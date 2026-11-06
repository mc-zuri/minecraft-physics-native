// The native layer's intermediate phases: where the tick's endpoint can agree by accident (two errors that cancel), the
// engine's trace (simulateVersionedTickTraced, native/src/phase.rs) is compared with vanilla's snapshot at each point of the
// tick both have, by name and occurrence (schema/phases.ts). Only what the engine holds at that point is compared: the
// fields of PHASE_FIELDS. A phase vanilla recorded that the engine did not pass, or the reverse, is a problem and not an
// empty comparison.

import type { NativeSimulationState, NativeTickPhase } from '../../dist/native.js';
import { inRange } from '../scenarios/dsl/names.ts';
import { NATIVE_SIM, PLAYER_FIELDS } from '../schema/fields.ts';
import { NATIVE_PHASES, PHASES, type PhaseName } from '../schema/phases.ts';
import type { ExpandedRow, Snapshot } from '../schema/recording.ts';
import { compareNative, type Divergence } from './compare.ts';
import { toNative, type SeedContext } from './seed.ts';

const MOTION = ['position', 'velocity'] as const;
const FLUIDS = ['inWater', 'inLava'] as const;
const CONTACT = ['onGround', 'collidedHorizontally', 'collidedVertically', 'verticalCollisionBelow'] as const;

/** The native fields compared at each phase: what both sides hold there. */
export const PHASE_FIELDS: Readonly<Record<PhaseName, readonly string[]>> = {
    tickStart: MOTION,
    afterBaseTick: [...MOTION, ...FLUIDS, 'fallDistance'],
    afterInput: [],
    beforeLivingAiStep: [...MOTION, ...FLUIDS],
    beforeTravel: [...MOTION, ...FLUIDS],
    beforeMove: [...MOTION, ...FLUIDS],
    afterMove: [...MOTION, ...CONTACT, 'fallDistance'],
    afterTravel: [...MOTION, ...CONTACT, 'fallDistance'],
    afterAiStep: [...MOTION, ...CONTACT, ...FLUIDS, 'fallDistance'],
    beforeSend: [],
    tickEnd: [],
    clientTickEnd: MOTION,
};

/** What the tick's input left for travel, recorded fields held to what the trace gives at beforeTravel: the travel vector after
 * its *0.98 (LivingEntity.aiStep), and the jump the auto-jump may have pressed. */
const TRAVEL_FIELDS: readonly (readonly [string, (vector: NativeTickPhase['travelVector'], state: NativeSimulationState) => unknown])[] = [
    ['xxa', vector => vector?.x],
    ['yya', vector => vector?.y],
    ['zza', vector => vector?.z],
    ['jumping', (_vector, state) => state.jumpRequested],
];

export interface PhaseComparison {
    readonly compared: number;
    /** Compared values by "<phase>.<field>", as a coverage report counts them. */
    readonly counts: Readonly<Record<string, number>>;
    readonly divergences: readonly Divergence[];
    readonly problems: readonly string[];
}

/** What this tick asks of the comparison. */
export interface PhaseContext {
    /** A removed entity's tick returns before it starts (from 1.19.1, simulation.rs). */
    readonly noTravel: boolean;
    /** The fields this tick leaves out at every phase, each for a reason the caller states. */
    readonly skip?: ReadonlySet<string>;
    /** The phases the tick leaves out, by name. */
    readonly skipPhases?: ReadonlySet<string>;
}

/** Whether the release has the recorded field a native field is compared with: one it lacks has no value of vanilla's to compare. */
function inRelease(key: string, version: string): boolean {
    const map = (NATIVE_SIM as unknown as Record<string, { from?: unknown }>)[key];
    const spec = typeof map?.from === 'string' ? (PLAYER_FIELDS as Record<string, { versions?: string }>)[map.from] : undefined;
    return !spec || inRange(version, spec.versions);
}

/** The head or the tail of a vehicle's move in the engine (simulateVersioned*TickTraced). */
export type VehicleMove = Readonly<{ name: string; position: Vec3Like; velocity: Vec3Like }>;
type Vec3Like = Readonly<{ x: number; y: number; z: number }>;

/** The ridden vehicle's moves inside its tick (Entity.move's head and tail), against the engine's, each by its motion and place:
 * a tick that ends in the same place by another way is told apart. What moved another number of times than vanilla is a problem,
 * not a match. Older recordings have no such phases, and `recorded` says so. */
export function compareVehicleMove(row: Pick<ExpandedRow, 't' | 'vehiclePhases'>, moves: readonly VehicleMove[], recorded: boolean): { divergences: Divergence[]; problems: string[] } {
    if (!recorded) return { divergences: [], problems: [] };
    if (row.vehiclePhases.length !== moves.length) return { divergences: [], problems: [`t=${row.t}: the vehicle's move has ${row.vehiclePhases.length} points in vanilla and ${moves.length} in the engine`] };
    const divergences: Divergence[] = [];
    row.vehiclePhases.forEach(({ name, state }, index) => {
        const move = moves[index]!;
        if (name.split('#')[0] !== move.name) {
            divergences.push({ tick: row.t, at: name, source: 'native', field: 'vehicle.phase', expected: name, actual: move.name });
            return;
        }
        for (const [field, want, got] of [['pos', state.pos, move.position], ['vel', state.vel, move.velocity]] as const) {
            const [x, y, z] = want as number[];
            const same = Object.is(x, got.x) && Object.is(y, got.y) && Object.is(z, got.z);
            if (!same) divergences.push({ tick: row.t, at: name, source: 'native', field: `vehicle.${field}`, expected: [x, y, z], actual: [got.x, got.y, got.z] });
        }
    });
    return { divergences, problems: [] };
}

export function comparePhases(traced: readonly NativeTickPhase[], row: Pick<ExpandedRow, 't' | 'phases' | 'post'>, seed: SeedContext, context: PhaseContext): PhaseComparison {
    const divergences: Divergence[] = [];
    const problems: string[] = [];
    const counts: Record<string, number> = {};
    let compared = 0;
    for (const name of NATIVE_PHASES) {
        if (context.skipPhases?.has(name)) continue;
        // (the end of the client's tick is the row's post: the mod takes no phase there)
        const vanilla = name === 'clientTickEnd' ? [{ name, state: row.post }] : row.phases.filter(p => p.name === name);
        const native = traced.filter(p => p.name === name);
        if (vanilla.length !== native.length || (vanilla.length === 0 && PHASES[name].essential)) {
            // (a tick that ends before it travels has nothing for what it never reached)
            if (context.noTravel) continue;
            const side = vanilla.length === native.length ? `neither side passed ${name}`
                : vanilla.length === 0 ? `vanilla has no ${name}`
                    : native.length === 0 ? `the engine did not pass ${name}`
                        : `${name} ran ${vanilla.length} times in vanilla and ${native.length} in the engine`;
            problems.push(`t=${row.t}: ${side}`);
            continue;
        }
        const fields = PHASE_FIELDS[name].filter(f => !context.skip?.has(f) && inRelease(f, seed.version));
        if (fields.length === 0) continue;
        const keep = new Set<string>(fields);
        const table = Object.fromEntries(Object.entries(NATIVE_SIM as unknown as Record<string, object>).filter(([key]) => keep.has(key)));
        for (let i = 0; i < vanilla.length; i += 1) {
            const at: Snapshot = vanilla[i]!.state;
            const want = toNative(at, at, seed) as unknown as Record<string, unknown>;
            const label = vanilla.length > 1 ? `${name}#${i}` : name;
            divergences.push(...compareNative(want, native[i]!.state as unknown as Record<string, unknown>, { tick: row.t, at: label, source: 'native' }, new Set(), table));
            compared += fields.length;
            for (const field of fields) counts[`${name}.${field}`] = (counts[`${name}.${field}`] ?? 0) + 1;
            if (name === 'beforeTravel') {
                const { travelVector, state } = native[i]!;
                const held = TRAVEL_FIELDS.map(([field, value]) => [field, value(travelVector, state)] as const).filter(([field]) => at[field] !== undefined && !context.skip?.has(field));
                for (const [field, actual] of held) {
                    if (!Object.is(at[field], actual)) divergences.push({ tick: row.t, at: label, source: 'native', field, expected: at[field], actual });
                    counts[`${name}.${field}`] = (counts[`${name}.${field}`] ?? 0) + 1;
                }
                compared += held.length;
            }
        }
    }
    return { compared, counts, divergences, problems };
}
