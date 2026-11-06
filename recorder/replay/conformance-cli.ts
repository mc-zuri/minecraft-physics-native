// The strict gate of a release.
//
//   node recorder/replay/conformance-cli.ts pin --version 26.3 [--exclusions file.json] [--manifest file.json]
//   node recorder/replay/conformance-cli.ts check --version 26.3 [--case "glob"] [--continuous] [--phases] [--regression file.json]
//       [--manifest file.json] [--json report.json]
//
// `pin` writes recorder/corpus/<version>.json from the recordings as they stand. `check` replays what the manifest selects
// and decides; it exits 0 only on `complete`, or `clean-subset` for a --case selection, which it says certifies nothing.
// --regression is { "primitive": { source, passed, failed }, "adapter": { ... } }: reported apart, and no help to the gate.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { replayIdentity } from '../runner/provenance.ts';
import { writeJson } from '../schema/json.ts';
import { checkCorpus, compiledScenarios, decide, emptyOutcomes, pinCorpus, readManifest, reconcileKnown, replayEvidence, selectEntries, type DeclaredExclusion, type EvidenceRow } from './conformance.ts';
import { describe } from './compare.ts';
import { replayNative, type ReplayResult } from './engine.ts';
import { loadRecording } from './load.ts';
import { knownFailures, recordingsRoot, RECORDER_ROOT } from './recordings.ts';
import { validateRecording } from './validate.ts';
import { verdict } from './verdict.ts';

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        version: { type: 'string' },
        case: { type: 'string' },
        manifest: { type: 'string' },
        exclusions: { type: 'string' },
        regression: { type: 'string' },
        json: { type: 'string' },
        continuous: { type: 'boolean', default: false },
        phases: { type: 'boolean', default: false },
    },
});
const command = positionals[0];
const version = values.version;
if (!version || (command !== 'pin' && command !== 'check')) {
    console.error('usage: conformance-cli.ts pin|check --version <release> [--case glob] [--continuous] [--phases] [--regression file] [--manifest file] [--json file]');
    process.exit(2);
}
const root = recordingsRoot();
const manifestFile = values.manifest ?? join(RECORDER_ROOT, 'corpus', `${version}.json`);

if (command === 'pin') {
    const exclusions = values.exclusions ? JSON.parse(readFileSync(values.exclusions, 'utf8')) as DeclaredExclusion[] : [];
    const { manifest, problems } = pinCorpus(root, version, exclusions);
    if (!manifest) {
        for (const problem of problems.slice(0, 20)) console.error(problem);
        console.error(`nothing pinned: ${problems.length} problem(s)`);
        process.exit(1);
    }
    mkdirSync(dirname(manifestFile), { recursive: true });
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 1)}\n`);
    console.log(`${manifestFile}: ${manifest.entries.length} recording(s) of ${version}, ${manifest.exclusions.length} excluded`);
    process.exit(0);
}

const manifest = readManifest(manifestFile);
const selected = manifest ? selectEntries(manifest, values.case) : [];
const selection = values.case ? 'subset' as const : 'whole' as const;
const corpusProblems = manifest ? checkCorpus(manifest, root, version, selected) : [];
if (manifest && selected.length === 0) corpusProblems.push(`nothing in the manifest matches ${values.case}`);
const outcomes = emptyOutcomes();
const fields: Record<string, number> = {};
const uncompared: string[] = [];
const known = knownFailures('native');
const stepwiseResults = new Map<string, ReplayResult>();
const layers = { stepwise: 0, continuous: 0, phases: 0 };
const carried = { recordings: 0, ticks: 0, reseeded: 0, drifted: 0 };
const findings: string[] = [];
// (a recording the corpus check refused is not replayed: it has said all it can)
const refused = new Set(corpusProblems.flatMap(p => /^(\S+): /.exec(p)?.[1] ?? []));
for (const entry of selected) {
    await new Promise(resolve => setImmediate(resolve));
    outcomes.recorded += 1;
    if (refused.has(entry.id)) {
        outcomes.unexpected += 1;
        continue;
    }
    const key = `${version}/${entry.id}`;
    const recording = loadRecording(join(root, version, `${entry.id}.jsonl.gz`));
    const invalid = validateRecording(recording, version, entry.id, true);
    if (invalid.length > 0) {
        outcomes.unexpected += 1;
        findings.push(`BAD ${key}: ${invalid[0]}`);
        continue;
    }
    outcomes.valid += 1;
    const stepwise = replayNative(recording, { phases: values.phases });
    stepwiseResults.set(key, stepwise);
    const outcome = verdict(stepwise, known[key]);
    outcomes.comparedTicks += stepwise.compared;
    outcomes.interpolatedTicks += stepwise.interpolated;
    outcomes.unmodelledTicks += stepwise.unmodelled;
    outcomes.elsewhereTicks += stepwise.elsewhere;
    for (const [field, n] of Object.entries(stepwise.fields)) fields[field] = (fields[field] ?? 0) + n;
    if (outcome === 'pass') outcomes.compared += 1;
    else if (outcome === 'known') outcomes.known += 1;
    else if (outcome === 'fail') outcomes.unexpected += 1;
    else {
        outcomes.unsupported += 1;
        uncompared.push(entry.id);
    }
    if (outcome === 'fail') {
        layers.stepwise += 1;
        if (values.phases && stepwise.first && !/^afterAiStep/.test(stepwise.first.at)) layers.phases += 1;
        findings.push(`FAIL ${key}: ${stepwise.problems[0] ?? (stepwise.first ? describe(stepwise.first) : 'nothing compared')}`);
    }
    if (values.continuous && stepwise.compared > 0) {
        const continuous = replayNative(recording, { mode: 'continuous' });
        if (replayEvidence(continuous) === 'continuous') {
            carried.recordings += 1;
            carried.ticks += continuous.compared;
            carried.reseeded += continuous.continuous!.reseeds.length;
        }
        if (continuous.first) {
            layers.continuous += 1;
            carried.drifted += 1;
            findings.push(`DRIFT ${key}: ${describe(continuous.first)}; at most ${continuous.continuous!.drift.maxPosition.toExponential(3)}`);
        }
    }
}
const knownProblems = manifest ? reconcileKnown(known, manifest, stepwiseResults) : [];
const ran = ['stepwise', ...(values.continuous ? ['continuous'] : []), ...(values.phases ? ['phases'] : [])] as (keyof typeof layers)[];
const decision = decide({
    version, selection, corpusProblems, knownProblems, outcomes, fields, uncompared, ...(manifest ? { manifest } : {}),
    scenarios: compiledScenarios(version),
    requiredLayers: ['stepwise', 'continuous', 'phases'],
    cleanLayers: outcomes.recorded > 0 ? ran.filter(layer => layers[layer] === 0) : [],
});
const regression = values.regression ? JSON.parse(readFileSync(values.regression, 'utf8')) as Record<string, Omit<EvidenceRow, 'category' | 'unavailable'>> : {};
const notRun = (category: EvidenceRow['category']): EvidenceRow => ({ category, source: 'not run', passed: 0, failed: 0, unavailable: 0 });
const given = (category: 'primitive' | 'adapter'): EvidenceRow => (regression[category] ? { ...regression[category], category, unavailable: 0 } : notRun(category));
const unavailable = outcomes.unsupported;
const evidence: EvidenceRow[] = [
    given('primitive'),
    given('adapter'),
    { category: 'stepwise', source: 'replayNative, stepwise', passed: outcomes.compared, failed: layers.stepwise, unavailable },
    values.continuous
        ? { category: 'continuous', source: `replayNative, continuous: ${carried.ticks} ticks, ${carried.reseeded} seeds; decisions from vanilla`, passed: carried.recordings - carried.drifted, failed: carried.drifted, unavailable }
        : notRun('continuous'),
    { category: 'vanilla-golden', source: decision.status === 'complete' ? `the pinned corpus of ${version}, whole` : 'no: the gate did not pass the whole corpus', passed: decision.status === 'complete' ? outcomes.compared : 0, failed: decision.status === 'complete' ? 0 : outcomes.unexpected, unavailable },
];
const report = {
    version, selection, ...(values.case ? { case: values.case } : {}), status: decision.status, blockers: decision.blockers, omittedFields: decision.omittedFields,
    corpus: manifest ? { file: manifestFile, recordings: manifest.entries.length, selected: selected.length, exclusions: manifest.exclusions, builds: [...new Set(selected.map(e => e.build))] } : 'none',
    replay: replayIdentity(RECORDER_ROOT), outcomes, evidence, fields, findings,
};
for (const row of evidence) console.log(`${row.category.padEnd(15)} ${String(row.passed).padStart(6)} passed ${String(row.failed).padStart(5)} failed ${String(row.unavailable).padStart(5)} unavailable   ${row.source}`);
for (const finding of findings.slice(0, 20)) console.log(finding);
for (const blocker of decision.blockers.slice(0, 20)) console.log(`blocker: ${blocker}`);
if (decision.blockers.length > 20) console.log(`(+${decision.blockers.length - 20} blockers)`);
console.log(`${version}: ${decision.status}${decision.status === 'clean-subset' ? ' (a subset certifies nothing)' : ''}`);
if (values.json) writeFileSync(values.json, writeJson(report));
process.exitCode = decision.status === 'incomplete' ? 1 : 0;
