// The vehicle layer of the native replay: a tick where the player rides, its vehicle ticks before
// it (Level.tickEntities ticks the root vehicle, then its passengers). The engine's boat or ridden-
// mob model is seeded from the vehicle and its rider as the client tick began (pre: the boat's
// input and the mount's ridden input are what the rider set on the tick before), run once, and
// compared with the vehicle after the tick (post).

import type { NativeBoatState, NativeHorseState } from '../../dist/native.js';

type BoatStatus = NonNullable<NativeBoatState['status']>;
import type { Snapshot } from '../schema/recording.ts';
import { floatRadians } from './seed.ts';

type Vec = readonly [number, number, number];
const vec = (v: unknown) => {
    const [x, y, z] = v as Vec;
    return { x, y, z };
};
const aabb = (b: readonly number[]) => ({ min: { x: b[0]!, y: b[1]!, z: b[2]! }, max: { x: b[3]!, y: b[4]!, z: b[5]! } });

interface RecordedVehicle {
    id?: number;
    type: string;
    pos: Vec; vel: Vec; oldPos: Vec; yRot: number; xRot: number; onGround: boolean; box: number[];
    horizontalCollision: boolean; verticalCollision: boolean; fallDistance: number; noGravity: boolean;
    isInWater: boolean; isInLava: boolean; fluidHeightWater: number; fluidHeightLava: number;
    bbWidth: number; bbHeight: number; stuckSpeedMultiplier: Vec;
    /** Whether this client moves the vehicle (its rider steers it); else it follows the server. */
    controlledByLocalInstance?: boolean;
    boat?: {
        status: string | null; oldStatus: string | null; deltaRotation: number; waterLevel: number; landFriction: number; paddlePhases?: number[]; silent?: boolean;
        inputLeft: boolean; inputRight: boolean; inputUp: boolean; inputDown: boolean; lastYd: number; speedMultiplier?: number;
        aboveBubbleColumn: boolean; bubbleColumnDirectionIsDown: boolean; bubbleTime: number;
    };
    mount?: {
        movementSpeed: number; jumpStrength?: number; flyingSpeed?: number; jumping: boolean; noAi: boolean; zza: number; speed: number; attributes?: Readonly<Record<string, number>>; lerpSteps?: number; lerpTo?: Vec; lerpNext?: Vec;
        effects: { id: string; amplifier: number }[];
        saddled?: boolean; standing?: boolean; standCounter?: number; horseJumping?: boolean; playerJumpPendingScale?: number;
        allowStandSliding?: boolean; boosting?: boolean; boostTime?: number; boostTimeTotal?: number; suffocating?: boolean; movementSpeedBase?: number; movementSpeedModifiers?: readonly SpeedModifier[];
        dashCooldown?: number; dashing?: boolean; sitting?: boolean; poseTime?: number;
    };
}

interface SpeedModifier { readonly amount: number; readonly operation: string }

/** The suffocating modifier, from 1.19.4: before that only the strider's move speed says it is cold. */
const COLD: SpeedModifier = { amount: -0.3400000035762787, operation: 'add_multiplied_base' };
const isCold = (x: SpeedModifier) => x.operation === COLD.operation && x.amount === COLD.amount;

/** AttributeInstance.calculateValue, but for the clamp, which no speed here reaches. */
function attributeValue(base: number, modifiers: readonly SpeedModifier[]): number {
    const added = modifiers.filter(x => x.operation === 'add_value').reduce((sum, x) => sum + x.amount, base);
    const scaled = modifiers.filter(x => x.operation === 'add_multiplied_base').reduce((sum, x) => sum + added * x.amount, added);
    return modifiers.filter(x => x.operation === 'add_multiplied_total').reduce((total, x) => total * (1 + x.amount), scaled);
}

function striderSpeeds(m: { movementSpeed: number; movementSpeedBase?: number; movementSpeedModifiers?: readonly SpeedModifier[] }) {
    if (m.movementSpeedBase === undefined || m.movementSpeedModifiers === undefined) return { movementSpeed: m.movementSpeed };
    const others = m.movementSpeedModifiers.filter(x => !isCold(x));
    return { movementSpeed: attributeValue(m.movementSpeedBase, others), suffocatingSpeed: attributeValue(m.movementSpeedBase, [...others, COLD]) };
}

export function vehicleOf(s: Snapshot): RecordedVehicle | null {
    return (s.vehicle ?? null) as RecordedVehicle | null;
}

const definedOnly = <T extends object>(o: T): T => {
    for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
    return o;
};

/** NativeBoatState from the boat and its rider (fields.ts BOAT_SIM). */
export function toBoat(v: RecordedVehicle, rider: Snapshot): NativeBoatState {
    const b = v.boat!;
    return definedOnly({
        position: vec(v.pos), velocity: vec(v.vel),
        yaw: floatRadians(v.yRot), yawDegrees: Math.fround(v.yRot),
        forward: b.inputUp, left: b.inputLeft, right: b.inputRight, inputDown: b.inputDown,
        deltaRotation: b.deltaRotation,
        inWater: b.status === 'in_water' || b.status === 'under_water' || b.status === 'under_flowing_water',
        waterLevel: b.waterLevel,
        ...(b.status ? { status: b.status as BoatStatus } : {}),
        ...(b.oldStatus ? { previousStatus: b.oldStatus as BoatStatus } : {}),
        bubbleTime: b.bubbleTime, bubbleColumnDirectionIsDown: b.bubbleColumnDirectionIsDown, aboveBubbleColumn: b.aboveBubbleColumn,
        playerPassenger: true,
        collidedHorizontally: v.horizontalCollision, collidedVertically: v.verticalCollision, onGround: v.onGround,
        landFriction: b.landFriction, lastVerticalVelocity: b.lastYd,
        boundingBox: aabb(v.box),
        riderYaw: rider.yRot as number, riderForward: rider.zza as number, riderStrafe: rider.xxa as number,
        stuckSpeedMultiplier: vec(v.stuckSpeedMultiplier),
        noGravity: v.noGravity,
        paddlePhases: b.paddlePhases, silent: b.silent,
        ...(b.speedMultiplier === undefined ? {} : { speedMultiplier: b.speedMultiplier }),
    });
}

/** Mth.lerp of each axis by 1 / steps. */
function lerpStep(from: Vec, to: Vec, steps: number): { x: number; y: number; z: number } {
    const share = 1 / steps;
    const step = (a: number, b: number) => a + share * (b - a);
    return { x: step(from[0], to[0]), y: step(from[1], to[1]), z: step(from[2], to[2]) };
}

/** NativeHorseState from the ridden mob and its rider (fields.ts HORSE_SIM). */
/** `released`: the riding jump the rider released on the tick before (onPlayerJump, percent). */
export function toHorse(v: RecordedVehicle, rider: Snapshot, released?: number, rearsThisTick = false): NativeHorseState {
    const m = v.mount!;
    const jumpBoost = m.effects.find(e => e.id === 'jump_boost')?.amplifier;
    const levitation = m.effects.find(e => e.id === 'levitation')?.amplifier;
    const attributes = m.attributes ?? {};
    return definedOnly({
        position: vec(v.pos), velocity: vec(v.vel),
        yaw: floatRadians(v.yRot), yawDegrees: Math.fround(v.yRot), pitchDegrees: Math.fround(v.xRot),
        forward: rider.zza as number, strafe: rider.xxa as number, jumpRequested: rider.jumping === true,
        onGround: v.onGround, inWater: v.isInWater, inLava: v.isInLava,
        waterHeight: v.fluidHeightWater, lavaHeightPositive: v.fluidHeightLava > 0,
        // a strider's speed warm and cold: which of them a tick moves at is the engine's to find
        ...striderSpeeds(m),
        // (a mob without the attribute, a pig: the engine needs a value, and nothing compares it)
        jumpStrength: m.jumpStrength ?? 0, flyingSpeed: m.flyingSpeed ?? 0,
        halfWidth: v.bbWidth / 2, height: v.bbHeight,
        collidedHorizontally: v.horizontalCollision, collidedVertically: v.verticalCollision,
        // (a camel husk rides as a camel: CamelHusk overrides none of its movement, and the engine names it so)
        entityType: v.type === 'camel_husk' ? 'camel' : v.type,
        riderYaw: rider.yRot as number, riderPitch: rider.xRot as number, riderSprinting: rider.sprinting === true,
        ...(released !== undefined ? { riderJump: released } : {}),
        fallDistance: v.fallDistance, boundingBox: aabb(v.box), previousPosition: vec(v.oldPos),
        // the step of an interpolation still running (LivingEntity.lerpPositionAndRotationStep)
        ...(m.lerpNext ? { lerpPosition: { x: m.lerpNext[0], y: m.lerpNext[1], z: m.lerpNext[2] } } : m.lerpSteps && m.lerpTo ? { lerpPosition: lerpStep(v.pos, m.lerpTo, m.lerpSteps) } : {}),
        saddled: m.saddled, noAi: m.noAi, ownForward: m.zza, riddenSpeed: m.speed,
        boosting: m.boosting, boostTime: m.boostTime, boostTimeTotal: m.boostTimeTotal, suffocating: m.suffocating,
        jumpPendingScale: m.playerJumpPendingScale, horseJumping: m.horseJumping, standing: m.standing || rearsThisTick,
        allowStandSliding: m.allowStandSliding, standCounter: rearsThisTick ? 1 : m.standCounter,
        dashCooldown: m.dashCooldown, dashing: m.dashing, sitting: m.sitting, ...(m.poseTime === undefined ? {} : { poseTime: m.poseTime }),
        ...(jumpBoost !== undefined ? { jumpBoostAmplifier: jumpBoost } : {}),
        noGravity: v.noGravity,
        stuckSpeedMultiplier: vec(v.stuckSpeedMultiplier),
        slowFalling: m.effects.some(e => e.id === 'slow_falling'),
        weaving: m.effects.some(e => e.id === 'weaving'),
        ...(levitation !== undefined ? { levitationAmplifier: levitation } : {}),
        dolphinsGrace: m.effects.some(e => e.id === 'dolphins_grace'),
        gravity: attributes.gravity, stepHeight: attributes.step_height,
        waterMovementEfficiency: attributes.water_movement_efficiency,
        airDragModifier: attributes.air_drag_modifier, frictionModifier: attributes.friction_modifier,
    });
}

/** The vehicle's state after a tick in the recording's terms, from the engine's boat or mount. */
export function fromVehicle(state: NativeBoatState | NativeHorseState): Record<string, unknown> {
    return {
        pos: [state.position.x, state.position.y, state.position.z],
        vel: [state.velocity.x, state.velocity.y, state.velocity.z],
        ...(state.onGround !== undefined ? { onGround: state.onGround } : {}),
        ...(state.yawDegrees !== undefined ? { yRot: state.yawDegrees } : {}),
    };
}

/** The recorded vehicle's fields the vehicle layer compares, in the same terms. */
export function recordedVehicle(v: RecordedVehicle): Record<string, unknown> {
    return { pos: v.pos, vel: v.vel, onGround: v.onGround, yRot: Math.fround(v.yRot) };
}
