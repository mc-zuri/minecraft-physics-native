// The moving entities of a recording, through the engine's tick (simulateVersionedMovingEntityTick). The server is the one
// that runs them in full: each entity of the server's view (srv.entities) with a `moving` state starts a tick from what the
// engine made of the tick before, and the next server tick's view has to match it exactly, its removal included. A divergence
// is reported, and the entity goes on from the recording. Nothing the engine leaves to the server is taken for a match: an
// entity gone that the tick did not end is counted in `gone`, with the reason the case gives (a merge, a pick-up, a burn).
// With `client`, the same for the client's view (nearbyEntities): the same physics under the client's branches.

import { createRequire } from 'node:module';
import type { NativeBoatState, NativeMovingEntityInputs, NativeMovingEntityState, NativeMovingEntityTickResult, NativePhysicsBinding } from '../../dist/native.js';
import { SAME_DATA, versionAtLeast } from '../scenarios/dsl/names.ts';
import type { Recording, Snapshot } from '../schema/recording.ts';
import type { Divergence } from './compare.ts';
import { movingBlocks } from './moving.ts';
import { AreaWorld } from './world.ts';

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
    id: number; type: string; pos: Vec; vel: Vec; onGround: boolean; box: number[]; moving?: RecordedMoving; rng?: string;
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
function compareTravel(row: { t: number }, e: RecordedEntity, version: string, world: unknown, binding: NativePhysicsBinding): Divergence[] {
    const from = e.travelFrom!;
    const to = e.travelTo!;
    const effect = (name: string) => from.effects.find(x => x.id.endsWith(name));
    const result = binding.simulateVersionedMobTravel(version, world as never, {
        // (a kind the inventory does not name has no travel of its own: LivingEntity.travel, with what its AI left)
        kind: binding.entityTravelSupport(version, e.type).family === 'unknown' ? 'living' : e.type, position: vec(from.pos), velocity: vec(from.vel), yawDegrees: from.yRot, input: vec(from.input), speed: from.speed,
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
    };
}

function carried(state: string, area: AreaWorld) {
    const name = state.replace(/^minecraft:/, '');
    const block = area.block(name) as unknown as { type: number; name: string };
    return { carriedBlock: block.type, carriedAir: block.name === 'air', concretePowder: /concrete_powder/.test(block.name) };
}

/** What the two states are compared in: everything of a state the recording says. */
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
    const data = require('minecraft-data')(SAME_DATA[recording.header.mc] ?? recording.header.mc) as { version: { minecraftVersion: string } };
    return { sync: new NativeWorldSync(binding, require('prismarine-registry')(data.version.minecraftVersion), recording.header.mc), area: new AreaWorld(recording.header) };
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
        const riders = new Set(view.filter(e => e.root !== undefined && e.root !== e.id).map(e => e.root));
        for (const mob of view) {
            if (mob.dragon) {
                divergences.push(...compareDragon(row, mob, version, binding));
                compared += 1;
                kinds.ender_dragon = (kinds.ender_dragon ?? 0) + 1;
            }
            // (a passenger's tick is rideTick: it has no travel of its own)
            if (!mob.travelFrom || !mob.travelTo || (mob.root !== undefined && mob.root !== mob.id)) continue;
            const { box, vel } = mob.travelFrom;
            sync.sync(area, {
                minX: box[0]! - Math.abs(vel[0]), minY: box[1]! - Math.abs(vel[1]) - 1, minZ: box[2]! - Math.abs(vel[2]),
                maxX: box[3]! + Math.abs(vel[0]), maxY: box[4]! + Math.abs(vel[1]) + 2, maxZ: box[5]! + Math.abs(vel[2]),
            }, 4);
            sync.setWorldBorder({ centerX: 0, centerZ: 0, size: 5.9999968e7 }, bounds);
            divergences.push(...compareTravel(row, mob, version, sync.world, binding));
            compared += 1;
            kinds[mob.type] = (kinds[mob.type] ?? 0) + 1;
        }
        for (const [id, was] of before) {
            const kind = KIND[was.type]!;
            const seed = carriedOn.get(id) ?? toState(was, kind, from.authority, area);
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
            for (const [id, was] of boatsBefore) {
                const after = (view as readonly RecordedEntity[]).find(e => e.id === id);
                if (!after) continue;
                sync.sync(area, {
                    minX: was.box[0]! - 1, minY: was.box[1]! - 2, minZ: was.box[2]! - 1, maxX: was.box[3]! + 1, maxY: was.box[4]! + 2, maxZ: was.box[5]! + 1,
                }, 4);
                sync.setWorldBorder({ centerX: 0, centerZ: 0, size: 5.9999968e7 }, bounds);
                const state = binding.simulateVersionedBoatTick(version, sync.world as never, {
                    ...boats.get(id), position: vec(was.pos), velocity: vec(was.vel), onGround: was.onGround, serverSide: true, inWater: false,
                    yaw: 0, forward: false, left: false, right: false,
                    ...(versionAtLeast(version, '1.17') ? {} : { boundingBox: { min: vec([was.box[0]!, was.box[1]!, was.box[2]!]), max: vec([was.box[3]!, was.box[4]!, was.box[5]!]) } }),
                });
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
    for (const row of recording.rows) {
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
