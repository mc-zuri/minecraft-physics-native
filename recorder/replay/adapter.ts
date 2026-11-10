// The decisions the native replay seeds from vanilla (engine.ts) are the adapter's, so this layer asks the adapter for
// them: each tick is run through NativePhysics.simulate from vanilla's state at the start of that tick and the keys of
// that tick and the one before it, and what it decided (the crouch, the pose, the glide's start, flight, swimming) is
// compared with vanilla's state at the end of the tick. A passenger's tick is left to the vehicle layer.

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Recording, Snapshot } from '../schema/recording.ts';
import { BorderTracker } from './border.ts';
import { ChunkTracker } from './chunks.ts';
import { TeamTracker } from './teams.ts';
import { packetBytes } from './load.ts';
import { decodeClientbound, decodeServerbound, leavesOverworld } from './packets.ts';
import type { Divergence } from './compare.ts';
import { nativeBinding } from './engine.ts';
import { entityKind } from './seed.ts';
import { AreaWorld } from './world.ts';
import { versionAtLeast } from '../scenarios/dsl/names.ts';

const require = createRequire(import.meta.url);
const root = new URL('../../', import.meta.url);
const distPath = new URL('dist/index.js', root).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// (a registry is tens of MB: one for each recording runs a long replay out of heap)
const registries = new Map<string, unknown>();
const registryFor = (mc: string): unknown => {
    if (!registries.has(mc)) {
        registries.set(mc, require('prismarine-registry')(mc));
    }
    return registries.get(mc);
};

/** The pose ids of the adapter (src/mineflayer/player.ts Pose) by vanilla's name; `sneaking` is 1.14's, as `dying` and `crouching`. */
const POSES: Readonly<Record<string, number>> = {
    standing: 0, fall_flying: 1, sleeping: 2, swimming: 3, spin_attack: 4, sneaking: 5, crouching: 5, long_jumping: 6, dying: 7,
};

const f32 = Math.fround;
const VEHICLES = /(^|_)(boat|raft|minecart)$/;
/** Another player, as the recorder names it (before 1.11 by its client class). */
const REMOTE_PLAYER = /^(player|RemotePlayer)$/;
/** The family whose cases build the area's own blocks in the nether (engine.ts ULTRA_WARM). */
const ULTRA_WARM = /^physrec\/uw_/;
/** The player's attack_speed as the snapshot gives it: the base and an item's modifiers. */
const attackSpeedOf = (s: Snapshot): number => {
    const a = ((s.attributes ?? {}) as Record<string, { base: number; modifiers: { amount: number; operation: string | number }[] } | undefined>);
    const speed = a['minecraft:attack_speed'] ?? a['attack_speed'] ?? a['minecraft:generic.attack_speed'] ?? a['generic.attack_speed'];
    return (speed?.base ?? 4) + (speed?.modifiers ?? []).reduce((sum, m) => sum + (m.operation === 0 || m.operation === 'add_value' || m.operation === 'addition' ? m.amount : 0), 0);
};
/** The synced slot of the living flags, which says the Riptide spin (1.13: 6, 1.14: 7, 1.17: 8). */
const livingSlot = (version: string) => (versionAtLeast(version, '1.17') ? 8 : versionAtLeast(version, '1.14') ? 7 : 6);
const KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'] as const;
/** The keys as the tick's input read them (a screen that opens clears them), which row.input does not say. */
const controls = (keys: Readonly<Record<string, boolean>> | undefined) => Object.fromEntries(KEYS.map(k => [k, keys?.[k] === true])) as Record<(typeof KEYS)[number], boolean>;

/**
 * LocalPlayer.vehicleCanSprint and jumpableVehicle (26.3 LocalPlayer.java:587-595, :1144-1146) of the recorded vehicle: only a
 * camel sprints (Camel.canSprint), a camel, a horse or a nautilus jumps. The vehicle's move is the vehicle layer's, so a
 * ridden tick is asked its decisions alone.
 */
interface RecordedVehicle { id?: number; root?: number; type?: string; onGround?: boolean; controlledByLocalInstance?: boolean; box?: number[]; boat?: { status?: string | null } }
const CAMELS = /^camel(_husk)?$/;
const BOATS = /(^|_)(boat|raft)$/;
const JUMPERS = /^(camel|camel_husk|horse|donkey|mule|skeleton_horse|zombie_horse|llama|trader_llama|nautilus|zombie_nautilus)$/;
const canSprintVehicle = (v: RecordedVehicle | undefined): boolean => v?.controlledByLocalInstance === true && CAMELS.test(v.type ?? '');
const canJumpVehicle = (v: RecordedVehicle | undefined): boolean => v?.controlledByLocalInstance === true && JUMPERS.test(v.type ?? '');

const FIELDS = ['crouching', 'pose', 'fallFlying', 'flying', 'swimming', 'sprinting', 'sprintTriggerTime', 'flyJumpTriggerTime', 'leftImpulse', 'forwardImpulse', 'inputJumping', 'inputShiftKeyDown'] as const;
/** What the tick's input left, in the adapter's terms: the impulses it made of the keys, and the keys as the input read them. */
const INPUT: Readonly<Record<string, (state: Record<string, unknown>) => unknown>> = {
    leftImpulse: s => (s.heading as { strafe: number }).strafe,
    forwardImpulse: s => (s.heading as { forward: number }).forward,
    // (wasJumping: an auto-jump presses the input's jump for its tick)
    inputJumping: s => (s.prevControl as { jump: boolean }).jump,
    inputShiftKeyDown: s => (s.control as { sneak: boolean }).sneak,
};
/** The state fields that are another recorded field's (the adapter's names for vanilla's). */
const RECORDED: Readonly<Record<string, string>> = { flyJumpTriggerTime: 'jumpTriggerTime' };
/** What the adapter's whole tick leaves, the move the decisions fed the engine (cli.ts --adapter --motion). */
export const MOTION = ['pos', 'vel', 'onGround', 'fallDistance', 'jumpTicks', 'autoJumpTime', 'isCollidedHorizontally', 'isCollidedHorizontallyMinor', 'isCollidedVertically', 'isInWater', 'isInLava', 'isUnderWater', 'eyeInWater', 'onClimbable', 'isInPowderSnow', 'stuckSpeedMultiplier', 'bbWidth', 'bbHeight', 'eyeHeight'] as const;
const RECORDED_MOTION: Readonly<Record<string, string>> = { jumpTicks: 'noJumpDelay', isCollidedHorizontally: 'horizontalCollision', isCollidedHorizontallyMinor: 'minorHorizontalCollision', isCollidedVertically: 'verticalCollision' };
const OPERATIONS: Readonly<Record<string, number>> = {
    add_value: 0, addition: 0, add_multiplied_base: 1, multiply_base: 1, add_multiplied_total: 2, multiply_total: 2,
};

type Keys = Readonly<Record<string, boolean>> | undefined;
interface Vec3Like { x: number; y: number; z: number; set(x: number, y: number, z: number): void; clone(): Vec3Like }
const vec = (x: number, y: number, z: number): Vec3Like => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; }, clone() { return vec(this.x, this.y, this.z); } }) as Vec3Like;

interface RecordedEntity { id: number; type: string; pos: [number, number, number]; box: [number, number, number, number, number, number]; tickedBeforePlayer: boolean; baby?: boolean; staysStill?: boolean; root?: number }
const placed = (e: RecordedEntity) => ({
    position: vec(...e.pos),
    boundingBox: { minX: e.box[0], minY: e.box[1], minZ: e.box[2], maxX: e.box[3], maxY: e.box[4], maxZ: e.box[5] },
});
/** The kinds of entity whose own tick pushes the player (seed.ts entityKind): a still one or an inert one does not. */
const PUSHERS = new Set(['boat', 'living', 'shulker', 'happy_ghast', 'happy_ghast_stays_still']);
const attachedIdsOf = (...snapshots: Snapshot[]) => new Set(snapshots.flatMap(s => ((s.attachedRockets ?? []) as { id: number }[]).map(r => r.id)));
/** The entities as the adapter takes them: where each was when the tick began, and where its own tick left it. */
function entitiesAround(version: string, start: Snapshot, pre: Snapshot, post: Snapshot): unknown[] {
    const at = (s: Snapshot) => new Map(((s.nearbyEntities ?? []) as RecordedEntity[]).map(e => [e.id, e]));
    const before = at(pre);
    const after = at(post);
    return ((start.nearbyEntities ?? []) as RecordedEntity[]).map(e => {
        const from = e.tickedBeforePlayer ? before.get(e.id) ?? e : e;
        const to = e.tickedBeforePlayer ? e : after.get(e.id) ?? e;
        const vehicle = start.vehicle as RecordedVehicle | undefined;
        return { id: e.id, name: e.type, sameVehicle: vehicle != null && (e.id === vehicle.id || (e.root !== undefined && e.root === vehicle.root)), living: entityKind(version, e as never) !== 'inert', baby: e.baby, staysStill: e.staysStill, ...placed(from), ticksBeforePlayer: e.tickedBeforePlayer, afterTick: placed(to) };
    });
}

/** The state of mineflayer-physics-utils' PlayerState the adapter reads, from vanilla's snapshot at the start of the tick. */
function stateOf(s: Snapshot, keys: Keys, lastKeys: Keys, chest: { id?: string } | undefined, version: string, bot: unknown): Record<string, unknown> {
    const [x, y, z] = s.pos as [number, number, number];
    const [vx, vy, vz] = s.vel as [number, number, number];
    const yaw = s.yRot as number;
    return {
        age: 0, pos: vec(x, y, z), vel: vec(vx, vy, vz), onGround: s.onGround, lastOnGround: s.lastOnGround ?? s.onGround, onClimbable: s.onClimbable,
        isInWater: s.isInWater, isUnderWater: s.isUnderWater, isInLava: s.isInLava, isInWeb: false, isCollidedHorizontally: s.horizontalCollision,
        isCollidedHorizontallyMinor: s.minorHorizontalCollision ?? false, isCollidedVertically: s.verticalCollision, fallDistance: s.fallDistance, scale: 1,
        isInPowderSnow: s.isInPowderSnow ?? false, wasInPowderSnow: s.wasInPowderSnow ?? false, keptBoundingBox: null, stuckSpeedMultiplier: vec(...(s.stuckSpeedMultiplier as [number, number, number])),
        nearbyEntities: [], pistonDeltas: [0, 0, 0], pistonDeltasTick: -1, jumpTicks: s.noJumpDelay ?? 0, sprintTriggerTime: s.sprintTriggerTime ?? 0,
        prevForwardImpulse: s.forwardImpulse ?? 0, autoJumpEnabled: s.autoJumpEnabled ?? false, autoJumpTime: s.autoJumpTime ?? 0, autoJumping: false, flyJumpTriggerTime: s.jumpTriggerTime ?? 0, attributes: {},
        yaw: Math.PI - (yaw * Math.PI) / 180, yawDegrees: yaw, pitch: -((s.xRot as number) * Math.PI) / 180, control: controls(keys), prevControl: controls(lastKeys),
        heading: { forward: 0, strafe: 0 }, prevHeading: { forward: 0, strafe: 0 }, isUsingItem: s.usingItem ?? false, useItemSpeedMultiplier: s.itemUseSpeedMultiplier, effects: {}, jumpBoost: 0, speed: 0, slowness: 0,
        dolphinsGrace: 0, slowFalling: 0, levitation: 0, blindness: 0, depthStrider: s.depthStrider ?? 0, swiftSneak: 0, riptide: 0, itemUseTicks: 0, autoSpinAttackTicks: s.autoSpinAttackTicks ?? 0,
        soulSpeed: s.soulSpeed ?? 0, pose: POSES[s.pose as string] ?? 0, gameMode: s.gameMode, food: s.food ?? 20, mayFly: s.mayfly ?? false, flying: s.flying ?? false, swimming: s.swimming ?? false,
        sprinting: s.sprinting ?? false, crouching: s.crouching ?? false, fallFlying: s.fallFlying ?? false, flySpeed: s.flyingSpeed ?? 0.05, validElytraEquipped: chest?.id === 'elytra',
        canWalkOnPowderSnow: (s.equipment as Record<string, { id?: string }> | undefined)?.feet?.id === 'leather_boots', invulnerable: s.invulnerable ?? false, noGravity: s.noGravity ?? false, fireworkRocketDuration: 0, fireworkRockets: 0, fireworkRocketsBeforePlayer: 0, supportingBlockPos: Array.isArray(s.mainSupportingBlockPos) ? vec(...(s.mainSupportingBlockPos as [number, number, number])) : null, passenger: false, bot, version,
        getBB() { return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }; },
    };
}

interface Registry { effectsByName: Record<string, { id: number }> }
/** The state's effects, by the ids and the names of the registry (minecraft:jump_boost is its JumpBoost). */
function effectsOf(registry: Registry, effects: readonly { id: string; amplifier: number }[]): Record<number, { amplifier: number }> {
    const named = new Map(Object.entries(registry.effectsByName).map(([name, e]) => [name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(), e.id]));
    return Object.fromEntries(effects.flatMap(e => {
        const id = named.get(e.id.replace(/^minecraft:/, ''));
        return id === undefined ? [] : [[id, { amplifier: e.amplifier }]];
    }));
}

/** The attributes as the server's packets give a bot its own: the base and the modifiers, under each name the release may read. */
function attributesOf(s: Snapshot, setup: readonly { id: string; modifiers?: readonly { uuid: string }[] }[]): Record<string, unknown> {
    const recorded = (s.attributes ?? {}) as Record<string, { base: number; modifiers: { id: string; amount: number; operation: string | number }[] }>;
    const out: Record<string, unknown> = {};
    for (const [key, attribute] of Object.entries(recorded)) {
        // (the recorder sorts them; a packet lists them as they were added, which decides two of a container's bucket: the setup's order)
        const added = setup.flatMap(a => (a.modifiers ?? []).map(m => m.uuid));
        const rank = (id: string) => (added.includes(id) ? added.indexOf(id) : added.length);
        const modifiers = [...attribute.modifiers].sort((a, b) => rank(a.id) - rank(b.id)).map(m => ({ id: m.id, uuid: m.id, amount: m.amount, operation: typeof m.operation === 'number' ? m.operation : OPERATIONS[m.operation.toLowerCase()] ?? 0 }));
        const value = { value: attribute.base, modifiers };
        const bare = key.replace(/^minecraft:/, '');
        out[bare] = value;
        out[`minecraft:${bare}`] = value;
    }
    return out;
}

/**
 * A bot the server told the effects and no movement speed: the sprint's modifier alone, which its own setSprinting keeps, and the
 * engine's fallback applies the effects what the attribute held (src/mineflayer/player.ts syncedSpeed). The motion has to be the same.
 */
function unsyncedSpeed(attributes: Record<string, unknown>): Record<string, unknown> {
    const sprinting = /^(minecraft:sprinting|662a6b8d-da3e-4c1c-8813-96ea6097278d)$/i;
    return Object.fromEntries(Object.entries(attributes).map(([key, value]) => {
        if (!/(^|[.:])movement_speed$/.test(key)) return [key, value];
        const { modifiers, ...held } = value as { modifiers: { id: string }[] };
        return [key, { ...held, unsynced: true, modifiers: modifiers.filter(m => sprinting.test(String(m.id))) }];
    }));
}

export interface AdapterResult {
    readonly id: string;
    readonly compared: number;
    /** The ticks vanilla started a glide on, and those the adapter did: its own decision, as each tick begins from vanilla's state. */
    readonly glideStarts: readonly number[];
    readonly adapterGlideStarts: readonly number[];
    readonly first?: Divergence;
    readonly divergences: readonly Divergence[];
}

/** The ticks of a recording through the adapter, one tick each. `fields` narrows what is compared. */
export function replayAdapter(recording: Recording, fields: readonly string[] = FIELDS, motion = false, effectsOnly = false, clones = false): AdapterResult {
    const version = recording.header.mc;
    const { NativePhysics } = require(distPath) as { NativePhysics: new (registry: unknown, options?: object) => {
        dispose(): void;
        simulate(ctx: { state: unknown }, world: unknown): void;
        refreshDimensions(state: unknown): void;
        cloneState(state: Record<string, unknown>): Record<string, unknown>;
        shulkerBoxesOf(world: unknown): unknown[] | undefined;
        pushByShulkerBox(ctx: { state: unknown }, world: unknown, open: unknown): void;
        syncOf(world: unknown): { blockChanged(pos: { x: number; y: number; z: number }): void; columnChanged(chunkX: number, chunkZ: number, loaded: boolean): void };
    } };
    nativeBinding();
    const registry = registryFor(version) as Registry;
    const physics = new NativePhysics(registry, { version });
    const swiftSneak = (recording.header.setup.equipment as Record<string, { enchantments?: Record<string, number> }>).legs?.enchantments?.swift_sneak ?? 0;
    const area = new AreaWorld(recording.header);
    const chunks = new ChunkTracker(version, recording.rows);
    area.holds = (x, z) => chunks.holds(x, z);
    const border = new BorderTracker(version);
    const teams = new TeamTracker(recording.header);
    const divergences: Divergence[] = [];
    let compared = 0;
    const glideStarts: number[] = [];
    const adapterGlideStarts: number[] = [];
    let lastKeys: Keys;
    // (mineflayer-physics-utils' clone, as far as this layer's state has one: the copy keeps the method)
    const clonable = (state: Record<string, unknown>): Record<string, unknown> => Object.defineProperty(state, 'clone', {
        value(this: Record<string, unknown>) { return clonable({ ...this, pos: (this.pos as Vec3Like).clone(), vel: (this.vel as Vec3Like).clone() }); }, writable: true, configurable: true, enumerable: false,
    });
    let state: Record<string, unknown> = clonable({});
    let ranLast = false;
    const riptide = (recording.header.setup.equipment as Record<string, { enchantments?: Record<string, number> }>).mainhand?.enchantments?.riptide ?? 0;
    let spinBefore = 0;
    let livingFlags = 0;
    let attackStrengthTicker = 1000;
    // (from 1.21 the enchantment is a server's: getKnockback asks EnchantmentHelper only in a ServerLevel, 1.21 LivingEntity.java:1422-1425)
    const knockbackLevel = versionAtLeast(version, '1.21') ? 0 : (recording.header.setup.equipment as Record<string, { enchantments?: Record<string, number> }>).mainhand?.enchantments?.knockback ?? 0;
    // the item in use's whole duration, which the snapshot says on the first tick of the use: the adapter counts up what vanilla
    // counts down, and TridentItem.releaseUsing reads their difference (1.13.2 class_3564.java:62, 26.3 TridentItem.java:64)
    let useDuration: number | undefined;
    let lastRemaining: number | undefined;
    // (in another dimension the area is not the world, but for a case that built it again in the nether: as engine.ts)
    let away = false;
    const ultraWarmCase = ULTRA_WARM.test(recording.header.scenario.id);
    // the bot's events the adapter listens to (base.ts syncMovingBlocks): the block events of the shulker boxes on its client,
    // its physicsTick, after which the lids move on, and its blockUpdate, one bot through the recording
    const botEvents = new EventEmitter();
    const client = new EventEmitter();
    let lidsTicked = false;
    for (const [rowIndex, row] of recording.rows.entries()) {
        // (the client's block entities tick after its entities: a tick not run here moves the lids on before this row's packets)
        if (rowIndex > 0 && !lidsTicked) botEvents.emit('physicsTick');
        lidsTicked = false;
        border.tick();
        border.packets(row.s2c);
        const respawn = row.s2c.findLast(p => p.name === 'ClientboundRespawnPacket');
        if (respawn) away = leavesOverworld(version, packetBytes(respawn.b));
        if (respawn && ultraWarmCase) {
            chunks.respawned();
            const [x0, , z0, x1, , z1] = recording.header.world.area.box;
            const [originX, , originZ] = recording.header.world.origin;
            for (let x = (x0 + originX) >> 4; x <= (x1 + originX) >> 4; x += 1) {
                for (let z = (z0 + originZ) >> 4; z <= (z1 + originZ) >> 4; z += 1) physics.syncOf(area).columnChanged(x, z, false);
            }
        }
        for (const [x, y, z, state] of row.blocks) {
            area.setState(x, y, z, state);
            physics.syncOf(area).blockChanged({ x, y, z });
            botEvents.emit('blockUpdate', null, { position: { x, y, z }, name: state.replace(/^minecraft:/, '').replace(/\[.*$/, '') });
        }
        for (const packet of row.s2c) {
            if (packet.name !== 'ClientboundBlockEventPacket') continue;
            client.emit('block_action', decodeClientbound(version, packetBytes(packet.b)).params);
        }
        for (const [chunkX, chunkZ, loaded] of chunks.packets(row.s2c)) physics.syncOf(area).columnChanged(chunkX, chunkZ, loaded);
        const start = row.phases.find(p => p.name === 'tickStart')?.state ?? row.pre;
        const keys = (row.phases.find(p => p.name === 'afterInput')?.state ?? start).keys as Keys;
        const end = row.phases.find(p => p.name === 'tickEnd')?.state ?? row.post;
        // (a mount or a dismount inside the tick is the server's: the tick's decisions are asked once the seat holds)
        const riding = start.passenger === true && end.passenger === true;
        const seatChanges = (start.passenger === true) !== (end.passenger === true);
        // (a moving block is no shape here: the adapter gets those from the bot)
        const moving = ((start.movingPistons ?? []) as unknown[]).length > 0;
        if (!row.playerTicked || seatChanges || start.health === 0 || moving || (away && !ultraWarmCase)) {
            lastKeys = keys;
            ranLast = false;
            continue;
        }
        const chest = (start.equipment as Record<string, { id?: string }> | undefined)?.chest;
        // (the snapshot says the item, not its damage: this case is the one worn to its last point)
        const refused = /^physrec\/f_elytra_last_use_/.test(recording.header.scenario.id);
        teams.packets(row.s2c);
        const others = (start.nearbyEntities ?? []) as RecordedEntity[];
        const bot = {
            on: botEvents.on.bind(botEvents), removeListener: botEvents.removeListener.bind(botEvents), _client: client,
            worldBorder: border.state(),
            game: { ...(versionAtLeast(version, '1.18') ? { minY: -64, height: 384 } : { minY: 0, height: 256 }), dimension: away ? 'the_nether' : 'overworld' },
            // the scoreboard as a bot's teamMap holds it: the player's name, and each entity's UUID
            username: recording.header.player.name,
            entities: Object.fromEntries(others.map(e => [e.id, { uuid: `${e.id}` }])),
            teamMap: { ...Object.fromEntries(others.map(e => [`${e.id}`, teams.teamOfType(e.type)])), [recording.header.player.name]: teams.teamOfPlayer() },
        };
        // one state through the recording, as a bot has: what the engine keeps for it (the block it stands on, the size the
        // last refresh left) goes on while vanilla's next tick starts where the last one ended
        const { scale: _scale, keptBoundingBox: _kept, itemUseTicks: _used, ...seed } = stateOf(start, keys, lastKeys, refused ? undefined : chest, version, bot);
        Object.assign(state, seed);
        const vehicle = start.vehicle as RecordedVehicle | undefined;
        state.passenger = riding;
        if (riding) {
            state.vehicleCanSprint = canSprintVehicle(vehicle);
            state.vehicleJumpable = canJumpVehicle(vehicle);
            state.vehicleOnGround = vehicle?.onGround;
            const [minX, minY, minZ, maxX, maxY, maxZ] = vehicle?.box ?? [];
            state.boatVehicle = BOATS.test(vehicle?.type ?? '') && maxZ !== undefined
                ? { boundingBox: { min: { x: minX!, y: minY!, z: minZ! }, max: { x: maxX!, y: maxY!, z: maxZ } }, underwater: /^under_/.test(vehicle?.boat?.status ?? '') }
                : null;
        }
        const using = start.usingItem === true;
        // (before 1.9 the recorder's count is the use's elapsed ticks, EntityPlayer.getItemInUseDuration, and counts up)
        const elapsedCount = !versionAtLeast(version, '1.9');
        const remaining = start.useItemRemainingTicks as number | undefined;
        // (an item used up and taken up again between two ticks starts its count over: more left than the last tick ended with, or less
        // elapsed)
        const restarted = using && remaining !== undefined && lastRemaining !== undefined && (elapsedCount ? remaining < lastRemaining : remaining > lastRemaining);
        if (!using || restarted) useDuration = undefined;
        if (using) useDuration ??= remaining;
        // (the count the adapter keeps: vanilla's after a tick it did not run, or a use that started over)
        if (!ranLast || restarted) state.itemUseTicks = using && useDuration !== undefined ? (elapsedCount ? remaining ?? 0 : useDuration - remaining!) : 0;
        // (before 1.17 the box is the entity's own: a tick this layer did not run, a piston's push among them, takes vanilla's, and then the one the adapter keeps)
        if (!versionAtLeast(version, '1.17') && Array.isArray(start.box) && (!ranLast || (state.keptBoundingBox as { pos?: Vec3Like } | null | undefined)?.pos === undefined)) {
            const [minX, minY, minZ, maxX, maxY, maxZ] = start.box as number[];
            state.keptBoundingBox = { bb: { minX: minX!, minY: minY!, minZ: minZ!, maxX: maxX!, maxY: maxY!, maxZ: maxZ! }, pos: (seed.pos as Vec3Like).clone(), width: start.bbWidth, height: start.bbHeight };
        }
        // (on 1.14 - 1.16 every synced pose refits the box, an echo of the player's own too, and nothing says when but the box
        // itself: the caller's refreshDimensions, as a metadata packet calls for)
        const held = (state.keptBoundingBox as { bb: Record<string, number> } | null | undefined)?.bb;
        if (held && !versionAtLeast(version, '1.17') && versionAtLeast(version, '1.14') && ((start.box as number[])[3] !== held.maxX || (start.box as number[])[5] !== held.maxZ)) physics.refreshDimensions(state);
        // (the eyes the adapter left, which the next tick's isUnderWater is: vanilla's after a tick it did not run)
        if (!ranLast) state.eyeInWater = start.eyeInWater;
        // the effects and the attributes by their recorded names, as a bot holds them
        const effects = (start.effects ?? []) as { id: string; amplifier: number }[];
        state.nearbyEntities = entitiesAround(version, start, row.pre, row.post);
        state.levitation = (effects.find(e => e.id.endsWith('levitation'))?.amplifier ?? -1) + 1;
        state.effects = effectsOf(registry, effects);
        const attributes = attributesOf(start, (recording.header.setup.attributes ?? []) as { id: string; modifiers?: { uuid: string }[] }[]);
        state.attributes = effectsOnly ? unsyncedSpeed(attributes) : attributes;
        state.swiftSneak = swiftSneak;
        const gliding = start.fallFlying === true;
        // the attached rockets that boost this tick after the player's start: one that ticks before the player is in the velocity
        // the tick starts from (tickStart is past the entities before it)
        // (and one that ends in its turn after the player is gone from the row's end, its last boost given)
        const attached = [...((start.attachedRockets ?? []) as { id: number; tickedBeforePlayer: boolean }[]), ...((row.post.attachedRockets ?? []) as { id: number; tickedBeforePlayer: boolean }[])];
        const rockets = [...new Map(attached.map(r => [r.id, r])).values()].filter(r => !r.tickedBeforePlayer);
        state.fireworkRockets = rockets.length;
        state.fireworkRocketsBeforePlayer = 0;
        state.fireworkRocketDuration = rockets.length > 0 ? 2 : 0;
        // what ticks before the player and pushes it is already in the velocity the tick starts from, and the engine pushes in its
        // turn: it starts from before them, as the stepwise replay does (engine.ts), with the rockets that boost among them
        // (a hit below keeps its own start: the row's, before the entities)
        const pushed = others.some(e => e.tickedBeforePlayer && !attachedIdsOf(start, row.post).has(e.id) && PUSHERS.has(entityKind(version, e as never)));
        if (pushed) {
            (state.vel as Vec3Like).set(...(row.pre.vel as [number, number, number]));
            const before = attached.filter((r, i) => r.tickedBeforePlayer && attached.findIndex(o => o.id === r.id) === i);
            state.fireworkRockets = rockets.length + before.length;
            state.fireworkRocketsBeforePlayer = before.length;
            state.fireworkRocketDuration = rockets.length + before.length > 0 ? 2 : 0;
        }
        // the Riptide release moves the player with no packet: the tick's own start says it was released, as engine.ts reads it
        const spin = (start.autoSpinAttackTicks as number | undefined) ?? 0;
        const released = spin > 0 && spin >= spinBefore && riptide > 0;
        spinBefore = spin + 1;
        // (the key is handled before the tick begins, so the tick's start is past the launch: it runs from the row's start)
        if (released) {
            (state.pos as Vec3Like).set(...(row.pre.pos as [number, number, number]));
            (state.vel as Vec3Like).set(...(row.pre.vel as [number, number, number]));
            state.onGround = row.pre.onGround;
            state.autoSpinAttackTicks = 0;
            state.itemUseTicks = 10;
            state.isUsingItem = false;
            state.riptide = riptide;
            state.isInWater = true;
        } else {
            state.riptide = 0;
        }
        // a left click on an entity runs Player.attack before the tick begins, and the tick's start is past it: the hit runs from
        // the row's start. Only a vehicle's hurt and another player's say true on the client (Entity.hurtClient,
        // VehicleEntity.hurtClient :29, RemotePlayer.hurtClient 26.3 :31; 1.8.9 OtherClientPlayerEntity.damage)
        attackStrengthTicker += 1;
        for (const packet of row.c2s) {
            // (from 26.2 an attack has a packet of its own, ServerboundAttackPacket)
            const own = packet.name === 'ServerboundAttackPacket';
            if (!own && !/Interact|UseEntity/.test(packet.name)) continue;
            const { params } = decodeServerbound(version, packetBytes(packet.b));
            if (!own && params.mouse !== 1 && params.action !== 'attack') continue;
            const target = ((row.pre.nearbyEntities ?? []) as RecordedEntity[]).find(e => e.id === (own ? params.entityId : params.target));
            const speed = attackSpeedOf(start);
            const strength = Math.min(1, Math.max(0, (attackStrengthTicker + 0.5) / (20 / speed)));
            attackStrengthTicker = 0;
            if (!target || !(VEHICLES.test(target.type) || REMOTE_PLAYER.test(target.type))) continue;
            (state.vel as Vec3Like).set(...(row.pre.vel as [number, number, number]));
            state.sprinting = row.pre.sprinting;
            state.attackHit = { strength: f32(strength), knockback: knockbackLevel };
        }
        // (a swing at nothing resets the ticker too, Minecraft.startAttack's miss)
        if (row.c2s.some(packet => /Swing|Animation|Punch/.test(packet.name))) attackStrengthTicker = 0;
        // the spin's pose reads the server's flag, as its packets say it (LivingEntity.isAutoSpinAttack)
        if (riptide > 0) {
            for (const packet of row.s2c) {
                if (!/EntityData|EntityMetadata/.test(packet.name)) continue;
                const { params } = decodeClientbound(version, packetBytes(packet.b));
                if (params.entityId !== recording.header.player.id) continue;
                for (const entry of (params.metadata ?? []) as { key: number; value: unknown }[]) if (entry.key === livingSlot(version)) livingFlags = entry.value as number;
            }
        }
        (bot as { entity?: unknown }).entity = { metadata: { [livingSlot(version)]: livingFlags } };
        physics.simulate({ state }, area);
        // the lids tick after the player and push it as they open (ShulkerBoxBlockEntity.moveCollidedEntities)
        botEvents.emit('physicsTick');
        lidsTicked = true;
        for (const open of physics.shulkerBoxesOf(area) ?? []) physics.pushByShulkerBox({ state }, area, open);
        compared += 1;
        if (!gliding && end.fallFlying === true) glideStarts.push(row.t);
        if (!gliding && state.fallFlying === true) adapterGlideStarts.push(row.t);
        for (const field of fields) {
            const actual = INPUT[field] ? INPUT[field](state) : state[field];
            const want = end[RECORDED[field] ?? field];
            const expected = field === 'pose' ? POSES[want as string] : want;
            // (before 1.16 the field is the sneak this tick's input read, not what the tick's start decided: the pose says that)
            if (field === 'crouching' && !versionAtLeast(version, '1.16')) continue;
            // (a pose before 1.14 is what the recorder derives from the sneak: the adapter keeps none)
            if (field === 'pose' && !versionAtLeast(version, '1.14')) continue;
            // (the spin's pose outlives its ticks by the server's flag, which this layer does not follow)
            if (expected === undefined || expected === actual || expected === POSES.spin_attack) continue;
            divergences.push({ tick: row.t, at: 'tickEnd', source: 'adapter', field, expected, actual });
        }
        const usedTicks = typeof end.useItemRemainingTicks === 'number' && useDuration !== undefined ? (elapsedCount ? end.useItemRemainingTicks : useDuration - end.useItemRemainingTicks) : undefined;
        lastRemaining = end.usingItem === true ? end.useItemRemainingTicks as number | undefined : undefined;
        if (fields === FIELDS && end.usingItem === true && usedTicks !== undefined && usedTicks !== state.itemUseTicks) {
            divergences.push({ tick: row.t, at: 'tickEnd', source: 'adapter', field: 'useItemRemainingTicks', expected: usedTicks, actual: state.itemUseTicks });
        }
        if (motion && !riding) {
            for (const field of MOTION) {
                const size = (physics as unknown as { poseSize(pose: number, scale: number): { width: number; height: number }; eyeHeight(s: unknown): number });
                const actual = (field === 'bbWidth' ? f32(size.poseSize(state.pose as number, state.scale as number).width) : field === 'bbHeight' ? f32(size.poseSize(state.pose as number, state.scale as number).height) : field === 'eyeHeight' ? f32(size.eyeHeight(state)) : state[field]) as number | boolean | Vec3Like;
                const recorded = row.post[RECORDED_MOTION[field] ?? field];
                if (recorded === undefined) continue;
                // (the pose's sizes: before 1.14 and in the spin's pose, as in the decisions above, it is not the adapter's)
                if ((field === 'bbWidth' || field === 'bbHeight' || field === 'eyeHeight') && (!versionAtLeast(version, '1.14') || row.post.pose === 'spin_attack')) continue;
                const same = typeof actual === 'object'
                    ? Object.is(actual.x, (recorded as number[])[0]) && Object.is(actual.y, (recorded as number[])[1]) && Object.is(actual.z, (recorded as number[])[2])
                    : actual === recorded;
                if (!same) divergences.push({ tick: row.t, at: 'post', source: 'adapter', field, expected: recorded, actual: typeof actual === 'object' ? [actual.x, actual.y, actual.z] : actual });
            }
        }
        lastKeys = keys;
        ranLast = true;
        // the tick goes on from a fork of the state, as a prediction resumes: nothing the engine keeps may stay behind
        if (clones) state = physics.cloneState(state);
    }
    // (a recording's engine keeps a world sync and a player: a long replay would run out of memory)
    physics.dispose();
    return { id: recording.header.scenario.id, compared, glideStarts, adapterGlideStarts, divergences, ...(divergences[0] ? { first: divergences[0] } : {}) };
}
