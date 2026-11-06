// What the clients report against what the run selected, without a client.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { casesLeft, diedIn, failureLines, failuresOf, reconcile, recordingProblem, shardsOf, type RecEvent, type SelectedScenario } from '../outcomes.ts';

const scenario = (id: string, file = 'a.json'): SelectedScenario => ({ id, hash: `hash-${id}`, file });
const result = (id: string, status = 'ok', hash = `hash-${id}`): RecEvent => ({ e: 'result', id, hash, status });
const done = (counts: Partial<Record<'ok' | 'invalid' | 'skipped' | 'errors', number>>): RecEvent => ({ e: 'done', ok: 0, invalid: 0, skipped: 0, errors: 0, ...counts });
const selected = [scenario('x'), scenario('y'), scenario('z')];
const statuses = (results: readonly RecEvent[]) => Object.fromEntries(results.map(r => [r.id, r.status]));

test('every scenario reported once by its client stands as it was reported', () => {
    const { results, problems } = reconcile(selected, [
        { shard: 0, results: [result('x'), result('z', 'skipped')], done: done({ ok: 1, skipped: 1 }) },
        { shard: 1, results: [result('y', 'invalid')], done: done({ invalid: 1 }) },
    ], 2);
    assert.deepEqual(problems, []);
    assert.deepEqual(statuses(results), { x: 'ok', y: 'invalid', z: 'skipped' });
});

test('the clients take the scenarios as Recorder.load deals them: the files in name order', () => {
    const shards = shardsOf([scenario('late', 'b.json'), scenario('early', 'a.json'), scenario('next', 'a.json'), scenario('last', 'c.json')], 2);
    assert.deepEqual(Object.fromEntries(shards), { early: 0, next: 1, late: 0, last: 1 });
});

test('a scenario no client reported is missing', () => {
    const { results, problems } = reconcile(selected, [{ shard: 0, results: [result('x')] }], 1);
    assert.deepEqual(statuses(results), { x: 'ok', y: 'missing', z: 'missing' });
    assert.deepEqual(problems, []);
});

test('two results for a scenario are an error, whatever the last one said', () => {
    const { results, problems } = reconcile([scenario('x')], [{ shard: 0, results: [result('x', 'error'), result('x', 'ok')] }], 1);
    assert.equal(results[0]!.status, 'error');
    assert.match(problems[0]!, /x: 2 results/);
});

test('a result for a scenario outside the selection fails the run', () => {
    const { results, problems } = reconcile([scenario('x')], [{ shard: 0, results: [result('x'), result('stranger')] }], 1);
    assert.deepEqual(statuses(results), { x: 'ok' });
    assert.match(problems[0]!, /stranger, which this run did not select/);
});

test('an unknown status, another hash or another client is no success', () => {
    for (const [event, shard, reason] of [
        [result('x', 'passed'), 0, /unknown status passed/],
        [result('x', 'ok', 'stale'), 0, /the hash stale/],
        [result('y'), 0, /belongs to shard 1/],
    ] as const) {
        const { results, problems } = reconcile(selected, [{ shard, results: [event] }], 2);
        assert.equal(results.find(r => r.id === event.id)!.status, 'error');
        assert.match(problems[0]!, reason);
    }
});

test('a done whose counts are not its results fails the run', () => {
    const { problems } = reconcile([scenario('x')], [{ shard: 0, results: [result('x')], done: done({ ok: 2 }) }], 1);
    assert.match(problems[0]!, /done says ok 2, its results 1/);
    assert.deepEqual(reconcile([scenario('x')], [{ shard: 0, results: [result('x', 'error')], done: done({ errors: 1 }) }], 1).problems, []);
});

test('a success stands only with its finished recording', () => {
    const dir = mkdtempSync(join(tmpdir(), 'outcomes-'));
    try {
        const s = scenario('x');
        const header = { kind: 'header', schema: 1, mc: '26.3', provenance: { id: 'b1' }, scenario: { id: 'x', hash: 'hash-x' } };
        const write = (name: string, text: string) => {
            const file = join(dir, name);
            writeFileSync(file, gzipSync(text));
            return file;
        };
        const lines = (...objects: unknown[]) => objects.map(o => JSON.stringify(o)).join('\n');
        const whole = write('whole', lines(header, { t: 0 }, { kind: 'footer', status: 'ok' }));
        assert.equal(recordingProblem(whole, '26.3', s, 'ok'), null);
        assert.equal(recordingProblem(whole, '26.3', s, 'ok', 'b1'), null);
        assert.match(recordingProblem(whole, '26.3', s, 'ok', 'b2')!, /the build b1, this run b2/);
        assert.match(recordingProblem(write('other', lines({ ...header, schema: 2 }, { kind: 'footer', status: 'ok' })), '26.3', s, 'ok')!, /schema 2/);
        assert.match(recordingProblem(join(dir, 'none'), '26.3', s, 'ok')!, /no readable recording/);
        assert.match(recordingProblem(whole, '1.20.4', s, 'ok')!, /a recording of 26.3/);
        assert.match(recordingProblem(whole, '26.3', scenario('y'), 'ok')!, /a recording of x/);
        assert.match(recordingProblem(whole, '26.3', s, 'invalid')!, /ended ok/);
        assert.match(recordingProblem(write('cut', lines(header, { t: 0 })), '26.3', s, 'ok')!, /no footer/);
        assert.match(recordingProblem(write('half', `${lines(header)}\n{"t":`), '26.3', s, 'ok')!, /cut short/);
        assert.match(recordingProblem(write('empty', ''), '26.3', s, 'ok')!, /a recording of undefined/);
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test('a client that takes over reports with the one that died, and neither is a duplicate', () => {
    const { results, problems } = reconcile(selected, [
        { shard: 0, results: [result('x'), result('y', 'error')] },
        { shard: 0, results: [result('z')], done: done({ ok: 1 }) },
    ], 1);
    assert.deepEqual(problems, []);
    assert.deepEqual(statuses(results), { x: 'ok', y: 'error', z: 'ok' });
});

test('what is left of a client is its own scenarios without a result', () => {
    assert.deepEqual(casesLeft(selected, 2, 0, new Set(['x'])).map(s => s.id), ['z']);
    assert.deepEqual(casesLeft(selected, 2, 1, new Set(['x'])).map(s => s.id), ['y']);
    assert.deepEqual(casesLeft(selected, 1, 0, new Set(['x', 'y', 'z'])), []);
});

test('a client dies in the scenario it started and said nothing more of', () => {
    const died = diedIn(selected, { started: ['x', 'y'], results: [result('x')] }, 'no progress for 120 s');
    assert.equal(died?.id, 'y');
    assert.equal(died?.hash, 'hash-y');
    assert.equal(died?.status, 'error');
    assert.match(String(died?.reason), /no progress for 120 s/);
    assert.equal(diedIn(selected, { started: ['x'], results: [result('x', 'error')] }, 'lockstep'), null);
    assert.equal(diedIn(selected, { started: [], results: [] }, 'before the world'), null);
});

test('a scenario that failed in both runs is named, which the comparison of the ok ones never does', () => {
    const died = { ...result('x', 'error'), reason: 'the client died in it: no progress for 420 s' };
    const run = failuresOf([died, result('y'), result('z', 'invalid'), result('w', 'skipped')]);
    assert.deepEqual(run.map(f => f.id), ['x', 'z']);
    const verify = failuresOf([died, result('y', 'missing'), result('z'), result('w', 'skipped')]);
    assert.deepEqual(failureLines('1.20.5', { run, verify }), [
        'FAILED in every run (run, verify): 1.20.5/x error (the client died in it: no progress for 420 s)',
        'FAILED in run: 1.20.5/z invalid',
        'FAILED in verify: 1.20.5/y missing',
    ]);
    assert.deepEqual(failureLines('1.20.5', { run: failuresOf([died]) }), ['FAILED in run: 1.20.5/x error (the client died in it: no progress for 420 s)']);
    assert.deepEqual(failureLines('1.20.5', { run: [], verify: [] }), []);
});
