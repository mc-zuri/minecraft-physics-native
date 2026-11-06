// The field registry: every value the recorder records, where vanilla keeps it, how it is
// compared, and how each field of the native engine's NativeSimulationState is fed from (or
// compared against) the recording. It is the single source of truth for the mod's FieldIds.java
// (gen-java.ts), the coverage test and the replay's seeding and comparison.
//
// `NATIVE_SIM` is typed over every key of NativeSimulationState, so tsc fails when the engine
// gains a field the registry does not account for.

import type { NativeSimulationState } from '../../native/artifacts/native.js';
import type { PhaseName } from './phases.ts';

export type FieldType =
    | 'f64' // Java double, exact
    | 'f32' // Java float, widened to a double when written
    | 'i32'
    | 'bool'
    | 'vec3' // three doubles
    | 'blockpos' // three ints, or null for none
    | 'aabb' // six doubles
    | 'enum' // a lowercase name
    | 'string'
    | 'effects' // [{ id, amplifier, duration, ambient, visible }]
    | 'attributes' // { [id]: { base, value, modifiers: [{ id, amount, operation }] } }
    | 'json'; // anything else, compared structurally

/** exact: Object.is (so -0 and 0 differ); float32: compared after Math.fround; ignore: recorded only. */
export type Compare = 'exact' | 'float32' | 'ignore';

export type Side = 'client' | 'server';

export interface FieldSpec {
    readonly type: FieldType;
    readonly side: Side;
    /** The vanilla source in 1.20.4 (mojmap), as documentation of what the mod reads. */
    readonly vanilla: string;
    readonly compare: Compare;
    /** The releases that have the field (a range such as ">=1.19.4"); every release when absent. */
    readonly versions?: string;
    /** The release from which a float field is a double, and loads unrounded. */
    readonly doubleFrom?: string;
    readonly note?: string;
}

function field<const T extends FieldSpec>(spec: T): T {
    return spec;
}

/** The local player's recorded fields, by the key the recording writes. */
export const PLAYER_FIELDS = {
    pos: field({ type: 'vec3', side: 'client', compare: 'exact', vanilla: 'Entity.position()' }),
    vel: field({ type: 'vec3', side: 'client', compare: 'exact', vanilla: 'Entity.getDeltaMovement()' }),
    yRot: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'Entity.getYRot()' }),
    xRot: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'Entity.getXRot()' }),
    yRotO: field({ type: 'f32', side: 'client', compare: 'ignore', vanilla: 'Entity.yRotO' }),
    xRotO: field({ type: 'f32', side: 'client', compare: 'ignore', vanilla: 'Entity.xRotO' }),
    look: field({ type: 'vec3', side: 'client', compare: 'exact', vanilla: 'Entity.getViewVector(1.0F)' }),
    oldPos: field({ type: 'vec3', side: 'client', compare: 'exact', vanilla: 'Entity.xo / yo / zo' }),
    bbWidth: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'Entity.getBbWidth()' }),
    bbHeight: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'Entity.getBbHeight()' }),
    box: field({ type: 'aabb', side: 'client', compare: 'exact', vanilla: 'Entity.getBoundingBox()' }),
    eyeHeight: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'Entity.getEyeHeight()' }),
    pose: field({ type: 'enum', side: 'client', compare: 'exact', vanilla: 'Entity.getPose()' }),
    onGround: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.onGround()' }),
    horizontalCollision: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.horizontalCollision' }),
    minorHorizontalCollision: field({
        type: 'bool', side: 'client', compare: 'exact', versions: '>=1.18', vanilla: 'Entity.minorHorizontalCollision',
    }),
    verticalCollision: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.verticalCollision' }),
    verticalCollisionBelow: field({
        type: 'bool', side: 'client', compare: 'exact', versions: '>=1.18.2', vanilla: 'Entity.verticalCollisionBelow',
    }),
    mainSupportingBlockPos: field({
        type: 'blockpos', side: 'client', compare: 'exact', versions: '>=1.20', vanilla: 'Entity.mainSupportingBlockPos',
    }),
    onGroundNoBlocks: field({
        type: 'bool', side: 'client', compare: 'exact', versions: '>=1.20', vanilla: 'Entity.onGroundNoBlocks',
    }),
    stuckSpeedMultiplier: field({
        type: 'vec3', side: 'client', compare: 'exact', vanilla: 'Entity.stuckSpeedMultiplier',
        note: 'read at Entity.move HEAD (move zeroes it after use)',
    }),
    fallDistance: field({
        type: 'f32', side: 'client', compare: 'float32', vanilla: 'Entity.fallDistance', doubleFrom: '1.21.5',
    }),
    isInWater: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.isInWater() (wasTouchingWater)' }),
    isInLava: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.isInLava()' }),
    fluidHeightWater: field({ type: 'f64', side: 'client', compare: 'exact', vanilla: 'Entity.getFluidHeight(FluidTags.WATER)' }),
    fluidHeightLava: field({ type: 'f64', side: 'client', compare: 'exact', vanilla: 'Entity.getFluidHeight(FluidTags.LAVA)' }),
    wasEyeInWater: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.wasEyeInWater' }),
    eyeInWater: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.isEyeInFluid(FluidTags.WATER)' }),
    eyeInLava: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.isEyeInFluid(FluidTags.LAVA)' }),
    isUnderWater: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.isUnderWater()' }),
    isInPowderSnow: field({ type: 'bool', side: 'client', compare: 'exact', versions: '>=1.17', vanilla: 'Entity.isInPowderSnow' }),
    wasInPowderSnow: field({ type: 'bool', side: 'client', compare: 'exact', versions: '>=1.17', vanilla: 'Entity.wasInPowderSnow' }),
    onClimbable: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'LivingEntity.onClimbable()' }),
    noPhysics: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.noPhysics' }),
    noGravity: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.isNoGravity()' }),
    tickCount: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'Entity.tickCount' }),
    remainingFireTicks: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'Entity.getRemainingFireTicks()' }),
    ticksFrozen: field({ type: 'i32', side: 'client', compare: 'exact', versions: '>=1.17', vanilla: 'Entity.getTicksFrozen()' }),
    ticksRequiredToFreeze: field({ type: 'i32', side: 'client', compare: 'exact', versions: '>=1.17', vanilla: 'Entity.getTicksRequiredToFreeze()' }),
    isInWall: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.isInWall()' }),
    // input
    keys: field({ type: 'json', side: 'client', compare: 'exact', vanilla: 'KeyMapping.isDown() of the movement keys' }),
    leftImpulse: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'LocalPlayer.input.leftImpulse' }),
    forwardImpulse: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'LocalPlayer.input.forwardImpulse' }),
    inputJumping: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'LocalPlayer.input.jumping' }),
    inputShiftKeyDown: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'LocalPlayer.input.shiftKeyDown' }),
    xxa: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'LivingEntity.xxa' }),
    yya: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'LivingEntity.yya' }),
    zza: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'LivingEntity.zza' }),
    jumping: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'LivingEntity.jumping' }),
    noJumpDelay: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'LivingEntity.noJumpDelay' }),
    autoJumpTime: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'LocalPlayer.autoJumpTime' }),
    autoJumpEnabled: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'LocalPlayer.autoJumpEnabled' }),
    sprintTriggerTime: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'LocalPlayer.sprintTriggerTime' }),
    jumpTriggerTime: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'Player.jumpTriggerTime' }),
    // modes
    shiftKeyDown: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.isShiftKeyDown()' }),
    crouching: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'LocalPlayer.crouching' }),
    movingSlowly: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'LocalPlayer.isMovingSlowly()' }),
    steppingCarefully: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.isSteppingCarefully()' }),
    sprinting: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.isSprinting()' }),
    swimming: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.isSwimming()' }),
    fallFlying: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'LivingEntity.isFallFlying()' }),
    fallFlyTicks: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'LivingEntity.getFallFlyingTicks()' }),
    autoSpinAttackTicks: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'LivingEntity.autoSpinAttackTicks' }),
    usingItem: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'LivingEntity.isUsingItem()' }),
    useItemRemainingTicks: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'LivingEntity.getUseItemRemainingTicks()' }),
    itemUseSpeedMultiplier: field({ type: 'f32', side: 'client', compare: 'exact', versions: '>=1.21.11', vanilla: 'UseEffects.speedMultiplier' }),
    sleeping: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'LivingEntity.isSleeping()' }),
    passenger: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.isPassenger()' }),
    vehicleId: field({ type: 'i32', side: 'client', compare: 'ignore', vanilla: 'Entity.getVehicle().getId(), -1 for none' }),
    alive: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'LivingEntity.isAlive()' }),
    removed: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Entity.isRemoved()' }),
    health: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'LivingEntity.getHealth()' }),
    food: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'Player.getFoodData().getFoodLevel()' }),
    gameMode: field({ type: 'enum', side: 'client', compare: 'exact', vanilla: 'MultiPlayerGameMode.getPlayerMode()' }),
    // abilities
    flying: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Player.getAbilities().flying' }),
    mayfly: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Player.getAbilities().mayfly' }),
    flyingSpeed: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'Player.getAbilities().getFlyingSpeed()' }),
    walkingSpeed: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'Player.getAbilities().getWalkingSpeed()' }),
    invulnerable: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'Player.getAbilities().invulnerable' }),
    // attributes, effects, enchantments
    speed: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'LivingEntity.getSpeed()' }),
    movementSpeed: field({ type: 'f64', side: 'client', compare: 'exact', vanilla: 'getAttributeValue(Attributes.MOVEMENT_SPEED)' }),
    sprintModifier: field({
        type: 'bool', side: 'client', compare: 'exact',
        vanilla: 'getAttribute(MOVEMENT_SPEED).getModifier(SPEED_MODIFIER_SPRINTING_UUID) != null',
    }),
    attributes: field({ type: 'attributes', side: 'client', compare: 'exact', vanilla: 'LivingEntity.getAttributes() (every synced attribute)' }),
    effects: field({ type: 'effects', side: 'client', compare: 'exact', vanilla: 'LivingEntity.getActiveEffects()' }),
    depthStrider: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'EnchantmentHelper.getDepthStrider(this)' }),
    soulSpeed: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'EnchantmentHelper.getEnchantmentLevel(SOUL_SPEED, this)' }),
    frostWalker: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'EnchantmentHelper.getEnchantmentLevel(FROST_WALKER, this)' }),
    fireProtection: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'max Fire Protection level worn' }),
    equipment: field({ type: 'json', side: 'client', compare: 'exact', vanilla: 'getItemBySlot(*) as { slot: item id }' }),
    selectedSlot: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'Inventory.selected' }),
    // what the client last sent (LocalPlayer.sendPosition's bookkeeping)
    lastSentPos: field({ type: 'vec3', side: 'client', compare: 'exact', vanilla: 'LocalPlayer.xLast / yLast1 / zLast' }),
    lastSentYRot: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'LocalPlayer.yRotLast' }),
    lastSentXRot: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'LocalPlayer.xRotLast' }),
    lastOnGround: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'LocalPlayer.lastOnGround' }),
    wasShiftKeyDown: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'LocalPlayer.wasShiftKeyDown' }),
    wasSprinting: field({ type: 'bool', side: 'client', compare: 'exact', vanilla: 'LocalPlayer.wasSprinting' }),
    positionReminder: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'LocalPlayer.positionReminder' }),
    // riding
    jumpRidingScale: field({ type: 'f32', side: 'client', compare: 'float32', vanilla: 'LocalPlayer.jumpRidingScale (the mount jump charge)' }),
    jumpRidingTicks: field({ type: 'i32', side: 'client', compare: 'exact', vanilla: 'LocalPlayer.jumpRidingTicks' }),
    vehicle: field({
        type: 'json', side: 'client', compare: 'exact',
        vanilla: 'Entity.getVehicle(): { id, type, pos, vel, yRot, xRot, oldPos, onGround, box, collisions, fluids, boat: {status, deltaRotation, inputs, paddles, ...}, mount: {xxa, zza, attributes, horse jump, steering boost, camel dash}, minecart: {flipped, onRails, rider, fuel, push, hurtTime, damage, fuse, enabled, inventory, its interpolation, ...} }, null when not riding',
        note: 'read by the vehicle layer (BOAT_SIM, HORSE_SIM)',
    }),
    // the scene around the player
    nearbyEntities: field({
        type: 'json', side: 'client', compare: 'exact',
        vanilla: 'ClientLevel.entitiesForRendering() within 16 blocks, in tick order: { id, type, pos, vel, box, tickedBeforePlayer }',
    }),
    attachedRockets: field({
        type: 'json', side: 'client', compare: 'exact',
        vanilla: 'FireworkRocketEntity attached to the player: { id, life, lifetime, tickedBeforePlayer }',
    }),
    movingPistons: field({
        type: 'json', side: 'client', compare: 'exact',
        vanilla: 'PistonMovingBlockEntity within the area: { pos, facing, extending, source, progress }',
    }),
} as const satisfies Record<string, FieldSpec>;

export type PlayerFieldKey = keyof typeof PLAYER_FIELDS;

/** The server's view of the player and its entities, recorded once per server tick. */
export const SERVER_FIELDS = {
    pos: field({ type: 'vec3', side: 'server', compare: 'exact', vanilla: 'ServerPlayer.position()' }),
    vel: field({ type: 'vec3', side: 'server', compare: 'exact', vanilla: 'ServerPlayer.getDeltaMovement()' }),
    onGround: field({ type: 'bool', side: 'server', compare: 'exact', vanilla: 'ServerPlayer.onGround()' }),
    fallDistance: field({ type: 'f32', side: 'server', compare: 'float32', vanilla: 'ServerPlayer.fallDistance' }),
    pose: field({ type: 'enum', side: 'server', compare: 'exact', vanilla: 'ServerPlayer.getPose()' }),
    health: field({ type: 'f32', side: 'server', compare: 'float32', vanilla: 'ServerPlayer.getHealth()' }),
    awaitingTeleport: field({ type: 'bool', side: 'server', compare: 'exact', vanilla: 'ServerGamePacketListenerImpl.awaitingPositionFromClient != null' }),
    remainingFireTicks: field({ type: 'i32', side: 'server', compare: 'exact', vanilla: 'ServerPlayer.getRemainingFireTicks()' }),
    ticksFrozen: field({ type: 'i32', side: 'server', compare: 'exact', vanilla: 'ServerPlayer.getTicksFrozen()' }),
    entities: field({
        type: 'json', side: 'server', compare: 'exact',
        vanilla: 'server-simulated entities in the area: { id, type, pos, vel, onGround, yRot, xRot, box, age, root, pickable, alive, health?, nbt? (arrows and tridents) }',
    }),
} as const satisfies Record<string, FieldSpec>;

export type ServerFieldKey = keyof typeof SERVER_FIELDS;

// ---------------------------------------------------------------------------------------------
// The native engine's state, field by field

/** A named conversion between a recorded value and the native field (replay/convert.ts). */
export type Conversion =
    | 'identity'
    | 'degreesToRadians' // the release's own float yaw/pitch to radians (yaw_radians)
    | 'half' // bbWidth -> halfWidth
    | 'level' // an enchantment level clamped to u8
    | 'blockPos' // [x, y, z] | null -> { x, y, z } | undefined
    | 'aabb'; // [minX, minY, minZ, maxX, maxY, maxZ] -> NativeAabb

export type NativeFieldMap =
    /** Seeded from the recorded field (at the phase the replay starts from) and compared after the tick. */
    | {
        readonly from: PlayerFieldKey; readonly via?: Conversion; readonly skipPhases?: readonly PhaseName[]; readonly decision?: true; readonly note?: string;
        /** The phase whose recorded value the engine's output matches, when not afterAiStep (what it means differs). */
        readonly comparedAt?: PhaseName;
        /**
         * The engine's value is the server's (its rules are the server's: what burns or freezes the player), compared
         * with this field of the server's view after the server tick that follows the client's (the next row's srv).
         */
        readonly server?: ServerFieldKey;
    }
    /** Computed from several recorded fields (replay/convert.ts by name). */
    | { readonly derive: string; readonly from: readonly PlayerFieldKey[]; readonly note?: string }
    /** Comes from the recorded world or scene rather than the player's own state. */
    | { readonly scene: string; readonly from?: readonly PlayerFieldKey[] }
    /** Engine bookkeeping or a per-tick output with nothing vanilla keeps to compare it with. */
    | { readonly exclude: string };

type NativeKey = keyof Required<NativeSimulationState>;

/**
 * Every NativeSimulationState field. `decision` marks a value the adapter decides in TypeScript
 * before the native tick (LocalPlayer.aiStep's choices), which the native-only replay seeds from
 * vanilla's beforeLivingAiStep snapshot instead of computing.
 */
export const NATIVE_SIM: { readonly [K in NativeKey]: NativeFieldMap } = {
    position: { from: 'pos' },
    velocity: { from: 'vel' },
    yaw: { from: 'yRot', via: 'degreesToRadians' },
    yawDegrees: { exclude: 'the float degrees of yaw, which the packed path sends: the native replay seeds the radians' },
    pitch: { from: 'xRot', via: 'degreesToRadians' },
    halfWidth: { from: 'bbWidth', via: 'half' },
    height: { from: 'bbHeight' },
    onGround: { from: 'onGround' },
    collidedHorizontally: { from: 'horizontalCollision' },
    minorHorizontalCollision: { from: 'minorHorizontalCollision' },
    collidedVertically: { from: 'verticalCollision' },
    verticalCollisionBelow: { from: 'verticalCollisionBelow' },
    blockFallCallback: { exclude: 'engine switch: whether Block.fallOn runs (always on for the player)' },
    entityBounciness: { scene: 'the BOUNCINESS attribute (26.x): attributes', from: ['attributes'] },
    blockBounciness: { scene: 'the block the player lands on: world', from: ['mainSupportingBlockPos'] },
    input: { derive: 'keyAxes', from: ['keys'], note: 'the engine takes the key axes (left - right, forward - back) and makes the impulses itself' },
    jumpRequested: { derive: 'jumpKey', from: ['keys'], note: 'the jump key; LivingEntity.jumping (the auto-jump too) is compared at beforeTravel' },
    jumpTicks: { from: 'noJumpDelay', skipPhases: ['tickStart', 'afterBaseTick', 'afterInput', 'beforeLivingAiStep'], note: 'the engine counts it down before baseTick' },
    autoJump: { from: 'autoJumpEnabled' },
    autoJumpTime: { from: 'autoJumpTime', skipPhases: ['tickStart', 'afterBaseTick'], note: 'the engine counts it down early' },
    riptideLaunch: { scene: 'the Riptide level of a trident released this tick: c2s use_item / release', from: ['equipment'] },
    sprinting: { from: 'sprinting', decision: true },
    wasSprinting: { from: 'wasSprinting' },
    sprintModifier: { from: 'sprintModifier', decision: true },
    inWater: { from: 'isInWater' },
    inLava: { from: 'isInLava' },
    ultraWarm: { scene: 'DimensionType.ultraWarm of the recorded dimension: header.world.dimension' },
    isPlayer: { exclude: 'constant: true for the local player' },
    controlledByLocalInstance: { exclude: 'constant: true for the local player' },
    nonLiving: { exclude: 'constant: false for the local player, a LivingEntity' },
    canSimulateMovement: { exclude: 'optional piston-authority override: omitted because the native fallback is exact for the replay\'s locally controlled player' },
    passenger: { from: 'passenger' },
    inWeb: { derive: 'stuckInWeb', from: ['stuckSpeedMultiplier'], note: 'a cobweb multiplier (0.25, 0.05, 0.25) or the Weaving one' },
    weaving: { derive: 'hasEffect:weaving', from: ['effects'] },
    fireResistance: { derive: 'hasEffect:fire_resistance', from: ['effects'] },
    onFireFlag: { scene: "the server's entity data, followed from the recorded packets (replay/flags.ts)" },
    frostWalker: { derive: 'levelAbove0', from: ['frostWalker'] },
    sweetBerryBushImmune: { exclude: 'constant: false for the player (only foxes and bees are immune)' },
    powderSnowImmune: { derive: 'wearsFreezeImmune', from: ['equipment'] },
    powderSnowWalkable: { derive: 'wearsLeatherBoots', from: ['equipment'] },
    inPowderSnow: { from: 'isInPowderSnow' },
    fireImmune: { exclude: 'constant: EntityType.PLAYER is not fire immune' },
    inRain: { scene: 'the recorded weather: header.server.weather' },
    fireProtection: { from: 'fireProtection' },
    burningTime: { scene: 'the BURNING_TIME attribute (1.21+): attributes', from: ['attributes'] },
    remainingFireTicks: { from: 'remainingFireTicks' },
    ticksFrozen: { from: 'ticksFrozen' },
    ticksRequiredToFreeze: { from: 'ticksRequiredToFreeze' },
    tickCount: { from: 'tickCount' },
    freezeDamage: { exclude: 'per-tick output (damage the server deals); compared with srv.health for hz_freeze_* only' },
    contactDamage: { exclude: 'per-tick output (damage the server deals); compared with srv.health for the hz_* cases of a block that hurts' },
    stabHit: { exclude: 'the input of a server state, from the caller modelling the server: the client only sends the stab and has no recoil' },
    wallDamage: { exclude: 'per-tick output (damage the server deals); compared with srv.health for the mortal f_elytra_wall_* only' },
    insideWall: { from: 'isInWall' },
    sleeping: { from: 'sleeping' },
    eyeHeight: { from: 'eyeHeight' },
    eyeInWater: { from: 'eyeInWater', skipPhases: ['afterBaseTick'], note: 'the engine computes it after the AfterBaseTick point' },
    eyeInLava: { from: 'eyeInLava' },
    slowFalling: { derive: 'hasEffect:slow_falling', from: ['effects'] },
    levitation: { derive: 'hasEffect:levitation', from: ['effects'] },
    levitationAmplifier: { derive: 'amplifier:levitation', from: ['effects'] },
    fallDistance: { from: 'fallDistance' },
    boatVehicle: { exclude: 'the boat of a passenger, whose own tick the replay does not run' },
    safeFallDistance: { scene: 'the SAFE_FALL_DISTANCE attribute (1.20.5+), 3 before: attributes', from: ['attributes'] },
    fallDamageImmune: { from: 'mayfly', note: 'Player.causeFallDamage deals nothing where the player may fly' },
    clientSide: { derive: 'constTrue', from: [], note: 'the recording is of the local player, as its client ticks it' },
    heightAfterTick: { scene: 'the box the pose update leaves, which the entities after the player meet: bbHeight at post', from: ['bbHeight'] },
    entityType: { exclude: 'constant: the state is the local player, which names no kind' },
    invulnerable: { from: 'invulnerable' },
    fallDamageMultiplier: { scene: 'the FALL_DAMAGE_MULTIPLIER attribute (1.20.5+): attributes', from: ['attributes'] },
    sneaking: { from: 'shiftKeyDown', decision: true },
    movingSlowly: { from: 'movingSlowly', decision: true },
    steppingCarefully: { from: 'steppingCarefully', decision: true },
    usingItem: { from: 'usingItem', decision: true },
    itemUseSpeedMultiplier: { from: 'itemUseSpeedMultiplier', decision: true },
    swimming: { from: 'swimming', decision: true },
    flying: { from: 'flying', decision: true },
    flyingSpeed: { from: 'flyingSpeed' },
    serverFireIncrement: { exclude: 'the random rise of a server player in fire (1.21.2+): the replay is the client, which has no such draw' },
    serverFireIncrements: { exclude: 'the ordered draws of that rise: the replay is the client, which reads none' },
    climbing: { exclude: 'an override for callers for an entity with no world to read; vanilla keeps no climbing state, and asks the world at each test (before the move and at the moved position), which the replay leaves to the engine' },
    noPhysics: { from: 'noPhysics' },
    noGravity: { from: 'noGravity' },
    removed: { from: 'removed' },
    dead: { derive: 'not', from: ['alive'] },
    gravity: { scene: 'the GRAVITY attribute (1.20.5+), 0.08 before: attributes', from: ['attributes'] },
    stepHeight: { scene: 'the STEP_HEIGHT attribute (1.20.5+), maxUpStep before: attributes', from: ['attributes'] },
    movementSpeed: { derive: 'attributeBase:movement_speed', from: ['attributes'] },
    movementSpeedValue: { from: 'movementSpeed' },
    movementSpeedAttribute: { derive: 'speedAttribute', from: ['attributes'], note: 'its parts, for the frost modifier the client makes at the end of aiStep (1.17 to 1.21.4)' },
    jumpStrength: { scene: 'the JUMP_STRENGTH attribute (1.20.5+), 0.42 before: attributes', from: ['attributes'] },
    speedEffectAmplifier: { derive: 'amplifier:speed', from: ['effects'] },
    slownessEffectAmplifier: { derive: 'amplifier:slowness', from: ['effects'] },
    jumpBoostAmplifier: { derive: 'amplifier:jump_boost', from: ['effects'] },
    dolphinsGrace: { derive: 'hasEffectU8:dolphins_grace', from: ['effects'] },
    depthStrider: { from: 'depthStrider', via: 'level' },
    soulSpeed: { from: 'soulSpeed', via: 'level' },
    waterMovementEfficiency: { scene: 'the WATER_MOVEMENT_EFFICIENCY attribute (1.21+): attributes', from: ['attributes'] },
    movementEfficiency: { scene: 'the MOVEMENT_EFFICIENCY attribute (1.21+): attributes', from: ['attributes'] },
    airDragModifier: { scene: 'the AIR_DRAG_MODIFIER attribute (26.x): attributes', from: ['attributes'] },
    frictionModifier: { scene: 'the FRICTION_MODIFIER attribute (26.x): attributes', from: ['attributes'] },
    sneakingSpeed: { scene: 'the SNEAKING_SPEED attribute (1.21+): attributes', from: ['attributes'] },
    fallDamage: { exclude: 'per-tick output (landing damage); compared with srv.health for fd_* only' },
    fallFlying: { from: 'fallFlying', decision: true },
    look: { from: 'look' },
    fireworkBoost: { exclude: 'engine bookkeeping of the attached rockets\' boost; recorded as attachedRockets' },
    stuckSpeedMultiplier: { from: 'stuckSpeedMultiplier' },
    previousPosition: { from: 'oldPos' },
    boundingBox: { from: 'box', via: 'aabb', note: 'the kept box is only an input before 1.17' },
    supportingBlock: { from: 'mainSupportingBlockPos', via: 'blockPos' },
    supportingBlockKept: { derive: 'constTrue', from: ['mainSupportingBlockPos'], note: 'true whenever seeded from a recording' },
    onGroundNoBlocks: { from: 'onGroundNoBlocks' },
    outsideBorder: { exclude: 'Entity.isOutsideBorder exists before 1.14 only' },
    nearbyEntities: { scene: 'the entities the client ticks around the player', from: ['nearbyEntities'] },
    fireworkRockets: { scene: 'the rockets attached to the player', from: ['attachedRockets'] },
    fireworkRocketsBeforePlayer: { scene: 'the attached rockets ticked before the player', from: ['attachedRockets'] },
    fireworkRocketTicks: { scene: 'the attached rockets\' remaining life', from: ['attachedRockets'] },
    movingPistons: { scene: 'the moving pistons around the player', from: ['movingPistons'] },
};

/** The recorded fields that no native field reads, each with why. Everything else must be read. */
export const RECORDED_ONLY: Readonly<Partial<Record<PlayerFieldKey, string>>> = {
    gameMode: 'the abilities it sets are recorded themselves: mayfly, flying, invulnerable',
    yRotO: 'render interpolation only',
    xRotO: 'render interpolation only',
    pose: 'the adapter decides poses (updatePoses); compared on the adapter layer',
    fluidHeightWater: 'diagnostic: explains isInWater / swim decisions',
    fluidHeightLava: 'diagnostic: explains isInLava',
    wasEyeInWater: 'the adapter keeps it (eyeInWater of the tick before)',
    isUnderWater: 'the adapter keeps it',
    wasInPowderSnow: 'diagnostic',
    leftImpulse: 'the engine makes it from the keys; the adapter layer compares it at the end of the tick',
    forwardImpulse: 'the engine makes it from the keys; the adapter layer compares it at the end of the tick',
    inputJumping: 'the adapter layer compares it',
    jumping: 'LivingEntity.jumping after the auto-jump: compared at beforeTravel',
    inputShiftKeyDown: 'the adapter layer compares it',
    xxa: 'the travel vector, compared at beforeTravel',
    yya: 'the travel vector, compared at beforeTravel',
    zza: 'the travel vector, compared at beforeTravel',
    onClimbable: 'the engine asks the world itself at each test and returns no such value: a wrong answer shows in the velocity',
    sprintTriggerTime: 'the adapter decides double-tap sprint',
    jumpTriggerTime: 'the adapter decides double-tap flight',
    crouching: 'the adapter decides the crouch pose',
    fallFlyTicks: 'diagnostic',
    autoSpinAttackTicks: 'the adapter counts the spin attack down',
    useItemRemainingTicks: 'the adapter layer compares it',
    vehicleId: 'scene bookkeeping',
    health: 'the server deals damage; compared through srv.health',
    food: 'gates sprinting in the adapter',
    walkingSpeed: 'feeds the movement speed attribute base',
    speed: 'LivingEntity.getSpeed: diagnostic of the folded speed',
    selectedSlot: 'a hand, which no movement reads: the bot layer compares the packet that says it',
    lastSentPos: 'the bot layer rebuilds packets from it',
    lastSentYRot: 'the bot layer rebuilds packets from it',
    lastSentXRot: 'the bot layer rebuilds packets from it',
    lastOnGround: 'the bot layer rebuilds packets from it',
    wasShiftKeyDown: 'the bot layer rebuilds packets from it',
    positionReminder: 'the bot layer rebuilds packets from it',
    jumpRidingScale: 'the jump charge the rider builds; the bot layer compares it with the power its release sends',
    jumpRidingTicks: 'the rider\'s jump charge counter; the bot layer compares the scale it makes',
    vehicle: 'the vehicle layer reads it (BOAT_SIM, HORSE_SIM)',
};

/** The recorded field keys the native mapping reads. */
export function nativeSources(): Set<PlayerFieldKey> {
    const out = new Set<PlayerFieldKey>();
    for (const map of Object.values(NATIVE_SIM) as NativeFieldMap[]) {
        if ('exclude' in map) continue;
        const from = map.from;
        if (from === undefined) continue;
        for (const key of (Array.isArray(from) ? from : [from]) as PlayerFieldKey[]) out.add(key);
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// The vehicle the player rides: the engine's boat and ridden-mob states, field by field, from the
// recorded `vehicle` (a path into it) and the rider's fields. Exhaustive over each engine type.

import type { NativeBoatState, NativeHorseState, NativeMinecartState } from '../../native/artifacts/native.js';

export type VehicleFieldMap =
    /** A path into the recorded vehicle ("boat.deltaRotation") or a rider field ("rider.yRot"). */
    | {
        readonly from: string; readonly note?: string;
        /** Read by the engine and not given back: seeded, never compared (why in the note). */
        readonly input?: true;
    }
    | { readonly derive: string; readonly from: readonly string[] }
    | { readonly exclude: string };

/** The server's cart, from an entity of the server's view (srv.entities; replay/minecart.ts seeds and compares it). */
export const MINECART_SIM: { readonly [K in keyof Required<NativeMinecartState>]: VehicleFieldMap } = {
    variant: { from: 'type' },
    position: { from: 'pos' },
    velocity: { from: 'vel' },
    yRot: { from: 'yRot' },
    xRot: { from: 'xRot' },
    flipped: { from: 'minecart.flipped' },
    onRails: { from: 'minecart.onRails', note: 'compared where the release keeps it' },
    onGround: { from: 'onGround' },
    firstTick: { from: 'minecart.firstTick', input: true, note: 'only ever true before a case starts' },
    inWater: { from: 'minecart.inWater' },
    collidedHorizontally: { from: 'minecart.horizontalCollision', input: true, note: 'read by the improved push; the view is the same tick' },
    collidedVertically: { from: 'minecart.verticalCollision', input: true, note: 'read by the improved push; the view is the same tick' },
    stuckSpeedMultiplier: { from: 'minecart.stuckSpeedMultiplier', input: true, note: 'a web sets it for the next move' },
    noGravity: { from: 'minecart.noGravity', input: true },
    ultraWarm: { exclude: 'the dimension (header.world.dimension)' },
    fallDistance: { from: 'minecart.fallDistance' },
    boundingBox: { from: 'box', input: true, note: 'kept before 1.17, where the position comes from it' },
    rider: { derive: 'cartRider', from: ['minecart.rider'] },
    fuel: { from: 'minecart.fuel' },
    push: { from: 'minecart.push' },
    comparatorSignal: { from: 'minecart.comparatorSignal', input: true },
    hasLootTable: { from: 'minecart.hasLootTable', input: true },
    tickCount: { from: 'age', input: true, note: 'its age: the activation delay of a command block cart compares against it' },
    hurtTime: { from: 'minecart.hurtTime' },
    hurtDir: { from: 'minecart.hurtDir' },
    damage: { from: 'minecart.damage' },
    invulnerable: { exclude: 'a command\'s, which no case sets' },
    fuse: { from: 'minecart.fuse' },
    explosionPowerBase: { exclude: 'an NBT tag no case sets: the default 4 of MinecartTNT' },
    explosionSpeedFactor: { exclude: 'an NBT tag no case sets: the default 1 of MinecartTNT' },
    randomSeed: { from: 'minecart.randomSeed', input: true, note: 'the raw state of Entity.random, a server\'s alone' },
    enabled: { from: 'minecart.enabled' },
    inventory: { from: 'minecart.inventory' },
    lastActivated: { from: 'minecart.lastActivated' },
    portal: { exclude: 'which portal is the block\'s: the engine sets it from the world' },
    insidePortal: { from: 'minecart.insidePortal', input: true },
    portalTime: { from: 'minecart.portalTime' },
    portalCooldown: { from: 'minecart.portalCooldown' },
    removed: { exclude: 'the cart gone from the next view' },
};

export const BOAT_SIM: { readonly [K in keyof Required<NativeBoatState>]: VehicleFieldMap } = {
    serverSide: { exclude: 'a ridden boat replays on the client; an empty boat is the moving replay' },
    nearbyEntities: { exclude: 'the scene: the engine.ts vehicle branch seeds it from the snapshot nearbyEntities, and the tick gives none back' },
    position: { from: 'pos' },
    velocity: { from: 'vel' },
    yaw: { derive: 'floatRadians', from: ['yRot'] },
    yawDegrees: { from: 'yRot' },
    forward: { from: 'boat.inputUp' },
    left: { from: 'boat.inputLeft' },
    right: { from: 'boat.inputRight' },
    inputDown: { from: 'boat.inputDown' },
    deltaRotation: { from: 'boat.deltaRotation' },
    inWater: { derive: 'statusInWater', from: ['boat.status'] },
    waterLevel: { from: 'boat.waterLevel' },
    status: { from: 'boat.status' },
    previousStatus: { from: 'boat.oldStatus' },
    bubbleTime: { from: 'boat.bubbleTime' },
    bubbleColumnDirectionIsDown: { from: 'boat.bubbleColumnDirectionIsDown' },
    aboveBubbleColumn: { from: 'boat.aboveBubbleColumn' },
    playerPassenger: { derive: 'constTrue', from: [] },
    collidedHorizontally: { from: 'horizontalCollision' },
    collidedVertically: { from: 'verticalCollision' },
    onGround: { from: 'onGround' },
    landFriction: { from: 'boat.landFriction' },
    lastVerticalVelocity: { from: 'boat.lastYd' },
    boundingBox: { from: 'box' },
    speedMultiplier: { exclude: 'the boat speed attribute (26.x); 1 on 1.20.4' },
    riderYaw: { from: 'rider.yRot' },
    riderForward: { from: 'rider.zza' },
    riderStrafe: { from: 'rider.xxa' },
    stuckSpeedMultiplier: { from: 'stuckSpeedMultiplier' },
    ultraWarm: { exclude: 'the dimension (header.world.dimension)' },
    noGravity: { from: 'noGravity' },
    paddlePhases: { from: 'boat.paddlePhases' },
    silent: { from: 'boat.silent' },
};

export const HORSE_SIM: { readonly [K in keyof Required<NativeHorseState>]: VehicleFieldMap } = {
    nearbyEntities: { exclude: 'the scene: the engine.ts vehicle branch seeds it from the snapshot nearbyEntities, and the tick gives none back' },
    position: { from: 'pos' },
    stuckSpeedMultiplier: { from: 'stuckSpeedMultiplier' },
    slowFalling: { derive: 'hasEffect:slow_falling', from: ['mount.effects'] },
    weaving: { derive: 'hasEffect:weaving', from: ['mount.effects'] },
    levitationAmplifier: { derive: 'effectAmplifier:levitation', from: ['mount.effects'] },
    dolphinsGrace: { derive: 'hasEffect:dolphins_grace', from: ['mount.effects'] },
    gravity: { derive: 'mountAttribute', from: ['mount.attributes'] },
    stepHeight: { derive: 'mountAttribute', from: ['mount.attributes'] },
    waterMovementEfficiency: { derive: 'mountAttribute', from: ['mount.attributes'] },
    airDragModifier: { derive: 'mountAttribute', from: ['mount.attributes'] },
    frictionModifier: { derive: 'mountAttribute', from: ['mount.attributes'] },
    velocity: { from: 'vel' },
    yaw: { derive: 'floatRadians', from: ['yRot'] },
    yawDegrees: { from: 'yRot' },
    pitchDegrees: { from: 'xRot' },
    forward: { from: 'rider.zza', note: 'the rider\'s impulse the mount takes (getRiddenInput)' },
    strafe: { from: 'rider.xxa' },
    jumpRequested: { from: 'rider.jumping', note: 'LivingEntity.jumping of the rider (HappyGhast.getRiddenInput)' },
    onGround: { from: 'onGround' },
    inWater: { from: 'isInWater' },
    inLava: { from: 'isInLava' },
    waterHeight: { from: 'fluidHeightWater', input: true, note: 'the mount\'s water height at the start of its tick (vanilla measures it in baseTick); the engine reads it and does not give it back' },
    lavaHeightPositive: { derive: 'positive', from: ['fluidHeightLava'] },
    movementSpeed: { from: 'mount.movementSpeed', note: 'a suffocating strider: mount.movementSpeedBase (the engine applies the -34% of Strider.setSuffocating itself)' },
    jumpStrength: { from: 'mount.jumpStrength' },
    flyingSpeed: { from: 'mount.flyingSpeed' },
    halfWidth: { derive: 'half', from: ['bbWidth'] },
    height: { from: 'bbHeight' },
    collidedHorizontally: { from: 'horizontalCollision' },
    collidedVertically: { from: 'verticalCollision' },
    entityType: { from: 'type' },
    riderYaw: { from: 'rider.yRot' },
    riderPitch: { from: 'rider.xRot' },
    riderSprinting: { from: 'rider.sprinting' },
    riderJump: { from: 'row.ridingJump', note: 'the jump the rider releases in this tick (onPlayerJump, percent), after the travel of the mount, which jumps at its next tick' },
    fallDistance: { from: 'fallDistance' },
    boundingBox: { from: 'box' },
    previousPosition: { from: 'oldPos' },
    saddled: { from: 'mount.saddled' },
    noAi: { from: 'mount.noAi' },
    riddenSpeed: { from: 'mount.speed', note: 'LivingEntity.getSpeed: before 1.19.4 air control reads what the last tick left' },
    ownForward: { from: 'mount.zza' },
    boosting: { from: 'mount.boosting' },
    boostTime: { from: 'mount.boostTime' },
    boostTimeTotal: { from: 'mount.boostTimeTotal' },
    suffocating: { from: 'mount.suffocating', note: 'a strider off the warm blocks (Strider.isSuffocating); the engine recomputes it unless its AI is off' },
    suffocatingSpeed: { derive: 'striderSpeeds', from: ['mount.movementSpeedBase', 'mount.movementSpeedModifiers'], note: 'its speed with the suffocating modifier among the others' },
    jumpPendingScale: { from: 'mount.playerJumpPendingScale' },
    horseJumping: { from: 'mount.horseJumping' },
    standing: { from: 'mount.standing' },
    allowStandSliding: { from: 'mount.allowStandSliding' },
    standCounter: { from: 'mount.standCounter' },
    dashCooldown: { from: 'mount.dashCooldown' },
    dashing: { from: 'mount.dashing' },
    sitting: { from: 'mount.sitting' },
    poseTime: { from: 'mount.poseTime' },
    lerpPosition: { derive: 'lerpStep', from: ['mount.lerpNext', 'mount.lerpSteps', 'mount.lerpTo', 'pos'], note: 'recorded as the next position from 26.3, whose handler follows a path of steps' },
    ultraWarm: { exclude: 'the dimension (header.world.dimension)' },
    jumpBoostAmplifier: { derive: 'amplifier:jump_boost', from: ['mount.effects'] },
    noGravity: { from: 'noGravity' },
};
