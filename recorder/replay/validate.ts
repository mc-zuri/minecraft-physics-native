// Whether a recording is what it says it is, before anything is concluded from it: its identity, its ticks, and the
// fields of every snapshot. A replay that matched a misfiled, cut short or hollow recording would prove nothing, and the
// seed's defaults make a missing field look like a matching one.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PLAYER_FIELDS, type FieldSpec } from '../schema/fields.ts';
import { PLAYER_PHASES } from '../schema/phases.ts';
import { inRange } from '../scenarios/dsl/names.ts';
import { RECORDER_ROOT } from './recordings.ts';
import type { Recording, Snapshot } from '../schema/recording.ts';

const require = createRequire(import.meta.url);

/** What a snapshot may leave out: no block under the player, no vehicle. */
const OPTIONAL = new Set(['mainSupportingBlockPos', 'vehicle']);

const fieldsOf = (version: string) => Object.entries(PLAYER_FIELDS as Record<string, FieldSpec>).filter(([, spec]) => inRange(version, spec.versions));

const numeric = (v: unknown) => typeof v === 'number' || v === 'NaN' || v === '+Inf' || v === '-Inf';

function fits(spec: FieldSpec, value: unknown): boolean {
    switch (spec.type) {
        case 'f64': case 'f32': case 'i32': return numeric(value);
        case 'bool': return typeof value === 'boolean';
        case 'vec3': return Array.isArray(value) && value.length === 3 && value.every(numeric);
        case 'aabb': return Array.isArray(value) && value.length === 6 && value.every(numeric);
        case 'blockpos': return value === null || (Array.isArray(value) && value.length === 3 && value.every(v => typeof v === 'number'));
        case 'enum': case 'string': return typeof value === 'string';
        default: return true;
    }
}

function snapshotProblems(state: Snapshot, fields: readonly [string, FieldSpec][]): string | undefined {
    const missing = fields.filter(([key]) => !(key in state) && !OPTIONAL.has(key)).map(([key]) => key);
    if (missing.length > 0) return `a snapshot lacks ${missing.join(', ')}`;
    const wrong = fields.filter(([key, spec]) => key in state && state[key] !== null && !fits(spec, state[key])).map(([key]) => key);
    return wrong.length > 0 ? `a snapshot has a wrong ${wrong.join(', ')}` : undefined;
}

const hashes = new Map<string, Map<string, string>>();

/** The scenarios compiled for a release, by id, with their hashes; none when it was not compiled here. */
function compiled(version: string): Map<string, string> | undefined {
    if (!hashes.has(version)) {
        let found = new Map<string, string>();
        try {
            const index = JSON.parse(readFileSync(join(RECORDER_ROOT, 'out', 'scenarios', version, 'index.json'), 'utf8')) as { scenarios: { id: string; hash: string }[] };
            found = new Map(index.scenarios.map(s => [s.id, s.hash]));
        } catch { /* nothing to compare with */ }
        hashes.set(version, found);
    }
    const found = hashes.get(version)!;
    return found.size > 0 ? found : undefined;
}

/** The ticks a body cannot finish in less than: what it holds for a fixed time. */
function leastTicks(recording: Recording): number {
    let total = 0;
    for (const step of recording.header.body) {
        if (step.op === 'server' && step.action.op === 'kick') break;
        if (step.op === 'press' || step.op === 'turn' || step.op === 'ticks') total += step.ticks;
    }
    return total;
}

/** Everything wrong with a recording filed as `version`/`id`; `current`: its scenario must be the one compiled now. */
export function validateRecording(recording: Recording, version: string, id: string, current = false): string[] {
    const { header, rows, footer } = recording;
    const problems: string[] = [];
    if (header.mc !== version) problems.push(`recorded on ${header.mc}, filed under ${version}`);
    if (header.scenario.id !== id) problems.push(`scenario ${header.scenario.id}, filed as ${id}`);
    const data = require('minecraft-data')(header.mc) as { version: { version: number } } | undefined;
    if (data && data.version.version !== header.protocol) problems.push(`protocol ${header.protocol}, ${header.mc} has ${data.version.version}`);
    if (header.provenance !== undefined && (typeof header.provenance.id !== 'string' || header.provenance.release !== version)) problems.push(`its provenance is for ${String(header.provenance.release)}`);
    if (current) {
        const hash = compiled(version)?.get(id);
        if (compiled(version) && hash === undefined) problems.push('its scenario is not compiled for this release');
        else if (hash !== undefined && hash !== header.scenario.hash) problems.push('recorded from another version of its scenario');
    }
    if (footer.status !== 'ok') problems.push(`status ${footer.status}: ${footer.reason}`);
    if (header.phases.join() !== PLAYER_PHASES.join()) problems.push('the header phases differ from phases.ts');
    const fields = fieldsOf(header.mc);
    if (JSON.stringify([...(header.fields ?? [])].sort()) !== JSON.stringify(fields.map(([key]) => key).sort())) {
        problems.push('the header does not list every field of fields.ts');
    }
    if (rows.length === 0) problems.push('no rows');
    rows.forEach((row, i) => {
        if (i > 0 && row.t !== rows[i - 1]!.t + 1) problems.push(`tick ${row.t} follows ${rows[i - 1]!.t}`);
    });
    if (footer.status === 'ok' && rows.length < leastTicks(recording)) problems.push(`${rows.length} rows of a body of at least ${leastTicks(recording)} ticks`);
    for (const row of rows) {
        for (const state of [row.pre, row.post, ...row.phases.map(p => p.state)]) {
            const problem = snapshotProblems(state, fields);
            if (problem) {
                problems.push(`t=${row.t}: ${problem}`);
                return problems;
            }
        }
    }
    return problems;
}
