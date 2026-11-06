// A randomized campaign against vanilla: generate from a seed, record each case twice, replay it, and shrink what fails by
// recording smaller cases until no step can go.
//
//   node recorder/replay/random-run.ts --version 26.3 --seed 7 --count 20 --work <dir> [--engine 1.21.4] [--shards 2] [--shrink 3]
//
// --engine replays by another release's rules: a defect put there on purpose, to show that the campaign finds and shrinks one.
// It is judged by the path alone: another gate of that release can differ in a field on every tick, whatever the case does, and
// a shrink that keeps such a difference drops every step and shows nothing.
// The saved specs, recordings and report stay in --work. Rebuild the scenarios afterwards (scenarios/build.ts): these are in
// the compiled index only for this run.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { generate, shrinkCandidates, type RandomSpec } from '../scenarios/random.ts';
import { replayNative } from './engine.ts';
import { firstDifference } from './differential.ts';
import { loadRecording } from './load.ts';
import { RECORDER_ROOT } from './recordings.ts';
import { validateRecording } from './validate.ts';

const { values } = parseArgs({ options: {
    version: { type: 'string', default: '26.3' }, seed: { type: 'string', default: '1' }, count: { type: 'string', default: '10' },
    work: { type: 'string' }, engine: { type: 'string' }, shards: { type: 'string', default: '2' }, shrink: { type: 'string', default: '3' },
} });
if (!values.work) {
    console.error('--work <dir> says where the campaign keeps its cases');
    process.exit(2);
}
const version = values.version;
const work = values.work;
const seed = Number(values.seed);
mkdirSync(work, { recursive: true });

/** Records the specs into `out`: vanilla, through the ordinary runner. */
function record(specs: readonly RandomSpec[], out: string): void {
    const cases = join(work, `cases-${Date.now()}.json`);
    writeFileSync(cases, JSON.stringify(specs));
    const run = spawnSync(process.execPath, [join(RECORDER_ROOT, 'runner', 'record.ts'), '--version', version, '--shards', values.shards, '--filter', 'physrec/rnd_*', '--out', out],
        { env: { ...process.env, RANDOM_CASES: cases }, encoding: 'utf8', maxBuffer: 1 << 28 });
    console.log(run.stdout.split('\n').filter(line => line.startsWith('run: ') && line.includes('scenario(s)')).at(-1) ?? `record.ts ended ${run.status}`);
}

const fileOf = (out: string, id: string) => join(out, version, 'physrec', `${id}.jsonl.gz`);

type Outcome = 'compared' | 'different' | 'invalid' | 'unsupported' | 'nondeterministic' | 'missing';

function judge(spec: RandomSpec, first: string, second?: string): { outcome: Outcome; tick?: number; field?: string } {
    if (!existsSync(fileOf(first, spec.id))) return { outcome: 'missing' };
    const recording = loadRecording(fileOf(first, spec.id));
    if (validateRecording(recording, version, `physrec/${spec.id}`).length > 0) return { outcome: 'invalid' };
    if (second) {
        if (!existsSync(fileOf(second, spec.id))) return { outcome: 'missing' };
        if (firstDifference(recording, loadRecording(fileOf(second, spec.id))) !== undefined) return { outcome: 'nondeterministic' };
    }
    const result = replayNative(recording, { ...(values.engine ? { engine: values.engine } : {}) });
    if (result.compared === 0) return { outcome: 'unsupported' };
    const onPath = (field: string) => field === 'pos' || field === 'vel';
    const found = values.engine ? result.results.flatMap(r => r.divergences).find(d => onPath(d.field)) : result.first;
    if (result.problems.length > 0 || found) return { outcome: 'different', ...(found ? { tick: found.tick, field: found.field } : {}) };
    return { outcome: 'compared' };
}

const specs = generate(seed, Number(values.count));
writeFileSync(join(work, 'specs.json'), JSON.stringify(specs, null, 1));
const [first, second] = [join(work, 'first'), join(work, 'second')];
record(specs, first);
record(specs, second);
const tally: Record<Outcome, number> = { compared: 0, different: 0, invalid: 0, unsupported: 0, nondeterministic: 0, missing: 0 };
const failing: { spec: RandomSpec; tick?: number; field?: string }[] = [];
for (const spec of specs) {
    const judged = judge(spec, first, second);
    tally[judged.outcome] += 1;
    if (judged.outcome === 'different') failing.push({ spec, ...judged });
}
console.log(`seed ${seed}: ${specs.length} generated, ${Object.entries(tally).map(([k, n]) => `${n} ${k}`).join(', ')}`);

const shrunk: unknown[] = [];
for (const { spec, tick, field } of failing.slice(0, Number(values.shrink))) {
    let smallest = spec;
    let round = 0;
    for (;;) {
        round += 1;
        const candidates = shrinkCandidates(smallest);
        if (candidates.length === 0) break;
        const out = join(work, `shrink-${spec.id}-${round}`);
        record(candidates, out);
        const smaller = candidates.find(candidate => judge(candidate, out).outcome === 'different');
        if (!smaller) break;
        smallest = smaller;
    }
    console.log(`${spec.id}: ${spec.steps.length} steps (t=${tick} ${field}) shrunk to ${smallest.id}, ${smallest.steps.length} steps: ${JSON.stringify(smallest.steps)}`);
    shrunk.push({ from: spec.id, steps: spec.steps.length, to: smallest });
}
writeFileSync(join(work, 'report.json'), JSON.stringify({ version, seed, count: specs.length, engine: values.engine ?? null, tally, failing: failing.map(f => f.spec.id), shrunk }, null, 1));
