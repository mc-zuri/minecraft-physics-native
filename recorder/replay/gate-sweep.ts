// What a moved version gate does to the replays of the release it moves (scripts/gate-mutants.cjs builds the addon).
//
//   NAPI_RS_NATIVE_LIBRARY_PATH=<mutation .node> node recorder/replay/gate-sweep.ts --addon <mutation .node> --sites <sites.json> --version 1.21.5 --out <file.jsonl>
//       [--case "physrec/*"] [--cap 60] [--worker 0/1] [--wide]
//
// One pass with no mutant finds which recordings match and which gates each one runs. Then every gate with this release
// beside its boundary is flipped on this release alone, and only the recordings that run it replay, until one stops
// matching. Lines already in --out are not done again, so a killed sweep goes on from there. A mutant that matches all it
// ran is a gate nothing here tells apart: `cap` says if it ran fewer recordings than reach the gate.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { idMatcher } from '../scenarios/build.ts';
import { nativeBinding, replayNative } from './engine.ts';
import { loadRecording } from './load.ts';
import { replayMovingEntities } from './moving-entities.ts';
import { replayProjectiles } from './projectile.ts';
import { findRecordings, recordingsRoot } from './recordings.ts';
import { validateRecording } from './validate.ts';

const require = createRequire(import.meta.url);
const { values } = parseArgs({
    options: {
        addon: { type: 'string' },
        sites: { type: 'string' },
        version: { type: 'string' },
        out: { type: 'string' },
        case: { type: 'string' },
        cap: { type: 'string', default: '60' },
        sample: { type: 'string', default: '1' },
        worker: { type: 'string', default: '0/1' },
        'only-sites': { type: 'string' },
        // every recording's moving entities and projectiles too, not only those of their own families
        wide: { type: 'boolean', default: false },
    },
});
// (the imports above load the engine, so it is named before they run: anything else leaves the mutants flipping a copy nobody calls)
if (process.env.NAPI_RS_NATIVE_LIBRARY_PATH !== values.addon) throw new Error('set NAPI_RS_NATIVE_LIBRARY_PATH to --addon');
const probe = require(values.addon!) as { gateProbeDrain(): number[]; gateProbeSet(site: number, release: string): void };
const sites = JSON.parse(readFileSync(values.sites!, 'utf8')) as { site: number; firstFrom: string | null; lastBefore: string | null }[];
const version = values.version!;
const out = values.out!;
const cap = Number(values.cap);
const [worker, workers] = values.worker!.split('/').map(Number) as [number, number];
const only = values['only-sites'] ? new Set(values['only-sites'].split(',').map(Number)) : null;

const matches = idMatcher(values.case);
// (--sample n: every nth recording of each family of ids, so that a small family keeps one)
const seen = new Map<string, number>();
const files = findRecordings(recordingsRoot(), [version]).filter(f => matches(f.id)).filter((f) => {
    const family = /^[^_]*/.exec(f.id)![0];
    const n = seen.get(family) ?? 0;
    seen.set(family, n + 1);
    return n % Number(values.sample) === 0;
});

/** Does this recording match, as `cli.ts` would call it: the player, its moving entities, its projectiles. */
function agrees(file: string, id: string): boolean {
    const recording = loadRecording(file);
    if (validateRecording(recording, version, id, true).length > 0) return false;
    if (values.wide || /^physrec\/(me_|mc_|pb_)/.test(id)) {
        const moved = replayMovingEntities(recording, nativeBinding(), 'server');
        if (moved.problems.length > 0 || moved.first) return false;
    }
    if (values.wide || /^physrec\/pj_/.test(id)) {
        const shot = replayProjectiles(recording);
        if (shot.first) return false;
    }
    const result = replayNative(recording, { mode: 'stepwise', phases: true });
    return result.problems.length === 0 && !result.first;
}

const covering = new Map<number, { file: string; id: string; reach: number }[]>();
const started = Date.now();
let ok = 0;
for (const f of files) {
    await new Promise(resolve => setImmediate(resolve));
    probe.gateProbeDrain();
    let matched = false;
    try {
        matched = agrees(f.file, f.id);
    } catch (error) {
        console.log(`baseline threw on ${f.id}: ${String(error).slice(0, 160)}`);
    }
    const hits = probe.gateProbeDrain();
    if (!matched) {
        console.log(`baseline differs on ${f.id}`);
        continue;
    }
    ok += 1;
    for (const site of hits) {
        const list = covering.get(site) ?? [];
        list.push({ file: f.file, id: f.id, reach: hits.length });
        covering.set(site, list);
    }
}
if (covering.size === 0 && ok > 0) throw new Error('no gate ran: the replay is not on the mutation addon');
console.log(`${version}: ${ok} of ${files.length} recordings match in ${Math.round((Date.now() - started) / 1000)}s`);

const done = new Set<number>();
if (existsSync(out)) {
    for (const line of readFileSync(out, 'utf8').split('\n')) {
        if (!line) continue;
        const entry = JSON.parse(line) as { site: number; release: string };
        if (entry.release === version) done.add(entry.site);
    }
}
const mutants = sites.filter(s => (s.firstFrom === version || s.lastBefore === version) && !done.has(s.site) && (only?.has(s.site) ?? true) && s.site % workers === worker);
for (const { site } of mutants) {
    // the recordings that run the fewest gates say the most about any one of them
    const reach = (covering.get(site) ?? []).toSorted((a, b) => a.reach - b.reach);
    const chosen = reach.slice(0, cap);
    let killedBy: string | undefined;
    let ran = 0;
    probe.gateProbeSet(site, version);
    for (const c of chosen) {
        await new Promise(resolve => setImmediate(resolve));
        ran += 1;
        try {
            if (!agrees(c.file, c.id)) killedBy = c.id;
        } catch (error) {
            killedBy = `${c.id} (threw ${String(error).slice(0, 80)})`;
        }
        if (killedBy) break;
    }
    probe.gateProbeSet(-1, version);
    appendFileSync(out, `${JSON.stringify({ site, release: version, reaching: reach.length, ran, killedBy })}\n`);
}
console.log(`${version}: ${mutants.length} mutants done in ${Math.round((Date.now() - started) / 1000)}s`);
