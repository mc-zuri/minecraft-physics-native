// What becomes of each recorded field the native comparison does not use, and of each entity family: read from the code as it
// is, so that a claim here names the file that holds it and a test can hold it to that file. schema/fields.ts RECORDED_ONLY gives
// the reason a field stays out of the native mapping, and a test holds what it says of a comparison to this table.

export type Verdict =
    /** Another layer compares it with an output. */
    | 'compared'
    /** Read as an input of a layer, whose comparison would show a wrong one. */
    | 'input'
    /** Only explains a result: nothing of the next tick reads it. */
    | 'diagnostic'
    /** Drawn or sent, and no movement reads it. */
    | 'out of scope'
    /** It can change the next tick, and nothing holds it. */
    | 'gap';

export interface FieldDecision { readonly verdict: Verdict; readonly by?: string; readonly why: string }

export const FIELD_DECISIONS: Readonly<Record<string, FieldDecision>> = {
    yRotO: { verdict: 'out of scope', why: 'the look of the last frame, which only rendering interpolates' },
    xRotO: { verdict: 'out of scope', why: 'the look of the last frame, which only rendering interpolates' },
    pose: { verdict: 'compared', by: 'adapter.ts', why: 'the pose the adapter decides, at the end of the tick' },
    fluidHeightWater: { verdict: 'diagnostic', why: 'the player\'s own: isInWater is what the engine gives back. A vehicle has its own field of the name, a seed' },
    fluidHeightLava: { verdict: 'diagnostic', why: 'as fluidHeightWater' },
    wasEyeInWater: { verdict: 'diagnostic', why: 'the same value as isUnderWater, which the adapter layer compares' },
    isUnderWater: { verdict: 'compared', by: 'adapter.ts', why: 'in the adapter\'s MOTION' },
    wasInPowderSnow: { verdict: 'input', by: 'adapter.ts', why: 'seeds the adapter\'s state; isInPowderSnow is compared' },
    onClimbable: { verdict: 'compared', by: 'adapter.ts', why: 'in the adapter\'s MOTION; the engine asks the world itself' },
    leftImpulse: { verdict: 'compared', by: 'adapter.ts', why: 'against the heading the adapter makes of the keys, at the end of the tick' },
    forwardImpulse: { verdict: 'compared', by: 'adapter.ts', why: 'against the heading the adapter makes of the keys; it also seeds prevForwardImpulse' },
    inputJumping: { verdict: 'compared', by: 'adapter.ts', why: 'against the adapter\'s wasJumping: the jump key, or the auto-jump\'s press' },
    inputShiftKeyDown: { verdict: 'compared', by: 'adapter.ts', why: 'against the key the adapter\'s tick read' },
    xxa: { verdict: 'compared', by: 'phases.ts', why: 'the travel vector at beforeTravel, against the engine\'s trace; also a mount\'s rider input' },
    yya: { verdict: 'compared', by: 'phases.ts', why: 'as xxa' },
    zza: { verdict: 'compared', by: 'phases.ts', why: 'as xxa' },
    jumping: { verdict: 'compared', by: 'phases.ts', why: 'at beforeTravel, against the engine\'s jumpRequested; also the rider\'s jump a mount takes' },
    sprintTriggerTime: { verdict: 'compared', by: 'adapter.ts', why: 'in the adapter\'s decisions' },
    jumpTriggerTime: { verdict: 'compared', by: 'adapter.ts', why: 'in the adapter\'s decisions' },
    crouching: { verdict: 'compared', by: 'adapter.ts', why: 'in the adapter\'s decisions' },
    fallFlyTicks: { verdict: 'out of scope', why: 'counts an elytra\'s wear: the glide reads it for damage and no motion' },
    autoSpinAttackTicks: { verdict: 'input', by: 'engine.ts', why: 'says a Riptide release; the adapter counts it down' },
    useItemRemainingTicks: { verdict: 'compared', by: 'adapter.ts', why: 'the ticks of the use, against the adapter\'s itemUseTicks: what a Riptide release reads' },
    vehicleId: { verdict: 'out of scope', why: 'an entity id, which the vehicle snapshot says too' },
    health: { verdict: 'compared', by: 'compare.ts', why: 'as srv.health against the damage the engine reports' },
    food: { verdict: 'input', by: 'adapter.ts', why: 'gates the sprint decision' },
    gameMode: { verdict: 'input', by: 'adapter.ts', why: 'seeds the adapter and the bot' },
    walkingSpeed: { verdict: 'out of scope', why: 'the movement speed attribute is what travel reads, and it is seeded whole' },
    speed: { verdict: 'diagnostic', why: 'LivingEntity.speed after the folding that movementSpeed seeds' },
    selectedSlot: { verdict: 'compared', by: 'bot.ts', why: 'a hand, read by no movement: the bot layer drives it and compares the held_item_slot it sends' },
    lastSentPos: { verdict: 'input', by: 'bot.ts', why: 'where the bot\'s next position packet starts from' },
    lastSentYRot: { verdict: 'input', by: 'bot.ts', why: 'as lastSentPos' },
    lastSentXRot: { verdict: 'input', by: 'bot.ts', why: 'as lastSentPos' },
    lastOnGround: { verdict: 'input', by: 'bot.ts', why: 'as lastSentPos' },
    wasShiftKeyDown: { verdict: 'input', by: 'bot.ts', why: 'as lastSentPos' },
    positionReminder: { verdict: 'input', by: 'bot.ts', why: 'the count to the next position packet; every packet compared holds it' },
    jumpRidingScale: { verdict: 'compared', by: 'bot.ts', why: 'the charge reaches the world only as the power START_RIDING_JUMP says, held to the scale on the tick of the release; the fork keeps it private, so a charge let go by no release is not compared' },
    jumpRidingTicks: { verdict: 'compared', by: 'bot.ts', why: 'as jumpRidingScale, through the scale its count makes' },
    vehicle: { verdict: 'compared', by: 'engine.ts', why: 'the vehicle layer, field by field (BOAT_SIM, HORSE_SIM, MINECART_SIM)' },
};

export interface FamilyInventory {
    readonly family: string;
    /** The snapshot that holds it. */
    readonly captured: string;
    /** What holds it to vanilla. */
    readonly compared: string;
    readonly by: string;
    /** What of it the engine reads and nothing records or compares. */
    readonly missing: string;
}

export const ENTITY_FAMILIES: readonly FamilyInventory[] = [
    { family: 'local player', captured: 'PLAYER_FIELDS at each phase', compared: 'NATIVE_SIM at the tick\'s end and PHASE_FIELDS between', by: 'engine.ts', missing: 'the gaps of the table below' },
    { family: 'boat', captured: 'snapshot vehicle.boat', compared: 'BOAT_SIM after its own tick, and the head and tail of its move inside it', by: 'engine.ts', missing: 'nothing of its tick between those points' },
    { family: 'ridden mob', captured: 'snapshot vehicle.mount', compared: 'HORSE_SIM after the rider, and the head and tail of its move inside its tick', by: 'engine.ts', missing: 'nothing of its tick between those points; walkAnimation, which seats a strider\'s rider (Strider.getPassengerAttachmentPoint), is in no snapshot' },
    { family: 'minecart', captured: 'srv.entities and snapshot vehicle.minecart', compared: 'MINECART_SIM on the server, and the client\'s interpolation', by: 'minecart.ts', missing: 'the client\'s own tick of a cart is only its interpolation' },
    { family: 'moving entity (TNT, falling block, item, orb)', captured: 'srv.entities and nearbyEntities', compared: 'path and end, server and client view', by: 'moving-entities.ts', missing: 'only with --moving, or in the physrec/me_ cases' },
    { family: 'projectile', captured: 'srv.entities', compared: 'path, hits and health', by: 'projectile.ts', missing: 'only with --projectiles' },
    { family: 'other entities near the player', captured: 'nearbyEntities', compared: 'as colliders and pushers: the player\'s motion shows them', by: 'seed.ts', missing: 'their own state: they are seeded each tick and never predicted' },
];

export const TALLY = (decisions: Readonly<Record<string, FieldDecision>> = FIELD_DECISIONS) => {
    const out: Partial<Record<Verdict, string[]>> = {};
    for (const [field, { verdict }] of Object.entries(decisions)) (out[verdict] ??= []).push(field);
    return out;
};
