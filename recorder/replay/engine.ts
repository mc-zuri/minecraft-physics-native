// The native layer of the replay: every recorded tick is run through the Rust engine alone
// (simulateVersionedTick), seeded from vanilla's state at the start of that tick and from the
// decisions vanilla made before LivingEntity.aiStep (stepwise), so each tick's divergence is its
// own. The tick's result is compared with vanilla's state at afterAiStep, where the engine's tick
// ends (the pose, the packets and the entities after the player are the adapter's and the bot's).

import { SAME_DATA } from '../scenarios/dsl/names.ts';
import { createRequire } from 'node:module';
import type { NativeMinecartState, NativeMovingPiston, NativePhysicsBinding, NativeSimulationState } from '../../dist/native.js';
import type { ExpandedRow, Recording, Snapshot } from '../schema/recording.ts';
import { BorderTracker } from './border.ts';
import { RainTracker } from './rain.ts';
import { ChunkTracker } from './chunks.ts';
import { compareContact, compareFreezing, compareLandings, compareNative, compareWallImpacts, type Divergence, type Landing } from './compare.ts';
import { DECIDED_BY_VANILLA, Prediction, VehiclePrediction, type Correction, type Drift, type Reseed } from './continuous.ts';
import { compareVehicleMove, comparePhases } from './phases.ts';
import { packetBytes } from './load.ts';
import { ReplayLids } from './lids.ts';
import { movingBlocks } from './moving.ts';
import { leavesOverworld } from './packets.ts';
import { nearbyEntities, toNative } from './seed.ts';
import { SharedFlags } from './flags.ts';
import { TeamTracker } from './teams.ts';
import { BOAT_SIM, HORSE_SIM, NATIVE_SIM, PLAYER_FIELDS } from '../schema/fields.ts';
import { inRange, versionAtLeast } from '../scenarios/dsl/names.ts';
import { AreaWorld } from './world.ts';
import type { MovingBlock } from '../../dist/mineflayer/world.js';
import { toBoat, toHorse, vehicleOf } from './vehicle.ts';
import { cartHits, cartReach, compareBlasts, compareCartTick, compareClientLerp, minecartRules, setVelocities } from './minecart.ts';

const require = createRequire(import.meta.url);
const root = new URL('../../', import.meta.url);

let binding: NativePhysicsBinding | undefined;
/** The engine as this checkout built it (native/artifacts, through dist/). */
export function nativeBinding(): NativePhysicsBinding {
    binding ??= (require(new URL('dist/index.js', root).pathname.replace(/^\/([A-Za-z]:)/, '$1')) as { LoadNativePhysics(): NativePhysicsBinding }).LoadNativePhysics();
    return binding;
}

interface WorldSyncLike {
    world: unknown;
    blockChanged(pos: { x: number; y: number; z: number }): void;
    columnChanged(chunkX: number, chunkZ: number, loaded: boolean): void;
    setMovingBlocks(blocks: readonly MovingBlock[]): void;
    movingPistonsOf(blocks: readonly MovingBlock[]): NativeMovingPiston[];
    setShulkerBoxes(boxes: readonly { x: number; y: number; z: number; bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } }[]): void;
    sync(source: AreaWorld, box: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }, margin: number): void;
    setWorldBorder(border: { centerX: number; centerZ: number; size: number; previousSize?: number; absoluteMaxSize?: number } | undefined, game?: { minY?: number; height?: number }): void;
}

export function worldSync(recording: Recording): { sync: WorldSyncLike; area: AreaWorld } {
    const { NativeWorldSync } = require(new URL('dist/index.js', root).pathname.replace(/^\/([A-Za-z]:)/, '$1')) as {
        NativeWorldSync: new (binding: NativePhysicsBinding, registry: unknown, release: string) => WorldSyncLike;
    };
    // (the release whose data it is: a registry must declare that, and 26.1.2 has 26.1's)
    const data = require('minecraft-data')(SAME_DATA[recording.header.mc] ?? recording.header.mc) as { version: { minecraftVersion: string } };
    const registry = require('prismarine-registry')(data.version.minecraftVersion);
    return { sync: new NativeWorldSync(nativeBinding(), registry, recording.header.mc), area: new AreaWorld(recording.header) };
}

/** The cases that take the area's blocks with them to an ultra-warm dimension (java-fluid-edges). */
const ULTRA_WARM = /^physrec\/uw_/;

const phase = (row: ExpandedRow, name: string): Snapshot | undefined => row.phases.find(p => p.name === name)?.state;

export interface TickResult {
    readonly t: number;
    readonly divergences: readonly Divergence[];
}

export interface ReplayResult {
    readonly id: string;
    readonly ticks: number;
    readonly compared: number;
    /** Ridden ticks of a vehicle the engine has no model for: recorded, not compared. */
    readonly unmodelled: number;
    /** Ridden ticks of a vehicle the rider does not control: the client takes its positions from the server. */
    readonly interpolated: number;
    /** Ticks in another dimension: the recording has the case's world only. */
    readonly elsewhere: number;
    readonly diverged: number;
    /** What makes the recording unfit to compare: not finished ok, a ticked row without the phases it needs. */
    readonly problems: readonly string[];
    readonly first?: Divergence;
    readonly results: readonly TickResult[];
    /** How the ticks were seeded: a stepwise match says nothing of a continuous replay. */
    readonly mode: ReplayMode;
    /** How many ticks each compared field was compared on (a field left out of a tick is not counted). */
    readonly fields: Readonly<Record<string, number>>;
    /** A continuous replay's own report (continuous.ts). */
    readonly continuous?: {
        readonly drift: Drift;
        readonly corrections: readonly Correction[];
        readonly reseeds: readonly Reseed[];
        /** The ticks a ridden vehicle started from the engine's own last tick, and those it seeded from vanilla. */
        readonly vehicle: { readonly carried: number; readonly reseeds: readonly Reseed[] };
        /** The native fields vanilla still decided: a limit of this layer, not something it proved. */
        readonly decidedByVanilla: readonly string[];
    };
    /** With `phases`: the values compared at each intermediate phase, by "<phase>.<field>". */
    readonly phases?: { readonly compared: number; readonly fields: Readonly<Record<string, number>> };
}

export type ReplayMode = 'stepwise' | 'continuous';

export interface ReplayOptions {
    /** continuous: seed once and carry the engine's output forward (continuous.ts). The default is stepwise. */
    readonly mode?: ReplayMode;
    /** Compare the engine's phase trace with vanilla's phases (phases.ts) as well as the tick's end. */
    readonly phases?: boolean;
    /** A change to the state a tick starts from, as a test makes one: the state is the tick's seed, the prediction in it. */
    readonly perturb?: (t: number, state: NativeSimulationState) => void;
    /** The release's rules the player's tick runs by, when not the recording's own: how a test shows two releases differ. */
    readonly engine?: string;
    /** Ends the prediction before a tick, as a test does: that tick seeds from vanilla, and the result counts it. */
    readonly reseed?: (t: number) => boolean;
}

type Vec = readonly [number, number, number];
type Box = readonly [number, number, number, number, number, number];

/**
 * The blocks a tick can reach: the box stretched along the move it starts with (and both ways, as a push or a
 * bounce can turn it), plus a step's height over it; NativeWorldSync adds its margin around that.
 */
function swept(box: Box, vel: Vec) {
    const reach = vel.map(v => Math.abs(v));
    return {
        minX: box[0] - reach[0], minY: box[1] - reach[1] - 1, minZ: box[2] - reach[2],
        maxX: box[3] + reach[0], maxY: box[4] + reach[1] + 1.5, maxZ: box[5] + reach[2],
    };
}

/** Replays every tick of a recording through the native engine: stepwise, unless the options ask for continuous. */
export function replayNative(recording: Recording, options: ReplayOptions = {}): ReplayResult {
    const native = nativeBinding();
    const mode = options.mode ?? 'stepwise';
    const rules = options.engine ?? recording.header.mc;
    const prediction = mode === 'continuous' ? new Prediction() : undefined;
    const ride = mode === 'continuous' ? new VehiclePrediction() : undefined;
    const fields: Record<string, number> = {};
    const phaseFields: Record<string, number> = {};
    let phaseValues = 0;
    // (a recording from before the vehicle phases has none on any row)
    const vehiclePhased = recording.rows.some(row => row.vehiclePhases?.length > 0);
    const { sync, area } = worldSync(recording);
    // the server's carts: their tick is the server's, in a world the client's chunks do not bound
    // (made when a cart first ticks: most recordings have none, and a world is a good part of a replay. What changed before
    // that waits here, in order)
    let cartWorlds: ReturnType<typeof worldSync> | undefined;
    const cartChanges: (readonly [number, number, number, string])[] = [];
    const cartWorldNow = () => {
        if (!cartWorlds) {
            cartWorlds = worldSync(recording);
            for (const [x, y, z, state] of cartChanges) {
                cartWorlds.area.setState(x, y, z, state);
                cartWorlds.sync.blockChanged({ x, y, z });
            }
        }
        return cartWorlds;
    };
    const cartRules = minecartRules(recording, recording.header.mc);
    const cartVelocities = setVelocities(recording);
    const cartSummons = (recording.header.setup.summons ?? []).map(s => s.ref);
    let serverBefore: ExpandedRow['srv'];
    let seatedIn: unknown;
    const rain = new RainTracker(recording.header);
    let keysBefore: readonly string[] | undefined;
    const version = recording.header.mc;
    const legs = (recording.header.setup.equipment as Record<string, { enchantments?: Record<string, number> }>).legs;
    const swiftSneak = legs?.enchantments?.swift_sneak ?? 0;
    const riptideLevel = (recording.header.setup.equipment as Record<string, { enchantments?: Record<string, number> }>).mainhand?.enchantments?.riptide ?? 0;
    // (a spin counts down a tick at a time: what the last tick's would have come to, and a start at or over it is a new release)
    let spinBefore = 1;
    const results: TickResult[] = [];
    let compared = 0;
    /** Ridden ticks of a vehicle the engine does not model (a minecart). */
    let unmodelled = 0;
    let interpolated = 0;
    let elsewhere = 0;
    let away = false;
    const problems: string[] = [];
    const border = new BorderTracker(version);
    const teams = new TeamTracker(recording.header);
    const flags = new SharedFlags(recording.header);
    const chunks = new ChunkTracker(version, recording.rows);
    area.holds = (chunkX, chunkZ) => chunks.holds(chunkX, chunkZ);
    // Entity.isOutsideBorder before 1.14, which nothing records: the move sets it, and the next one reads it
    let outsideBorder = false;
    // (the physrec/fd_* cases and these two cf_ falls are the falls in which only the landing moves the health)
    const landings = /^physrec\/fd_/.test(recording.header.scenario.id) ? [] as Landing[] : undefined;
    // 1.21.4's client runs no checkFallDamage for its player: its landing is the server's alone (handleFall, 1.21.4
    // Entity.java:1250-1256), which counts a fall of its own from the moves it receives, and nothing records that
    let serverFall = 0;
    // (the physrec/hz_* cases of a block that hurts: a case of an invulnerable player has no hits at all)
    const contact = /^physrec\/hz_(cactus|campfire|soul_campfire|magma|burn|berry)_/.test(recording.header.scenario.id) ? [] as Landing[] : undefined;
    const freezing = recording.header.scenario.id.startsWith('physrec/hz_freeze_') ? [] as Landing[] : undefined;
    // (the mortal glides into a wall; the other f_elytra_wall cases are invulnerable and hurt nothing)
    let serverVel: Vec | undefined;
    const impacts = /^physrec\/f_elytra_wall_(hurts|near)_/.test(recording.header.scenario.id) ? [] as Landing[] : undefined;
    if (recording.footer.status !== 'ok') problems.push(`the recording ended ${recording.footer.status}: ${recording.footer.reason ?? ''}`);
    if (recording.rows.length === 0) problems.push('the recording has no rows');
    const lids = new ReplayLids(native as never, version, area);
    for (const [rowIndex, row] of recording.rows.entries()) {
        // (a row that compared nothing still ticked the level: its lids moved on)
        if (rowIndex > 0) lids.tick(recording.rows[rowIndex - 1]!.t);
        lids.packets(row);
        // the border as the player's tick finds it: the last tick's level.tick moved it, after the entities, and the
        // row's packets came since (26.3 Minecraft.java:1797, 1823, ClientLevel.java:291)
        border.tick();
        border.packets(row.s2c);
        teams.packets(row.s2c);
        flags.packets(row.s2c);
        if (border.changed) sync.setWorldBorder(border.state(), versionAtLeast(version, '1.18') ? { minY: -64, height: 384 } : { minY: 0, height: 256 });
        // the riding jump the rider releases in this tick (its onPlayerJump, after the mount's travel): the engine
        // applies it after the travel too, and the mount jumps at its next tick
        const released = row.ridingJump;
        const respawn = row.s2c.findLast(p => p.name === 'ClientboundRespawnPacket');
        if (respawn) away = leavesOverworld(version, packetBytes(respawn.b));
        // (a case of this family built the area's own blocks in the nether, so the world stays; only the dimension is new)
        const ultraWarm = away && ULTRA_WARM.test(recording.header.scenario.id);
        if (respawn && ULTRA_WARM.test(recording.header.scenario.id)) {
            chunks.respawned();
            const [x0, , z0, x1, , z1] = recording.header.world.area.box;
            const [originX, , originZ] = recording.header.world.origin;
            for (let x = (x0 + originX) >> 4; x <= (x1 + originX) >> 4; x += 1) {
                for (let z = (z0 + originZ) >> 4; z <= (z1 + originZ) >> 4; z += 1) sync.columnChanged(x, z, false);
            }
        }
        if (away && !ultraWarm) {
            elsewhere += 1;
            prediction?.end('another dimension');
            continue;
        }
        for (const [chunkX, chunkZ, loaded] of chunks.packets(row.s2c)) sync.columnChanged(chunkX, chunkZ, loaded);
        // (a blast's craters come with the view of the tick that made them: that tick's carts have yet to meet them)
        const blasted = row.s2c.some(p => /Explo/.test(p.name));
        const setCartBlock = (x: number, y: number, z: number, state: string) => {
            if (!cartWorlds) {
                cartChanges.push([x, y, z, state]);
                return;
            }
            cartWorlds.area.setState(x, y, z, state);
            cartWorlds.sync.blockChanged({ x, y, z });
        };
        // the blocks the server changed before this tick (trampled farmland, frosted ice)
        for (const [x, y, z, state] of row.blocks) {
            area.setState(x, y, z, state);
            sync.blockChanged({ x, y, z });
            if (!blasted) setCartBlock(x, y, z, state);
        }
        const reach = cartReach(serverBefore);
        if (reach) {
            const cartWorld = cartWorldNow();
            cartWorld.sync.sync(cartWorld.area, reach, 4);
            // (a cart is pushed as all else is, after its tick)
            const pistonsNow = movingBlocks(version, row.pre, cartWorld.area, problems) as unknown as MovingBlock[];
            cartWorld.sync.setMovingBlocks(pistonsNow);
            const pushCart = pistonsNow.length === 0 ? undefined : (state: NativeMinecartState, cart: { readonly box: readonly number[] }): NativeMinecartState => {
                const push = native.simulateVersionedEntityPistonPush(version, cartWorld.sync.world as never, {
                    position: state.position, velocity: state.velocity, halfWidth: (cart.box[3]! - cart.box[0]!) / 2, height: cart.box[4]! - cart.box[1]!,
                    onGround: state.onGround ?? false, fallDistance: state.fallDistance ?? 0,
                }, cartWorld.sync.movingPistonsOf(pistonsNow));
                return { ...state, position: push.position, velocity: push.velocity, onGround: push.onGround, fallDistance: push.fallDistance };
            };
            const carts = compareCartTick(native, version, cartWorld.sync.world as never, cartRules, serverBefore, row, recording.header.player.id, cartSummons, cartVelocities.get(row.t), keysBefore, pushCart, rowIndex > 0 ? cartHits(recording.rows[rowIndex - 1]!) : []);
            compared += carts.compared;
            // (the packets a server tick sent are in the row with its view)
            const divergences = [...carts.divergences, ...compareBlasts(version, carts.explosions ?? [], row)];
            if (divergences.length > 0) results.push({ t: row.t, divergences });
        }
        if (blasted) for (const [x, y, z, state] of row.blocks) setCartBlock(x, y, z, state);
        serverBefore = row.srv ?? serverBefore;
        keysBefore = row.input.keys;
        if (!row.playerTicked) {
            prediction?.end('a tick the client skipped');
            continue;
        }
        const start = phase(row, 'tickStart') ?? row.pre;
        const decided = phase(row, 'beforeLivingAiStep');
        const expected = phase(row, 'afterAiStep');
        const riding = row.pre.passenger === true || start.passenger === true || decided?.passenger === true;
        // (dead for 20 ticks the player is removed, in the tick's base tick: nothing of it runs after that)
        if (!riding && !decided && start.health === 0) {
            prediction?.end('death');
            continue;
        }
        if (!riding && (!decided || !expected)) {
            problems.push(`t=${row.t}: the player ticked without ${!decided ? 'beforeLivingAiStep' : 'afterAiStep'}`);
            continue;
        }
        // a passenger does not travel: its vehicle ticks before it and moves it (the vehicle layer)
        if (!riding) ride?.end('the rider got off');
        if (riding) {
            prediction?.end('a ride');
            const before = vehicleOf(row.pre);
            const after = vehicleOf(row.post);
            // a click that boosts a pig: before 1.11 the client starts the boost itself, after the row's pre and before the
            // pig ticks, so the tick starts from it
            const started = before?.mount && !before.mount.boosting && after?.mount?.boosting === true && after.mount.boostTime === 1;
            const vehicle = started ? { ...before, mount: { ...before.mount!, boosting: true, boostTime: 0, boostTimeTotal: after!.mount!.boostTimeTotal } } : before;
            // a vehicle the rider does not control (a llama, a pig without a carrot on a stick) is not simulated
            // by the client at all: it follows the server's positions, so there is no physics to compare (a minecart's
            // interpolation is compared with the engine's own, which reads no world)
            if (vehicle && vehicle.controlledByLocalInstance === false) {
                interpolated += 1;
                ride?.end('a vehicle the server drives');
                const riding = movingBlocks(version, start, area, problems) as unknown as MovingBlock[];
                const lerp = compareClientLerp(native, version, row.pre, row.post, row.t, riding.length === 0 ? undefined : (position, box) => {
                    sync.sync(area, swept(box as unknown as Box, vehicle.vel as Vec), 4);
                    sync.setMovingBlocks(riding);
                    return native.simulateVersionedEntityPistonPush(version, sync.world as never, {
                        position, velocity: { x: 0, y: 0, z: 0 }, halfWidth: (box[3]! - box[0]!) / 2, height: box[4]! - box[1]!, clientSide: true, controlledByLocalInstance: false,
                    }, sync.movingPistonsOf(riding)).position;
                });
                if (lerp.divergences.length > 0) results.push({ t: row.t, divergences: lerp.divergences });
                continue;
            }
            if (!vehicle || !after || (!vehicle.boat && !vehicle.mount)) {
                unmodelled += 1;
                ride?.end('a vehicle with no model');
                continue;
            }
            sync.sync(area, swept(vehicle.box as unknown as Box, vehicle.vel as Vec), 4);
            const pistons = movingBlocks(version, start, area, problems) as unknown as MovingBlock[];
            sync.setMovingBlocks(pistons);
            // (what ticks before the player ticks before its root vehicle too; the vehicle is not its own collider)
            const others = (start.nearbyEntities ?? []) as { id: number }[];
            const around = { ...start, nearbyEntities: others.filter(e => e.id !== (row.pre.vehicle as { id?: number } | null)?.id) } as Snapshot;
            const nearby = { nearbyEntities: nearbyEntities(around, { version, pre: row.pre, post: row.post, swiftSneak }) };
            const carried = <T extends object>(seed: T): T => {
                const state = ride ? ride.seed(seed, row) : seed;
                options.perturb?.(row.t, state as never);
                return state;
            };
            const tracing = options.phases === true && vehiclePhased;
            const boat = vehicle.boat ? { ...carried(toBoat(vehicle, row.pre)), ...nearby } : undefined;
            // (before 1.19.3 a horse's ambient sound, a roll of its random in baseTick, can make it rear within the tick; a rear no
            // released jump or stand slide explains is that roll, an input and not physics)
            const mount = vehicle.boat ? undefined : { ...carried(toHorse(vehicle, row.pre, released,
                !versionAtLeast(version, '1.19.3') && !vehicle.mount!.standing && after.mount?.standing === true && released === undefined && !after.mount.allowStandSliding)), ...nearby };
            const moved = !tracing ? undefined : boat ? native.simulateVersionedBoatTickTraced(version, sync.world as never, boat) : native.simulateVersionedHorseTickTraced(version, sync.world as never, mount!);
            const simulated = moved?.state ?? (boat ? native.simulateVersionedBoatTick(version, sync.world as never, boat) : native.simulateVersionedHorseTick(version, sync.world as never, mount!));
            ride?.keep(simulated);
            compared += 1;
            if (moved) {
                const move = compareVehicleMove(row, moved.moves, true);
                problems.push(...move.problems);
                if (move.divergences.length > 0) results.push({ t: row.t, divergences: move.divergences });
            }
            // every field the registry seeds the vehicle from, against vanilla's vehicle after its own tick, converted the
            // same way: the rider's tickStart (the vehicle ticks first; the rider's input this tick, in post, is for the next)
            // a boat: after its own tick (the rider's tickStart), as the rider sets its paddles for the next one; a mount:
            // after the rider too (post), whose released jump the engine applies after the travel
            // (the block entities tick last: with a piston under way the tick ends where they left it, post)
            const ticked = vehicle.boat && pistons.length === 0 ? (vehicleOf(start) ?? after) : after;
            const want = (vehicle.boat ? toBoat(ticked, row.pre) : toHorse(ticked, row.pre, released)) as unknown as Record<string, unknown>;
            const got = { ...(simulated as unknown as Record<string, unknown>) };
            if (pistons.length > 0) {
                const living = vehicle.mount !== undefined;
                const push = native.simulateVersionedEntityPistonPush(version, sync.world as never, {
                    position: simulated.position, velocity: simulated.velocity, ...(simulated.boundingBox ? { boundingBox: simulated.boundingBox } : {}),
                    halfWidth: ticked.bbWidth / 2, height: ticked.bbHeight, onGround: simulated.onGround ?? false, living,
                    collidedHorizontally: simulated.collidedHorizontally ?? false, collidedVertically: simulated.collidedVertically ?? false,
                    fallDistance: (simulated as { fallDistance?: number }).fallDistance ?? 0,
                    ...(simulated.stuckSpeedMultiplier ? { stuckSpeedMultiplier: simulated.stuckSpeedMultiplier } : {}),
                    ...(living ? { stepHeight: (want as { stepHeight?: number }).stepHeight ?? 0, gravity: (want as { gravity?: number }).gravity ?? 0.08 } : {}),
                    clientSide: true,
                }, sync.movingPistonsOf(pistons));
                // (a boat's checkFallDamage keeps its motion, a piston's move as much as its own: 26.3 AbstractBoat.java; 1.21.4 skips it)
                const moved = push.position.x !== simulated.position.x || push.position.y !== simulated.position.y || push.position.z !== simulated.position.z;
                if (vehicle.boat && moved && version !== '1.21.4' && versionAtLeast(version, '1.9')) got.lastVerticalVelocity = push.velocity.y;
                Object.assign(got, {
                    position: push.position, velocity: push.velocity, onGround: push.onGround, collidedHorizontally: push.collidedHorizontally,
                    collidedVertically: push.collidedVertically, fallDistance: push.fallDistance, stuckSpeedMultiplier: push.stuckSpeedMultiplier,
                    ...(push.boundingBox ? { boundingBox: push.boundingBox } : { boundingBox: undefined }),
                });
                simulated.position = push.position;
            }
            if (got.boundingBox === undefined && simulated.position) {
                // (no box of its own: the position and the vehicle's dimensions)
                const { x, y, z } = simulated.position;
                const half = ticked.bbWidth / 2;
                got.boundingBox = { min: { x: x - half, y, z: z - half }, max: { x: x + half, y: y + ticked.bbHeight, z: z + half } };
            }
            // the seat: the rider's tick is after its boat's, which is the one place that sets it (Boat.positionRider)
            // (the tick a passenger gets on, it has not been set there: Entity.rideTick is from the next)
            const settled = seatedIn === vehicle.id;
            seatedIn = vehicle.id;
            if (vehicle.boat && pistons.length === 0 && settled) {
                // (a mob beside the player in it: the first seat is forward of the middle)
                const aboard = ((row.srv?.entities ?? []) as unknown as { id: number; root?: number }[]).filter(e => e.id !== vehicle.id && e.root === vehicle.id).length;
                const seat = native.boatPassengerPlacement(version, toBoat(ticked, row.pre), row.pre.yRot as number, /chest/.test(ticked.type), /raft/.test(ticked.type) || /bamboo/.test(String((ticked.boat as { variant?: unknown } | undefined)?.variant)), aboard + 1);
                const [x, y, z] = row.post.pos as unknown as Vec;
                const seated = { x, y, z };
                if (seat.position.x !== x || seat.position.y !== y || seat.position.z !== z) {
                    results.push({ t: row.t, divergences: [{ tick: row.t, at: 'vehicle', source: 'native', field: 'vehicle.seat.pos', expected: seated, actual: seat.position }] });
                    continue;
                }
            }
            results.push({ t: row.t, divergences: compareNative(want, got, { tick: row.t, at: 'vehicle', source: 'native' }, new Set(), vehicle.boat ? BOAT_SIM : HORSE_SIM, 'vehicle.', ticked as unknown as Record<string, unknown>) });
            continue;
        }
        // (the blocks around where the tick starts: the prediction's own, in a continuous replay)
        sync.sync(area, swept((prediction?.box(start.box as Box, start.pos as Vec) ?? start.box) as Box, start.vel as Vec), 4);
        // (the block entities tick after the entities: the move meets them as the last tick left them)
        const moving = movingBlocks(version, start, area, problems) as unknown as MovingBlock[];
        sync.setMovingBlocks(moving);
        sync.setShulkerBoxes(lids.boxes());
        // before 1.16 isMovingSlowly follows the input, which the tick updates after it read this: the base tick left it
        // (and 1.14's KeyboardInput.tick slows on the pose it can take then, or the key it has just read: the key of the tick before is
        // no part of it, and a boat beside a player just off it leaves no room to crouch, 1.14.4 LocalPlayer.java:556-561, 592-593)
        const left = versionAtLeast(version, '1.16') || !versionAtLeast(version, '1.14') ? undefined : phase(row, 'afterBaseTick');
        const posed = left?.crouching === true || (left?.pose === 'swimming' && left.isInWater !== true);
        const slow = left && !versionAtLeast(version, '1.15') ? { ...left, movingSlowly: posed || decided?.movingSlowly === true } : left;
        const state = toNative(start, decided!, { version, pre: row.pre, post: row.post, swiftSneak, pushes: type => teams.pushes(type), ...(slow ? { slow } : {}) });
        state.outsideBorder = outsideBorder;
        state.onFireFlag = flags.onFire;
        if (ultraWarm) state.ultraWarm = true;
        // (the pose is the adapter's, updated at the end of Player.tick: the entities after the player meet what it left)
        if (typeof row.post.bbHeight === 'number') state.heightAfterTick = row.post.bbHeight;
        // The native tick is the whole scene: the pushes and rocket boosts of the entities that tick before the player,
        // its tick, then those of the entities after it. They change the velocity only, so with entities around it is
        // seeded from before any entity ticked (pre) and expected after all of them (post); the rest stays the
        // player's own tick, tickStart to afterAiStep.
        // the fields the engine keeps as the server does start from the server's view before this tick
        for (const [key, map] of Object.entries(NATIVE_SIM)) {
            if (!('server' in map) || !map.server) continue;
            const value = (row.srv as Record<string, unknown> | undefined)?.[map.server];
            if (value !== undefined) (state as unknown as Record<string, unknown>)[key] = value;
        }
        // the level counts tickCount up before the entity ticks (Level.tickNonPassenger), and the engine does that
        // itself: its seed is the count before it, at the start of the client tick
        if (typeof row.pre.tickCount === 'number') state.tickCount = row.pre.tickCount;
        const scene = ((start.nearbyEntities ?? []) as unknown[]).length > 0 || ((row.post.attachedRockets ?? []) as unknown[]).length > 0;
        // what ticks before the player and moves it, the engine replays: it starts from before them. Nothing else may undo
        // what the tick's input did before them (a Riptide launch)
        const moved = (state.nearbyEntities ?? []).some(e => e.ticksBeforePlayer && e.kind !== 'inert' && e.kind !== 'still_living');
        if (scene && (moved || (state.fireworkRocketsBeforePlayer ?? 0) > 0)) {
            const [vx, vy, vz] = row.pre.vel as [number, number, number];
            state.velocity = { x: vx, y: vy, z: vz };
        }
        // the moving blocks tick after the entities and push what they meet, so the tick ends where they left it (post). The
        // limit of 0.51 a tick starts at nothing: the recorder clears Entity.pistonDeltas before a case's first row
        const same = (a: unknown, b: unknown) => (a as number[]).every((value, i) => Object.is(value, (b as number[])[i]));
        const moves = moving.length > 0 && expected !== undefined && !(same(row.post.pos, expected.pos) && same(row.post.vel, expected.vel));
        if (moves) state.movingPistons = sync.movingPistonsOf(moving);
        if (options.reseed?.(row.t)) prediction?.end('the caller asked');
        prediction?.seed(state, row);
        // (the release of a Riptide trident moves the player before the tick, with no packet: the tick's own start says it was
        // released, and the engine launches from where it predicted: TridentItem.releaseUsing, 26.3 TridentItem.java)
        const spin = (start.autoSpinAttackTicks as number | undefined) ?? 0;
        if (prediction && spin > 0 && spin >= spinBefore && riptideLevel > 0) {
            state.riptideLaunch = riptideLevel;
            // (a release that starts a spin found the player wet: the weather is the recording's, as the world is)
            state.inRain = true;
        }
        spinBefore = spin + 1;
        // Entity.isInRain, which no recorded field says: the rain level of the packets and the sky over the player
        rain.packets(row.s2c);
        const [atX, atY, atZ] = start.pos as unknown as Vec;
        const top = (recording.header.world.origin[1] ?? 0) + recording.header.world.area.box[4] + 1;
        const sky = (from: number) => {
            for (let y = from + 1; y < top; y += 1) if (area.getBlock({ x: atX, y, z: atZ }).name !== 'air') return false;
            return true;
        };
        if (rain.exposed(sky, atY, atY + (typeof start.bbHeight === 'number' ? start.bbHeight : 1.8))) state.inRain = true;
        options.perturb?.(row.t, state);
        const traced = options.phases ? native.simulateVersionedTickTraced(rules, sync.world as never, state, {}) : undefined;
        let after = traced ? traced.state : native.simulateVersionedTick(rules, sync.world as never, state, {});
        // the block entities tick after the entities, and a lid pushes what it meets: the tick ends where it left the player
        const lidsPushing = lids.tick(row.t);
        for (const lid of lidsPushing) {
            after = native.simulateVersionedShulkerBoxPush(rules, sync.world as never, after, lid.state, lid.x, lid.y, lid.z);
        }
        outsideBorder = after.outsideBorder ?? false;
        compared += 1;
        if (landings && version === '1.21.4') {
            const server = native.simulateVersionedTick(version, sync.world as never, { ...state, clientSide: false, fallDistance: serverFall }, {});
            serverFall = server.fallDistance ?? 0;
            if ((server.fallDamage ?? 0) > 0) landings.push({ t: row.t, damage: server.fallDamage! });
        } else if (landings && (after.fallDamage ?? 0) > 0) {
            landings.push({ t: row.t, damage: after.fallDamage! });
        }
        // a block's hurt is the server's (26.3 Entity.java:1969-1975): the same tick there says what it deals
        if ((contact || freezing) && !state.invulnerable) {
            const server = native.simulateVersionedTick(version, sync.world as never, { ...state, clientSide: false }, {});
            if (contact && (server.contactDamage ?? 0) > 0) contact.push({ t: row.t, damage: server.contactDamage! });
            if (freezing && (server.freezeDamage ?? 0) > 0) freezing.push({ t: row.t, damage: server.freezeDamage! });
        }
        // the wall's hurt is the server's too, by its own glide: its player has its own motion, from where the client last was
        // (26.3 LivingEntity.java:2507-2510, ServerGamePacketListenerImpl.tickPlayer; srv.vel is that motion after the tick before)
        if (impacts && !state.invulnerable && serverVel) {
            const [x, y, z] = serverVel;
            const dealt = native.simulateVersionedTick(version, sync.world as never, { ...state, clientSide: false, velocity: { x, y, z } }, {}).wallDamage ?? 0;
            if (dealt > 0) impacts.push({ t: row.t, damage: dealt });
        }
        serverVel = (row.srv?.vel as Vec | undefined) ?? serverVel;
        const target = moves || lidsPushing.length > 0 ? row.post : scene ? { ...expected!, vel: row.post.vel } : expected!;
        // every field the registry seeds from the recording, against vanilla's state converted the same way
        const want = toNative(target, target, { version, pre: row.pre, post: row.post, swiftSneak }) as unknown as Record<string, unknown>;
        // (the engine decides it where vanilla's baseTick does: the recorded field is read live, after the move)
        const based = phase(row, 'afterBaseTick');
        if (based) want.insideWall = based.isInWall === true;
        // a field that is the server's own is expected from the server's view after its next tick (seeded from its
        // view before it, below the seed); without one (the last row, an older recording) it is not compared
        const next = recording.rows[rowIndex + 1];
        const unavailable = new Set<string>();
        // (an input the engine gives back: before 1.16 the tick moves it after reading it, so the seed is its start)
        if (!versionAtLeast(version, '1.16')) unavailable.add('movingSlowly');
        // (nor where a glide ended in the tick: isMovingSlowly reads the pose as well, which says fall_flying until Player.tick
        // updates it (26.3 LivingEntity.java:2500-2503, 3602-3604, Player.java:274), so the recorded value is one no tick acts
        // on. Its readers, LocalPlayer.java:699 and :1141, both run in LocalPlayer.aiStep before super.aiStep (:893), where the
        // glide ends; what else reads the pose in between (LivingEntity.updateSwimAmount) only draws.)
        if (decided?.fallFlying === true && expected?.fallFlying !== true) unavailable.add('movingSlowly');
        // (the engine takes the look as it is given: before 1.12 it follows the head, which a mount turns during the tick)
        unavailable.add('look');
        // (a field this release has no vanilla value for, as Entity.mainSupportingBlockPos before 1.20)
        for (const [key, map] of Object.entries(NATIVE_SIM)) {
            if (!('from' in map) || typeof map.from !== 'string') continue;
            const spec = (PLAYER_FIELDS as Record<string, { versions?: string }>)[map.from];
            if (spec && !inRange(version, spec.versions)) unavailable.add(key);
        }
        for (const [key, map] of Object.entries(NATIVE_SIM)) {
            if (!('server' in map) || !map.server) continue;
            const value = (next?.srv as Record<string, unknown> | undefined)?.[map.server];
            if (value === undefined) unavailable.add(key);
            else want[key] = value;
        }
        // a field that means vanilla's value at another phase is expected from that phase
        for (const [key, map] of Object.entries(NATIVE_SIM)) {
            if (!('comparedAt' in map) || !map.comparedAt) continue;
            const at = phase(row, map.comparedAt);
            if (!at) {
                problems.push(`t=${row.t}: no ${map.comparedAt} to compare ${key} with`);
                continue;
            }
            want[key] = (toNative(at, at, { version, pre: row.pre, post: row.post, swiftSneak }) as unknown as Record<string, unknown>)[key];
        }
        const got = { ...(after as unknown as Record<string, unknown>) };
        // isMovingSlowly is a getter, which the engine has as the input it was given: in the swimming pose it is
        // isVisuallyCrawling, !isInWater, and a move that enters or leaves water changes that (26.3 LocalPlayer.java:670-672,
        // Entity.java:2844-2846), so it is compared on the engine's own isInWater
        if (decided?.pose === 'swimming' && typeof after.inWater === 'boolean') got.movingSlowly = !after.inWater;
        // from 1.17 the engine keeps no box of its own: it is the position and the dimensions, as vanilla makes it
        // (EntityDimensions.makeBoundingBox), so it is compared that way rather than left out
        if (got.boundingBox === undefined && after.position && after.halfWidth !== undefined && after.height !== undefined) {
            const { x, y, z } = after.position;
            got.boundingBox = { min: { x: x - after.halfWidth, y, z: z - after.halfWidth }, max: { x: x + after.halfWidth, y: y + after.height, z: z + after.halfWidth } };
        }
        const divergences = compareNative(want, got, { tick: row.t, at: scene ? 'afterAiStep (vel: post)' : 'afterAiStep', source: 'native' }, unavailable, undefined, undefined, undefined, fields);
        prediction?.keep(after, target, row.t, divergences.length > 0);
        results.push({ t: row.t, divergences });
        if (traced) {
            // (with entities or rockets around, the seed's motion is from before them, and the trace's points are not vanilla's)
            const seen = comparePhases(traced.phases, row, { version, pre: row.pre, post: row.post, swiftSneak }, { noTravel: state.removed === true, skip: new Set(moves || scene ? ['velocity'] : []) });
            phaseValues += seen.compared;
            for (const [key, n] of Object.entries(seen.counts)) phaseFields[key] = (phaseFields[key] ?? 0) + n;
            problems.push(...seen.problems);
            if (seen.divergences.length > 0) results.push({ t: row.t, divergences: seen.divergences });
        }
    }
    problems.push(...border.problems);
    // (a block the engine refused is a gap in its world: said here, or it reads as a physics difference)
    for (const [cell, why] of (sync as { refused?: ReadonlyMap<string, string> }).refused ?? []) problems.push(`the engine refused the block at ${cell}: ${why}`);
    const health = recording.rows.flatMap(row => (typeof row.srv?.health === 'number' ? [{ t: row.t, health: row.srv.health }] : []));
    const missed = [...(landings ? compareLandings(landings, health) : []), ...(contact ? compareContact(contact, health) : []), ...(freezing ? compareFreezing(freezing, health) : []), ...(impacts ? compareWallImpacts(impacts, health) : [])];
    if (missed.length > 0) results.push({ t: missed[0]!.tick, divergences: missed });
    const diverged = results.filter(r => r.divergences.length > 0);
    return {
        id: recording.header.scenario.id,
        ticks: recording.rows.length,
        compared,
        unmodelled,
        interpolated,
        elsewhere,
        diverged: diverged.length,
        problems,
        ...(diverged[0] ? { first: diverged[0].divergences[0] } : {}),
        results,
        mode,
        fields,
        ...(prediction ? { continuous: { drift: prediction.report(), corrections: prediction.corrections, reseeds: prediction.reseeds, vehicle: { carried: ride!.carried, reseeds: ride!.reseeds }, decidedByVanilla: DECIDED_BY_VANILLA } } : {}),
        ...(options.phases ? { phases: { compared: phaseValues, fields: phaseFields } } : {}),
    };
}
