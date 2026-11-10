// Continuous replay: seeded once from vanilla, each tick then starts from what the engine's last tick left, so state the
// engine loses or a drift it gathers shows on later ticks instead of going at the next row, as it does in the stepwise
// replay. Every field the tick reads has one owner:
//
// - predicted (CARRIED): the engine's output. A later vanilla row never overwrites it, a packet's handling apart.
// - protocol: what a server packet changed, at the packet's own boundary: the fields of its recorded delta and only those (a
//   teleport the position, a motion packet the velocity). Each is a `correction` in the result.
// - input: the keys and the look of the row, and a Riptide trident's release, which the client handles before the level ticks
//   and which no packet carries: the engine launches from the prediction (riptideLaunch), as vanilla does from where it is.
// - decision: what the adapter decides before the tick, which the native layer takes from vanilla in continuous as in
//   stepwise (DECIDED_BY_VANILLA, which every result states). replayAdapter makes those itself.
// - scene: world, entities, pistons, border, effects and attributes, from the recording as the stepwise replay has them.
//
// A tick the engine does not run for the player (a ride, another dimension, death, a tick the client skipped) ends the
// prediction: the next one seeds again, and the result counts it as a reseed, with why. A vehicle the rider steers has its own
// prediction (VehiclePrediction), on the same terms: its rider's input and its attributes and effects stay the recording's.

import type { NativeSimulationState } from '../../dist/native.js';
import { NATIVE_SIM } from '../schema/fields.ts';
import type { ExpandedRow, Snapshot } from '../schema/recording.ts';

/** The native fields a tick carries forward: what the engine computes and reads again on the next one. */
export const CARRIED = [
    'position', 'velocity', 'previousPosition', 'boundingBox', 'onGround', 'collidedHorizontally', 'minorHorizontalCollision',
    'collidedVertically', 'verticalCollisionBelow', 'jumpTicks', 'autoJumpTime', 'wasSprinting', 'inWater', 'inLava', 'eyeInWater',
    'eyeInLava', 'inPowderSnow', 'insideWall', 'stuckSpeedMultiplier', 'fallDistance', 'tickCount', 'onGroundNoBlocks', 'supportingBlock',
] as const satisfies readonly (keyof NativeSimulationState)[];

/** What a boat or a mount carries from tick to tick: the fields of the engine's output its next tick reads. */
export const VEHICLE_CARRIED = [
    'position', 'velocity', 'previousPosition', 'boundingBox', 'onGround', 'inWater', 'inLava', 'collidedHorizontally', 'collidedVertically',
    'fallDistance', 'stuckSpeedMultiplier', 'standing', 'standCounter', 'horseJumping', 'boosting', 'boostTime', 'dashing', 'dashCooldown', 'poseTime',
    'status', 'previousStatus', 'waterLevel', 'landFriction', 'lastVerticalVelocity', 'deltaRotation', 'paddlePhases',
] as const;

/** What the native layer does not decide: from vanilla at beforeLivingAiStep on every tick of a continuous replay too. */
export const DECIDED_BY_VANILLA: readonly string[] = Object.entries(NATIVE_SIM).flatMap(([key, map]) => ('decision' in map && map.decision ? [key] : []));

/** Every native field by the recorded field it is seeded from. */
const BY_RECORDED = new Map<string, string>(Object.entries(NATIVE_SIM).flatMap(([key, map]) => ('from' in map && typeof map.from === 'string' ? [[map.from, key] as const] : [])));

export interface Correction {
    readonly t: number;
    readonly packet: string;
    /** The recorded fields the packet's handling changed, of those the prediction owned. */
    readonly fields: readonly string[];
    /** The prediction a move replaced, and where vanilla was. */
    readonly predicted?: readonly [number, number, number];
    readonly vanilla?: readonly [number, number, number];
}

export interface Reseed { readonly t: number; readonly why: string }

export interface Drift {
    /** The tick of the first divergence of any field, and how far the position had gone by then. */
    readonly firstTick?: number;
    readonly firstPosition: number;
    /** The farthest position and motion went from vanilla, and where they ended. */
    readonly maxPosition: number;
    readonly maxVelocity: number;
    readonly finalPosition: number;
    readonly finalVelocity: number;
}

type Xyz = { x: number; y: number; z: number };
const vec = (v: Xyz) => [v.x, v.y, v.z] as const;
const gap = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/**
 * A ridden vehicle's prediction. A packet that changed the vehicle's recorded state takes the whole of it back to vanilla, as a
 * snapshot does not say which of its fields the packet moved.
 */
export class VehiclePrediction {
    private held: Record<string, unknown> | undefined;
    private cause = 'the first tick';
    readonly reseeds: Reseed[] = [];
    carried = 0;

    end(why: string): void {
        if (this.held) this.cause = why;
        this.held = undefined;
    }

    seed<T extends object>(state: T, row: Pick<ExpandedRow, 't' | 's2c'>): T {
        if (this.held && row.s2c.some(packet => packet.after && 'vehicle' in packet.after)) this.end('a packet moved the vehicle');
        if (!this.held) {
            this.reseeds.push({ t: row.t, why: this.cause });
            return state;
        }
        this.carried += 1;
        const out = { ...state } as Record<string, unknown>;
        for (const key of VEHICLE_CARRIED) if (key in out && this.held[key] !== undefined) out[key] = this.held[key];
        return out as T;
    }

    keep(after: object): void {
        this.held = after as Record<string, unknown>;
    }
}

/** The prediction through a recording: what the last tick left, what the packets took from it, how far it went from vanilla. */
export class Prediction {
    private held: NativeSimulationState | undefined;
    private cause: string | undefined = 'the first tick';
    readonly corrections: Correction[] = [];
    readonly reseeds: Reseed[] = [];
    private firstTick: number | undefined;
    private firstPosition = 0;
    private maxPosition = 0;
    private maxVelocity = 0;
    private finalPosition = 0;
    private finalVelocity = 0;

    /** The chain ends here: nothing the engine ran fed this tick. */
    end(why: string): void {
        if (this.held) this.cause = why;
        this.held = undefined;
    }

    /** A recorded box at `position`, moved to where the prediction is. */
    box(box: readonly number[], position: readonly number[], row?: Pick<ExpandedRow, 's2c'>): readonly number[] {
        // (a packet of the row that moved the player, a teleport, puts the tick where vanilla's start is, as seed() takes it)
        if (!this.held || row?.s2c.some(packet => packet.after?.pos !== undefined)) return box;
        const [dx, dy, dz] = [this.held.position.x - position[0]!, this.held.position.y - position[1]!, this.held.position.z - position[2]!];
        return [box[0]! + dx, box[1]! + dy, box[2]! + dz, box[3]! + dx, box[4]! + dy, box[5]! + dz];
    }

    /**
     * The tick's seed with the prediction in it: every carried field as the engine's last tick left it, but for those a
     * packet of this row changed, which the seed has from vanilla at the tick's start.
     */
    seed(state: NativeSimulationState, row: Pick<ExpandedRow, 't' | 's2c'>): void {
        if (!this.held) {
            this.reseeds.push({ t: row.t, why: this.cause ?? 'unknown' });
            this.cause = undefined;
            return;
        }
        const taken = new Set<string>();
        for (const packet of row.s2c) {
            const owned = Object.keys(packet.after ?? {}).filter(field => (CARRIED as readonly string[]).includes(BY_RECORDED.get(field) ?? ''));
            if (owned.length === 0) continue;
            for (const field of owned) taken.add(BY_RECORDED.get(field)!);
            this.corrections.push({
                t: row.t, packet: packet.name, fields: owned,
                ...(owned.includes('pos') ? { predicted: vec(this.held.position), vanilla: vec(state.position) } : {}),
            });
        }
        const out = state as unknown as Record<string, unknown>;
        const held = this.held as unknown as Record<string, unknown>;
        for (const key of CARRIED) {
            if (taken.has(key)) continue;
            if (held[key] === undefined) delete out[key];
            else out[key] = held[key];
        }
    }

    /** What the tick left, against vanilla's state where the tick ends. */
    keep(after: NativeSimulationState, expected: Snapshot, t: number, diverged: boolean): void {
        this.held = after;
        const position = gap(vec(after.position), expected.pos as number[]);
        const velocity = gap(vec(after.velocity), expected.vel as number[]);
        this.finalPosition = position;
        this.finalVelocity = velocity;
        this.maxPosition = Math.max(this.maxPosition, position);
        this.maxVelocity = Math.max(this.maxVelocity, velocity);
        if (diverged && this.firstTick === undefined) {
            this.firstTick = t;
            this.firstPosition = position;
        }
    }

    report(): Drift {
        return {
            ...(this.firstTick === undefined ? {} : { firstTick: this.firstTick }),
            firstPosition: this.firstPosition, maxPosition: this.maxPosition, maxVelocity: this.maxVelocity,
            finalPosition: this.finalPosition, finalVelocity: this.finalVelocity,
        };
    }
}
