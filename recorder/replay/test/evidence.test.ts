// What the repository keeps of its findings holds together: the evidence records replay, the dispositions of D-161 to D-229
// add up from their own entries, the field table is the registry's, and a field's delta leaves nothing stale behind.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RECORDER_ROOT } from '../recordings.ts';
import { checkRecord, EVIDENCE_DIR, readRecords, replayRecord } from '../evidence.ts';
import { fieldCoverage } from '../field-coverage.ts';
import { RECORDED_ONLY } from '../../schema/fields.ts';
import { ENTITY_FAMILIES, FIELD_DECISIONS, TALLY } from '../field-decisions.ts';
import { parseRecording } from '../load.ts';

const records = readRecords();

test('every evidence record is whole, and each replays clean on this build', () => {
    assert.ok(records.length >= 2);
    for (const record of records) {
        assert.deepEqual(checkRecord(record), []);
        assert.deepEqual(replayRecord(record), []);
    }
});

test('a fixture that moved, a path that is gone and a regression that went are each found', () => {
    const record = records[0]!;
    assert.match(checkRecord({ ...record, fixture: { ...record.fixture, sha256: '0' } }).join(), /bytes changed/);
    assert.match(checkRecord({ ...record, fixture: { ...record.fixture, path: 'fixtures/gone.jsonl.gz' } }).join(), /no fixture at/);
    assert.deepEqual(checkRecord({ ...record, fixture: { ...record.fixture, path: 'fixtures/gone.jsonl.gz', planned: true } }), []);
    assert.match(checkRecord({ ...record, regression: { test: 'recorder/replay/test/gone.test.ts#x' } }).join(), /no regression at/);
    assert.match(checkRecord({ ...record, regression: { test: `${record.regression.test.split('#')[0]}#no such test` } }).join(), /is gone/);
    assert.match(checkRecord({ ...record, source: [] }).join(), /no source reference/);
});

test('a record of executed vanilla has a recording, whatever it says', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidence-'));
    const record = { ...records[0]!, fixture: { ...records[0]!.fixture, path: 'note.txt', planned: true } };
    writeFileSync(join(dir, 'note.txt'), 'x');
    assert.match(checkRecord(record, dir).join(), /executed vanilla with no recording/);
    rmSync(dir, { recursive: true, force: true });
    assert.ok(EVIDENCE_DIR.length > 0);
});

interface Disposition { id: string; disposition: string; duplicateOf: string | null; evidenceKind: string; evidence: Record<string, string | null>; overlaps: string[]; note: string }
const dispositions = JSON.parse(readFileSync(join(RECORDER_ROOT, '..', 'docs', 'parity-dispositions.json'), 'utf8')) as Disposition[];

test('every one of D-161 to D-229 has one disposition, in order', () => {
    assert.deepEqual(dispositions.map(d => d.id), Array.from({ length: 69 }, (_, i) => `D-${161 + i}`));
    const known = new Set(['fixed-validated', 'fixed-unvalidated', 'active', 'superseded', 'duplicate', 'rejected', 'blocked']);
    for (const d of dispositions) {
        assert.ok(known.has(d.disposition), d.id);
        assert.ok(d.note.length > 0, d.id);
    }
});

test('duplicates point at a real entry, and do not count as open twice', () => {
    const ids = new Set(dispositions.map(d => d.id));
    for (const d of dispositions.filter(x => x.disposition === 'duplicate')) assert.ok(d.duplicateOf && ids.has(d.duplicateOf) && d.duplicateOf !== d.id, d.id);
    const active = dispositions.filter(d => d.disposition === 'active').map(d => d.id);
    assert.equal(new Set(active).size, active.length);
    assert.ok(active.every(id => !dispositions.some(d => d.disposition === 'duplicate' && d.id === id)));
});

test('evidence kinds are kept apart: a claim of executed vanilla names its recording, a validated fix a regression', () => {
    for (const d of dispositions) {
        if (d.evidenceKind === 'executed-vanilla') assert.ok(d.evidence.regression, d.id);
        if (d.disposition === 'fixed-validated') assert.ok(d.evidence.regression, d.id);
        if (d.disposition === 'fixed-unvalidated') assert.notEqual(d.evidenceKind, 'executed-vanilla', d.id);
    }
});

test('the field table is what the registry says', () => {
    assert.equal(readFileSync(join(RECORDER_ROOT, '..', 'docs', 'field-coverage.md'), 'utf8').replace(/\r\n/g, '\n'), fieldCoverage());
});

test('every field with no native use has a verdict, and each names a file that reads it', () => {
    const undecided = fieldCoverage().split('\n').filter(line => line.endsWith('| recorded |'));
    assert.deepEqual(undecided, []);
    for (const [field, { verdict, by, why }] of Object.entries(FIELD_DECISIONS)) {
        assert.ok(why.length > 0, field);
        if (verdict === 'compared' || verdict === 'input') {
            assert.ok(by, `${field} says ${verdict} and names no file`);
            assert.match(readFileSync(join(RECORDER_ROOT, 'replay', by!), 'utf8'), new RegExp(`\\b${field}\\b`), `${field} in ${by}`);
        }
    }
});

test('no recorded field is a gap: each is compared, or an input, or said why not', () => {
    assert.deepEqual(TALLY().gap ?? [], []);
});

test('what RECORDED_ONLY says of a comparison is what the table says', () => {
    for (const [field, reason] of Object.entries(RECORDED_ONLY)) {
        if (/\bcompare[sd]?\b/.test(reason!)) assert.equal(FIELD_DECISIONS[field]?.verdict, 'compared', `${field}: ${reason}`);
    }
});

test('every entity family says where it is captured and what holds it', () => {
    for (const { family, by, missing } of ENTITY_FAMILIES) {
        assert.ok(readFileSync(join(RECORDER_ROOT, 'replay', by), 'utf8').length > 0, family);
        assert.ok(missing.length > 0, family);
    }
});

test('a field appears, changes and goes through packet, phase and post deltas, and leaves nothing behind', () => {
    const header = { kind: 'header', schema: 1, mc: '1.20.4', protocol: 765, scenario: { id: 't', hash: 'h' }, fields: [], phases: [],
        world: { origin: [0, 0, 0], area: { name: 'a', box: [0, 0, 0, 0, 0, 0], fills: [] }, dimension: 'overworld' },
        server: { wire: false, ownerChecks: 'dedicated', allowFlight: true }, start: {}, setup: {}, body: [] };
    const rows = [
        { t: 0, pre: { fallDistance: 1 }, kf: true, in: { keys: [], yRot: 0, xRot: 0 }, post: {} },
        { t: 1, s2c: [{ seq: 1, name: 'P', id: 1, b: '', after: { vehicle: { id: 1 } } }], pre: {}, in: { keys: [], yRot: 0, xRot: 0 }, post: {} },
        { t: 2, pre: {}, in: { keys: [], yRot: 0, xRot: 0 }, ph: { afterMove: { vehicle: { id: 2 } } }, post: {} },
        { t: 3, pre: {}, in: { keys: [], yRot: 0, xRot: 0 }, post: { vehicle: null } },
        { t: 4, pre: {}, in: { keys: [], yRot: 0, xRot: 0 }, post: {} },
    ];
    const footer = { kind: 'footer', status: 'ok', touched: [], corrections: 0, wallMs: 0, rows: rows.length };
    const r = parseRecording([header, ...rows, footer].map(x => JSON.stringify(x)).join('\n'));
    assert.equal(r.rows[0]!.post.vehicle, undefined);
    assert.deepEqual(r.rows[1]!.s2c[0]!.state.vehicle, { id: 1 });
    assert.deepEqual(r.rows[1]!.pre.vehicle, { id: 1 });
    assert.deepEqual(r.rows[2]!.pre.vehicle, { id: 1 });
    assert.deepEqual(r.rows[2]!.phases[0]!.state.vehicle, { id: 2 });
    assert.deepEqual(r.rows[2]!.post.vehicle, { id: 2 });
    assert.deepEqual(r.rows[3]!.pre.vehicle, { id: 2 });
    assert.equal('vehicle' in r.rows[3]!.post, false);
    assert.equal('vehicle' in r.rows[4]!.pre, false, 'gone stays gone');
    assert.equal(r.rows[4]!.post.fallDistance, 1, 'and what no delta touched stays');
});
