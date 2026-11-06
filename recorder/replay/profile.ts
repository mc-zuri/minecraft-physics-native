// Where a replay's time and memory go, stage by stage, on chosen recordings: the measurements a change to the replay is held to.
//
//   node recorder/replay/profile.ts --version 26.3 --case "physrec/j_*" [--repeat 3] [--json report.json] [--budget recorder/replay/profile-budget.json --set small]
//
// Each recording is run --repeat times; the first is the cold run of its registry and world mapping, the later ones warm.
//
// --budget holds the run to a set of the budget file: the warm replay's CPU milliseconds per row and peak memory, each within the
// file's allowance of its baseline, at --repeat 3 as the baselines were. CPU and not the clock, which moved by more than half
// between two runs of one recording on a shared machine; per row and warm, so that the selection's size and the first run's caches
// do not count.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { idMatcher } from '../scenarios/build.ts';
import { overBudget, type ProfileBudget } from './profile-budget.ts';
import { replayIdentity } from '../runner/provenance.ts';
import { replayNative, worldSync } from './engine.ts';
import { parseRecording } from './load.ts';
import { findRecordings, recordingsRoot, RECORDER_ROOT } from './recordings.ts';

const { values } = parseArgs({ options: { version: { type: 'string' }, case: { type: 'string' }, repeat: { type: 'string', default: '3' }, json: { type: 'string' }, budget: { type: 'string' }, set: { type: 'string' } } });
const matches = idMatcher(values.case);
const files = findRecordings(recordingsRoot(), values.version ? values.version.split(',') : undefined).filter(f => matches(f.id));
if (files.length === 0) {
    console.error('no recordings match');
    process.exit(1);
}
const STAGES = ['read', 'decompress', 'parse', 'world', 'replay'] as const;
type Stage = (typeof STAGES)[number];
const timed = <T>(run: () => T): [T, number] => {
    const from = performance.now();
    const out = run();
    return [out, performance.now() - from];
};
const quantile = (sorted: readonly number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
const repeat = Number(values.repeat);
const samples: Record<'cold' | 'warm', Record<Stage, number[]>> = {
    cold: { read: [], decompress: [], parse: [], world: [], replay: [] },
    warm: { read: [], decompress: [], parse: [], world: [], replay: [] },
};
let ticks = 0;
let bytes = 0;
let peakRss = 0;
let peakHeap = 0;
// (the replay's CPU, warm: what the budget holds, as wall time on a shared machine moves with the other work on it)
let cpuMs = 0;
for (const file of files) {
    for (let run = 0; run < repeat; run += 1) {
        await new Promise(resolve => setImmediate(resolve));
        const [raw, read] = timed(() => readFileSync(file.file));
        const [text, decompress] = timed(() => gunzipSync(raw).toString('utf8'));
        const [recording, parse] = timed(() => parseRecording(text));
        const [, world] = timed(() => worldSync(recording));
        const cpuBefore = process.cpuUsage();
        const [result, replay] = timed(() => replayNative(recording));
        if (run > 0) {
            const used = process.cpuUsage(cpuBefore);
            cpuMs += (used.user + used.system) / 1000;
        }
        const into = samples[run === 0 ? 'cold' : 'warm'];
        into.read.push(read);
        into.decompress.push(decompress);
        into.parse.push(parse);
        into.world.push(world);
        into.replay.push(replay);
        if (run === 0) {
            ticks += result.ticks;
            bytes += raw.length;
        }
        const memory = process.memoryUsage();
        peakRss = Math.max(peakRss, memory.rss);
        peakHeap = Math.max(peakHeap, memory.heapUsed);
    }
}
const summary = Object.fromEntries((['cold', 'warm'] as const).map(kind => [kind, Object.fromEntries(STAGES.map(stage => {
    const sorted = [...samples[kind][stage]].sort((a, b) => a - b);
    return [stage, { total: sorted.reduce((a, b) => a + b, 0), median: quantile(sorted, 0.5), p95: quantile(sorted, 0.95), max: sorted.at(-1) ?? 0 }];
}))]));
const report = { recordings: files.length, ticks, bytes, repeat, peakRssMb: peakRss / 2 ** 20, peakHeapMb: peakHeap / 2 ** 20, summary, replay: replayIdentity(RECORDER_ROOT) };
for (const kind of ['cold', 'warm'] as const) {
    console.log(kind);
    for (const stage of STAGES) {
        const s = summary[kind]![stage]!;
        console.log(`  ${stage.padEnd(11)} total ${s.total.toFixed(1).padStart(9)} ms  median ${s.median.toFixed(2).padStart(8)}  p95 ${s.p95.toFixed(2).padStart(8)}  max ${s.max.toFixed(2).padStart(8)}`);
    }
}
console.log(`${files.length} recording(s), ${ticks} rows, ${bytes} bytes; peak rss ${report.peakRssMb.toFixed(0)} MB, heap ${report.peakHeapMb.toFixed(0)} MB`);
const perRow = cpuMs / Math.max(1, ticks * (repeat - 1));
console.log(`warm replay ${perRow.toFixed(3)} ms of CPU a row (${(summary.warm!.replay!.total / Math.max(1, ticks * (repeat - 1))).toFixed(3)} of the clock)`);
if (values.json) writeFileSync(values.json, JSON.stringify({ ...report, perRow }, null, 1));
if (values.budget) {
    const budget = JSON.parse(readFileSync(values.budget, 'utf8')) as ProfileBudget;
    const problems = overBudget(budget, values.set ?? '', { perRow, peakRssMb: report.peakRssMb });
    for (const problem of problems) console.log(`over budget: ${problem}`);
    process.exitCode = problems.length > 0 ? 1 : 0;
}
