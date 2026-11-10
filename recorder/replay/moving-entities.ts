// The moving entities of a recording, through the engine's tick (simulateVersionedMovingEntityTick). The server is the one
// that runs them in full: each entity of the server's view (srv.entities) with a `moving` state starts a tick from what the
// engine made of the tick before, and the next server tick's view has to match it exactly, its removal included. A divergence
// is reported, and the entity goes on from the recording. Nothing the engine leaves to the server is taken for a match: an
// entity gone that the tick did not end is counted in `gone`, with the reason the case gives (a merge, a pick-up, a burn).
// With `client`, the same for the client's view (nearbyEntities): the same physics under the client's branches.

import { createRequire } from 'node:module';
import type { NativeBoatState, NativeMovingEntityInputs, NativeMovingEntityState, NativeMovingEntityTickResult, NativePhysicsBinding } from '../../dist/native.js';
import { versionAtLeast } from '../scenarios/dsl/names.ts';
import type { Recording, Snapshot } from '../schema/recording.ts';
import type { Divergence } from './compare.ts';
import { movingBlocks } from './moving.ts';
import { createRequire as requireOf } from 'node:module';
import { decodeClientbound, decodeServerbound } from './packets.ts';
import { packetBytes } from './load.ts';
import { AreaWorld } from './world.ts';
import { cartReach, compareCartTick, minecartRules, setVelocities, withoutNegligible } from './minecart.ts';

const require = createRequire(import.meta.url);
const root = new URL('../../', import.meta.url);

type Vec = readonly [number, number, number];
const vec = (v: Vec) => ({ x: v[0], y: v[1], z: v[2] });
const array = (v: { x: number; y: number; z: number }): Vec => [v.x, v.y, v.z];

interface RecordedMoving {
    oldPos: Vec; tickCount: number; horizontalCollision: boolean; verticalCollision: boolean; verticalCollisionBelow?: boolean;
    fallDistance: number; noGravity: boolean; noPhysics: boolean; isInWater: boolean; isInLava: boolean; stuckSpeedMultiplier: Vec;
    fuse?: number; time?: number; block?: string; age?: number; pickupDelay?: number; health?: number;
    orbTicks?: number; followingTime?: number; throwTime?: number; following?: number;
}

interface RecordedEntity {
    /** The id of what it rides, in the end: its own if nothing. */
    readonly root?: number;
    id: number; type: string; pos: Vec; vel: Vec; onGround: boolean; box: number[]; moving?: RecordedMoving; rng?: string; nbt?: string;
    /** What a mob's travel started from and left (MobTravelMixin). */
    travelFrom?: RecordedTravel; travelTo?: RecordedTravel;
    /** A dragon's tick (DragonFlightMixin). */
    dragon?: RecordedDragon;
}

interface RecordedDragonState { pos: Vec; vel: Vec; yRot: number; yRotA: number; inWall: boolean; box: number[]; target?: Vec; steering?: Vec; flySpeed?: number; turnSpeed?: number }

interface RecordedDragon {
    from?: RecordedDragonState; to: RecordedDragonState; history: [number, number][]; sitting: boolean; hurtTime: number;
    parts: { id: number; pos: Vec; box: number[] }[];
    pushes: { id: number; impulse: Vec; pos: Vec; box: number[] }[];
}

const aabb = (box: readonly number[]) => ({ min: { x: box[0]!, y: box[1]!, z: box[2]! }, max: { x: box[3]!, y: box[4]!, z: box[5]! } });

/** One dragon's flight from what its phase left, against what vanilla's left; its parts where the tick left them; its wings' pushes. */
function compareDragon(row: { t: number }, e: RecordedEntity, version: string, binding: NativePhysicsBinding): Divergence[] {
    const { from, to, history, sitting, parts, pushes, hurtTime } = e.dragon!;
    const start = from ?? to;
    const result = binding.simulateVersionedDragonTick(version, {
        position: vec(start.pos), velocity: vec(start.vel), yawDegrees: start.yRot, yawAcceleration: start.yRotA, inWall: start.inWall,
        ...(versionAtLeast(version, '1.17') ? {} : { boundingBox: aabb(start.box) }),
        ...(from ? { target: vec((to.target ?? from.target)!) } : {}),
        ...(from?.steering ? { steeringTarget: vec(from.steering) } : {}),
        ...(from?.flySpeed === undefined ? {} : { flySpeed: from.flySpeed }), ...(from?.turnSpeed === undefined ? {} : { turnSpeed: from.turnSpeed }),
        sitting, history: history.map(([y, yawDegrees]) => ({ y, yawDegrees })), historyRecorded: true,
    });
    const out: Divergence[] = [];
    const check = (field: string, expected: unknown, actual: unknown) => {
        if (!same(expected, actual)) out.push({ tick: row.t, at: `ender_dragon#${e.id}`, source: 'native', field, expected, actual });
    };
    const velocity = array(result.state.velocity);
    check('pos', to.pos, array(result.state.position));
    check('vel', to.vel, versionAtLeast(version, '1.13') ? velocity : throughVec3(velocity));
    check('yRot', Math.fround(to.yRot), result.state.yawDegrees);
    check('yRotA', Math.fround(to.yRotA), result.state.yawAcceleration);
    const boxOf = (box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }) => [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
    check('parts', parts.length, result.parts.length);
    result.parts.forEach((part, i) => {
        const want = parts[i];
        check(`part ${i} id`, want?.id, e.id + part.idOffset);
        check(`part ${i} pos`, want?.pos, array(part.position));
        check(`part ${i} box`, want?.box, boxOf(part.boundingBox));
    });
    if (hurtTime === 0 || pushes.length > 0) {
        // (each pushed entity once for the engine, which pushes it for each wing it is near)
        const seen = new Map(pushes.map(p => [p.id, p]));
        const targets = [...seen.values()].map(p => ({ id: p.id, position: vec(p.pos), boundingBox: aabb(p.box) }));
        const got = binding.dragonWingPushesForVersion(version, result.parts, targets);
        check('pushes', pushes.map(p => [p.id, ...p.impulse]), got.map(p => [p.id, ...array(p.impulse)]));
    }
    return out;
}

interface RecordedTravel {
    pos: Vec; vel: Vec; yRot: number; input: Vec; speed: number; onGround: boolean; horizontalCollision: boolean; verticalCollision: boolean;
    isInWater: boolean; isInLava: boolean; noGravity: boolean; stuckSpeedMultiplier: Vec; fallDistance: number;
    bbWidth: number; bbHeight: number; maxUpStep: number; box: number[]; hasTarget: boolean; guardianMoving: boolean;
    climbing: boolean; pushedByFluid: boolean; fluidJumpThreshold: number; underWater: boolean; wantsToSwim: boolean; nearHome: boolean;
    marker: boolean; bodyItem: boolean; floats: boolean; tickCount: number;
    effects: { id: string; amplifier: number }[]; attributes: { gravity?: number; water_movement_efficiency?: number };
}

/** One mob's travel from what its AI left, against what vanilla's left. */
function compareTravel(row: { t: number }, e: RecordedEntity, version: string, world: unknown, binding: NativePhysicsBinding, effectiveAi?: boolean): Divergence[] {
    const from = e.travelFrom!;
    const to = e.travelTo!;
    const effect = (name: string) => from.effects.find(x => x.id.endsWith(name));
    const result = binding.simulateVersionedMobTravel(version, world as never, {
        kind: e.type, position: vec(from.pos), velocity: vec(from.vel), yawDegrees: from.yRot, input: vec(from.input), speed: from.speed,
        halfWidth: from.bbWidth / 2, height: from.bbHeight, maxStep: from.maxUpStep,
        ...(versionAtLeast(version, '1.17') ? {} : { boundingBox: { min: { x: from.box[0]!, y: from.box[1]!, z: from.box[2]! }, max: { x: from.box[3]!, y: from.box[4]!, z: from.box[5]! } } }),
        onGround: from.onGround, collidedHorizontally: from.horizontalCollision, collidedVertically: from.verticalCollision,
        inWater: from.isInWater, inLava: from.isInLava, noGravity: from.noGravity, stuckSpeedMultiplier: vec(from.stuckSpeedMultiplier),
        fallDistance: from.fallDistance, hasTarget: from.hasTarget, guardianMoving: from.guardianMoving,
        climbing: from.climbing, pushedByFluid: from.pushedByFluid, fluidJumpThreshold: from.fluidJumpThreshold, underWater: from.underWater,
        wantsToSwim: from.wantsToSwim, nearHome: from.nearHome, marker: from.marker, bodyItem: from.bodyItem, floatsInLiquids: from.floats, tickCount: from.tickCount,
        slowFalling: effect('slow_falling') !== undefined, dolphinsGrace: effect('dolphins_grace') !== undefined,
        ...(effect('levitation') ? { levitationAmplifier: effect('levitation')!.amplifier } : {}),
        ...(from.attributes.gravity === undefined ? {} : { gravity: from.attributes.gravity }),
        ...(from.attributes.water_movement_efficiency === undefined ? {} : { waterMovementEfficiency: from.attributes.water_movement_efficiency }),
        ...(effectiveAi === undefined ? {} : { effectiveAi }),
    });
    const want: Record<string, unknown> = {
        pos: to.pos, vel: to.vel, onGround: to.onGround, horizontalCollision: to.horizontalCollision, verticalCollision: to.verticalCollision,
        stuck: to.stuckSpeedMultiplier,
        // (a float until 1.21.5, a double after it)
        fallDistance: versionAtLeast(version, '1.21.5') ? to.fallDistance : Math.fround(to.fallDistance),
    };
    const got: Record<string, unknown> = {
        pos: array(result.position), vel: array(result.velocity), onGround: result.onGround, horizontalCollision: result.collidedHorizontally,
        verticalCollision: result.collidedVertically, stuck: array(result.stuckSpeedMultiplier ?? { x: 0, y: 0, z: 0 }),
        fallDistance: versionAtLeast(version, '1.21.5') ? result.fallDistance ?? 0 : Math.fround(result.fallDistance ?? 0),
    };
    if (!versionAtLeast(version, '1.13')) got.vel = throughVec3(got.vel as Vec);
    return Object.keys(want).filter(key => !same(want[key], got[key]))
        .map(key => ({ tick: row.t, at: `${e.type}#${e.id}`, source: 'native' as const, field: key, expected: want[key], actual: got[key] }));
}

/** What can push a server boat besides itself: the player as its packets left it (standing or crouching) and the view's pushable
 * entities (boats, carts and mobs; not items, orbs, arrows or what has no physics), each by its position and box. */
function pushersAbout(row: { srv?: { pos?: unknown; pose?: unknown; entities?: unknown } | null }, view: readonly RecordedEntity[], self: number): [Vec, readonly number[], boolean, boolean][] {
    const out: [Vec, readonly number[], boolean, boolean][] = [];
    const pos = row.srv?.pos as Vec | undefined;
    if (pos && (row.srv?.pose === 'standing' || row.srv?.pose === 'crouching')) {
        const half = Math.fround(0.6) / 2;
        const height = row.srv.pose === 'crouching' ? Math.fround(1.5) : Math.fround(1.8);
        out.push([pos, [pos[0] - half, pos[1], pos[2] - half, pos[0] + half, pos[1] + height, pos[2] + half], false, true]);
    }
    for (const e of view) {
        if (e.id === self || UNPUSHABLE.test(e.type) || (e as { noPhysics?: boolean }).noPhysics) continue;
        out.push([e.pos, e.box, BOAT.test(e.type), false]);
        // (another boat runs the same push in its own tick, and this one takes it again)
        if (BOAT.test(e.type)) out.push([e.pos, e.box, true, false]);
    }
    return out;
}
const UNPUSHABLE = /^(.*minecart|item|experience_orb|xp_orb|arrow|spectral_arrow|trident|snowball|egg|ender_pearl|fishing_bobber|falling_block|tnt|armor_stand|item_frame|painting|leash_knot|marker|area_effect_cloud|.*fireball|wind_charge|firework_rocket|eye_of_ender|potion|experience_bottle|lightning_bolt|Item|XPOrb|Arrow|FallingSand|PrimedTnt)$/;

/** The push of a hit on entity `target` that the row's packets brought: the knockback of the sprint and the enchantment, along the
 * player's look, 0.5 a level and 0.1 up (1.12.2 EntityPlayer.attackTargetEntityWithCurrentItem: addVelocity; 26.3 Player.attack). */
function attackPush(version: string, row: { c2s: readonly { name: string; b: string }[]; pre: Snapshot }, target: number, recording: Recording, strength: number): Vec | undefined {
    const hits = row.c2s.filter(p => /Interact|UseEntity|^ServerboundAttackPacket$/.test(p.name)).some(p => {
        const { params } = decodeServerbound(version, packetBytes(p.b));
        const id = params.target ?? params.entityId;
        return id === target && (params.mouse === 1 || params.action === 'attack' || /Attack/.test(p.name));
    });
    if (!hits) return undefined;
    const enchant = (recording.header.setup.equipment as Record<string, { enchantments?: Record<string, number> }> | undefined)?.mainhand?.enchantments?.knockback ?? 0;
    // (the sprint's level only at a full swing: attack strength over 0.9F, 1.12.2 EntityPlayer.java, 26.3 Player.attack knockbackAttack)
    const level = enchant + (row.pre.sprinting === true && strength > Math.fround(0.9) ? 1 : 0);
    if (level <= 0) return undefined;
    const mth = mthFor(versionAtLeast(version, '1.21.11'));
    const yaw = Math.fround(Math.fround(row.pre.yRot as number) * Math.fround(0.017453292));
    const f = Math.fround;
    return [f(f(-mth.sin(yaw)) * f(level * 0.5)), 0.1, f(f(mth.cos(yaw)) * f(level * 0.5))];
}

const { mthFor } = requireOf(import.meta.url)('../../dist/mineflayer/mth.js') as { mthFor(doubleArgument: boolean): { sin(x: number): number; cos(x: number): number } };
const BOAT = /(?:^|_)(?:boat|raft)$/;
const KIND: Readonly<Record<string, NativeMovingEntityState['kind']>> = {
    tnt: 'tnt', falling_block: 'falling_block', item: 'item', experience_orb: 'experience_orb',
    primed_tnt: 'tnt', xp_orb: 'experience_orb',
    PrimedTnt: 'tnt', FallingSand: 'falling_block', Item: 'item', XPOrb: 'experience_orb',
};

// java.util.Random's generator, which LegacyRandomSource shares: the state the recorder reads is the scrambled seed
const MULTIPLIER = 0x5DEECE66Dn;
const MASK = (1n << 48n) - 1n;
const step = (seed: bigint) => (seed * MULTIPLIER + 0xBn) & MASK;

/** The nextFloat()s between two states of a random, at most `limit` of them; undefined if the second is not reached. */
export function drawsBetween(from: bigint, to: bigint, limit = 256): number[] | undefined {
    const draws: number[] = [];
    let seed = from;
    while (seed !== to) {
        if (draws.length === limit) return undefined;
        seed = step(seed);
        draws.push(Number(seed >> 24n) / (1 << 24));
    }
    return draws;
}

/** FallingBlock.isFree of the block, by the names before 1.14: air, fire, liquids and the replaceable materials. */
const FREE = /^(air|fire|water|lava|flowing_water|flowing_lava|grass|tall_grass|tallgrass|fern|dead_bush|deadbush|snow|snow_layer|vine|seagrass|tall_seagrass|large_fern|double_plant)$/;

export interface MovingReplayResult {
    readonly compared: number;
    /** Entity ticks by kind. */
    readonly kinds: Readonly<Record<string, number>>;
    /** Entities that went without their tick saying so: the server's merge, pick-up or burn. */
    readonly gone: number;
    readonly diverged: number;
    readonly first?: Divergence;
    readonly divergences: readonly Divergence[];
    /** The tick's result for each `removed`, `explodes`, `landedAt`: how many ticks ended an entity. */
    readonly ended: number;
    readonly problems: readonly string[];
}

/** The state of a recorded entity as the engine takes it. */
function toState(e: RecordedEntity, kind: NativeMovingEntityState['kind'], authority: 'server' | 'client', area: AreaWorld): NativeMovingEntityState {
    const m = e.moving!;
    return {
        kind, authority, id: e.id, tickCount: m.tickCount,
        position: vec(e.pos), velocity: vec(e.vel),
        ...(versionAtLeast(area.version, '1.17') ? {} : { boundingBox: { min: { x: e.box[0]!, y: e.box[1]!, z: e.box[2]! }, max: { x: e.box[3]!, y: e.box[4]!, z: e.box[5]! } } }),
        onGround: e.onGround,
        collidedHorizontally: m.horizontalCollision, collidedVertically: m.verticalCollision,
        verticalCollisionBelow: m.verticalCollisionBelow ?? false,
        inWater: m.isInWater, inLava: m.isInLava, noGravity: m.noGravity, noPhysics: m.noPhysics,
        stuckSpeedMultiplier: vec(m.stuckSpeedMultiplier), fallDistance: m.fallDistance,
        firstTick: m.tickCount === 0,
        ...(m.fuse === undefined ? {} : { fuse: m.fuse }),
        ...(m.time === undefined ? {} : { time: m.time }),
        ...(m.block === undefined ? {} : carried(m.block, area)),
        ...(m.age === undefined ? {} : { age: m.age }),
        ...(m.pickupDelay === undefined ? {} : { pickupDelay: m.pickupDelay }),
        ...(m.throwTime === undefined ? {} : { pickupDelay: m.throwTime }),
        ...(m.following === undefined ? {} : { followingPlayer: m.following }),
        ...(m.followingTime === undefined ? {} : { followingTime: m.followingTime }),
        ...(m.orbTicks === undefined ? {} : { orbTicks: m.orbTicks }),
        // (Item.isFireproof: the netherite items and ancient debris, 1.16 Items.java `.fireproof()`)
        ...(kind === 'item' && /id:"?(minecraft:)?(netherite_|ancient_debris)/.test(e.nbt ?? '') ? { fireImmune: true } : {}),
    };
}

function carried(state: string, area: AreaWorld) {
    const name = state.replace(/^minecraft:/, '');
    const block = area.block(name) as unknown as { type: number; name: string };
    return { carriedBlock: block.type, carriedAir: block.name === 'air', concretePowder: /concrete_powder/.test(block.name) };
}

/** What the two states are compared in: everything of a state the recording says. */
interface Ticked { readonly id: number; readonly was: RecordedEntity; readonly after: RecordedEntity | undefined; readonly kind: NativeMovingEntityState['kind']; result: NativeMovingEntityTickResult }

/**
 * The merges of the items' ticks, in the level's order. An item whose tick looks about (the engine's mergeCheck) meets each
 * item its box grown by 0.5 sideways reaches, by the order of their ids, and the two of the same stack become one: the larger
 * stack takes the other, and of two the same the one met takes the one looking (26.3 ItemEntity.tryToMerge, 1.12.2
 * EntityItem.combineItems, 1.8.9 the same). What takes keeps the greater pickupDelay and the smaller age of the two (26.3
 * ItemEntity.merge, 1.8.9 EntityItem.combineItems). The look comes after the item's pickupDelay counts down and before its age
 * counts up (26.3 ItemEntity.tick, 1.12.2 EntityItem.onUpdate); an item later in the order has not yet ticked, and counts
 * both on from what it took.
 */
function mergeItems(version: string, ticked: Ticked[]): void {
    const items = ticked.filter(t => t.kind === 'item' && t.was.moving?.age !== undefined && t.was.moving.pickupDelay !== undefined);
    if (!items.some(t => t.result.mergeCheck)) return;
    const stackOf = (e: RecordedEntity) => (e as unknown as { itemStack?: { count: number; maxStack: number } & Record<string, unknown> }).itemStack;
    const kindOf = (e: RecordedEntity) => {
        const { count: _count, ...rest } = stackOf(e) ?? { count: 0, maxStack: 64 };
        return JSON.stringify(rest);
    };
    const modern = versionAtLeast(version, '1.14');
    const current = new Map(items.map(t => [t.id, {
        age: t.was.moving!.age!, pickupDelay: t.was.moving!.pickupDelay!, count: stackOf(t.was)?.count ?? 1, max: stackOf(t.was)?.maxStack ?? 64,
        done: false, gone: false,
    }]));
    const countDown = (delay: number) => (delay > 0 && delay !== 32767 ? delay - 1 : delay);
    const boxOf = (t: Ticked, done: boolean): number[] => {
        const halfWidth = (t.was.box[3]! - t.was.box[0]!) / 2;
        const height = t.was.box[4]! - t.was.box[1]!;
        const at = done ? array(t.result.state.position) : t.was.pos;
        return [at[0] - halfWidth, at[1], at[2] - halfWidth, at[0] + halfWidth, at[1] + height, at[2] + halfWidth];
    };
    const mergeable = (c: { age: number; pickupDelay: number; count: number; max: number; gone: boolean }) =>
        !c.gone && c.pickupDelay !== 32767 && c.age !== -32768 && (!modern || (c.age < 6000 && c.count < c.max));
    for (const x of items) {
        const self = current.get(x.id)!;
        self.pickupDelay = countDown(self.pickupDelay);
        self.done = true;
        if (x.result.mergeCheck && !self.gone) {
            const [a0, a1, a2, a3, a4, a5] = boxOf(x, true);
            const reach = [a0 - 0.5, a1, a2 - 0.5, a3 + 0.5, a4, a5 + 0.5];
            for (const y of items) {
                if (y === x || !mergeable(self)) continue;
                const other = current.get(y.id)!;
                if (!mergeable(other) || kindOf(y.was) !== kindOf(x.was) || other.count + self.count > other.max) continue;
                const b = boxOf(y, other.done);
                if (!(b[0]! < reach[3]! && b[3]! > reach[0]! && b[1]! < reach[4]! && b[4]! > reach[1]! && b[2]! < reach[5]! && b[5]! > reach[2]!)) continue;
                const [to, from] = other.count < self.count ? [self, other] : [other, self];
                to.count += from.count;
                to.pickupDelay = Math.max(to.pickupDelay, from.pickupDelay);
                to.age = Math.min(to.age, from.age);
                from.gone = true;
                if (self.gone) break;
            }
        }
        if (self.age !== -32768) self.age += 1;
    }
    for (const t of items) {
        const c = current.get(t.id)!;
        t.result = { ...t.result, state: { ...t.result.state, age: c.age, pickupDelay: c.pickupDelay } };
    }
}

function fields(state: NativeMovingEntityState, recorded?: RecordedEntity): Record<string, unknown> {
    const m = recorded?.moving;
    const out: Record<string, unknown> = {
        pos: array(state.position), vel: array(state.velocity), onGround: state.onGround ?? false,
        horizontalCollision: state.collidedHorizontally ?? false, verticalCollision: state.collidedVertically ?? false,
        inWater: state.inWater ?? false, noPhysics: state.noPhysics ?? false, tickCount: state.tickCount ?? 0,
        stuck: array(state.stuckSpeedMultiplier ?? { x: 0, y: 0, z: 0 }), fallDistance: Math.fround(state.fallDistance ?? 0),
    };
    if (m?.verticalCollisionBelow !== undefined) out.verticalCollisionBelow = state.verticalCollisionBelow ?? false;
    if (m?.fuse !== undefined) out.fuse = state.fuse;
    if (m?.time !== undefined) out.time = state.time;
    if (m?.age !== undefined) out.age = state.age;
    if (m?.pickupDelay !== undefined) out.pickupDelay = state.pickupDelay;
    if (m?.orbTicks !== undefined) out.following = state.followingPlayer ?? null;
    return out;
}

/** Vec3's constructor before 1.13 turns -0.0 to 0.0 (1.12.2 Vec3d.java:21-31), and the recorder reads the motion through it. */
const throughVec3 = (v: Vec) => [v[0] + 0, v[1] + 0, v[2] + 0];

function same(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
    return Object.is(a, b) || (a == null && b == null);
}

interface Side {
    readonly view: (row: Recording['rows'][number]) => readonly Snapshot[] | undefined;
    readonly authority: 'server' | 'client';
}

const SERVER: Side = { view: row => row.srv?.entities, authority: 'server' };
const CLIENT: Side = { view: row => row.post.nearbyEntities as readonly Snapshot[] | undefined, authority: 'client' };

function worldSync(recording: Recording, binding: NativePhysicsBinding) {
    const { NativeWorldSync } = require(new URL('dist/index.js', root).pathname.replace(/^\/([A-Za-z]:)/, '$1')) as {
        NativeWorldSync: new (binding: NativePhysicsBinding, registry: unknown, release?: string) => {
            world: unknown;
            blockChanged(pos: { x: number; y: number; z: number }): void;
            setMovingBlocks(blocks: readonly unknown[]): void;
            movingPistonsOf(blocks: readonly never[]): readonly unknown[];
            sync(source: AreaWorld, box: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }, margin: number): void;
            setWorldBorder(border: { centerX: number; centerZ: number; size: number }, game?: { minY?: number; height?: number }): void;
        };
    };
    return { sync: new NativeWorldSync(binding, require('prismarine-registry')(recording.header.mc), recording.header.mc), area: new AreaWorld(recording.header) };
}

/** The block entities tick after the entities: what the tick left, pushed by the pistons of the tick. */
function pushed(result: NativeMovingEntityTickResult, was: RecordedEntity, moving: readonly unknown[], version: string, sync: ReturnType<typeof worldSync>['sync'], binding: NativePhysicsBinding): NativeMovingEntityTickResult {
    if (moving.length === 0 || result.state.removed) return result;
    const state = result.state;
    const push = binding.simulateVersionedEntityPistonPush(version, sync.world as never, {
        position: state.position, velocity: state.velocity, ...(state.boundingBox ? { boundingBox: state.boundingBox } : {}),
        halfWidth: (was.box[3]! - was.box[0]!) / 2, height: was.box[4]! - was.box[1]!,
        onGround: state.onGround ?? false, collidedHorizontally: state.collidedHorizontally ?? false, collidedVertically: state.collidedVertically ?? false,
        verticalCollisionBelow: state.verticalCollisionBelow ?? false, fallDistance: state.fallDistance ?? 0,
        ...(state.stuckSpeedMultiplier ? { stuckSpeedMultiplier: state.stuckSpeedMultiplier } : {}), noPhysics: state.noPhysics ?? false,
        // (items and the like simulate on both sides, and the server alone owns them: 26.3 Entity.java:3721)
        clientSide: state.authority !== 'server', controlledByLocalInstance: state.authority === 'server', canSimulateMovement: true,
    }, sync.movingPistonsOf(moving as never) as never);
    return {
        ...result,
        state: {
            ...state, position: push.position, velocity: push.velocity, ...(push.boundingBox ? { boundingBox: push.boundingBox } : {}), onGround: push.onGround,
            collidedHorizontally: push.collidedHorizontally, collidedVertically: push.collidedVertically, verticalCollisionBelow: push.verticalCollisionBelow,
            fallDistance: push.fallDistance, stuckSpeedMultiplier: push.stuckSpeedMultiplier,
        },
    };
}

/** Every moving entity of the recording, tick by tick, on the server's side or the client's. */
export function replayMovingEntities(recording: Recording, binding: NativePhysicsBinding, side: 'server' | 'client' = 'server'): MovingReplayResult {
    const { sync, area } = worldSync(recording, binding);
    const version = recording.header.mc;
    if (side === 'client') return replayClient(recording, binding, sync, area);
    const from = side === 'server' ? SERVER : CLIENT;
    const bounds = versionAtLeast(version, '1.18') ? { minY: -64, height: 384 } : { minY: 0, height: 256 };
    const divergences: Divergence[] = [];
    const kinds: Record<string, number> = {};
    const problems: string[] = [];
    let compared = 0;
    let gone = 0;
    let ended = 0;
    const carriedOn = new Map<number, NativeMovingEntityState>();
    let before = new Map<number, RecordedEntity>();
    let lastServer: (typeof recording.rows)[number]['srv'] | undefined;
    const cartVelocities = setVelocities(recording);
    let lastVehicle: unknown;
    let lastRowSeen: (typeof recording.rows)[number] | undefined;
    let strengthTicker = 1000;
    let lastStrength = 1;
    // whether a mob has its AI, which the recording says only of what the case summoned: of a kind all its summons agree on
    // (by the setup's summons, the body's, and a summon command's NoAI tag)
    const setup = recording.header.setup as { summons?: readonly { type: string; noAi?: boolean }[]; commands?: readonly string[] };
    const body = (recording.header.body as unknown as readonly { action?: { op?: string; summon?: { type: string; noAi?: boolean } } }[])
        .flatMap(step => (step.action?.op === 'summon' && step.action.summon ? [step.action.summon] : []));
    const commanded = (setup.commands ?? []).flatMap(c => {
        const m = /summon\s+(?:minecraft:)?(\w+)([^{]*)(\{.*\})?/.exec(c);
        return m ? [{ type: m[1]!, noAi: /NoAI:\s*1b?/i.test(m[3] ?? '') }] : [];
    });
    const summons = [...(setup.summons ?? []), ...body, ...commanded];
    // a server command of the body that sets NoAI (data merge entity, entitydata before 1.13) holds from the row after it: a
    // server action runs between a client tick and the server's (README, Writing scenarios). Horses were all EntityHorse before 1.11
    const merges: { from: number; selector: string; noAi: boolean }[] = [];
    {
        let t = 0;
        for (const step of recording.header.body as unknown as readonly { op: string; ticks?: number; action?: { op?: string; command?: string } }[]) {
            if (step.op === 'ticks' || step.op === 'press' || step.op === 'turn') t += step.ticks ?? 0;
            const m = step.op === 'server' && step.action?.op === 'command' ? /type=(?:minecraft:)?(\w+)[^{]*\{[^}]*NoAI:\s*([01])b?/i.exec(step.action.command ?? '') : null;
            if (m) merges.push({ from: t + 1, selector: m[1]!.toLowerCase(), noAi: m[2] === '1' });
        }
    }
    const selects = (selector: string, type: string) => {
        const name = type.replace(/^minecraft:/, '').toLowerCase();
        return selector === name || (selector === 'entityhorse' && /horse|donkey|mule/.test(name));
    };
    const noAiOf = (type: string, t: number): boolean | undefined => {
        // (NoAI is a Mob's: an armor stand is no Mob, and it travels whatever its summon said, 26.3 Mob.isEffectiveAi and
        // Mob.readAdditionalSaveData, ArmorStand extends LivingEntity; the recorder sets it on a Mob alone, ServerOpsImpl.summon)
        if (/^(minecraft:)?armor_?stand$/i.test(type)) return undefined;
        const merged = merges.filter(m => m.from <= t && selects(m.selector, type)).at(-1);
        if (merged) return merged.noAi;
        // (a 1.8 to 1.10 horse is summoned as EntityHorse with its kind after a colon, EntityHorse:skeleton)
        const named = (summoned: string) => {
            const horse = /^EntityHorse(?::(\w+))?$/.exec(summoned);
            if (!horse) return summoned.replace(/^minecraft:/, '').toLowerCase();
            const kind = (horse[1] ?? 'horse').toLowerCase();
            return kind === 'skeleton' || kind === 'zombie' ? `${kind}_horse` : kind;
        };
        const of = summons.filter(x => named(x.type) === type.replace(/^minecraft:/, '').toLowerCase()).map(x => x.noAi === true);
        return of.length > 0 && of.every(x => x === of[0]) ? of[0] : undefined;
    };
    // (an empty boat ticks on the server alone: what the engine keeps of it, its status and timer, goes on from tick to tick)
    const boats = new Map<number, NativeBoatState>();
    let boatsBefore = new Map<number, RecordedEntity>();
    for (const row of recording.rows) {
        for (const [x, y, z, state] of row.blocks) {
            area.setState(x, y, z, state);
            sync.blockChanged({ x, y, z });
        }
        const view = from.view(row) as unknown as readonly RecordedEntity[] | undefined;
        if (!view) continue;
        const now = new Map(view.filter(e => e.moving && KIND[e.type]).map(e => [e.id, e]));
        // a TNT cart that blows up in its tick pushes the items about it before an item later in the level's order ticks (26.3
        // ServerExplosion.hurtEntities, ItemEntity takes the knockback): the carts' tick gives where the blast left each item
        const blastFrom = side === 'server' && lastServer && row.s2c.some(p => /Explo/.test(p.name))
            ? ((lastServer.entities ?? []) as unknown as readonly RecordedEntity[]).filter(e => e.type === 'tnt_minecart').map(e => e.id) : [];
        let blasted: ReadonlyMap<number, { velocity?: { x: number; y: number; z: number } | null }> | undefined;
        if (blastFrom.length > 0) {
            const reach = cartReach(lastServer as never);
            if (reach) sync.sync(area, reach, 4);
            blasted = compareCartTick(binding, version, sync.world as never, minecartRules(recording, version), lastServer as never, row as never, recording.header.player.id,
                (recording.header.setup.summons ?? []).map(s => s.ref), cartVelocities.get(row.t), lastRowSeen?.input.keys).items;
        }
        // (and the player's own vehicle, which the server's view does not list among the passengers: the player controls it, and the
        // server moves it as the client's move packets say, 26.3 ServerGamePacketListenerImpl.handleMoveVehicle)
        const ridden = [row.pre.vehicle, row.post.vehicle].map(v => (v as { id?: number } | null | undefined)?.id).filter(id => id !== undefined);
        const riders = new Set([...view.filter(e => e.root !== undefined && e.root !== e.id).map(e => e.root), ...ridden]);
        // (a dismount the client made in the row's packets is the server's within its tick, after the mount's travel: the row before's)
        const steered = new Set([row.pre.vehicle ? undefined : lastVehicle, row.pre.vehicle, row.post.vehicle].flatMap(v => {
            const vehicle = v as { id?: number; controlledByLocalInstance?: boolean } | null | undefined;
            return vehicle?.id !== undefined && vehicle.controlledByLocalInstance === true ? [vehicle.id] : [];
        }));
        for (const mob of view) {
            if (mob.dragon) {
                divergences.push(...compareDragon(row, mob, version, binding));
                compared += 1;
                kinds.ender_dragon = (kinds.ender_dragon ?? 0) + 1;
            }
            // (a passenger's tick is rideTick: it has no travel of its own; a mount the player steers is the client's to move, and
            // the server's travel stops it, 1.16.5 AbstractHorse.java:788-792 and ItemSteerable.java:33-44, until 1.19.3)
            if (!mob.travelFrom || !mob.travelTo || (mob.root !== undefined && mob.root !== mob.id) || steered.has(mob.id)) continue;
            const { box, vel } = mob.travelFrom;
            sync.sync(area, {
                minX: box[0]! - Math.abs(vel[0]), minY: box[1]! - Math.abs(vel[1]) - 1, minZ: box[2]! - Math.abs(vel[2]),
                maxX: box[3]! + Math.abs(vel[0]), maxY: box[4]! + Math.abs(vel[1]) + 2, maxZ: box[5]! + Math.abs(vel[2]),
            }, 4);
            sync.setWorldBorder({ centerX: 0, centerZ: 0, size: 5.9999968e7 }, bounds);
            divergences.push(...compareTravel(row, mob, version, sync.world, binding, noAiOf(mob.type, row.t) === undefined ? undefined : !noAiOf(mob.type, row.t)));
            compared += 1;
            kinds[mob.type] = (kinds[mob.type] ?? 0) + 1;
        }
        const ticked: Ticked[] = [];
        // (the level ticks what it holds in the order it took it in, which is the order of the ids: 1.12.2 World.loadedEntityList,
        // 1.16.5 ServerWorld.entitiesById, 26.3 EntityTickList)
        for (const [id, was] of [...before].sort(([a], [b]) => a - b)) {
            const kind = KIND[was.type]!;
            const carried = carriedOn.get(id) ?? toState(was, kind, from.authority, area);
            const blast = blastFrom.some(cart => cart < id) ? blasted?.get(id)?.velocity ?? undefined : undefined;
            const seed = blast ? { ...carried, velocity: blast } : carried;
            sync.sync(area, {
                minX: was.box[0]! - Math.abs(was.vel[0]), minY: was.box[1]! - Math.abs(was.vel[1]) - 1, minZ: was.box[2]! - Math.abs(was.vel[2]),
                maxX: was.box[3]! + Math.abs(was.vel[0]), maxY: was.box[4]! + Math.abs(was.vel[1]) + 1, maxZ: was.box[5]! + Math.abs(was.vel[2]),
            }, 4);
            sync.setWorldBorder({ centerX: 0, centerZ: 0, size: 5.9999968e7 }, bounds);
            const moving = movingBlocks(version, row.pre, area, problems);
            sync.setMovingBlocks(moving);
            const after = now.get(id);
            const inputs = inputsOf(recording.header.player.id, row, was, after, area, version);
            const tick = (i: NativeMovingEntityInputs): NativeMovingEntityTickResult => binding.simulateVersionedMovingEntityTick(version, sync.world as never, seed, i);
            let result = tick(inputs);
            // the entity's draws end its tick: whatever its base tick drew for sounds and splashes comes first
            if (result.randomUsed > 0 && inputs.random && result.randomUsed <= inputs.random.length) {
                result = tick({ ...inputs, random: inputs.random.slice(inputs.random.length - result.randomUsed) });
            }
            result = pushed(result, was, moving, version, sync, binding);
            ticked.push({ id, was, after, kind, result });
        }
        if (side === 'server') mergeItems(version, ticked);
        for (const { id, after, kind, result } of ticked) {
            compared += 1;
            kinds[kind] = (kinds[kind] ?? 0) + 1;
            if (result.state.removed) ended += 1;
            carriedOn.delete(id);
            if (!after) {
                if (!result.state.removed) gone += 1;
                continue;
            }
            if (result.state.removed) {
                divergences.push({ tick: row.t, at: `${kind}#${id}`, source: 'native', field: 'removed', expected: false, actual: true });
                continue;
            }
            const want = fields(toState(after, kind, from.authority, area), after);
            const got = fields(result.state, after);
            if (!versionAtLeast(version, '1.13')) got.vel = throughVec3(got.vel as Vec);
            let matched = true;
            for (const key of Object.keys(want)) {
                if (!same(want[key], got[key])) {
                    matched = false;
                    divergences.push({ tick: row.t, at: `${kind}#${id}`, source: 'native', field: key, expected: want[key], actual: got[key] });
                }
            }
            // what the engine made goes on, so that what it keeps is proved too; after a divergence the recording takes over
            if (matched) carriedOn.set(id, result.state);
        }
        if (side === 'server') {
            // the server's player on foot, whose own tick (ServerPlayer.doTick) moves it by its motion and then pushes what its box
            // meets (LivingEntity.aiStep: travel, then pushEntities): from 1.9 in the connection's tick, after the level's (1.15
            // ServerPlayNetworkHandler.tick playerTick, 26.3 ServerGamePacketListenerImpl.tick), and before it in 1.8, for a move
            // packet and before the packet's move (1.8.9 ServerPlayNetworkHandler.onPlayerMove tickPlayer)
            const onFoot = !row.pre.vehicle && !row.post.vehicle && (row.srv?.pose === 'standing' || row.srv?.pose === 'crouching');
            const footBefore = !!lastRowSeen && !lastRowSeen.post.vehicle && (lastServer?.pose === 'standing' || lastServer?.pose === 'crouching');
            const legacy = !versionAtLeast(version, '1.9');
            // (1.8: a row's view is the level's tick, and its packets are handled after it: the boats of this tick meet the player
            // ticks of the row before's move packets, from where that row left the player)
            const movePackets = (lastRowSeen?.c2s ?? []).filter(p => /^(Pos|PosRot|Rot|StatusOnly|Flying|C03.*|.*MovePlayer.*|.*PlayerPacket.*)$/.test(p.name));
            let playerImpulse: Vec = [0, 0, 0];
            const playerTick = (at: Vec, velocity: Vec, onGround: boolean, pose: unknown, solids: readonly (readonly number[])[]): { box: number[]; velocity: Vec } => {
                const height = pose === 'crouching' ? Math.fround(1.5) : Math.fround(1.8);
                const half = Math.fround(0.6) / 2;
                sync.sync(area, { minX: at[0] - 2, minY: at[1] - 2, minZ: at[2] - 2, maxX: at[0] + 2, maxY: at[1] + 3, maxZ: at[2] + 2 }, 4);
                const travelled = binding.simulateVersionedMobTravel(version, sync.world as never, {
                    // (aiStep drops a negligible motion before the travel)
                    kind: 'living', position: vec(at), velocity: vec(((v: Vec): Vec => [v[0], Math.abs(v[1]) < (versionAtLeast(version, '1.9') ? 0.003 : 0.005) ? 0 : v[1], v[2]])(withoutNegligible(version, velocity))), yawDegrees: 0, input: { x: 0, y: 0, z: 0 }, speed: 0,
                    halfWidth: half, height, maxStep: 0.6, onGround,
                    ...(versionAtLeast(version, '1.17') ? {} : { boundingBox: { min: { x: at[0] - half, y: at[1], z: at[2] - half }, max: { x: at[0] + half, y: at[1] + height, z: at[2] + half } } }),
                });
                const moved = travelled.position;
                // (a boat is solid to what moves, Entity.getCollisionBox: the travel meets the boats about as well, y first and then x
                // and z, 1.8.9 Entity.move; the world the engine reads has no entity in it)
                let [x, y, z] = at;
                const clip = (axis: 0 | 1 | 2, delta: number) => {
                    let d = delta;
                    for (const box of solids) {
                        const lo = [x - half, y, z - half], hi = [x + half, y + height, z + half];
                        const others = ([0, 1, 2] as const).filter(a => a !== axis);
                        if (!others.every(a => lo[a]! < box[a + 3]! && hi[a]! > box[a]!)) continue;
                        if (d > 0 && hi[axis]! <= box[axis]!) d = Math.min(d, box[axis]! - hi[axis]!);
                        else if (d < 0 && lo[axis]! >= box[axis + 3]!) d = Math.max(d, box[axis + 3]! - lo[axis]!);
                    }
                    return d;
                };
                y += clip(1, moved.y - at[1]);
                x += clip(0, moved.x - at[0]);
                z += clip(2, moved.z - at[2]);
                return { box: [x - half, y, z - half, x + half, y + height, z + half, x, y, z], velocity: array(travelled.velocity) };
            };
            // what each boat starts its tick with: its motion, a hit's push, and in 1.8 the pushes of the player's ticks, each from
            // where the move packet before it put the player and with the motion the tick before left (the server's player keeps it)
            const starts = new Map<number, Vec>();
            for (const [id, was] of boatsBefore) {
                const hit = lastRowSeen ? attackPush(version, lastRowSeen, id, recording, lastStrength) : undefined;
                starts.set(id, hit ? [was.vel[0] + hit[0], was.vel[1] + hit[1], was.vel[2] + hit[2]] : was.vel);
            }
            if (legacy && footBefore && movePackets.length > 0 && lastServer?.pos && lastServer.vel) {
                let at = lastServer.pos as unknown as Vec;
                let motion = lastServer.vel as unknown as Vec;
                let ground = lastServer.onGround === true;
                for (const packet of movePackets) {
                    // (the boats where the level's tick before left them)
                    const moved = playerTick(at, motion, ground, lastServer.pose, [...boatsBefore.values()].map(e => e.box));
                    motion = moved.velocity;
                    const b = moved.box;
                    // (the player's box grown by 0.2 sideways, LivingEntity.tickCramming, and the boat's Entity.pushAwayFrom)
                    const reach = [b[0]! - 0.2, b[1]!, b[2]! - 0.2, b[3]! + 0.2, b[4]!, b[5]! + 0.2];
                    for (const [id, was] of boatsBefore) {
                        if (!(reach[0]! < was.box[3]! && reach[3]! > was.box[0]! && reach[1]! < was.box[4]! && reach[4]! > was.box[1]! && reach[2]! < was.box[5]! && reach[5]! > was.box[2]!)) continue;
                        const pushed = binding.simulateVersionedEntityPush(version,
                            { position: vec(was.pos), velocity: vec(starts.get(id)!), noPhysics: false, vehicle: false, pushable: true, pushthrough: 0 },
                            { position: { x: b[6]!, y: b[7]!, z: b[8]! }, velocity: vec(motion), noPhysics: false, vehicle: false, pushable: true, pushthrough: 0 }, false);
                        starts.set(id, array(pushed.leftVelocity));
                        motion = array(pushed.rightVelocity);
                    }
                    const { params } = decodeServerbound(version, packetBytes(packet.b)) as { params: { x?: number; y?: number; z?: number; onGround?: boolean } };
                    if (params.x !== undefined && params.y !== undefined && params.z !== undefined) at = [params.x, params.y, params.z];
                    if (params.onGround !== undefined) ground = params.onGround;
                }
            }
            const ticked: { id: number; after: RecordedEntity; state: NativeBoatState }[] = [];
            for (const [id, was] of boatsBefore) {
                const after = (view as readonly RecordedEntity[]).find(e => e.id === id);
                // (a boat the player got into within this tick, a click's or a command's, is the player's from it on)
                if (!after || riders.has(id)) continue;
                sync.sync(area, {
                    minX: was.box[0]! - 1, minY: was.box[1]! - 2, minZ: was.box[2]! - 1, maxX: was.box[3]! + 1, maxY: was.box[4]! + 2, maxZ: was.box[5]! + 1,
                }, 4);
                sync.setWorldBorder({ centerX: 0, centerZ: 0, size: 5.9999968e7 }, bounds);
                // a hit the row's packets brought, before the level ticks: Player.attack's push of what is no LivingEntity (1.12.2
                // EntityPlayer.attackTargetEntityWithCurrentItem, 26.3 Player.attack causeExtraKnockback)
                // (a hit the client sent in its last tick: the server handles it as this tick begins)
                const start = starts.get(id)!;
                const state = binding.simulateVersionedBoatTick(version, sync.world as never, {
                    ...boats.get(id), position: vec(was.pos), velocity: vec(start), onGround: was.onGround, serverSide: true, inWater: false,
                    yaw: 0, forward: false, left: false, right: false,
                    ...(versionAtLeast(version, '1.17') ? {} : { boundingBox: { min: vec([was.box[0]!, was.box[1]!, was.box[2]!]), max: vec([was.box[3]!, was.box[4]!, was.box[5]!]) } }),
                });
                // after its move the boat pushes what is about it, and is pushed back: AbstractBoat.tick's list of what its box grown by
                // 0.2 and shrunk by 0.01 meets, EntitySelector.pushableBy, Entity.push (1.9.4 EntityBoat.onUpdate, 26.3 AbstractBoat.tick).
                // Before 1.9 a boat pushes only boats, and a player pushes from its own update (not modelled here)
                if (versionAtLeast(version, '1.9')) {
                    const half = (was.box[3]! - was.box[0]!) / 2;
                    const height = was.box[4]! - was.box[1]!;
                    const p = state.position;
                    const grown = [p.x - half - 0.2, p.y + 0.01, p.z - half - 0.2, p.x + half + 0.2, p.y + height - 0.01, p.z + half + 0.2];
                    for (const [position, box, boat, player] of pushersAbout(row, view as readonly RecordedEntity[], id)) {
                        if (!(box[0]! < grown[3]! && box[3]! > grown[0]! && box[1]! < grown[4]! && box[4]! > grown[1]! && box[2]! < grown[5]! && box[5]! > grown[2]!)) continue;
                        // Boat.push: another boat only below this one's top, anything else only at or under its bottom (1.9.4
                        // BoatEntity.pushAwayFrom, 26.3 AbstractBoat.java:168-177); the other boat's own push asks the same of this one
                        if (boat ? !(box[1]! < p.y + height && p.y < box[4]!) : !(box[1]! <= p.y)) continue;
                        const pushed = binding.simulateVersionedEntityPush(version,
                            { position: state.position, velocity: state.velocity, noPhysics: false, vehicle: false, pushable: true, pushthrough: 0 },
                            { position: vec(position), velocity: { x: 0, y: 0, z: 0 }, noPhysics: false, vehicle: false, pushable: true, pushthrough: 0 }, false);
                        // Vec3.add: the push is added to the velocity, so a -0 the push leaves alone becomes +0 (-0 plus 0); a
                        // pusher nearer than 0.01 adds nothing at all (Entity.push), and the velocity keeps its signs
                        const v = state.velocity, l = pushed.leftVelocity;
                        if (player) playerImpulse = [playerImpulse[0] + pushed.rightVelocity.x, playerImpulse[1] + pushed.rightVelocity.y, playerImpulse[2] + pushed.rightVelocity.z];
                        if (!(l.x === v.x && l.y === v.y && l.z === v.z)) {
                            const plus = (was: number, now: number) => (now === was ? was + 0 : Object.is(now, -0) ? 0 : now);
                            state.velocity = { x: plus(v.x, l.x), y: plus(v.y, l.y), z: plus(v.z, l.z) };
                        }
                    }
                }
                // before 1.9 a boat pushes only boats, from its own tick (1.8.9 BoatEntity.tick: its box grown by 0.2 sideways, and
                // Entity.pushAwayFrom of each boat it meets, which pushes both): after its move this one pushes the boats about it, where
                // they are (one later in the level's order where the tick before left it), and one later pushes this one again
                if (!versionAtLeast(version, '1.9')) {
                    const half = (was.box[3]! - was.box[0]!) / 2;
                    const height = was.box[4]! - was.box[1]!;
                    const p = state.position;
                    const mine = [p.x - half - 0.2, p.y, p.z - half - 0.2, p.x + half + 0.2, p.y + height, p.z + half + 0.2];
                    const earlier = new Map(((lastServer?.entities ?? []) as unknown as readonly RecordedEntity[]).map(e => [e.id, e]));
                    const meets = (a: readonly number[], b: readonly number[]) => a[0]! < b[3]! && a[3]! > b[0]! && a[1]! < b[4]! && a[4]! > b[1]! && a[2]! < b[5]! && a[5]! > b[2]!;
                    const pushes: Vec[] = [];
                    for (const other of view as readonly RecordedEntity[]) {
                        if (other.id === id || !BOAT.test(other.type)) continue;
                        const there = other.id < id ? other : earlier.get(other.id) ?? other;
                        if (meets(mine, there.box)) pushes.push(there.pos);
                        if (other.id < id) continue;
                        const o = other.box;
                        const reach = [o[0]! - 0.2, o[1]!, o[2]! - 0.2, o[3]! + 0.2, o[4]!, o[5]! + 0.2];
                        if (meets(reach, [p.x - half, p.y, p.z - half, p.x + half, p.y + height, p.z + half])) pushes.push(other.pos);
                    }
                    for (const from of pushes) {
                        const pushed = binding.simulateVersionedEntityPush(version,
                            { position: state.position, velocity: state.velocity, noPhysics: false, vehicle: false, pushable: true, pushthrough: 0 },
                            { position: vec(from), velocity: { x: 0, y: 0, z: 0 }, noPhysics: false, vehicle: false, pushable: true, pushthrough: 0 }, false);
                        state.velocity = pushed.leftVelocity;
                    }
                }
                ticked.push({ id, after, state });
            }
            // (from 1.9 the player's tick comes after the level's: it moves by its motion and what the boats' pushes gave it, and
            // pushes each boat its box meets at or above the boat's bottom, Boat.push)
            if (!legacy && onFoot && ticked.length > 0 && row.srv?.pos && lastServer?.vel) {
                const v = lastServer.vel as unknown as Vec;
                const b = playerTick(row.srv.pos as unknown as Vec, [v[0] + playerImpulse[0], v[1] + playerImpulse[1], v[2] + playerImpulse[2]], lastServer.onGround === true, row.srv.pose,
                    ticked.map(({ id, state }) => {
                        const was = boatsBefore.get(id)!;
                        const half = (was.box[3]! - was.box[0]!) / 2, height = was.box[4]! - was.box[1]!, p = state.position;
                        return [p.x - half, p.y, p.z - half, p.x + half, p.y + height, p.z + half];
                    })).box;
                for (const { id, state } of ticked) {
                    const was = boatsBefore.get(id)!;
                    const half = (was.box[3]! - was.box[0]!) / 2;
                    const height = was.box[4]! - was.box[1]!;
                    const p = state.position;
                    const box = [p.x - half, p.y, p.z - half, p.x + half, p.y + height, p.z + half];
                    if (!(b[0]! < box[3]! && b[3]! > box[0]! && b[1]! < box[4]! && b[4]! > box[1]! && b[2]! < box[5]! && b[5]! > box[2]!) || !(b[1]! <= p.y)) continue;
                    const pushed = binding.simulateVersionedEntityPush(version,
                        { position: state.position, velocity: state.velocity, noPhysics: false, vehicle: false, pushable: true, pushthrough: 0 },
                        { position: { x: b[6]!, y: b[7]!, z: b[8]! }, velocity: { x: 0, y: 0, z: 0 }, noPhysics: false, vehicle: false, pushable: true, pushthrough: 0 }, false);
                    const w = state.velocity, l = pushed.leftVelocity;
                    if (!(l.x === w.x && l.y === w.y && l.z === w.z)) {
                        const plus = (x: number, now: number) => (now === x ? x + 0 : Object.is(now, -0) ? 0 : now);
                        state.velocity = { x: plus(w.x, l.x), y: plus(w.y, l.y), z: plus(w.z, l.z) };
                    }
                }
            }
            for (const { id, after, state } of ticked) {
                boats.set(id, state);
                compared += 1;
                kinds.boat = (kinds.boat ?? 0) + 1;
                const check = (field: string, expected: unknown, actual: unknown) => {
                    if (!same(expected, actual)) divergences.push({ tick: row.t, at: `boat#${id}`, source: 'native', field, expected, actual });
                };
                check('pos', after.pos, array(state.position));
                check('vel', after.vel, array(state.velocity));
                check('onGround', after.onGround, state.onGround);
            }
            boatsBefore = new Map((view as readonly RecordedEntity[]).filter(e => BOAT.test(e.type) && (e.root === undefined || e.root === e.id) && !riders.has(e.id)).map(e => [e.id, e]));
        }
        before = now;
        lastServer = row.srv ?? lastServer;
        lastVehicle = row.post.vehicle;
        lastRowSeen = row;
        // Player.attackStrengthTicker: one more each tick, and an attack or a swing starts it over (as the adapter layer counts it);
        // the strength of a hit is the ticker's before it, at the hand's attack speed of 4
        strengthTicker += 1;
        const swings = row.c2s.some(p => /Swing|Animation|Punch/.test(p.name));
        const attacks = row.c2s.some(p => /Interact|UseEntity|^ServerboundAttackPacket$/.test(p.name));
        lastStrength = Math.min(1, Math.max(0, Math.fround((strengthTicker + 0.5) / Math.fround(20 / 4))));
        if (attacks || swings) strengthTicker = 0;
    }
    return {
        compared, kinds, gone, ended, divergences, problems,
        diverged: new Set(divergences.map(d => `${d.tick}/${d.at}`)).size,
        ...(divergences[0] ? { first: divergences[0] } : {}),
    };
}

/**
 * The client's tick of each entity: from where the row's packets left it (pre) to where its tick left it (post). A position the
 * interpolation of the client moved it to is the client's own and no physics: such a tick is left out (`gone` counts it).
 */
function replayClient(recording: Recording, binding: NativePhysicsBinding, sync: ReturnType<typeof worldSync>['sync'], area: AreaWorld): MovingReplayResult {
    const version = recording.header.mc;
    const divergences: Divergence[] = [];
    const kinds: Record<string, number> = {};
    const problems: string[] = [];
    const bounds = versionAtLeast(version, '1.18') ? { minY: -64, height: 384 } : { minY: 0, height: 256 };
    let compared = 0;
    let gone = 0;
    let ended = 0;
    // an orb a client holds from 1.21.5 follows the server's position by interpolation, before its tick (1.21.5
    // ExperienceOrb.java:79): the client's way of showing it, and the pull starts from it. No such tick is compared; the server's side proves the physics
    const interpolates = (kind: string) => kind === 'experience_orb' && versionAtLeast(version, '1.21.5');
    // 1.18 and 1.18.1 keep a falling block the server removed for 50 ms more: setRemoved(DISCARDED) only sets removeAtMillis
    // (ClientLevel.shouldDelayFallingBlockEntityRemoval, unless prioritizeChunkUpdates is NEARBY; NONE by default), and tick()
    // then waits for the clock, moving nothing and counting no time (1.18 FallingBlockEntity.java:105-109, 213-221,
    // ClientLevel.java:809-811). The level still counts its tickCount. 1.17.1 and 1.18.2 remove it at once.
    const holdsRemoved = versionAtLeast(version, '1.18') && !versionAtLeast(version, '1.18.2');
    const removed = new Set<number>();
    for (const row of recording.rows) {
        if (holdsRemoved) {
            for (const packet of row.s2c) {
                if (!packet.name.startsWith('ClientboundRemoveEntit')) continue;
                for (const id of (decodeClientbound(version, packetBytes(packet.b)).params.entityIds ?? []) as number[]) removed.add(id);
            }
        }
        for (const [x, y, z, state] of row.blocks) {
            area.setState(x, y, z, state);
            sync.blockChanged({ x, y, z });
        }
        const before = new Map((((row.pre.nearbyEntities ?? []) as unknown as RecordedEntity[])).filter(e => e.moving && KIND[e.type]).map(e => [e.id, e]));
        for (const after of (row.post.nearbyEntities ?? []) as unknown as RecordedEntity[]) {
            const was = before.get(after.id);
            if (!was) continue;
            const kind = KIND[was.type]!;
            if (after.moving!.tickCount === was.moving!.tickCount) continue;
            if (interpolates(kind)) {
                gone += 1;
                continue;
            }
            const seed = toState(was, kind, 'client', area);
            if (holdsRemoved && kind === 'falling_block' && removed.has(after.id)) {
                // (the held block's tick: where it was, as it was)
                compared += 1;
                kinds[kind] = (kinds[kind] ?? 0) + 1;
                const want = fields(toState(after, kind, 'client', area), after);
                // (Level.tickNonPassenger counts tickCount before the tick, the held one's too)
                const got = fields({ ...seed, tickCount: (seed.tickCount ?? 0) + 1 }, after);
                for (const key of Object.keys(want)) {
                    if (!same(want[key], got[key])) divergences.push({ tick: row.t, at: `${kind}#${after.id}`, source: 'native', field: key, expected: want[key], actual: got[key] });
                }
                continue;
            }
            sync.sync(area, {
                minX: was.box[0]! - Math.abs(was.vel[0]), minY: was.box[1]! - Math.abs(was.vel[1]) - 1, minZ: was.box[2]! - Math.abs(was.vel[2]),
                maxX: was.box[3]! + Math.abs(was.vel[0]), maxY: was.box[4]! + Math.abs(was.vel[1]) + 1, maxZ: was.box[5]! + Math.abs(was.vel[2]),
            }, 4);
            sync.setWorldBorder({ centerX: 0, centerZ: 0, size: 5.9999968e7 }, bounds);
            const moving = movingBlocks(version, row.pre, area, problems);
            sync.setMovingBlocks(moving);
            const inputs = inputsOf(recording.header.player.id, row, was, undefined, area, version);
            if (was.rng !== undefined) inputs.random = nextDraws(BigInt(was.rng), 64);
            inputs.players = [{ id: recording.header.player.id, position: vec(row.post.pos as unknown as Vec), eyeHeight: (row.pre.eyeHeight as number | undefined) ?? 1.62 }];
            const result = pushed(binding.simulateVersionedMovingEntityTick(version, sync.world as never, seed, inputs), was, moving, version, sync, binding);
            compared += 1;
            kinds[kind] = (kinds[kind] ?? 0) + 1;
            if (result.state.removed) ended += 1;
            const events = result.explodes || !!result.landedAt || result.expired || result.mergeCheck;
            if (events) problems.push(`t=${row.t}: a client's tick said what only the server does`);
            // (what the client draws is its own, and the server's side proves the use of a draw)
            if (result.randomUsed > 0) {
                gone += 1;
                continue;
            }
            const want = fields(toState(after, kind, 'client', area), after);
            const got = fields(result.state, after);
            if (!versionAtLeast(version, '1.13')) got.vel = throughVec3(got.vel as Vec);
            for (const key of Object.keys(want)) {
                if (!same(want[key], got[key])) divergences.push({ tick: row.t, at: `${kind}#${after.id}`, source: 'native', field: key, expected: want[key], actual: got[key] });
            }
        }
    }
    return {
        compared, kinds, gone, ended, divergences, problems,
        diverged: new Set(divergences.map(d => `${d.tick}/${d.at}`)).size,
        ...(divergences[0] ? { first: divergences[0] } : {}),
    };
}

function nextDraws(from: bigint, count: number): number[] {
    const draws: number[] = [];
    let seed = from;
    for (let i = 0; i < count; i += 1) {
        seed = step(seed);
        draws.push(Number(seed >> 24n) / (1 << 24));
    }
    return draws;
}

function inputsOf(playerId: number, row: Recording['rows'][number], was: RecordedEntity, after: RecordedEntity | undefined, area: AreaWorld, version: string): NativeMovingEntityInputs {
    const inputs: NativeMovingEntityInputs = {};
    if (was.rng !== undefined && after?.rng !== undefined) {
        const draws = drawsBetween(BigInt(was.rng), BigInt(after.rng));
        if (draws) inputs.random = draws;
    }
    if (row.srv) {
        inputs.players = [{
            id: playerId, position: vec(row.srv.pos), eyeHeight: (row.pre.eyeHeight as number | undefined) ?? 1.62,
            spectator: row.pre.gameMode === 'spectator', dead: row.srv.health <= 0,
        }];
    }
    if (!versionAtLeast(version, '1.14') && KIND[was.type] === 'falling_block') {
        const at = { x: was.pos[0], y: was.pos[1] + was.vel[1] - 0.01, z: was.pos[2] };
        inputs.fallsThroughBelow = FREE.test((area.getBlock(at) as unknown as { name: string }).name);
    }
    return inputs;
}
