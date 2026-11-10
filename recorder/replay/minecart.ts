// The minecart layer of the native replay. A cart's rail movement is the server's, in every release, so it is compared
// with the server's view (row.srv.entities): each server tick is seeded from the carts as the tick before left them, and
// what the tick made of them is compared with the tick's own view. The client only interpolates to what it is sent: that
// is compared by itself, on the client's cart (vehicle.minecart), where the recording has it, and never reads the world.

import type { NativeBlockPosition, NativeMinecartContainer, NativeMinecartGateway, NativeMinecartItem, NativeMinecartOther, NativeMinecartRider, NativeMinecartRules, NativeMinecartStack, NativeMinecartState, NativePhysicsBinding, NativeWorld } from '../../dist/native.js';
import type { ExpandedRow, Recording, ServerView, Snapshot } from '../schema/recording.ts';
import { versionAtLeast } from '../scenarios/dsl/names.ts';
import type { Divergence } from './compare.ts';
import { packetBytes } from './load.ts';
import { decodeClientbound, readClientbound } from './packets.ts';

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
    /** The scoreboard team it is on: its name and collision rule, and its friendly fire where that is off. */
    readonly team?: { readonly name: string; readonly collisionRule: string; readonly allowFriendlyFire?: boolean };
    /** Entity.boardingCooldown from 1.9, while it runs. */
    readonly boardingCooldown?: number;
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
        /** A TNT cart's blast power from 1.21.2, where it is not 4 and 1. */
        readonly explosionPowerBase?: number;
        readonly explosionSpeedFactor?: number;
        /** From 1.21.5, the hurt that lit a TNT cart was a creative player's. */
        readonly creativeIgnition?: boolean;
        /** Entity.invulnerable, where it is set. */
        readonly invulnerable?: boolean;
        readonly enabled?: boolean;
        readonly inventory?: readonly (NativeMinecartStack | null)[];
        readonly lastActivated?: number;
        readonly insidePortal?: boolean;
        readonly portalTime?: number;
        readonly portalCooldown?: number;
        /** From 1.21, the portal block of Entity.portalProcess and where it went in. */
        readonly portal?: string;
        readonly portalEntry?: Vec;
        /** A hopper cart's: the container over its hopper, its slots open from below. */
        readonly container?: RecordedContainer;
        /** The containers over the cells about that one, a block each way, where its next tick can take it. */
        readonly containers?: readonly RecordedContainer[];
        /** A spawner cart's BaseSpawner. */
        readonly spawner?: { readonly delay: number; readonly minDelay: number; readonly maxDelay: number; readonly range: number };
        /** The end gateways about a cart, which no client sees into. */
        readonly gateways?: readonly RecordedGateway[];
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

interface RecordedContainer { readonly pos: Vec; readonly slots: readonly (NativeMinecartStack | null)[] }
interface RecordedGateway { readonly pos: Vec; readonly exit?: Vec; readonly cooldown: number; readonly age: number }

const CARTS = new Set(['minecart', 'chest_minecart', 'hopper_minecart', 'furnace_minecart', 'tnt_minecart', 'spawner_minecart', 'command_block_minecart', 'commandblock_minecart']);
// (an armor stand and a bat are not isPushable: 1.8.8 ArmorStand.java:277, Bat.java:54)
const NOT_PUSHABLE = new Set(['armor_stand', 'bat', 'item', 'experience_orb', 'arrow', 'painting', 'item_frame', 'leash_knot', 'falling_block', 'tnt', 'fireball', 'small_fireball']);
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
    const level = {
        minY: versionAtLeast(version, '1.18') ? -64 : 0,
        tntExplodes: !commands.some(c => /gamerule\s+tnt_?explodes\s+false/i.test(c)),
        spawnerBlocksEnabled: !commands.some(c => /gamerule\s+spawner_?blocks_?enabled\s+false/i.test(c)),
        netherExit: NETHER_EXIT(version),
    };
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
        // (from 1.21 the recording says which portal; before it only a nether portal keeps a count across ticks)
        ...(m.portal ? { portal: m.portal } : m.insidePortal || (m.portalTime ?? 0) > 0 ? { portal: 'nether' } : {}),
        ...(m.portal === 'gateway' && m.portalEntry ? { portalEntry: vec(m.portalEntry) } : {}),
        ...(m.spawner ? { spawnDelay: m.spawner.delay, minSpawnDelay: m.spawner.minDelay, maxSpawnDelay: m.spawner.maxDelay, requiredPlayerRange: m.spawner.range } : {}),
        ...(versionAtLeast(version, '1.17') ? {} : { boundingBox: aabb(e.box) }),
        ...(rider ? { rider } : {}),
        ...(e.team ? { team: e.team } : {}),
        ...(e.type === 'furnace_minecart' ? furnaceOf(e, next, before) : {}),
        ...(e.type === 'chest_minecart' || e.type === 'hopper_minecart' ? { comparatorSignal: m.comparatorSignal ?? 0, hasLootTable: m.hasLootTable ?? false } : {}),
        ...(e.type === 'tnt_minecart' ? { fuse: m.fuse ?? -1, randomSeed: m.randomSeed ?? 0 } : {}),
        ...(e.type === 'tnt_minecart' && m.explosionPowerBase !== undefined ? { explosionPowerBase: m.explosionPowerBase } : {}),
        ...(e.type === 'tnt_minecart' && m.explosionSpeedFactor !== undefined ? { explosionSpeedFactor: m.explosionSpeedFactor } : {}),
        ...(e.type === 'tnt_minecart' && m.creativeIgnition ? { creativeIgnition: true } : {}),
        ...(m.invulnerable ? { invulnerable: true } : {}),
        ...(e.type === 'hopper_minecart' ? { enabled: m.enabled ?? true, inventory: [...(m.inventory ?? [])] } : {}),
    };
}

/** The item entities a hopper cart can take and a TNT cart's blast hurts, in the view's order, with their ids. */
function itemEntitiesOf(view: ServerView | undefined): { readonly id: number; readonly item: NativeMinecartItem }[] {
    return entitiesOf(view).flatMap(e => (e.itemStack ? [{ id: e.id, item: { boundingBox: aabb(e.box), stack: e.itemStack, position: vec(e.pos), velocity: vec(e.vel) } }] : []));
}

function itemsOf(view: ServerView | undefined): NativeMinecartItem[] {
    return itemEntitiesOf(view).map(entry => entry.item);
}

/** The engine has no empty stack in a container: a slot of none of anything. */
const EMPTY_SLOT: NativeMinecartStack = { item: '', count: 0, maxStack: 64 };
const posKey = (p: Vec | { x: number; y: number; z: number }) => (Array.isArray(p) ? p.join(',') : `${(p as { x: number }).x},${(p as { y: number }).y},${(p as { z: number }).z}`);

/** The containers over and about the view's hopper carts, each once, as a hopper's suckInItems finds them. */
function containersOf(view: ServerView | undefined): NativeMinecartContainer[] {
    const out = new Map<string, NativeMinecartContainer>();
    for (const e of cartsOf(view)) {
        for (const c of [e.minecart?.container, ...(e.minecart?.containers ?? [])]) {
            if (c && !out.has(posKey(c.pos))) out.set(posKey(c.pos), { x: c.pos[0], y: c.pos[1], z: c.pos[2], slots: c.slots.map(s => s ?? EMPTY_SLOT) });
        }
    }
    return [...out.values()];
}

/**
 * The containers a tick's hopper carts take from: those over them in the view before it, and one the view after it has
 * over a cart that the view before did not, as the hopper takes after its move (26.3 MinecartHopper.tick, super.tick
 * then tryConsumeItems; 1.8.9 HopperMinecartEntity.java tick): a cart that rolled under it, or a chest a command set at
 * the tick's start. The view records the container over the cart at the tick's end, so that one is given as it was
 * before: with what the cart gained back in its first slot, where that slot still holds it and so gave it (a hopper
 * takes from the first slot that holds anything). Where the slot it came from is not told, it is left out.
 */
function containersFor(before: ServerView | undefined, after: ServerView | undefined): NativeMinecartContainer[] {
    const out = containersOf(before);
    const known = new Set(out.map(c => posKey(c)));
    const previous = new Map(cartsOf(before).map(e => [e.id, e]));
    for (const e of cartsOf(after)) {
        const c = e.minecart?.container;
        if (!c || known.has(posKey(c.pos))) continue;
        const slots = c.slots.map(s => s ?? EMPTY_SLOT);
        const gained = gainOf(previous.get(e.id)?.minecart?.inventory, e.minecart?.inventory);
        if (gained === null) continue;
        if (gained) {
            if (!(slots[0] && slots[0].count > 0 && slots[0].item === gained.item)) continue;
            slots[0] = { ...slots[0], count: slots[0].count + gained.count };
        }
        known.add(posKey(c.pos));
        out.push({ x: c.pos[0], y: c.pos[1], z: c.pos[2], slots });
    }
    return out;
}

/** What a hopper cart's slots gained over a tick: nothing (undefined), one kind of item, or null for anything else. */
function gainOf(before: readonly (NativeMinecartStack | null)[] | undefined, after: readonly (NativeMinecartStack | null)[] | undefined): { item: string; count: number } | undefined | null {
    const totals = new Map<string, number>();
    for (const s of before ?? []) if (s && s.count > 0) totals.set(s.item, (totals.get(s.item) ?? 0) - s.count);
    for (const s of after ?? []) if (s && s.count > 0) totals.set(s.item, (totals.get(s.item) ?? 0) + s.count);
    const changed = [...totals].filter(([, count]) => count !== 0);
    if (changed.length === 0) return undefined;
    if (changed.length > 1 || changed[0]![1] < 0) return null;
    return { item: changed[0]![0], count: changed[0]![1] };
}

/** The end gateways about the view's carts, each once. */
function gatewaysOf(view: ServerView | undefined): NativeMinecartGateway[] {
    const out = new Map<string, NativeMinecartGateway>();
    for (const g of cartsOf(view).flatMap(e => e.minecart?.gateways ?? [])) {
        if (out.has(posKey(g.pos))) continue;
        const at = (p: Vec) => ({ x: p[0], y: p[1], z: p[2] });
        out.set(posKey(g.pos), { position: at(g.pos), ...(g.exit ? { exit: at(g.exit) } : {}), cooldown: g.cooldown, age: g.age });
    }
    return [...out.values()];
}

/**
 * How a tick's blast appears in the packets after it: a float power, and the blocks its rays reach (air included) under
 * every draw of the level's random (certain) and under some (possible).
 */
export interface CartExplosion {
    readonly tick: number;
    readonly power: number;
    readonly position: Vec;
    readonly certain?: readonly NativeBlockPosition[];
    readonly possible?: readonly NativeBlockPosition[];
}

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

/** ClientboundSetPlayerTeamPacket's methods by their numbers, and Team.CollisionRule by its id and its names. */
const TEAM_MODES = ['create', 'remove', 'change', 'join', 'leave'];
const TEAM_RULES = ['always', 'never', 'pushOtherTeams', 'pushOwnTeam'];

/**
 * The view before a tick with the teams as the tick has them: a command run at the tick's start (the removal of a team at a
 * case's end, a change of its rule) comes in that tick's packets, ahead of the entities, and the view before it has the
 * teams as they were (PlayerTeam's packet is sent as the scoreboard changes, ServerScoreboard.onTeamRemoved and onTeamChanged).
 */
function teamsAsTicked(version: string, view: ServerView | undefined, row: ExpandedRow): ServerView | undefined {
    const removed = new Set<string>();
    const rules = new Map<string, string>();
    for (const packet of row.s2c) {
        if (packet.name !== 'ClientboundSetPlayerTeamPacket' && packet.name !== 'S3EPacketTeams') continue;
        const { params } = decodeClientbound(version, packetBytes(packet.b));
        const team = String(params.team);
        const mode = typeof params.mode === 'string' ? TEAM_MODES.indexOf(params.mode) : Number(params.mode);
        if (mode === 1) removed.add(team);
        if (mode === 2 && params.collisionRule !== undefined) {
            const rule = params.collisionRule;
            const name = typeof rule === 'number' ? TEAM_RULES[rule] ?? 'always' : String(rule).replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
            rules.set(team, TEAM_RULES.includes(name) ? name : 'always');
        }
    }
    if (!view || (removed.size === 0 && rules.size === 0)) return view;
    const entities = entitiesOf(view).map(e => {
        if (!e.team) return e;
        if (removed.has(e.team.name)) return { ...e, team: undefined };
        const rule = rules.get(e.team.name);
        return rule ? { ...e, team: { ...e.team, collisionRule: rule } } : e;
    });
    return { ...view, entities } as unknown as ServerView;
}

/** What a cart meets that is not a cart: its box and what it does to a cart (the same names in every release). */
function otherOf(e: RecordedEntity, riders: ReadonlyMap<number, number>, ticks: OtherTicks): NativeMinecartOther {
    const rides = riders.get(e.id);
    const end = ticks.after.get(e.id);
    const clientMoved = e.id === ticks.playerVehicle;
    const from = clientMoved ? (end ?? e) : e;
    // (the rider of a cart goes where the cart's tick puts it; one the tick throws off, an activator rail's, stands where the
    // server's dismount put it, the view after's, when its own tick comes: LivingEntity.dismountVehicle, which no engine models)
    const thrownOff = rides !== undefined && end !== undefined && (end.root === undefined || end.root === end.id);
    const own = (rides === undefined || thrownOff) && !clientMoved ? end : undefined;
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
        armorStand: e.type === 'armor_stand',
        bat: e.type === 'bat',
        ...(e.team ? { team: e.team } : {}),
        ...(e.boardingCooldown ? { boardingCooldown: e.boardingCooldown } : {}),
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

/**
 * The velocity a player's server tick travels by: LivingEntity.aiStep drops what is negligible first. Below 0.005 on each
 * axis before 1.9 (1.8.8 LivingEntity.java:1414-1424), 0.003 from it (1.9.4 LivingEntity.java:1686-1696, 1.21.4 :2690-2700),
 * and from 1.21.5 a player's horizontal length below 0.003 (1.21.5 LivingEntity.java:2668-2681, 26.3 :2977-2989).
 */
export function withoutNegligible(version: string, [x, y, z]: Vec): Vec {
    if (versionAtLeast(version, '1.21.5')) return x * x + z * z < 9.0e-6 ? [0, y, 0] : [x, y, z];
    const least = versionAtLeast(version, '1.9') ? 0.003 : 0.005;
    return [Math.abs(x) < least ? 0 : x, y, Math.abs(z) < least ? 0 : z];
}

const same = (a: number, b: number) => a === b || (a === 0 && b === 0);
const sameVec = (a: Vec, b: { x: number; y: number; z: number }) => same(a[0], b.x) && same(a[1], b.y) && same(a[2], b.z);

export interface CartComparison {
    readonly compared: number;
    readonly divergences: readonly Divergence[];
    /** The blasts the engine's tick made. */
    readonly explosions?: readonly CartExplosion[];
    /** The item entities after the carts' tick, by id: where a blast left their velocity, before their own tick. */
    readonly items?: ReadonlyMap<number, NativeMinecartItem>;
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
export function compareCartTick(native: NativePhysicsBinding, version: string, world: NativeWorld, rules: NativeMinecartRules, viewBefore: ServerView | undefined, row: ExpandedRow, player: number, summons: readonly string[], set: ReadonlyMap<string, Vec> | undefined, keys?: readonly string[], pistons?: (state: NativeMinecartState, cart: { readonly box: readonly number[] }) => NativeMinecartState, hits?: readonly CartHit[]): CartComparison {
    const before = teamsAsTicked(version, viewBefore, row);
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
        // (before 1.9 the player ticks in the handling of its move packet, before it goes where the packet says: it pushes
        // from where the packet before put it, the view before this tick. 1.8.8 ServerGamePacketListenerImpl.java:290-291
        // doTick, then absMoveTo; from 1.9 in the connection's tick, after the level, from where the packets put it, 1.9.4
        // ServerGamePacketListenerImpl.java:163-166)
        const at = versionAtLeast(version, '1.9') || !before ? view : before;
        const [x, y, z] = at.pos;
        const half = Math.fround(0.6) / 2;
        const box = (px: number, pz: number) => aabb([px - half, y, pz - half, px + half, y + Math.fround(1.8), pz + half]);
        // (its server tick travels by its velocity and pushes from there, and the connection then snaps it back: the
        // view has it back. What stops that travel, a wall, is not modelled. From 1.21.2 a teleport takes the velocity too, so
        // the tick whose packets hold one travels nowhere and pushes from the view: requestTeleport to setPosition with a zero
        // delta, 1.21.4 ServerPlayNetworkHandler.java:1070-1082, 1.21.5 ServerGamePacketListenerImpl.java:1154-1168)
        const teleported = versionAtLeast(version, '1.21.2') && row.s2c.some(p => p.name === 'ClientboundPlayerPositionPacket');
        const [vx, , vz] = withoutNegligible(version, teleported ? [0, 0, 0] : before?.vel ?? [0, 0, 0]);
        const travels = vx !== 0 || vz !== 0;
        // (where the travel leaves it: before 1.17 Entity.move takes the position from the middle of the moved box, always
        // before 1.14 (1.13.2 Entity.java:772, 875-879) and from 1.14 where it moved (1.14.4 Entity.java:492-495, 1.16.5 :630-633);
        // from 1.17 it adds the movement (1.17 Entity.java:558-560))
        const fromBox = !versionAtLeast(version, '1.17') && (travels || !versionAtLeast(version, '1.14'));
        const moved = (c: number, v: number) => (fromBox ? (c - half + v + (c + half + v)) / 2 : c + v);
        others.push({
            position: vec(at.pos), boundingBox: box(x, z), velocity: vec(view.vel),
            pushable: true, player: true, living: true,
            ...(travels || fromBox
                ? { tickPosition: vec([moved(x, vx), y, moved(z, vz)]), tickBoundingBox: aabb([x - half + vx, y, z - half + vz, x + half + vx, y + Math.fround(1.8), z + half + vz]) }
                : {}),
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
    const scene = native.simulateVersionedMinecartScene(version, world, carts, others, rules, itemsOf(before), containersFor(before, view), gatewaysOf(before));
    const divergences: Divergence[] = [];
    const where = { tick: row.t, at: 'srv.minecart', source: 'native' as const };
    // what the tick left of the containers and gateways, against the view after it, where it still has them
    const slots = (list: readonly (NativeMinecartStack | null | undefined)[]) => JSON.stringify(list.map(s => (s && s.count > 0 ? [s.item, s.count] : null)));
    const containersAfter = new Map(containersOf(view).map(c => [posKey(c), c]));
    for (const got of scene.containers ?? []) {
        const want = containersAfter.get(posKey(got));
        if (want && slots(want.slots) !== slots(got.slots)) divergences.push({ ...where, field: `container@${posKey(got)}.slots`, expected: slots(want.slots), actual: slots(got.slots) });
    }
    const gatewaysAfter = new Map(gatewaysOf(view).map(g => [posKey(g.position), g]));
    for (const got of scene.gateways ?? []) {
        const want = gatewaysAfter.get(posKey(got.position));
        if (got.undecided) divergences.push({ ...where, field: `gateway@${posKey(got.position)}.undecided`, expected: false, actual: true });
        else if (want && want.cooldown !== got.cooldown) divergences.push({ ...where, field: `gateway@${posKey(got.position)}.cooldown`, expected: want.cooldown, actual: got.cooldown });
    }
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
        // (a spawner that tried to spawn has the delay the level's random gave it, or none: the server's)
        if (m.spawner && !tick.spawner && m.spawner.delay !== got.spawnDelay) wrong('spawnDelay', m.spawner.delay, got.spawnDelay);
        if (m.comparatorSignal !== undefined && got.comparatorSignal !== undefined && m.comparatorSignal !== got.comparatorSignal) wrong('comparatorSignal', m.comparatorSignal, got.comparatorSignal);
        if (m.inventory) {
            const stacks = (slots: readonly (NativeMinecartStack | null | undefined)[]) => JSON.stringify(slots.map(s => (s ? [s.item, s.count] : null)));
            if (stacks(m.inventory) !== stacks(got.inventory ?? [])) wrong('inventory', stacks(m.inventory), stacks(got.inventory ?? []));
        }
        // a mob the cart's own tick picks up (its push, by the team rules from 1.9) rides it in the view after; a tick that throws
        // the rider off, or that an interaction starts, is not a change a cart's tick makes alone
        if (!previous[index]!.minecart?.rider) {
            const picked = Boolean(m.rider && !m.rider.player);
            const gotPicked = Boolean(got.rider && !got.rider.player);
            if (picked !== gotPicked) wrong('pickedUp', picked, gotPicked);
        }
    });
    const explosions = scene.carts.flatMap(tick => tick.explosions.map(blast => ({
        tick: row.t, power: blast.power, position: [blast.position.x, blast.position.y, blast.position.z] as const, certain: blast.certain, possible: blast.possible,
    })));
    // an item a blast burnt up is gone from the view after it, and one it left is still there (where it went is its own tick's)
    if (explosions.length > 0) {
        const kept = new Set(entitiesOf(view).map(e => e.id));
        itemEntitiesOf(before).forEach(({ id }, index) => {
            const got = scene.items[index];
            if (!got || (got.stack.count <= 0 && !got.removed)) return;
            const gone = !kept.has(id);
            if (gone !== Boolean(got.removed)) divergences.push({ ...where, field: 'item#' + id + '.removed', expected: gone, actual: got.removed ?? false });
        });
    }
    const items = new Map(itemEntitiesOf(before).flatMap(({ id }, index) => (scene.items[index] ? [[id, scene.items[index]!] as const] : [])));
    return { compared: scene.carts.length, divergences, explosions, items };
}

/** The boxes the server's carts of a view reach in a tick (each NativeWorldSync call wants one box). */
export function cartReach(view: ServerView | undefined): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | undefined {
    const carts = cartsOf(view);
    if (carts.length === 0) return undefined;
    // (a gateway sends a cart to its exit within its tick, and from 1.21 the cart moves on from there in the same tick: 26.3
    // AbstractMinecart.tick handles the portal before behavior.tick, EndGatewayBlock.getPortalDestination)
    const at = (c: RecordedEntity, [x, y, z]: Vec) => {
        const [cx, cy, cz] = [(c.box[0]! + c.box[3]!) / 2, c.box[1]!, (c.box[2]! + c.box[5]!) / 2];
        const [dx, dy, dz] = [x + 0.5 - cx, y - cy, z + 0.5 - cz];
        return { box: [c.box[0]! + dx, c.box[1]! + dy, c.box[2]! + dz, c.box[3]! + dx, c.box[4]! + dy, c.box[5]! + dz], vel: c.vel };
    };
    const boxes = [...carts, ...carts.flatMap(c => (c.minecart?.gateways ?? []).flatMap(g => (g.exit ? [at(c, g.exit)] : [])))];
    const axis = (i: number) => {
        const low = Math.min(...boxes.map(c => c.box[i]! - Math.abs(c.vel[i]!)));
        const high = Math.max(...boxes.map(c => c.box[i + 3]! + Math.abs(c.vel[i]!)));
        return [low, high] as const;
    };
    const [minX, maxX] = axis(0);
    const [minY, maxY] = axis(1);
    const [minZ, maxZ] = axis(2);
    // (a TNT cart's rays reach a blast's radius by 1.3 over 0.225 steps of 0.3: 21 blocks at the power of 11.5 a cart at 5
    // blocks a tick has, and its world is the blocks they meet)
    const margin = carts.some(c => c.type === 'tnt_minecart') ? 21 : 2;
    return { minX: minX - margin, minY: minY - margin, minZ: minZ - margin, maxX: maxX + margin, maxY: maxY + margin, maxZ: maxZ + margin };
}

/**
 * The blasts the engine's tick made, against the explosion packets that tick sent: a recording's own
 * word for each blast's power (its radius; where the release's packet has none, its count alone), and
 * the blocks it broke. Before 1.21.2 the packet lists them all, air included, as offsets from the
 * centre's block ((int) of the centre before 1.14, 1.13.2 ClientboundExplodePacket.java:100; Mth.floor
 * from it, 1.14.4 :71): every block the weakest rays reach is there, and none the strongest could not.
 * From 1.21.2 the packet has none, and the blocks come in the server's next tick (`next`): what it made
 * air is no block the strongest rays miss, but for what the neighbour updates take from a block it broke
 * on, one block to the next (a rail that cannot survive where it is, BaseRailBlock.neighborChanged, pops
 * when the rail beside it goes), and every block the weakest reach that was no air (`stateAt`, the world
 * before the blast) is among them.
 */
export function compareBlasts(version: string, blasts: readonly CartExplosion[], row: ExpandedRow, next?: ExpandedRow, stateAt?: (x: number, y: number, z: number) => string | undefined): Divergence[] {
    if (blasts.length === 0) return [];
    const heard = row.s2c.filter(p => /Explo/.test(p.name)).map(p => readClientbound(version, packetBytes(p.b)).params);
    const where = { tick: row.t, at: 'srv.minecart', source: 'native' as const };
    if (heard.length < blasts.length) return [{ ...where, field: 'explosion', expected: blasts.length, actual: heard.length }];
    const key = (p: NativeBlockPosition) => `${p.x},${p.y},${p.z}`;
    const out: Divergence[] = [];
    const listed = !versionAtLeast(version, '1.21.2');
    blasts.forEach((blast, index) => {
        const radius = heard[index]!.radius as number | undefined;
        if (radius !== undefined && Math.fround(radius) !== blast.power) out.push({ ...where, field: 'explosion.power', expected: radius, actual: blast.power });
        if (!blast.certain || !blast.possible || !listed) return;
        const base = blast.position.map(c => (versionAtLeast(version, '1.14') ? Math.floor(c) : Math.trunc(c)));
        const offsets = (heard[index]!.affectedBlockOffsets ?? []) as readonly { x: number; y: number; z: number }[];
        const blown = new Set(offsets.map(o => key({ x: base[0]! + o.x, y: base[1]! + o.y, z: base[2]! + o.z })));
        out.push(...blockSets(where, blast, blown));
    });
    if (!listed && next && stateAt) {
        const made = new Set([...(row.blocks ?? []), ...(next.blocks ?? [])].filter(([, , , state]) => isAir(state)).map(([x, y, z]) => key({ x, y, z })));
        const all = blasts.filter(blast => blast.certain && blast.possible);
        const possible = new Set(all.flatMap(blast => blast.possible!.map(key)));
        // (what the rays broke, and each made air beside one of those, on to the next)
        const reached = new Set([...made].filter(at => possible.has(at)));
        const queue = [...reached];
        while (queue.length > 0) {
            const [x, y, z] = queue.pop()!.split(',').map(Number) as [number, number, number];
            for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
                const at = key({ x: x + dx, y: y + dy, z: z + dz });
                if (made.has(at) && !reached.has(at)) {
                    reached.add(at);
                    queue.push(at);
                }
            }
        }
        const extra = [...made].filter(at => !reached.has(at));
        if (extra.length > 0) out.push({ ...where, field: 'explosion.blocks.beyond', expected: [], actual: extra.slice(0, 8) });
        const solid = all.flatMap(blast => blast.certain!).filter(p => !isAir(stateAt(p.x, p.y, p.z) ?? 'air'));
        const missed = solid.map(key).filter(at => !made.has(at));
        if (missed.length > 0) out.push({ ...where, field: 'explosion.blocks.missed', expected: missed.slice(0, 8), actual: [] });
    }
    return out;
}

const isAir = (state: string) => /^(minecraft:)?(air|cave_air|void_air)(\[|$)/.test(state);

/** A blast's listed blocks against what its weakest and strongest rays reach. */
function blockSets(where: Omit<Divergence, 'field' | 'expected' | 'actual'>, blast: CartExplosion, blown: ReadonlySet<string>): Divergence[] {
    const key = (p: NativeBlockPosition) => `${p.x},${p.y},${p.z}`;
    const possible = new Set(blast.possible!.map(key));
    const missed = blast.certain!.map(key).filter(at => !blown.has(at));
    const beyond = [...blown].filter(at => !possible.has(at));
    return [
        ...(missed.length > 0 ? [{ ...where, field: 'explosion.blocks.missed', expected: missed.slice(0, 8), actual: [] } as Divergence] : []),
        ...(beyond.length > 0 ? [{ ...where, field: 'explosion.blocks.beyond', expected: [], actual: beyond.slice(0, 8) } as Divergence] : []),
    ];
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
