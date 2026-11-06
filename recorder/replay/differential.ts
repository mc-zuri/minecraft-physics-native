// Version-to-version differences: for each gate, a case the source says changes and a control it says does not. Each side is
// held to its own release's vanilla first; only then does their difference mean anything. The newer recording replayed by the
// older release's rules must fail on the changed case, which is what a profile shared by accident would look like, and the
// control must not.
//
//   node recorder/replay/differential.ts [--gate "1.21.5 horizontal cutoff"] [--json report.json]
//
// Evidence here is executed: two vanilla recordings of the same scenario. A gate with no recording of a side is `unavailable`,
// and a neighbour's never stands in for it.

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Recording } from '../schema/recording.ts';
import { replayNative, type ReplayResult } from './engine.ts';
import { loadRecording } from './load.ts';
import { recordingsRoot } from './recordings.ts';

export interface Gate {
    readonly gate: string;
    readonly older: string;
    readonly newer: string;
    /** A case whose vanilla runs differ across the gate, and one whose runs do not. */
    readonly changed: string;
    readonly control: string;
    /** The vanilla change, and the engine's gate for it. */
    readonly source: string;
    readonly engine: string;
}

export const GATES: readonly Gate[] = [
    {
        gate: '1.21 step candidates', older: '1.20.6', newer: '1.21', changed: 'physrec/g_step_sprint_lantern', control: 'physrec/bt_air_down_inside',
        source: 'Entity.collectCandidateStepUpHeights, new in 1.21 (1.21 Entity.java collide)', engine: 'collision.rs collide_with_world, the release gate of 1.21',
    },
    {
        gate: '1.21.5 horizontal cutoff', older: '1.21.4', newer: '1.21.5', changed: 'physrec/cf_cut_two_small_components', control: 'physrec/cf_cut_one_small_component',
        source: 'Player-only radial cutoff of LivingEntity.aiStep (1.21.5 LivingEntity.java)', engine: 'simulation.rs: is_player && at_least(1, 21, 5)',
    },
    {
        gate: '1.21.9 block traversal', older: '1.21.8', newer: '1.21.9', changed: 'physrec/bt_air_up_inside', control: 'physrec/bt_air_down_inside',
        source: 'Entity.applyEffectsFromBlocks and its movement list (1.21.9 Entity.java)', engine: 'block_traversal.rs and movements_this_tick, the 1.21.9 gate',
    },
    {
        gate: '26.3 restitution and queries', older: '26.2', newer: '26.3', changed: 'physrec/cf_slime_landing_at_gravity', control: 'physrec/cf_slime_landing_over_gravity',
        source: 'Entity restitution: -y <= gravity rests from 26.3, -y < gravity before (26.2 Entity.java:874-881, 26.3 :905-911)', engine: 'simulation.rs restitute_movement_after_collisions, at_least(26, 3, 0)',
    },
];

export interface GateResult {
    readonly gate: string;
    /** unavailable: a side has no recording. */
    readonly status: 'held' | 'broken' | 'unavailable';
    readonly problems: readonly string[];
    readonly firstDifference?: number;
}

const movesApart = (result: ReplayResult) => result.results.some(r => r.divergences.some(d => d.field === 'pos' || d.field === 'vel'));
const trajectory = (r: Recording) => r.rows.map(row => [row.post.pos, row.post.vel]);

/** The first row two recordings of a scenario differ on in position or motion, or nothing. */
export function firstDifference(a: Recording, b: Recording): number | undefined {
    const [x, y] = [trajectory(a), trajectory(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) if (JSON.stringify(x[i]) !== JSON.stringify(y[i])) return i;
    return undefined;
}

export function checkGate(gate: Gate, root: string): GateResult {
    const path = (version: string, id: string) => join(root, version, `${id}.jsonl.gz`);
    const needed = [path(gate.older, gate.changed), path(gate.newer, gate.changed), path(gate.older, gate.control), path(gate.newer, gate.control)];
    const missing = needed.filter(file => !existsSync(file));
    if (missing.length > 0) return { gate: gate.gate, status: 'unavailable', problems: missing.map(file => `no recording ${file}`) };
    const problems: string[] = [];
    const [oldChanged, newChanged, oldControl, newControl] = needed.map(file => loadRecording(file)) as [Recording, Recording, Recording, Recording];
    if (oldChanged.header.scenario.hash !== newChanged.header.scenario.hash) problems.push(`${gate.changed} was not one scenario on both sides`);
    // each side against its own vanilla, first
    for (const recording of [oldChanged, newChanged, oldControl, newControl]) {
        const own = replayNative(recording);
        if (own.first || own.compared === 0) problems.push(`${recording.header.mc}/${recording.header.scenario.id} does not match its own vanilla`);
    }
    const difference = firstDifference(oldChanged, newChanged);
    if (difference === undefined) problems.push(`${gate.changed} runs the same on both sides: it selects no changed branch`);
    if (firstDifference(oldControl, newControl) !== undefined) problems.push(`${gate.control} differs across the gate`);
    // a profile shared across the gate by accident: the older rules, on the newer vanilla
    // (by the trajectory alone: a gate is one change, and another of the same release can move another field)
    if (!movesApart(replayNative(newChanged, { engine: gate.older }))) problems.push(`the ${gate.older} rules keep ${gate.newer}'s ${gate.changed} on its path: this case cannot see the gate`);
    if (movesApart(replayNative(newControl, { engine: gate.older }))) problems.push(`the ${gate.older} rules move ${gate.newer}'s control off its path: it is no control`);
    return { gate: gate.gate, status: problems.length > 0 ? 'broken' : 'held', problems, ...(difference === undefined ? {} : { firstDifference: difference }) };
}

if (process.argv[1]?.endsWith('differential.ts')) {
    const { values } = parseArgs({ options: { gate: { type: 'string' }, json: { type: 'string' } } });
    const results = GATES.filter(g => !values.gate || g.gate === values.gate).map(gate => checkGate(gate, recordingsRoot()));
    for (const r of results) {
        console.log(`${r.status.padEnd(12)} ${r.gate}${r.firstDifference === undefined ? '' : ` (the sides part at row ${r.firstDifference})`}`);
        for (const problem of r.problems) console.log(`    ${problem}`);
    }
    if (values.json) writeFileSync(values.json, JSON.stringify(results, null, 1));
    process.exitCode = results.some(r => r.status === 'broken') ? 1 : 0;
}
