// The strict gate: what must stop a release being called complete, each on its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { checkCorpus, decide, emptyOutcomes, pinCorpus, reconcileKnown, requiredFields, selectEntries, type CorpusManifest, type GateInput } from '../conformance.ts';

const FIXTURES = fileURLToPath(new URL('fixtures', import.meta.url));
const CASES = ['physrec/j_walk_f', 'physrec/j_hop_held', 'physrec/b_cobweb_sprint_in'];

function corpus(run: (root: string, manifest: CorpusManifest) => void) {
    const root = mkdtempSync(join(tmpdir(), 'corpus-'));
    try {
        for (const id of CASES) {
            const file = join(root, '26.3', `${id}.jsonl.gz`);
            mkdirSync(dirname(file), { recursive: true });
            copyFileSync(join(FIXTURES, '26.3', `${id}.jsonl.gz`), file);
        }
        const { manifest, problems } = pinCorpus(root, '26.3');
        assert.deepEqual(problems, []);
        run(root, manifest!);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

const file = (root: string, id: string) => join(root, '26.3', `${id}.jsonl.gz`);

test('a pinned corpus checks clean', () => corpus((root, manifest) => {
    assert.equal(manifest.entries.length, 3);
    assert.deepEqual(checkCorpus(manifest, root, '26.3'), []);
}));

test('no corpus pins nothing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'corpus-'));
    assert.match(pinCorpus(empty, '26.3').problems.join(), /no recordings of 26.3/);
    rmSync(empty, { recursive: true, force: true });
});

test('a missing file, changed bytes and a truncated footer each fail', () => corpus((root, manifest) => {
    rmSync(file(root, CASES[0]!));
    assert.match(checkCorpus(manifest, root, '26.3').join(), /j_walk_f: no recording/);
    const bytes = readFileSync(file(root, CASES[1]!));
    writeFileSync(file(root, CASES[1]!), Buffer.concat([bytes, Buffer.from([0])]));
    assert.match(checkCorpus(manifest, root, '26.3').join(), /j_hop_held: its bytes changed/);
}));

test('a recording cut short cannot be pinned', () => corpus(root => {
    const text = gunzipSync(readFileSync(file(root, CASES[2]!))).toString('utf8').trimEnd().split('\n');
    writeFileSync(file(root, CASES[2]!), gzipSync(text.slice(0, -1).join('\n')));
    assert.match(pinCorpus(root, '26.3').problems.join(), /no footer/);
}));

test('a truncated footer behind matching bytes still fails the check', () => corpus((root, manifest) => {
    const text = gunzipSync(readFileSync(file(root, CASES[2]!))).toString('utf8').trimEnd().split('\n');
    const cut = gzipSync(text.slice(0, -1).join('\n'));
    writeFileSync(file(root, CASES[2]!), cut);
    const entries = manifest.entries.map(e => (e.id === CASES[2] ? { ...e, sha256: pinnedDigest(cut) } : e));
    assert.match(checkCorpus({ ...manifest, entries }, root, '26.3').join(), /no footer/);
}));

const pinnedDigest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('a duplicate identity, a wrong release and a wrong protocol each fail', () => corpus((root, manifest) => {
    assert.match(checkCorpus({ ...manifest, entries: [...manifest.entries, manifest.entries[0]!] }, root, '26.3').join(), /pinned twice/);
    assert.match(checkCorpus({ ...manifest, version: '26.2' }, root, '26.3').join(), /the manifest is of 26.2/);
    assert.match(checkCorpus({ ...manifest, protocol: 1 }, root, '26.3').join(), /protocol \d+, the manifest has 1/);
}));

test('a recording of another scenario fails', () => corpus((root, manifest) => {
    const entries = manifest.entries.map(e => ({ ...e, scenario: 'changed' }));
    assert.match(checkCorpus({ ...manifest, entries }, root, '26.3').join(), /recorded from another scenario/);
}));

test('a selection comes from the manifest: a selected case that is gone is not hidden by the others', () => corpus((root, manifest) => {
    const selected = selectEntries(manifest, 'physrec/j_*');
    assert.deepEqual(selected.map(e => e.id).sort(), ['physrec/j_hop_held', 'physrec/j_walk_f']);
    rmSync(file(root, 'physrec/j_walk_f'));
    assert.match(checkCorpus(manifest, root, '26.3', selected).join(), /j_walk_f: no recording/);
    assert.deepEqual(checkCorpus(manifest, root, '26.3', selectEntries(manifest, 'physrec/b_*')), []);
}));

test('an exclusion names a pinned case and says why', () => corpus((root, manifest) => {
    assert.match(checkCorpus({ ...manifest, exclusions: [{ id: 'physrec/nothing', reason: 'x' }] }, root, '26.3').join(), /not in the manifest/);
    assert.match(checkCorpus({ ...manifest, exclusions: [{ id: CASES[0]!, reason: ' ' }] }, root, '26.3').join(), /no reason/);
}));

const pin = (id: string) => ({ id, scenario: '', sha256: '', rows: 1, build: '' });
const manifest: CorpusManifest = { schema: 1, version: '26.3', protocol: 1, entries: [pin('a/one'), pin('a/two')], exclusions: [{ id: 'a/declared', reason: 'a vehicle the server drives' }] };
const every = Object.fromEntries(requiredFields('26.3').map(f => [f, 1]));
const clean: GateInput = {
    version: '26.3', manifest, selection: 'whole', corpusProblems: [], knownProblems: [], fields: every, uncompared: [], scenarios: ['a/one', 'a/two'],
    outcomes: { ...emptyOutcomes(), recorded: 2, valid: 2, compared: 2, comparedTicks: 40 },
    requiredLayers: ['stepwise', 'continuous', 'phases'], cleanLayers: ['stepwise', 'continuous', 'phases'],
};

test('a whole clean release is complete, and a clean subset certifies nothing', () => {
    assert.deepEqual(decide(clean), { status: 'complete', blockers: [], omittedFields: decide(clean).omittedFields });
    assert.equal(decide({ ...clean, selection: 'subset', fields: {} }).status, 'clean-subset');
});

const blocked = (input: Partial<GateInput>, pattern: RegExp) => {
    const decision = decide({ ...clean, ...input });
    assert.equal(decision.status, 'incomplete');
    assert.match(decision.blockers.join('\n'), pattern);
};

test('each of these prevents completion on its own', () => {
    const { manifest: _none, ...withoutCorpus } = clean;
    assert.match(decide(withoutCorpus).blockers.join(), /no corpus manifest/);
    blocked({ corpusProblems: ['x: no recording'] }, /x: no recording/);
    blocked({ knownProblems: ['x passes now'] }, /x passes now/);
    blocked({ outcomes: emptyOutcomes() }, /no recording ran/);
    blocked({ outcomes: { ...clean.outcomes, comparedTicks: 0 } }, /no tick was compared/);
    blocked({ outcomes: { ...clean.outcomes, unexpected: 1 } }, /unexpected/);
    blocked({ outcomes: { ...clean.outcomes, known: 1 } }, /a known difference is still one/);
    blocked({ fields: { ...every, pos: 0 } }, /required field pos/);
    blocked({ scenarios: ['a/one', 'a/two', 'a/three'] }, /1 compiled scenario.s. are not pinned, the first a.three/);
    blocked({ scenarios: [] }, /no scenarios compiled/);
    blocked({ uncompared: ['b/undeclared'] }, /b\/undeclared compared nothing/);
    blocked({ cleanLayers: ['stepwise', 'phases'] }, /the continuous layer did not run clean/);
});

test('a declared exclusion stays visible and does not block', () => {
    assert.equal(decide({ ...clean, uncompared: ['a/declared'] }).status, 'complete');
});

test('a field the gate leaves out is listed with why', () => {
    assert.ok(!requiredFields('26.3').includes('look'));
    assert.match(decide(clean).omittedFields.look!, /look/);
});

test('required fields are the release\'s own', () => {
    assert.ok(requiredFields('26.3').includes('mainSupportingBlockPos'));
    assert.ok(!requiredFields('1.12.2').includes('mainSupportingBlockPos'));
});

test('known failures: every key is checked against the whole corpus, and only selected ones against the run', () => {
    const pinned: CorpusManifest = { ...manifest, entries: [{ id: 'a', scenario: '', sha256: '', rows: 1, build: '' }, { id: 'b', scenario: '', sha256: '', rows: 1, build: '' }] };
    const failure = { tick: 1, field: 'pos', fields: { pos: 1 }, reason: 'r' };
    const stale = reconcileKnown({ '26.3/gone': failure }, pinned, new Map());
    assert.match(stale.join(), /no pinned recording/);
    // (a key outside the selection stands)
    assert.deepEqual(reconcileKnown({ '26.3/b': failure }, pinned, new Map([['26.3/a', { results: [] }]])), []);
    assert.match(reconcileKnown({ '26.3/a': failure }, pinned, new Map([['26.3/a', { results: [] }]])).join(), /passes now/);
    const moved = { first: { tick: 2, at: '', source: 'native' as const, field: 'pos', expected: 0, actual: 1 }, results: [{ t: 2, divergences: [] }, { t: 3, divergences: [] }] };
    assert.match(reconcileKnown({ '26.3/a': failure }, pinned, new Map([['26.3/a', moved]])).join(), /no longer fails as listed/);
});
