// Continuous replay carries the engine's output: a change to a prediction goes on where the stepwise replay would drop it at
// the next row, vanilla's later rows do not write over it, and a packet changes only what it changed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExpandedRow, Recording, Snapshot } from '../../schema/recording.ts';
import { CARRIED, DECIDED_BY_VANILLA, Prediction } from '../continuous.ts';
import { replayEvidence } from '../conformance.ts';
import { replayNative } from '../engine.ts';
import { loadRecording } from '../load.ts';

const fixture = (name: string) => loadRecording(join(fileURLToPath(new URL('fixtures/26.3/physrec', import.meta.url)), `${name}.jsonl.gz`));
const diverging = (r: ReturnType<typeof replayNative>) => r.results.filter(x => x.divergences.length > 0).map(x => x.t);

test('the fixtures replay clean in both modes, and say which they were', () => {
    for (const name of ['j_walk_f', 'j_hop_held', 'b_cobweb_sprint_in']) {
        const recording = fixture(name);
        const stepwise = replayNative(recording);
        const continuous = replayNative(recording, { mode: 'continuous' });
        assert.equal(stepwise.first, undefined, name);
        assert.equal(continuous.first, undefined, name);
        assert.equal(stepwise.mode, 'stepwise');
        assert.equal(stepwise.continuous, undefined);
        assert.equal(continuous.mode, 'continuous');
        assert.ok(continuous.compared > 10);
        assert.deepEqual(continuous.continuous!.decidedByVanilla, DECIDED_BY_VANILLA);
        assert.equal(continuous.continuous!.reseeds[0]!.why, 'the first tick');
    }
});

test('a change to the predicted motion goes on in a continuous replay and ends at the next row in a stepwise one', () => {
    const recording = fixture('j_walk_f');
    const nudge = (t: number, s: { velocity: { x: number; y: number; z: number } }) => {
        if (t === 10) s.velocity = { ...s.velocity, x: s.velocity.x + 1e-6 };
    };
    assert.deepEqual(diverging(replayNative(recording, { perturb: nudge })), [10]);
    const continuous = replayNative(recording, { mode: 'continuous', perturb: nudge });
    assert.equal(continuous.first?.tick, 10);
    assert.equal(diverging(continuous).at(-1), recording.rows.at(-1)!.t);
    const drift = continuous.continuous!.drift;
    assert.equal(drift.firstTick, 10);
    assert.ok(drift.finalPosition > drift.firstPosition, 'first divergence and accumulated error are reported apart');
});

test('a persistent counter lost for one tick stays lost in a continuous replay', () => {
    const recording = fixture('j_hop_held');
    // the jump delay, wrong for one tick: at the tick the next hop would start, which it holds back
    let done = false;
    const loses = (t: number, s: { jumpTicks?: number; onGround?: boolean; jumpRequested?: boolean }) => {
        if (done || t < 5 || !s.onGround || !s.jumpRequested) return;
        done = true;
        s.jumpTicks = 10;
    };
    const stepwise = diverging(replayNative(recording, { perturb: loses }));
    done = false;
    const continuous = diverging(replayNative(recording, { mode: 'continuous', perturb: loses }));
    assert.ok(done);
    assert.ok(continuous.length > stepwise.length, `continuous ${continuous.length}, stepwise ${stepwise.length}`);
});

test('losing a block\'s slowdown for one tick is caught later only by a continuous replay', () => {
    const recording = fixture('b_cobweb_sprint_in');
    const inWeb = recording.rows.find(r => (r.pre.stuckSpeedMultiplier as number[])[0] !== 0)!.t;
    const loses = (t: number, s: { stuckSpeedMultiplier?: { x: number; y: number; z: number } }) => {
        if (t === inWeb + 1) s.stuckSpeedMultiplier = { x: 0, y: 0, z: 0 };
    };
    const stepwise = diverging(replayNative(recording, { perturb: loses }));
    const continuous = diverging(replayNative(recording, { mode: 'continuous', perturb: loses }));
    assert.ok(stepwise.length <= 1, `stepwise recovers at the next seed: ${stepwise}`);
    assert.ok(continuous.length > 1 + stepwise.length, `continuous ${continuous.length}`);
});

test('a Riptide launch comes from the prediction: the engine launches, as no packet carries it', () => {
    const recording = fixture('q_riptide_1_surface');
    const clean = replayNative(recording, { mode: 'continuous' });
    assert.equal(clean.first, undefined);
    assert.equal(clean.continuous!.corrections.filter(c => c.fields.includes('pos')).length, 0, 'no vanilla position stands in for it');
    let launches = 0;
    replayNative(recording, { mode: 'continuous', perturb: (_, s: { riptideLaunch?: number }) => { launches += s.riptideLaunch === undefined ? 0 : 1; } });
    assert.equal(launches, 1);
});

/** The recording with its snapshots at tick t changed where the replay would seed from them. */
function rewrite(recording: Recording, t: number, change: (row: ExpandedRow) => ExpandedRow): Recording {
    return { ...recording, rows: recording.rows.map(row => (row.t === t ? change(row) : row)) };
}

test('a mount keeps what its tick left: a web lost for one tick is caught later only by a continuous replay', () => {
    const recording = fixture('cf_ride_horse_stops_in_web');
    const stuck = (s: Snapshot) => ((s.vehicle as { stuckSpeedMultiplier?: number[] } | null | undefined)?.stuckSpeedMultiplier ?? [0])[0] !== 0;
    const inWeb = recording.rows.find(r => stuck(r.pre) && stuck(r.post))!.t;
    const loses = (t: number, s: { stuckSpeedMultiplier?: { x: number; y: number; z: number } }) => {
        if (t === inWeb + 5) s.stuckSpeedMultiplier = { x: 0, y: 0, z: 0 };
    };
    const clean = replayNative(recording, { mode: 'continuous' });
    assert.equal(clean.first, undefined);
    assert.ok(clean.continuous!.vehicle.carried > 100);
    assert.equal(clean.continuous!.vehicle.reseeds.length, 1);
    const stepwise = diverging(replayNative(recording, { perturb: loses }));
    const continuous = diverging(replayNative(recording, { mode: 'continuous', perturb: loses }));
    assert.ok(stepwise.length <= 1, `stepwise recovers at the next seed: ${stepwise}`);
    assert.ok(continuous.length > 1 + stepwise.length, `continuous ${continuous.length}`);
});

test('a later row\'s state does not write over the prediction', () => {
    const recording = fixture('j_walk_f');
    const moved = (s: Snapshot) => ({ ...s, pos: (s.pos as number[]).map(v => v + 1), vel: (s.vel as number[]).map(v => v + 1) });
    const lied = rewrite(recording, 20, row => ({ ...row, phases: row.phases.map(p => (p.name === 'tickStart' ? { ...p, state: moved(p.state) } : p)) }));
    assert.ok(diverging(replayNative(lied)).includes(20), 'stepwise seeds from it');
    assert.equal(replayNative(lied, { mode: 'continuous' }).first, undefined);
});

test('a packet changes the fields it changed and no others, at its row', () => {
    const recording = fixture('j_walk_f');
    const prediction = new Prediction();
    const held = { position: { x: 1, y: 2, z: 3 }, velocity: { x: 0.5, y: 0, z: 0 }, onGround: true } as never;
    prediction.keep(held, { pos: [1, 2, 3], vel: [0.5, 0, 0] }, 0, false);
    const seed = { position: { x: 9, y: 9, z: 9 }, velocity: { x: 7, y: 7, z: 7 }, onGround: false } as never as { position: object; velocity: object; onGround: boolean };
    prediction.seed(seed as never, { t: 1, s2c: [{ seq: 1, name: 'ClientboundSetEntityMotionPacket', id: 0, b: '', after: { vel: [7, 7, 7] }, state: {} }] });
    assert.deepEqual(seed.velocity, { x: 7, y: 7, z: 7 }, 'the motion is the packet\'s');
    assert.deepEqual(seed.position, { x: 1, y: 2, z: 3 }, 'the position stays the prediction');
    assert.equal(seed.onGround, true);
    assert.deepEqual(prediction.corrections.map(c => [c.t, c.packet, c.fields]), [[1, 'ClientboundSetEntityMotionPacket', ['vel']]]);
    assert.equal(prediction.reseeds.length, 0);
    assert.ok(recording.rows.length > 0);
});

test('a teleport replaces the prediction and reports what it replaced', () => {
    const prediction = new Prediction();
    prediction.keep({ position: { x: 1, y: 2, z: 3 }, velocity: { x: 0, y: 0, z: 0 } } as never, { pos: [1, 2, 3], vel: [0, 0, 0] }, 0, false);
    const seed = { position: { x: 5, y: 6, z: 7 }, velocity: { x: 0, y: 0, z: 0 } };
    prediction.seed(seed as never, { t: 1, s2c: [{ seq: 1, name: 'ClientboundPlayerPositionPacket', id: 0, b: '', after: { pos: [5, 6, 7] }, state: {} }] });
    assert.deepEqual(seed.position, { x: 5, y: 6, z: 7 });
    assert.deepEqual(prediction.corrections[0]!.predicted, [1, 2, 3]);
    assert.deepEqual(prediction.corrections[0]!.vanilla, [5, 6, 7]);
});

test('the same inputs replay to the same bits and leave the recording as it was', () => {
    const recording = fixture('j_hop_held');
    const before = JSON.stringify(recording);
    const strip = (r: ReturnType<typeof replayNative>) => JSON.stringify(r);
    assert.equal(strip(replayNative(recording, { mode: 'continuous' })), strip(replayNative(recording, { mode: 'continuous' })));
    assert.equal(JSON.stringify(recording), before);
});

test('a replay that seeds every tick is stepwise evidence, whatever it was started as', () => {
    const recording = fixture('j_walk_f');
    const carried = replayNative(recording, { mode: 'continuous' });
    assert.equal(replayEvidence(carried), 'continuous');
    const reseeded = replayNative(recording, { mode: 'continuous', reseed: () => true });
    assert.equal(reseeded.continuous!.reseeds.length, reseeded.compared);
    assert.equal(replayEvidence(reseeded), 'stepwise');
    assert.equal(replayEvidence(replayNative(recording)), 'stepwise');
});

test('everything carried is a field the engine gives back', () => {
    const recording = fixture('j_walk_f');
    const seen = new Set<string>();
    replayNative(recording, { mode: 'continuous', perturb: (_, s) => { for (const key of Object.keys(s)) seen.add(key); } });
    for (const key of CARRIED) if (key !== 'boundingBox') assert.ok(seen.has(key), key);
});
