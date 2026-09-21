export interface NativeVec3 {
    x: number;
    y: number;
    z: number;
}

export interface NativeSimulationConfig {
    gravity?: number;
    drag?: number;
    movementSpeed?: number;
    sprintMultiplier?: number;
    jumpVelocity?: number;
    stepHeight?: number;
    negligibleVelocity?: number;
}

export interface NativeSimulationState {
    position: NativeVec3;
    velocity: NativeVec3;
    yaw?: number;
    halfWidth: number;
    height: number;
    onGround: boolean;
    collidedHorizontally: boolean;
    minorHorizontalCollision?: boolean;
    collidedVertically: boolean;
    verticalCollisionBelow?: boolean;
    blockFallCallback?: boolean;
    entityBounciness?: number;
    blockBounciness?: number;
    input?: NativeVec3;
    jumpRequested?: boolean;
    jumpTicks?: number;
    sprinting?: boolean;
    inWater?: boolean;
    firstTick?: boolean;
    inLava?: boolean;
    ultraWarm?: boolean;
    isPlayer?: boolean;
    controlledByLocalInstance?: boolean;
    passenger?: boolean;
    inWeb?: boolean;
    weaving?: boolean;
    sweetBerryBushImmune?: boolean;
    powderSnowImmune?: boolean;
    powderSnowWalkable?: boolean;
    inPowderSnow?: boolean;
    ticksFrozen?: number;
    ticksRequiredToFreeze?: number;
    tickCount?: number;
    freezeDamage?: number;
    contactDamage?: number;
    insideWall?: boolean;
    eyeHeight?: number;
    eyeInWater?: boolean;
    eyeInLava?: boolean;
    slowFalling?: boolean;
    levitation?: boolean;
    levitationAmplifier?: number;
    fallDistance?: number;
    safeFallDistance?: number;
    fallDamageImmune?: boolean;
    fallDamageMultiplier?: number;
    sneaking?: boolean;
    steppingCarefully?: boolean;
    usingItem?: boolean;
    swimming?: boolean;
    flying?: boolean;
    flyingSpeed?: number;
    climbing?: boolean;
    noPhysics?: boolean;
    noGravity?: boolean;
    gravity?: number;
    stepHeight?: number;
    movementSpeed?: number;
    jumpStrength?: number;
    speedEffectAmplifier?: number;
    slownessEffectAmplifier?: number;
    jumpBoostAmplifier?: number;
    dolphinsGrace?: number;
    depthStrider?: number;
    soulSpeed?: number;
    waterMovementEfficiency?: number;
    movementEfficiency?: number;
    airDragModifier?: number;
    frictionModifier?: number;
    sneakingSpeed?: number;
    fallDamage?: number;
    fallFlying?: boolean;
    look?: NativeVec3;
    fireworkBoost?: NativeVec3;
}

export interface NativeEntityPushState {
    position: NativeVec3;
    velocity: NativeVec3;
    noPhysics: boolean;
    vehicle: boolean;
    pushable: boolean;
    pushthrough: number;
}

export interface NativeEntityPushResult {
    leftVelocity: NativeVec3;
    rightVelocity: NativeVec3;
}

export interface NativeVersionedEntityState {
    simulation: NativeSimulationState;
    noPhysics: boolean;
    vehicleId?: number;
    pushable: boolean;
    pushthrough: number;
}

export interface NativePoseRefreshResult {
    state: NativeSimulationState;
    pose: number;
    changed: boolean;
}

export interface NativeEntityDescriptor {
    position: NativeVec3;
    velocity: NativeVec3;
    halfWidth: number;
    height: number;
    onGround: boolean;
    yaw: number;
    inWater: boolean;
    inLava: boolean;
    version?: string;
    pose?: number;
    pitch?: number;
    input?: NativeVec3;
    sprinting?: boolean;
    sneaking?: boolean;
    usingItem?: boolean;
    swimming?: boolean;
    passenger?: boolean;
    flying?: boolean;
    flyingSpeed?: number;
    climbing?: boolean;
    noGravity?: boolean;
    fallFlying?: boolean;
    fallDamageImmune?: boolean;
    slowFalling?: boolean;
    levitation?: boolean;
    levitationAmplifier?: number;
    fallDamageMultiplier?: number;
    movementSpeed?: number;
    jumpStrength?: number;
    speedEffectAmplifier?: number;
    slownessEffectAmplifier?: number;
    jumpBoostAmplifier?: number;
    dolphinsGrace?: number;
    depthStrider?: number;
    soulSpeed?: number;
    sneakingSpeed?: number;
    look?: NativeVec3;
    fireworkBoost?: NativeVec3;
}

export interface NativeWorld {
    setChunkLoaded(chunkX: number, chunkZ: number, loaded: boolean): void;
    isChunkLoaded(chunkX: number, chunkZ: number): boolean;
    setWorldBounds(minBuildHeight: number, maxBuildHeight: number, borderCenterX: number, borderCenterZ: number, borderSize: number): void;
    worldBounds(): NativeWorldBounds;
    isInsideWorldBorder(x: number, z: number): boolean;
    isInsideBuildHeight(y: number): boolean;
    isSectionPresent(chunkX: number, sectionY: number, chunkZ: number): boolean;
    setSectionPresent(chunkX: number, sectionY: number, chunkZ: number, present: boolean): void;
    sectionBlockCount(chunkX: number, sectionY: number, chunkZ: number): number;
    clampToWorldBorder(position: NativeVec3): NativeVec3;
    setFullBlock(x: number, y: number, z: number, id: number): void;
    setBlockStateId(x: number, y: number, z: number, version: string, id: number): void;
    setBlockEntity(x: number, y: number, z: number, kind: string): void;
    removeBlockEntity(x: number, y: number, z: number): void;
    setBlockProperties(x: number, y: number, z: number, properties: NativeBlockProperty[]): void;
    setBlockShape(x: number, y: number, z: number, id: number, shape: NativeBlockShape): void;
    setBlockOutlineShape(x: number, y: number, z: number, shape: NativeBlockShape): void;
    setBlockShapes(x: number, y: number, z: number, id: number, shapes: NativeBlockShape[], outlineShapes?: NativeBlockShape[]): void;
    removeBlock(x: number, y: number, z: number): void;
    setFluid(x: number, y: number, z: number, fluid: number): void;
    setFluidState(x: number, y: number, z: number, fluid: number, fluidTags: number, fluidLevel: number, fluidSource: boolean, fluidFalling: boolean, fluidFlow: NativeVec3): void;
    setVersionedFluidState(x: number, y: number, z: number, version: string, fluid: number, fluidTags: number, fluidLevel: number, fluidSource: boolean, fluidFalling: boolean, fluidFlow: NativeVec3): void;
    applyBlockUpdates(updates: NativeBlockUpdate[]): void;
    collisionShapes(min: NativeVec3, max: NativeVec3): NativeAabb[];
    outlineShapes(min: NativeVec3, max: NativeVec3): NativeAabb[];
    interactionShapes(min: NativeVec3, max: NativeVec3): NativeAabb[];
    fluidAt(x: number, y: number, z: number): number;
    fluidTagsAt(x: number, y: number, z: number): number;
    fluidHeightAt(x: number, y: number, z: number): number;
    fluidFlowAt(x: number, y: number, z: number): NativeVec3;
    blockEffectAt(x: number, y: number, z: number): number;
    blockTagsAt(x: number, y: number, z: number): number;
    blockAt(x: number, y: number, z: number): NativeBlockState;
}

export interface NativeAabb {
    min: NativeVec3;
    max: NativeVec3;
}

export interface NativeWorldBounds {
    minBuildHeight: number;
    maxBuildHeight: number;
    borderCenterX: number;
    borderCenterZ: number;
    borderSize: number;
}

export interface NativeBlockState {
    present: boolean;
    id: number;
    stateVersion?: string;
    properties: NativeBlockProperty[];
    tags: number;
    fluid: number;
    fluidTags: number;
    fluidLevel: number;
    fluidSource: boolean;
    fluidFlow: NativeVec3;
    fluidFalling: boolean;
    fallDamageResetting: boolean;
    effect: number;
    slipperiness: number;
    bounceRestitution: number;
    suppressesBounce: boolean;
    shape?: NativeAabb;
    outlineShape?: NativeAabb;
    interactionShape?: NativeAabb;
    blockEntity?: string;
    removeBlockEntity?: boolean;
}

export interface NativeBlockProperty {
    name: string;
    value: string;
}

export interface NativeBlockShape {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
    slipperiness: number;
    effect?: number;
    bounceRestitution?: number;
    suppressesBounce?: boolean;
    fallDamageResetting?: boolean;
}

export interface NativeGeneratedShapeBox {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

export interface NativeGeneratedShapeProvenance {
    sourceSha256?: string;
    hasMethod: boolean;
    stateDependent: boolean;
    propertyDependencies: string[];
    candidateBoxCount: number;
}

export interface NativeGeneratedShapePredicate {
    property: string;
    operator: string;
    value: string;
}

export interface NativeBlockUpdate {
    x: number;
    y: number;
    z: number;
    id?: number;
    stateVersion?: string;
    blockEntity?: string;
    properties?: NativeBlockProperty[];
    tags?: number;
    shape?: NativeBlockShape;
    outlineShape?: NativeBlockShape;
    interactionShape?: NativeBlockShape;
    fluid?: number;
    fluidTags?: number;
    fluidLevel?: number;
    fluidSource?: boolean;
    fluidFlow?: NativeVec3;
    fluidFalling?: boolean;
    bounceRestitution?: number;
    suppressesBounce?: boolean;
    fallDamageResetting?: boolean;
    remove?: boolean;
}

export interface NativePhysicsBinding {
    NativeWorld: new () => NativeWorld;
    simulateTick(
        world: NativeWorld,
        state: NativeSimulationState,
        config: NativeSimulationConfig,
    ): NativeSimulationState;
    createSimulationState(descriptor: NativeEntityDescriptor): NativeSimulationState;
    simulateTicks(
        world: NativeWorld,
        states: NativeSimulationState[],
        ticks: number,
        config: NativeSimulationConfig,
    ): NativeSimulationState[];
    simulateVersionedTick(
        version: string,
        world: NativeWorld,
        state: NativeSimulationState,
        config: NativeSimulationConfig,
    ): NativeSimulationState;
    simulateVersionedTicks(
        version: string,
        world: NativeWorld,
        states: NativeSimulationState[],
        ticks: number,
        config: NativeSimulationConfig,
    ): NativeSimulationState[];
    simulateVersionedEntityTicks(
        version: string,
        world: NativeWorld,
        states: NativeVersionedEntityState[],
        ticks: number,
        config: NativeSimulationConfig,
    ): NativeVersionedEntityState[];
    simulateVersionedEntityPush(
        version: string,
        left: NativeEntityPushState,
        right: NativeEntityPushState,
        passengerOfSameVehicle: boolean,
    ): NativeEntityPushResult;
    refreshVersionedPose(
        version: string,
        world: NativeWorld,
        state: NativeSimulationState,
        currentPose: number,
        requestedPose: number,
        spectator: boolean,
    ): NativePoseRefreshResult;
    versionCapabilities(major: number, minor: number, patch: number): NativeVersionCapabilities;
    generatedBlockHasTag(version: string, block: string, tag: string): boolean;
    generatedStateIndex(
        version: string,
        block: string,
        properties: [string, string][],
    ): number | null;
    generatedBlockStateCount(version: string, block: string): number | null;
    generatedFluidStateCount(version: string, fluid: string): number | null;
    generatedFluidStateIndex(
        version: string,
        fluid: string,
        properties: Array<[string, string]>,
    ): number | null;
    generatedBlockDefaults(version: string, block: string): NativeBlockProperty[] | null;
    generatedSourceShapeBoxes(version: string, block: string): NativeGeneratedShapeBox[] | null;
    generatedMethodShapeBoxes(version: string, block: string, kind: "collision" | "outline" | "interaction"): NativeGeneratedShapeBox[] | null;
    generatedExactMethodShapeBoxes(version: string, block: string, kind: "collision" | "outline" | "interaction"): NativeGeneratedShapeBox[] | null;
    generatedExactMethodShapeBoxesForState(version: string, block: string, kind: "collision" | "outline" | "interaction", properties: NativeBlockProperty[]): NativeGeneratedShapeBox[] | null;
    generatedShapePropertyDependencies(version: string, block: string): string[] | null;
    generatedMethodShapePropertyDependencies(version: string, block: string, kind: "collision" | "outline" | "interaction"): string[] | null;
    generatedMethodShapePredicates(version: string, block: string, kind: "collision" | "outline" | "interaction"): NativeGeneratedShapePredicate[] | null;
    generatedMethodShapePredicatesMatchState(version: string, block: string, kind: "collision" | "outline" | "interaction", properties: NativeBlockProperty[]): boolean | null;
    generatedMethodShapeIsStateDependent(version: string, block: string, kind: "collision" | "outline" | "interaction"): boolean | null;
    generatedMethodShapeProvenance(version: string, block: string, kind: "collision" | "outline" | "interaction"): NativeGeneratedShapeProvenance | null;
    simulateBoatTick(state: NativeBoatState): NativeBoatState;
    simulateVersionedBoatTick(version: string, world: NativeWorld, state: NativeBoatState): NativeBoatState;
    simulateVersionedBoatTicks(version: string, world: NativeWorld, states: NativeBoatState[], ticks: number): NativeBoatState[];
    simulateHorseTick(state: NativeHorseState): NativeHorseState;
    simulateVersionedHorseTick(version: string, world: NativeWorld, state: NativeHorseState): NativeHorseState;
    simulateVersionedHorseTicks(version: string, world: NativeWorld, states: NativeHorseState[], ticks: number): NativeHorseState[];
    simulateProjectileTick(
        world: NativeWorld,
        state: NativeProjectileState,
    ): NativeProjectileTickResult;
    simulateVersionedProjectileTicks(
        version: string,
        world: NativeWorld,
        states: NativeProjectileState[],
        ticks: number,
    ): NativeProjectileTickResult[];
    simulateArrowTick(world: NativeWorld, state: NativeArrowState): NativeArrowTickResult;
    simulateVersionedArrowTicks(version: string, world: NativeWorld, states: NativeArrowState[], ticks: number): NativeArrowTickResult[];
    simulateTridentTick(world: NativeWorld, state: NativeTridentState): NativeTridentTickResult;
    simulateVersionedTridentTicks(version: string, world: NativeWorld, states: NativeTridentState[], ticks: number): NativeTridentTickResult[];
}

export interface NativeVersionCapabilities {
    fluidPhysics: boolean;
    honeyBlocks: boolean;
    fallFlying: boolean;
    waterMovementEfficiency: boolean;
    minorHorizontalCollision: boolean;
}

export interface NativeBoatState {
    position: NativeVec3;
    velocity: NativeVec3;
    yaw: number;
    forward: boolean;
    left: boolean;
    right: boolean;
    /** Vanilla `inputDown`; optional for compatibility with older callers. */
    inputDown?: boolean;
    /** Persistent vanilla deltaRotation in degrees. */
    deltaRotation?: number;
    inWater: boolean;
    waterLevel?: number;
    status?: 'in_water' | 'under_water' | 'under_flowing_water' | 'on_land' | 'in_air';
    previousStatus?: 'in_water' | 'under_water' | 'under_flowing_water' | 'on_land' | 'in_air';
    bubbleTime?: number;
    bubbleColumnDirectionIsDown?: boolean;
    aboveBubbleColumn?: boolean;
    playerPassenger?: boolean;
    collidedHorizontally?: boolean;
    collidedVertically?: boolean;
    onGround?: boolean;
}

export interface NativeHorseState {
    position: NativeVec3;
    velocity: NativeVec3;
    yaw: number;
    forward: number;
    strafe: number;
    jumpRequested: boolean;
    onGround: boolean;
    inWater: boolean;
    movementSpeed: number;
    jumpStrength: number;
    halfWidth?: number;
    height?: number;
    collidedHorizontally?: boolean;
    collidedVertically?: boolean;
}

export interface NativeProjectileState {
    position: NativeVec3;
    velocity: NativeVec3;
    gravity?: number;
    airDrag?: number;
    /** Persistent AbstractHurtingProjectile power acceleration. */
    power?: NativeVec3;
    inWater?: boolean;
    firstTick?: boolean;
    /** Optional projectile family tag for source-specialized dispatch. */
    kind?: string;
    /** Source-derived firework horizontal collision flag. */
    horizontalCollision?: boolean;
    /** Source-derived firework shot-at-angle flag. */
    shotAtAngle?: boolean;
}

export interface NativeProjectileTickResult {
    position: NativeVec3;
    velocity: NativeVec3;
    blockHit: boolean;
    firstTick: boolean;
}

export interface NativeArrowState {
    position: NativeVec3;
    velocity: NativeVec3;
    gravity?: number;
    airDrag?: number;
    waterInertia?: number;
    inWater?: boolean;
    inGround?: boolean;
    life?: number;
    inGroundTime?: number;
    shakeTime?: number;
    fallImpulse?: NativeVec3;
    lastBlockId?: number;
}

export interface NativeArrowTickResult {
    position: NativeVec3;
    velocity: NativeVec3;
    blockHit: boolean;
    inGround: boolean;
    discarded: boolean;
    inGroundTime: number;
    shakeTime: number;
    startedFalling: boolean;
}

export interface NativeTridentState {
    position: NativeVec3;
    velocity: NativeVec3;
    gravity?: number;
    airDrag?: number;
    waterInertia?: number;
    inWater?: boolean;
    dealtDamage?: boolean;
}

export interface NativeTridentTickResult {
    position: NativeVec3;
    velocity: NativeVec3;
    blockHit: boolean;
}

export function LoadNativePhysics(): NativePhysicsBinding {
    const modulePath = process.env.NAPI_RS_NATIVE_LIBRARY_PATH ?? '../native/artifacts/native.js';
    try {
        return module.require(modulePath) as NativePhysicsBinding;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Native physics addon is unavailable at ${modulePath}: ${message}`);
    }
}
