// Every recording replays through the native engine with no divergence, except its known failures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe as describeDivergence } from '../compare.ts';
import { replayNative } from '../engine.ts';
import { loadRecording, parseRecording } from '../load.ts';
import { findRecordings, knownFailures, signature } from '../recordings.ts';

const known = knownFailures('native');
const files = findRecordings();

test('the loader expands deltas, keyframes and packets', () => {
    const header = { kind: 'header', schema: 1, mc: '1.20.4', protocol: 765, scenario: { id: 't', hash: 'h' }, fields: [], phases: [],
        world: { origin: [0, 0, 0], area: { name: 'a', box: [0, 0, 0, 0, 0, 0], fills: [] }, dimension: 'overworld' },
        server: { wire: false, ownerChecks: 'dedicated', allowFlight: true }, start: {}, setup: {}, body: [] };
    const rows = [
        { t: 0, pre: { pos: [0, 0, 0], yRot: 0.1, onGround: true }, kf: true, in: { keys: [], yRot: 0, xRot: 0 },
            ph: { afterMove: { pos: [0, 1, 0] } }, post: { onGround: false } },
        { t: 1, s2c: [{ seq: 1, name: 'P', id: 1, b: '', after: { vel: [0, '+Inf', 'NEGZERO'] } }], pre: {}, in: { keys: [], yRot: 0, xRot: 0 },
            post: { vel: null } },
    ];
    const footer = { kind: 'footer', status: 'ok', touched: [], corrections: 0, wallMs: 0, rows: 2 };
    const text = [header, ...rows, footer].map(x => JSON.stringify(x)).join('\n').replace('"NEGZERO"', '-0.0');
    const r = parseRecording(text);
    assert.deepEqual(r.rows[0]!.phases[0]!.state.pos, [0, 1, 0]);
    assert.equal(r.rows[0]!.pre.yRot, Math.fround(0.1));
    assert.equal(r.rows[0]!.post.onGround, false);
    const vel = r.rows[1]!.s2c[0]!.state.vel as number[];
    assert.equal(vel[1], Infinity);
    assert.ok(Object.is(vel[2], -0));
    assert.equal(r.rows[1]!.post.vel, undefined);
    assert.deepEqual(r.rows[1]!.post.pos, [0, 1, 0]);
});

// (CONFORMANCE=strict: no corpus is a failure, and only a developer's run of these tests may go without one)
test('recordings are present', { skip: files.length === 0 && process.env.CONFORMANCE !== 'strict' ? 'no recordings (run recorder/runner or set REPLAY_RECORDINGS)' : false }, () => {
    assert.ok(files.length > 0);
});

for (const f of files) {
    const key = `${f.version}/${f.id}`;
    test(`native replay ${key}`, t => {
        const result = replayNative(loadRecording(f.file));
        const expected = known[key];
        assert.deepEqual(result.problems, [], 'the recording is not fit to compare');
        // nothing the native layer models: the player rode all along (the recording is still for the packet replay)
        if (result.compared === 0 && result.unmodelled > 0) {
            t.skip(`${result.unmodelled} ridden ticks of a vehicle the engine does not model (minecart)`);
            return;
        }
        if (result.compared === 0 && result.interpolated > 0) {
            t.skip(`${result.interpolated} ridden ticks of a vehicle the server drives`);
            return;
        }
        if (expected) {
            assert.ok(result.first, `${key} is a known failure (${expected.reason}) but passes now: remove it from known-failures.json`);
            const moved = `${key} now first diverges at ${describeDivergence(result.first)}`;
            assert.equal(result.first.field, expected.field, moved);
            assert.equal(result.first.tick, expected.tick, moved);
            assert.deepEqual(signature(result.results), expected.fields, `${key}: the divergences changed beyond the known one`);
            return;
        }
        assert.equal(result.first, undefined, result.first && describeDivergence(result.first));
        assert.ok(result.compared > 0, 'no tick was compared');
    });
}
