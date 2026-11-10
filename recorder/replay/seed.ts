// Recorded snapshots <-> the native engine's NativeSimulationState, by the field registry
// (schema/fields.ts NATIVE_SIM). The native-only replay seeds the engine from vanilla's state at
// the start of the tick and from the decisions vanilla's LocalPlayer.aiStep made before
// LivingEntity.aiStep (the adapter makes those in TypeScript), then compares what the tick leaves.

import { createRequire } from 'node:module';
import type { NativeAabb, NativeAttributeModifier, NativeNearbyEntity, NativeSimulationState } from '../../native/artifacts/native.js';
import type { Snapshot } from '../schema/recording.ts';
import type { PlayerFieldKey } from '../schema/fields.ts';
import { versionAtLeast } from '../scenarios/dsl/names.ts';

const f32 = Math.fround;
const require = createRequire(import.meta.url);

/** What a tick's seed needs besides vanilla's two snapshots. */
export interface SeedContext {
    readonly version: string;
    /** Where the tick reads movingSlowly, when not where it decides the rest: see engine.ts. */
    readonly slow?: Snapshot;
    /** The tick's row: the scene before the entities ticked (pre) and after the client's tick (post). */
    readonly pre: Snapshot;
    readonly post: Snapshot;
    /** The Swift Sneak level the setup put on the legs. */
    readonly swiftSneak: number;
    /** Whether the team rules let an entity of this type push the player (absent: they do). */
    readonly pushes?: (type: string) => boolean;
}

interface RecordedEntity { id: number; type: string; pos: [number, number, number]; box: [number, number, number, number, number, number]; tickedBeforePlayer: boolean; order?: number; baby?: boolean; staysStill?: boolean }

const NOT_MOBS = new Set(['Vehicles', 'Drops', 'Blocks', 'Projectiles', 'Immobile']);
const FREEZE_IMMUNE = new Set(['leather_boots', 'leather_leggings', 'leather_chestplate', 'leather_helmet']);
const LIVING_CATEGORIES = new Set(['mob', 'animal', 'hostile', 'ambient', 'water_creature', 'passive', 'player']);
const categories = new Map<string, Map<string, string>>();
let modernNames: Map<string, string> | undefined;
function modernTypes(): Map<string, string> {
    modernNames ??= new Map((require('minecraft-data')('1.20.4') as { entitiesArray: { name: string; type: string }[] }).entitiesArray.map(e => [e.name, e.type]));
    return modernNames;
}

/** minecraft-data's category of an entity type (mob, animal, other...). */
function category(version: string, type: string): string | undefined {
    let byName = categories.get(version);
    if (!byName) {
        const data = require('minecraft-data')(version) as { entitiesArray: { name: string; type: string; category?: string }[] };
        // (up to 1.16.5 every type is "mob" and the kind is in the category: a boat, a minecart and a dropped item are too)
        // (and 1.13 and 1.14 have no category at all, and 1.15 to 1.16.5 UNKNOWN for a rocket, a bee or a piglin: a later release,
        // which types them properly, says)
        const modern = new Map((require('minecraft-data')('1.20.4') as typeof data).entitiesArray.map(e => [e.name, e.type]));
        byName = new Map(data.entitiesArray.map(e => [e.name, e.type === 'mob' && NOT_MOBS.has(e.category ?? '') ? 'other'
            : e.type === 'mob' && (!e.category || e.category === 'UNKNOWN') ? modern.get(e.name) ?? e.type : e.type]));
        categories.set(version, byName);
    }
    // (a recording before 1.11 says an entity by its later name)
    return byName.get(type) ?? modernTypes().get(type);
}

/** How the engine treats an entity, as the adapter decides it (src/mineflayer/player.ts entityKind). */
export function entityKind(version: string, entity: RecordedEntity): string {
    const type = entity.type;
    if (/(^|_)(boat|raft)$/.test(type) || type === 'chest_boat') return 'boat';
    if (type === 'shulker') return 'shulker';
    if (/(^|_)minecart$/.test(type)) return 'minecart';
    if (type === 'happy_ghast') return entity.baby ? 'living' : entity.staysStill ? 'happy_ghast_stays_still' : 'happy_ghast';
    if (type === 'armor_stand') return 'still_living';
    // (the recorder names another player by its client class before 1.11, RemotePlayer: from 1.9 players push each other,
    // the team's collision rule, 1.9.4 EntityOtherPlayerMP.canBePushed; in 1.8 a remote player pushes nothing, 1.8.9
    // OtherClientPlayerEntity)
    if (type === 'RemotePlayer') return versionAtLeast(version, '1.9') ? 'living' : 'inert';
    return LIVING_CATEGORIES.has(category(version, type) ?? '') ? 'living' : 'inert';
}

const aabb = (b: readonly number[]): NativeAabb => ({ min: { x: b[0]!, y: b[1]!, z: b[2]! }, max: { x: b[3]!, y: b[4]!, z: b[5]! } });

/**
 * The entities around the player as the engine takes them: where each was when the client's tick began and where its
 * own tick left it. The client ticks some before the player (at tickStart they have moved: pre has where they were)
 * and the rest after it (post has where they went).
 */
/**
 * The firework rockets attached to the player that boosted it this tick: those attached at its end (a new rocket
 * attaches in its first tick, so tickStart does not list it yet), on their side of the player.
 */
const attachedRockets = (post: Snapshot) => (post.attachedRockets ?? []) as { tickedBeforePlayer: boolean; order?: number }[];

function rockets(post: Snapshot): { fireworkRockets?: number; fireworkRocketsBeforePlayer?: number } {
    const attached = attachedRockets(post);
    // (in tick order among the entities when the recording says it: see nearbyEntities)
    if (attached.length === 0 || attached.every(r => typeof r.order === 'number')) return {};
    return { fireworkRockets: attached.length, fireworkRocketsBeforePlayer: attached.filter(r => r.tickedBeforePlayer).length };
}

/** The ids of the rockets attached to the player at the end of the tick: they are given as rockets, not entities. */
const attachedIds = (post: Snapshot) => new Set(((post.attachedRockets ?? []) as { id: number }[]).map(r => r.id));

export function nearbyEntities(start: Snapshot, ctx: SeedContext): NativeNearbyEntity[] {
    const at = (s: Snapshot) => new Map(((s.nearbyEntities ?? []) as RecordedEntity[]).map(e => [e.id, e]));
    const before = at(ctx.pre);
    const after = at(ctx.post);
    const out: NativeNearbyEntity[] = [];
    const order: number[] = [];
    const position = new Map(((ctx.post.nearbyEntities ?? []) as RecordedEntity[]).map(e => [e.id, e.order]));
    const rocketIds = attachedIds(ctx.post);
    for (const e of (start.nearbyEntities ?? []) as RecordedEntity[]) {
        if (rocketIds.has(e.id)) continue;
        const from = e.tickedBeforePlayer ? before.get(e.id) ?? e : e;
        const to = e.tickedBeforePlayer ? e : after.get(e.id) ?? e;
        // (a fireball summoned with no power before 1.13 has a NaN box on the client: no comparison meets it)
        if (![...from.pos, ...from.box, ...to.pos, ...to.box].every(v => typeof v === 'number' && Number.isFinite(v))) continue;
        out.push({
            kind: entityKind(ctx.version, e),
            position: vec(from.pos),
            boundingBox: aabb(from.box),
            ticksBeforePlayer: e.tickedBeforePlayer,
            tickPosition: vec(to.pos),
            tickBoundingBox: aabb(to.box),
            ...(ctx.pushes?.(e.type) === false ? { teamPushes: false } : {}),
        });
        order.push(position.get(e.id) ?? e.order ?? 0);
    }
    // the rockets among them, in the order they all tick: a boost and a push do not commute
    const rockets = attachedRockets(ctx.post);
    if (!rockets.every(r => typeof r.order === 'number')) return out;
    for (const r of rockets) {
        const here = { position: vec(start.pos as [number, number, number]), boundingBox: aabb(start.box as number[]) };
        out.push({ kind: 'attached_rocket', ...here, ticksBeforePlayer: r.tickedBeforePlayer, tickPosition: here.position, tickBoundingBox: here.boundingBox });
        order.push(r.order!);
    }
    return out.map((entity, i) => [entity, order[i]!] as const).sort((x, y) => x[1] - y[1]).map(([entity]) => entity);
}

/** The value of each attribute the snapshot has, under its native name (ids are bare or generic./player.-prefixed by release). */
function attributed(s: Snapshot, names: Readonly<Record<string, string>>): Record<string, number> {
    const all = (s.attributes ?? {}) as Record<string, { value: number }>;
    const out: Record<string, number> = {};
    for (const [native, id] of Object.entries(names)) {
        const found = all[id] ?? all[`generic.${id}`] ?? all[`player.${id}`];
        if (found) out[native] = found.value;
    }
    return out;
}

interface SpeedModifier extends NativeAttributeModifier { id: string }

/** LivingEntity's powder snow modifier: its UUID up to 1.20.6, its id from 1.21 (1.17 LivingEntity.java:123, 1.21 :139). */
const FROST_MODIFIERS = new Set(['1eaf83ff-7207-4596-b37a-d7a07b3ec4ce', 'minecraft:powder_snow']);

/** The movement speed attribute's parts, which the engine folds again when the end of aiStep changes its frost. */
export function speedAttribute(s: Snapshot): Pick<NativeSimulationState, 'movementSpeedAttribute'> {
    const all = (s.attributes ?? {}) as Record<string, { base: number; modifiers?: SpeedModifier[] }>;
    const found = all.movement_speed ?? all['generic.movement_speed'];
    if (!found) return {};
    const modifiers = found.modifiers ?? [];
    const frost = modifiers.find(x => FROST_MODIFIERS.has(x.id))?.amount;
    return {
        movementSpeedAttribute: {
            base: found.base,
            modifiers: modifiers.filter(x => !FROST_MODIFIERS.has(x.id)).map(({ amount, operation }) => ({ amount, operation })),
            ...(frost === undefined ? {} : { frost }),
        },
    };
}

/** The sneak slowdown Swift Sneak gives from 1.19 to 1.20.6 (LocalPlayer.aiStep: clamp(0.3 + level * 0.15)); 0.3 without it. */
function sneakingSpeed(version: string, level: number): number | undefined {
    const [major, minor, patch] = version.split('.').map(Number);
    const v = (major ?? 0) * 10000 + (minor ?? 0) * 100 + (patch ?? 0);
    if (level <= 0 || v < 11900 || v >= 12100) return undefined;
    return Math.min(Math.max(f32(f32(0.3) + f32(level * f32(0.15))), 0), 1);
}
/** Mth's float radians of float degrees, as the adapter's floatRadians (src/mineflayer/mth.ts). */
export const floatRadians = (degrees: number) => f32(f32(degrees) * f32(0.017453292));

type Vec = readonly [number, number, number];
const vec = (v: unknown) => {
    const [x, y, z] = v as Vec;
    return { x, y, z };
};
const num = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : fallback);
const bool = (v: unknown) => v === true;

interface Effect { id: string; amplifier: number }
const effect = (s: Snapshot, id: string) => (s.effects as Effect[] | undefined)?.find(e => e.id === id);
const amplifier = (s: Snapshot, id: string) => effect(s, id)?.amplifier;

/**
 * The engine's state for one tick: `start` is vanilla's state when the tick began (tickStart),
 * `decided` its state at beforeLivingAiStep (sprint, sneak, swim, fly, elytra, item use decided).
 */
export function toNative(start: Snapshot, decided: Snapshot, ctx?: SeedContext): NativeSimulationState {
    const keys = (start.keys ?? {}) as Record<string, boolean>;
    const support = decided.mainSupportingBlockPos as Vec | null | undefined;
    const levitation = amplifier(decided, 'levitation');
    const worn = decided.equipment as Record<string, { id: string }> | undefined;
    const wornIds = ['head', 'chest', 'legs', 'feet'].flatMap(slot => worn?.[slot]?.id ?? []);
    const feet = worn?.feet?.id;
    const sneak = ctx ? sneakingSpeed(ctx.version, ctx.swiftSneak) : undefined;
    const state: NativeSimulationState = {
        position: vec(start.pos),
        velocity: vec(start.vel),
        yaw: floatRadians(num(decided.yRot)),
        pitch: floatRadians(num(decided.xRot)),
        halfWidth: num(decided.bbWidth) / 2,
        height: num(decided.bbHeight),
        eyeHeight: num(decided.eyeHeight),
        look: vec(decided.look),
        previousPosition: vec(start.oldPos),
        ...(Array.isArray(start.box) ? { boundingBox: aabb(start.box as number[]) } : {}),
        onGround: bool(start.onGround),
        collidedHorizontally: bool(start.horizontalCollision),
        minorHorizontalCollision: bool(start.minorHorizontalCollision),
        collidedVertically: bool(start.verticalCollision),
        verticalCollisionBelow: bool(start.verticalCollisionBelow),
        input: { x: Number(!!keys.left) - Number(!!keys.right), y: 0, z: Number(!!keys.forward) - Number(!!keys.back) },
        jumpRequested: !!keys.jump,
        jumpTicks: num(start.noJumpDelay),
        autoJump: bool(start.autoJumpEnabled),
        autoJumpTime: num(start.autoJumpTime),
        sprinting: bool(decided.sprinting),
        wasSprinting: bool(start.sprinting),
        sprintModifier: bool(decided.sprintModifier),
        inWater: bool(start.isInWater),
        inLava: bool(start.isInLava),
        eyeInWater: bool(start.eyeInWater),
        eyeInLava: bool(start.eyeInLava),
        inPowderSnow: bool(start.isInPowderSnow),
        // any leather armor keeps the cold off (LivingEntity.canFreeze, the freeze_immune_wearables tag); leather boots alone
        // walk on powder snow (PowderSnowBlock.canEntityWalkOnPowderSnow)
        powderSnowImmune: wornIds.some(id => FREEZE_IMMUNE.has(id)),
        powderSnowWalkable: feet === 'leather_boots',
        ...(sneak !== undefined ? { sneakingSpeed: sneak } : {}),
        // the attributes the physics reads, where the release has them
        ...attributed(decided, {
            gravity: 'gravity', stepHeight: 'step_height', jumpStrength: 'jump_strength', safeFallDistance: 'safe_fall_distance',
            fallDamageMultiplier: 'fall_damage_multiplier', burningTime: 'burning_time', waterMovementEfficiency: 'water_movement_efficiency',
            movementEfficiency: 'movement_efficiency', sneakingSpeed: 'sneaking_speed', entityBounciness: 'bounciness',
            airDragModifier: 'air_drag_modifier', frictionModifier: 'friction_modifier',
        }),
        ...(ctx ? { nearbyEntities: nearbyEntities(start, ctx) } : {}),
        ...(ctx ? rockets(ctx.post) : {}),
        isPlayer: true,
        // the client's own player: the client's side of the fire and freeze ticks
        clientSide: true,
        invulnerable: bool(start.invulnerable),
        // Player.causeFallDamage deals nothing where the player may fly (1.8.9 PlayerEntity.java:1387-1388, 26.3 Player.java)
        fallDamageImmune: bool(start.mayfly),
        controlledByLocalInstance: true,
        passenger: bool(start.passenger),
        fallDistance: num(start.fallDistance),
        sneaking: bool(decided.shiftKeyDown),
        movingSlowly: bool((ctx?.slow ?? decided).movingSlowly),
        steppingCarefully: bool(decided.steppingCarefully),
        usingItem: bool(decided.usingItem),
        ...(decided.itemUseSpeedMultiplier === undefined ? {} : { itemUseSpeedMultiplier: num(decided.itemUseSpeedMultiplier) }),
        swimming: bool(decided.swimming),
        flying: bool(decided.flying),
        flyingSpeed: num(decided.flyingSpeed, f32(0.05)),
        fallFlying: bool(decided.fallFlying),
        // (Player.tick sets it from the game mode, after the row's tickStart)
        noPhysics: bool(decided.noPhysics),
        noGravity: bool(start.noGravity),
        removed: bool(decided.removed),
        dead: start.alive === false,
        sleeping: bool(start.sleeping),
        insideWall: bool(start.isInWall),
        stuckSpeedMultiplier: vec(start.stuckSpeedMultiplier),
        movementSpeedValue: num(decided.movementSpeed),
        ...speedAttribute(decided),
        weaving: effect(decided, 'weaving') !== undefined,
        speedEffectAmplifier: amplifier(decided, 'speed'),
        slownessEffectAmplifier: amplifier(decided, 'slowness'),
        jumpBoostAmplifier: amplifier(decided, 'jump_boost'),
        slowFalling: effect(decided, 'slow_falling') !== undefined,
        levitation: levitation !== undefined,
        ...(levitation !== undefined ? { levitationAmplifier: levitation } : {}),
        dolphinsGrace: effect(decided, 'dolphins_grace') ? 1 : 0,
        depthStrider: num(decided.depthStrider),
        soulSpeed: num(decided.soulSpeed),
        frostWalker: num(decided.frostWalker) > 0,
        fireResistance: effect(decided, 'fire_resistance') !== undefined,
        fireProtection: num(decided.fireProtection),
        remainingFireTicks: num(start.remainingFireTicks),
        ticksFrozen: num(start.ticksFrozen),
        ticksRequiredToFreeze: num(start.ticksRequiredToFreeze),
        tickCount: num(start.tickCount),
        onGroundNoBlocks: bool(start.onGroundNoBlocks),
        supportingBlockKept: true,
        ...(support ? { supportingBlock: { x: support[0], y: support[1], z: support[2] } } : {}),
    };
    // (undefined optional fields are dropped: N-API objects take absent, not undefined)
    for (const key of Object.keys(state) as (keyof NativeSimulationState)[]) if (state[key] === undefined) delete state[key];
    return state;
}

/** The recorded fields the native tick's output stands for, in the recording's names. */
export function fromNative(state: NativeSimulationState): Partial<Record<PlayerFieldKey, unknown>> {
    const v = (p: { x: number; y: number; z: number } | undefined) => (p ? [p.x, p.y, p.z] : undefined);
    const out: Partial<Record<PlayerFieldKey, unknown>> = {
        pos: v(state.position),
        vel: v(state.velocity),
        onGround: state.onGround,
        horizontalCollision: state.collidedHorizontally,
        minorHorizontalCollision: state.minorHorizontalCollision,
        verticalCollision: state.collidedVertically,
        verticalCollisionBelow: state.verticalCollisionBelow,
        fallDistance: state.fallDistance,
        isInWater: state.inWater,
        isInLava: state.inLava,
        isInPowderSnow: state.inPowderSnow,
        noJumpDelay: state.jumpTicks,
        autoJumpTime: state.autoJumpTime,
        sprinting: state.sprinting,
        swimming: state.swimming,
        fallFlying: state.fallFlying,
        onGroundNoBlocks: state.onGroundNoBlocks,
        mainSupportingBlockPos: state.supportingBlock ? [state.supportingBlock.x, state.supportingBlock.y, state.supportingBlock.z] : null,
    };
    for (const key of Object.keys(out) as PlayerFieldKey[]) if (out[key] === undefined) delete out[key];
    return out;
}

/** The fields the native layer compares after a tick (the rest are the adapter's or the server's). */
export const NATIVE_COMPARED: readonly PlayerFieldKey[] = [
    'pos', 'vel', 'onGround', 'horizontalCollision', 'minorHorizontalCollision', 'verticalCollision', 'verticalCollisionBelow',
    'fallDistance', 'isInWater', 'isInLava', 'isInPowderSnow', 'noJumpDelay', 'autoJumpTime', 'onGroundNoBlocks',
    'mainSupportingBlockPos',
];
