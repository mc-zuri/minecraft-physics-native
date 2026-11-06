// The minecart layer of the native replay. A cart's rail movement is the server's, in every release, so it is compared
// with the server's view (row.srv.entities): each server tick is seeded from the carts as the tick before left them, and
// what the tick made of them is compared with the tick's own view. The client only interpolates to what it is sent: that
// is compared by itself, on the client's cart (vehicle.minecart), where the recording has it, and never reads the world.

import type { NativeMinecartItem, NativeMinecartOther, NativeMinecartRider, NativeMinecartRules, NativeMinecartStack, NativeMinecartState, NativePhysicsBinding, NativeWorld } from '../../dist/native.js';
import type { ExpandedRow, Recording, ServerView, Snapshot } from '../schema/recording.ts';
import { versionAtLeast } from '../scenarios/dsl/names.ts';
import type { Divergence } from './compare.ts';
import { packetBytes } from './load.ts';
import { readClientbound } from './packets.ts';

type Vec = readonly [number, number, number];
const vec = (v: Vec) => ({ x: v[0], y: v[1], z: v[2] });
const aabb = (b: readonly number[]) => ({ min: { x: b[0]!, y: b[1]!, z: b[2]! }, max: { x: b[3]!, y: b[4]!, z: b[5]! } });

/** PlayerSnap.entity with the CompatMinecart object a cart has. */
interface RecordedEntity {
    readonly id: number;
    readonly type: string;
    readonly pos: Vec;
    readonly vel: Vec;
    readonly yRot: number;
    readonly xRot: number;
    readonly onGround: boolean;
    readonly box: readonly number[];
    readonly age?: number;
    /** The id of what it rides, in the end: its own if nothing. */
    readonly root?: number;
    /** An item entity's stack. */
    readonly itemStack?: NativeMinecartStack;
    readonly minecart?: {
        readonly flipped: boolean;
        readonly onRails?: boolean;
        readonly inWater: boolean;
        readonly horizontalCollision: boolean;
        readonly verticalCollision: boolean;
        readonly noGravity: boolean;
        readonly stuckSpeedMultiplier: Vec;
        readonly fallDistance: number;
        readonly firstTick?: boolean;
        readonly fuel?: number;
        readonly push?: Vec;
        readonly comparatorSignal?: number;
        readonly hasLootTable?: boolean;
        readonly hurtTime?: number;
        readonly hurtDir?: number;
        readonly damage?: number;
        readonly fuse?: number;
        readonly randomSeed?: number;
        readonly enabled?: boolean;
        readonly inventory?: readonly (NativeMinecartStack | null)[];
        readonly lastActivated?: number;
        readonly insidePortal?: boolean;
        readonly portalTime?: number;
        readonly portalCooldown?: number;
        readonly rider?: {
            readonly id: number;
            readonly player: boolean;
            readonly living: boolean;
            readonly zza: number;
            readonly yRot: number;
            readonly vel: Vec;
            readonly moveIntent?: Vec;
        };
    };
}

const CARTS = new Set(['minecart', 'chest_minecart', 'hopper_minecart', 'furnace_minecart', 'tnt_minecart', 'spawner_minecart', 'command_block_minecart', 'commandblock_minecart']);
const NOT_PUSHABLE = new Set(['item', 'experience_orb', 'arrow', 'painting', 'item_frame', 'leash_knot', 'falling_block', 'tnt', 'fireball', 'small_fireball']);
const NOT_LIVING = new Set(['item', 'experience_orb', 'arrow', 'painting', 'item_frame', 'leash_knot', 'falling_block', 'tnt', 'boat', 'oak_boat']);

const entitiesOf = (view: ServerView | undefined) => (view?.entities ?? []) as unknown as readonly RecordedEntity[];
const cartsOf = (view: ServerView | undefined) => entitiesOf(view).filter(e => CARTS.has(e.type) && e.minecart);

/** Whether a recording's cart finds a way through a nether portal, none of whose worlds has one on the far side. */
const NETHER_EXIT = (version: string) => versionAtLeast(version, '1.21') || !versionAtLeast(version, '1.14');

/** The feature the world was made with (recorder.features) and the game rule its case set. */
export function minecartRules(recording: Recording, version: string): NativeMinecartRules {
    const features = (recording.header as unknown as { features?: readonly string[] }).features ?? [];
    const improvements = features.includes('minecart_improvements');
    const commands = (recording.header.setup as unknown as { commands?: readonly string[] }).commands ?? [];
    // (the overworld's bottom, where every case runs: 1.18 took it to -64)
    const level = { minY: versionAtLeast(version, '1.18') ? -64 : 0, tntExplodes: !commands.some(c => /gamerule\s+tnt_?explodes\s+false/i.test(c)), netherExit: NETHER_EXIT(version) };
    if (!improvements) return { improvements, ...level };
    const rule = commands.map(c => /gamerule\s+\S*minecart\S*\s+(\d+)/i.exec(c)?.[1]).find(v => v !== undefined);
    return { improvements, maxMinecartSpeed: rule === undefined ? 8 : Number(rule), ...level };
}

const MOVE_KEYS: ReadonlySet<string> = new Set(['forward', 'back', 'left', 'right']);

/**
 * What the rider gave the tick from `next` (the view after it) and `previous` (the one before): its input comes in with
 * the packets before the tick and stays until the next ones (1.8.9 NetHandlerPlayServer.processInput, 26.3
 * ServerPlayer.setLastClientInput). Its velocity from 1.14 is the one its own tick left: the connection's tick, after
 * the level's, gives it (ServerPlayer.doTick) and its rideTick clears it after the cart's.
 */
function riderOf(previous: RecordedEntity, next: RecordedEntity | undefined, before: ServerView | undefined, keys: readonly string[] | undefined): NativeMinecartRider | undefined {
    // (who rides is the tick before's: a rider the tick picks up rides from the tick after)
    const had = previous.minecart?.rider;
    if (!had) return undefined;
    const stays = next?.minecart?.rider?.id === had.id;
    const rider = stays ? next.minecart!.rider! : had;
    const velocity = rider.player && before ? before.vel : had.vel;
    // (a rider that gets off is in no view after the tick, whose input came with the packets before it: the keys it sent say
    // whether it still asked to move; a change of direction on that very tick is not told apart)
    const stopped = !stays && rider.player && keys !== undefined && !keys.some(key => MOVE_KEYS.has(key));
    return {
        player: rider.player, living: rider.living, forward: stopped ? 0 : rider.zza, yaw: rider.yRot,
        velocity: vec(velocity),
        ...(rider.moveIntent && !stopped ? { moveIntent: vec(rider.moveIntent) } : {}),
    };
}

/**
 * A furnace cart's fuel and push. Coal the tick's packets gave it is in no view before the tick:
 * MinecartFurnace.addFuel adds 3600 and has the push run from the player to the cart (26.3 :110-121).
 */
function furnaceOf(e: RecordedEntity, next: RecordedEntity | undefined, before: ServerView | undefined): Pick<NativeMinecartState, 'fuel' | 'push'> {
    const fuel = e.minecart!.fuel ?? 0;
    if (!before || (next?.minecart?.fuel ?? 0) <= fuel) return { fuel, push: vec(e.minecart!.push ?? [0, 0, 0]) };
    return { fuel: fuel + 3600, push: vec([e.pos[0] - before.pos[0], 0, e.pos[2] - before.pos[2]]) };
}

function seed(version: string, e: RecordedEntity, next: RecordedEntity | undefined, before: ServerView | undefined, keys: readonly string[] | undefined): NativeMinecartState {
    const m = e.minecart!;
    const rider = riderOf(e, next, before, keys);
    return {
        variant: e.type,
        position: vec(e.pos), velocity: vec(e.vel),
        yRot: Math.fround(e.yRot), xRot: Math.fround(e.xRot),
        flipped: m.flipped,
        onRails: m.onRails ?? false,
        onGround: e.onGround,
        firstTick: m.firstTick ?? false,
        inWater: m.inWater,
        collidedHorizontally: m.horizontalCollision, collidedVertically: m.verticalCollision,
        stuckSpeedMultiplier: vec(m.stuckSpeedMultiplier),
        noGravity: m.noGravity,
        fallDistance: m.fallDistance,
        tickCount: e.age ?? 0,
        hurtTime: m.hurtTime ?? 0, hurtDir: m.hurtDir ?? 1, damage: m.damage ?? 0,
        lastActivated: m.lastActivated ?? 0,
        insidePortal: m.insidePortal ?? false, portalTime: m.portalTime ?? 0, portalCooldown: m.portalCooldown ?? 0,
        ...(m.insidePortal || (m.portalTime ?? 0) > 0 ? { portal: 'nether' } : {}),
        ...(versionAtLeast(version, '1.17') ? {} : { boundingBox: aabb(e.box) }),
        ...(rider ? { rider } : {}),
        ...(e.type === 'furnace_minecart' ? furnaceOf(e, next, before) : {}),
        ...(e.type === 'chest_minecart' || e.type === 'hopper_minecart' ? { comparatorSignal: m.comparatorSignal ?? 0, hasLootTable: m.hasLootTable ?? false } : {}),
        ...(e.type === 'tnt_minecart' ? { fuse: m.fuse ?? -1, randomSeed: m.randomSeed ?? 0 } : {}),
        ...(e.type === 'hopper_minecart' ? { enabled: m.enabled ?? true, inventory: [...(m.inventory ?? [])] } : {}),
    };
}

/** The item entities a hopper cart can take, in the view's order. */
function itemsOf(view: ServerView | undefined): NativeMinecartItem[] {
    return entitiesOf(view).flatMap(e => (e.itemStack ? [{ boundingBox: aabb(e.box), stack: e.itemStack }] : []));
}

/** How a tick's blast appears in the packets after it: a float power. */
export interface CartExplosion { readonly tick: number; readonly power: number; readonly position: Vec }

const isBoat = (e: RecordedEntity) => e.type.endsWith('boat') || e.type.endsWith('raft');

/** What the views say of an entity's own tick among the carts'. */
interface OtherTicks {
    /** The view after the tick: where a tick's end leaves what is in it. */
    readonly after: ReadonlyMap<number, RecordedEntity>;
    /** How many carts tick ahead of an id. */
    readonly cartsAhead: (id: number) => number;
    /** What the player rides: the client moves it, with the packets before the tick. */
    readonly playerVehicle: number | undefined;
    readonly carrying: ReadonlySet<number>;
}

/** What a cart meets that is not a cart: its box and what it does to a cart (the same names in every release). */
function otherOf(e: RecordedEntity, riders: ReadonlyMap<number, number>, ticks: OtherTicks): NativeMinecartOther {
    const rides = riders.get(e.id);
    const end = ticks.after.get(e.id);
    const clientMoved = e.id === ticks.playerVehicle;
    const from = clientMoved ? (end ?? e) : e;
    // (the rider of a cart goes where the cart's tick puts it)
    const own = rides === undefined && !clientMoved ? end : undefined;
    return {
        position: vec(from.pos), boundingBox: aabb(from.box), velocity: vec(e.vel),
        pushable: !NOT_PUSHABLE.has(e.type),
        solid: e.type.endsWith('boat') || e.type.endsWith('raft') || e.type === 'shulker',
        player: false,
        ironGolem: e.type === 'iron_golem',
        living: !NOT_LIVING.has(e.type) && !isBoat(e),
        passenger: rides !== undefined,
        hasPassengers: ticks.carrying.has(e.id),
        boat: isBoat(e),
        ...(rides === undefined ? { ticksAfter: ticks.cartsAhead(e.root ?? e.id) } : { rides }),
        ...(own ? { tickPosition: vec(own.pos), tickBoundingBox: aabb(own.box) } : {}),
    };
}

/**
 * The velocities the case set: a server action runs between a client tick and the server's, so the row after it is the
 * server tick that starts from it (README, Writing scenarios). Row -> ref -> velocity.
 */
export function setVelocities(recording: Recording): ReadonlyMap<number, ReadonlyMap<string, Vec>> {
    const out = new Map<number, Map<string, Vec>>();
    let t = 0;
    for (const step of recording.header.body as readonly { op: string; ticks?: number; action?: { op: string; target?: string; vel?: Vec } }[]) {
        if (step.op === 'ticks' || step.op === 'press' || step.op === 'turn') t += step.ticks ?? 0;
        if (step.op === 'server' && step.action?.op === 'velocity' && step.action.target && step.action.vel) {
            const row = out.get(t + 1) ?? new Map<string, Vec>();
            row.set(step.action.target, step.action.vel);
            out.set(t + 1, row);
        }
    }
    return out;
}

const same = (a: number, b: number) => a === b || (a === 0 && b === 0);
const sameVec = (a: Vec, b: { x: number; y: number; z: number }) => same(a[0], b.x) && same(a[1], b.y) && same(a[2], b.z);

export interface CartComparison {
    readonly compared: number;
    readonly divergences: readonly Divergence[];
    /** The blasts the engine's tick made. */
    readonly explosions?: readonly CartExplosion[];
}

/** A player's hit on an entity: its id, the damage Player.attack gives it and whether the attacker is in creative mode. */
export interface CartHit { readonly entity: number; readonly amount: number; readonly creative: boolean }

function readVarInt(bytes: Buffer, from: number): { value: number; next: number } {
    let value = 0;
    let at = from;
    for (let shift = 0; shift < 35; shift += 7) {
        const byte = bytes[at]!;
        at += 1;
        value |= (byte & 127) << shift;
        if (byte < 128) break;
    }
    return { value, next: at };
}

/**
 * The hits the client sent in `row`: ServerboundInteractPacket's ATTACK (a packet id, the entity, the action 1), 26.3's
 * ServerboundAttackPacket (the packet id, the entity). A fist's whole charge is 1 (Player.attack, attack_damage's base, at a full
 * attackStrengthScale); a recording that waits out the charge between its hits has no other amount.
 */
export function cartHits(row: Pick<ExpandedRow, 'c2s' | 'pre'>): CartHit[] {
    const creative = row.pre.gameMode === 'creative';
    return row.c2s.flatMap(packet => {
        if (packet.name !== 'ServerboundInteractPacket' && packet.name !== 'ServerboundAttackPacket') return [];
        const bytes = packetBytes(packet.b);
        const { value: entity, next } = readVarInt(bytes, readVarInt(bytes, 0).next);
        if (packet.name === 'ServerboundInteractPacket' && readVarInt(bytes, next).value !== 1) return [];
        return [{ entity, amount: 1, creative }];
    });
}

/**
 * The server tick that `row` follows: the carts of the previous row's view through one tick of the engine, against the
 * carts of this row's. A cart nothing moved is a tick all the same: the rail still has to hold it. `keys` are the ones the
 * client held on the previous row, whose packets this tick read.
 */
export function compareCartTick(native: NativePhysicsBinding, version: string, world: NativeWorld, rules: NativeMinecartRules, before: ServerView | undefined, row: ExpandedRow, player: number, summons: readonly string[], set: ReadonlyMap<string, Vec> | undefined, keys?: readonly string[], pistons?: (state: NativeMinecartState, cart: { readonly box: readonly number[] }) => NativeMinecartState, hits?: readonly CartHit[]): CartComparison {
    const view = row.srv;
    const after = new Map(cartsOf(view).map(e => [e.id, e]));
    // a sneaking player gets off in Player.rideTick, right after the cart's tick (ServerLevel.tickPassenger), so the cart moves
    // with its rider, whose keys are this row's, and meets it where it was set down (26.3 Player.java rideTick, LivingEntity.pushEntities)
    const sneaks = row.input?.keys.includes('sneak') === true || row.pre?.inputShiftKeyDown === true;
    const previous = cartsOf(before);
    if (previous.length === 0 || !view) return { compared: 0, divergences: [] };
    const riders = new Map(previous.flatMap((c, index) => (c.minecart?.rider ? [[c.minecart.rider.id, index] as const] : [])));
    // (the level ticks what it holds in the order it took it in, a rider with its vehicle, which is the views' order of ids:
    // 1.13.2 World.entities, 1.15 ServerWorld.entitiesById, 1.20.4 EntityList. What came back with its chunk would be out of it.)
    const playerVehicle = (row.pre as { vehicle?: { id: number } | null } | undefined)?.vehicle?.id;
    const ticks: OtherTicks = {
        after: new Map(entitiesOf(view).map(e => [e.id, e])),
        cartsAhead: id => previous.filter(c => c.id < id).length,
        playerVehicle,
        carrying: new Set([...entitiesOf(before).filter(e => e.root !== undefined && e.root !== e.id).map(e => e.root!), ...(playerVehicle === undefined ? [] : [playerVehicle])]),
    };
    const others = entitiesOf(before).filter(e => !CARTS.has(e.type)).map(e => otherOf(e, riders, ticks));
    // (the view has the player apart: on foot it is one of what a cart meets, where the packets before this tick put it)
    // (a rider the tick throws off, as well: its own tick is after the cart's)
    const thrownOff = riders.get(player);
    const steppedOff = thrownOff !== undefined && sneaks && after.has(previous[thrownOff]!.id) && after.get(previous[thrownOff]!.id)!.minecart?.rider?.id !== player;
    if (thrownOff === undefined || after.get(previous[thrownOff]!.id)?.minecart?.rider?.id !== player) {
        const [x, y, z] = view.pos;
        const half = Math.fround(0.6) / 2;
        const box = (px: number, pz: number) => aabb([px - half, y, pz - half, px + half, y + Math.fround(1.8), pz + half]);
        // (its server tick from 1.9 travels by its velocity and pushes from there, and the connection then snaps it back: the
        // view has it back. What stops that travel, a wall, is not modelled. From 1.21.2 a teleport takes the velocity too, so
        // the tick whose packets hold one travels nowhere and pushes from the view: requestTeleport to setPosition with a zero
        // delta, 1.21.4 ServerPlayNetworkHandler.java:1070-1082, 1.21.5 ServerGamePacketListenerImpl.java:1154-1168)
        const teleported = versionAtLeast(version, '1.21.2') && row.s2c.some(p => p.name === 'ClientboundPlayerPositionPacket');
        const [vx, , vz] = teleported ? [0, 0, 0] : before?.vel ?? [0, 0, 0];
        const travels = versionAtLeast(version, '1.9') && (vx !== 0 || vz !== 0);
        others.push({
            position: vec(view.pos), boundingBox: box(x, z), velocity: vec(view.vel),
            pushable: true, player: true, living: true,
            ...(travels ? { tickPosition: vec([x + vx, y, z + vz]), tickBoundingBox: box(x + vx, z + vz) } : {}),
            ...(thrownOff === undefined || steppedOff ? {} : { passenger: true, rides: thrownOff, getsOff: true }),
        });
    }
    // (the summons in the order they were made, which is their ids')
    const refs = new Map(entitiesOf(before).map((e, index) => [e.id, summons[index]]));
    const carts = previous.map(e => {
        const state = seed(version, e, after.get(e.id), before, keys);
        const velocity = set?.get(refs.get(e.id) ?? '');
        const stepping = steppedOff && state.rider && previous[thrownOff!]!.id === e.id ? { ...state, rider: { ...state.rider, forward: row.pre.zza as number, moveIntent: undefined } } : state;
        const moving = velocity ? { ...stepping, velocity: vec(velocity) } : stepping;
        // (the packets of the client's last tick are handled ahead of the level's: the hit stands when the cart's tick begins)
        return (hits ?? []).filter(hit => hit.entity === e.id).reduce((state, hit) => native.simulateVersionedMinecartHurt(version, world, state, { kind: 'plain', amount: hit.amount, creative: hit.creative }, rules).state, moving);
    });
    const scene = native.simulateVersionedMinecartScene(version, world, carts, others, rules, itemsOf(before));
    const divergences: Divergence[] = [];
    const where = { tick: row.t, at: 'srv.minecart', source: 'native' as const };
    scene.carts.forEach((tick, index) => {
        const id = previous[index]!.id;
        const want = after.get(id);
        const got = !tick.state.removed && pistons ? pistons(tick.state, previous[index]!) : tick.state;
        // gone from the server's view is gone from the engine's: broken, blown up, under the world, through a portal
        if (!want || got.removed) {
            if (!want !== Boolean(got.removed)) divergences.push({ ...where, field: `${got.variant}#${index}.removed`, expected: !want, actual: got.removed ?? false });
            return;
        }
        const wrong = (field: string, expected: unknown, actual: unknown) => divergences.push({ ...where, field: `${want.type}#${index}.${field}`, expected, actual });
        if (!sameVec(want.pos, got.position)) wrong('pos', want.pos, [got.position.x, got.position.y, got.position.z]);
        if (!sameVec(want.vel, got.velocity)) wrong('vel', want.vel, [got.velocity.x, got.velocity.y, got.velocity.z]);
        if (!same(Math.fround(want.yRot), Math.fround(got.yRot))) wrong('yRot', want.yRot, got.yRot);
        if (!same(Math.fround(want.xRot), Math.fround(got.xRot ?? 0))) wrong('xRot', want.xRot, got.xRot);
        if (want.onGround !== got.onGround) wrong('onGround', want.onGround, got.onGround);
        const m = want.minecart!;
        if (m.flipped !== got.flipped) wrong('flipped', m.flipped, got.flipped);
        if (m.inWater !== got.inWater) wrong('inWater', m.inWater, got.inWater);
        if (m.onRails !== undefined && m.onRails !== got.onRails) wrong('onRails', m.onRails, got.onRails);
        if (m.fuel !== undefined && m.fuel !== got.fuel) wrong('fuel', m.fuel, got.fuel);
        if (m.push && got.push && !sameVec(m.push, got.push)) wrong('push', m.push, [got.push.x, got.push.y, got.push.z]);
        if (!same(Math.fround(m.fallDistance), Math.fround(got.fallDistance ?? 0))) wrong('fallDistance', m.fallDistance, got.fallDistance);
        if (m.hurtTime !== undefined && m.hurtTime !== got.hurtTime) wrong('hurtTime', m.hurtTime, got.hurtTime);
        if (m.hurtDir !== undefined && m.hurtDir !== got.hurtDir) wrong('hurtDir', m.hurtDir, got.hurtDir);
        if (m.damage !== undefined && !same(m.damage, got.damage ?? 0)) wrong('damage', m.damage, got.damage);
        if (m.fuse !== undefined && m.fuse !== got.fuse) wrong('fuse', m.fuse, got.fuse);
        if (m.enabled !== undefined && m.enabled !== got.enabled) wrong('enabled', m.enabled, got.enabled);
        if (m.lastActivated !== undefined && m.lastActivated !== got.lastActivated) wrong('lastActivated', m.lastActivated, got.lastActivated);
        if (m.portalTime !== undefined && m.portalTime !== got.portalTime) wrong('portalTime', m.portalTime, got.portalTime);
        if (m.portalCooldown !== undefined && m.portalCooldown !== got.portalCooldown) wrong('portalCooldown', m.portalCooldown, got.portalCooldown);
        if (m.comparatorSignal !== undefined && got.comparatorSignal !== undefined && m.comparatorSignal !== got.comparatorSignal) wrong('comparatorSignal', m.comparatorSignal, got.comparatorSignal);
        if (m.inventory) {
            const stacks = (slots: readonly (NativeMinecartStack | null | undefined)[]) => JSON.stringify(slots.map(s => (s ? [s.item, s.count] : null)));
            if (stacks(m.inventory) !== stacks(got.inventory ?? [])) wrong('inventory', stacks(m.inventory), stacks(got.inventory ?? []));
        }
        // (a tick that throws the rider off, or that an interaction starts, is not a change a cart's tick makes alone)
    });
    const explosions = scene.carts.flatMap(tick => tick.explosions.map(blast => ({ tick: row.t, power: blast.power, position: [blast.position.x, blast.position.y, blast.position.z] as const })));
    return { compared: scene.carts.length, divergences, explosions };
}

/** The boxes the server's carts of a view reach in a tick (each NativeWorldSync call wants one box). */
export function cartReach(view: ServerView | undefined): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | undefined {
    const carts = cartsOf(view);
    if (carts.length === 0) return undefined;
    const axis = (i: number) => {
        const low = Math.min(...carts.map(c => c.box[i]! - Math.abs(c.vel[i]!)));
        const high = Math.max(...carts.map(c => c.box[i + 3]! + Math.abs(c.vel[i]!)));
        return [low, high] as const;
    };
    const [minX, maxX] = axis(0);
    const [minY, maxY] = axis(1);
    const [minZ, maxZ] = axis(2);
    return { minX: minX - 2, minY: minY - 2, minZ: minZ - 2, maxX: maxX + 2, maxY: maxY + 2, maxZ: maxZ + 2 };
}

/**
 * The blasts the engine's tick made, against the explosion packets that tick sent: a recording's own
 * word for each blast's power (its radius; where the release's packet has none, its count alone).
 */
export function compareBlasts(version: string, blasts: readonly CartExplosion[], row: ExpandedRow): Divergence[] {
    if (blasts.length === 0) return [];
    const heard = row.s2c.filter(p => /Explo/.test(p.name)).map(p => readClientbound(version, packetBytes(p.b)).params);
    const where = { tick: row.t, at: 'srv.minecart', source: 'native' as const };
    if (heard.length < blasts.length) return [{ ...where, field: 'explosion', expected: blasts.length, actual: heard.length }];
    return blasts.flatMap((blast, index) => {
        const radius = heard[index]!.radius as number | undefined;
        return radius === undefined || Math.fround(radius) === blast.power ? [] : [{ ...where, field: 'explosion.power', expected: radius, actual: blast.power }];
    });
}

/** The recorded client cart: what its interpolation is seeded from and compared with. */
interface RecordedLerp { readonly steps: number; readonly target: Vec; readonly yRot: number; readonly xRot: number }
interface RecordedStep { readonly position: Vec; readonly movement: Vec; readonly yRot: number; readonly xRot: number; readonly weight: number }
interface RecordedSteps { readonly delay: number; readonly pending: readonly RecordedStep[]; readonly current: readonly RecordedStep[]; readonly totalWeight: number; readonly old: RecordedStep }
interface ClientCart extends RecordedEntity { readonly minecart: NonNullable<RecordedEntity['minecart']> & { readonly lerp?: RecordedLerp; readonly steps?: RecordedSteps } }

const nativeStep = (s: RecordedStep) => ({ position: vec(s.position), movement: vec(s.movement), yRot: s.yRot, xRot: s.xRot, weight: s.weight });

/**
 * The client's cart through a tick of the old path's interpolation, from its state before the tick (pre) to after it
 * (post), where nothing the server sent came between. It has to arrive where vanilla's did without reading the world.
 */
export function compareClientLerp(native: NativePhysicsBinding, version: string, pre: Snapshot, post: Snapshot, tick: number, pushed?: (position: { x: number; y: number; z: number }, box: readonly number[]) => { x: number; y: number; z: number }): { compared: number; divergences: readonly Divergence[] } {
    const before = pre.vehicle as ClientCart | null | undefined;
    const after = post.vehicle as ClientCart | null | undefined;
    if (!before?.minecart || !after || before.id !== after.id) return { compared: 0, divergences: [] };
    const lerp = before.minecart.lerp;
    const steps = before.minecart.steps;
    if ((!lerp || lerp.steps <= 0) && !steps) return { compared: 0, divergences: [] };
    const got = steps
        ? native.simulateMinecartClientSteps({
            position: vec(before.pos), velocity: vec(before.vel), yRot: before.yRot, xRot: before.xRot, delay: steps.delay,
            pending: steps.pending.map(nativeStep), current: steps.current.map(nativeStep), totalWeight: steps.totalWeight, old: nativeStep(steps.old),
        })
        : native.simulateMinecartClientLerp(version, {
            position: vec(before.pos), yRot: before.yRot, xRot: before.xRot, steps: lerp!.steps,
            target: vec(lerp!.target), targetYRot: lerp!.yRot, targetXRot: lerp!.xRot,
        });
    // (the client's pistons push what it interpolates too, after its tick)
    if (pushed) got.position = pushed(got.position, before.box);
    const where = { tick, at: 'client.minecart', source: 'native' as const };
    const divergences: Divergence[] = [];
    if (!sameVec(after.pos, got.position)) divergences.push({ ...where, field: 'lerp.pos', expected: after.pos, actual: [got.position.x, got.position.y, got.position.z] });
    if (!same(Math.fround(after.yRot), Math.fround(got.yRot))) divergences.push({ ...where, field: 'lerp.yRot', expected: after.yRot, actual: got.yRot });
    return { compared: 1, divergences };
}
