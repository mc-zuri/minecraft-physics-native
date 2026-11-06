// The phase comparison: an error two phases cancel out by the tick's end still fails, a repeated phase stays in its order, and
// a phase one side lacks is a problem and not an empty comparison. The trace changes nothing of the tick.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NativeTickPhase } from '../../../dist/native.js';
import { NATIVE_PHASES } from '../../schema/phases.ts';
import type { Recording, Snapshot } from '../../schema/recording.ts';
import { nativeBinding, replayNative, worldSync } from '../engine.ts';
import { loadRecording } from '../load.ts';
import { compareVehicleMove, comparePhases, PHASE_FIELDS } from '../phases.ts';
import { toNative } from '../seed.ts';

const fixture = (name: string) => loadRecording(join(fileURLToPath(new URL('fixtures/26.3/physrec', import.meta.url)), `${name}.jsonl.gz`));
const seed = { version: '26.3', pre: {}, post: {}, swiftSneak: 0 };
const snapshot = (pos: number[], vel: number[]): Snapshot => ({ pos, vel, oldPos: pos, look: [0, 0, 1], stuckSpeedMultiplier: [0, 0, 0], yRot: 0, xRot: 0, bbWidth: 0.6, bbHeight: 1.8, eyeHeight: 1.62, movementSpeed: 0.1, onGround: false });
const trace = (name: string, state: Snapshot, occurrence = 0): NativeTickPhase => ({ name, occurrence, state: toNative(state, state, seed) });

/** Vanilla's phases and the engine's trace of a tick, the same at every point. */
function tick(states: Partial<Record<string, Snapshot>> = {}) {
    const state = snapshot([0, 0, 0], [0, 0, 0]);
    const names = NATIVE_PHASES.filter(n => n !== 'clientTickEnd');
    return {
        row: { t: 3, phases: names.map(name => ({ name, state })), post: state },
        traced: [...names.map(name => trace(name, states[name] ?? state)), trace('clientTickEnd', state)],
    };
}

test('the same trace compares every field of every phase and finds nothing', () => {
    const { row, traced } = tick();
    const seen = comparePhases(traced, row, seed, { noTravel: false });
    assert.deepEqual(seen.divergences, []);
    assert.deepEqual(seen.problems, []);
    assert.equal(seen.compared, NATIVE_PHASES.reduce((n, name) => n + PHASE_FIELDS[name].length, 0));
    assert.equal(seen.counts['beforeMove.velocity'], 1);
});

test('two errors that cancel by the end of the tick fail at the phase between them', () => {
    const wrong = snapshot([0, 0, 0], [1e-9, 0, 0]);
    const { row, traced } = tick({ beforeMove: wrong });
    const seen = comparePhases(traced, row, seed, { noTravel: false });
    assert.deepEqual(seen.divergences.map(d => [d.tick, d.at, d.field]), [[3, 'beforeMove', 'vel']]);
    assert.equal(seen.divergences[0]!.delta, 1e-9);
});

test('a field the release does not have is not compared at any phase', () => {
    const { row, traced } = tick();
    const old = { ...seed, version: '1.13.2' };
    const seen = comparePhases(traced, row, old, { noTravel: false });
    assert.equal(seen.counts['afterMove.verticalCollisionBelow'], undefined);
    assert.equal(seen.counts['afterMove.onGround'], 1);
    assert.equal(comparePhases(traced, row, seed, { noTravel: false }).counts['afterMove.verticalCollisionBelow'], 1);
});

test('a phase one side lacks is a problem', () => {
    const { row, traced } = tick();
    assert.match(comparePhases(traced.filter(p => p.name !== 'afterMove'), row, seed, { noTravel: false }).problems.join(), /t=3: the engine did not pass afterMove/);
    const without = { ...row, phases: row.phases.filter(p => p.name !== 'beforeTravel') };
    assert.match(comparePhases(traced, without, seed, { noTravel: false }).problems.join(), /t=3: vanilla has no beforeTravel/);
    const neither = comparePhases(traced.filter(p => p.name !== 'beforeMove'), { ...row, phases: row.phases.filter(p => p.name !== 'beforeMove') }, seed, { noTravel: false });
    assert.match(neither.problems.join(), /neither side passed beforeMove/);
});

test('a tick that does not travel owes nothing past its end', () => {
    const { row } = tick();
    const seen = comparePhases([], row, seed, { noTravel: true });
    assert.deepEqual(seen.problems, []);
    assert.equal(seen.compared, 0);
});

test('a repeated phase is compared in its order, and a different count is ambiguous', () => {
    const { row, traced } = tick();
    const first = snapshot([0, 0, 0], [1, 0, 0]);
    const second = snapshot([0, 0, 0], [2, 0, 0]);
    const twice = { ...row, phases: [...row.phases.filter(p => p.name !== 'beforeMove'), { name: 'beforeMove', state: first }, { name: 'beforeMove', state: second }] };
    const native = traced.filter(p => p.name !== 'beforeMove');
    const ordered = comparePhases([...native, trace('beforeMove', first, 0), trace('beforeMove', second, 1)], twice, seed, { noTravel: false });
    assert.deepEqual(ordered.divergences, []);
    assert.equal(ordered.counts['beforeMove.velocity'], 2);
    const swapped = comparePhases([...native, trace('beforeMove', second, 0), trace('beforeMove', first, 1)], twice, seed, { noTravel: false });
    assert.deepEqual(swapped.divergences.map(d => d.at), ['beforeMove#0', 'beforeMove#1']);
    assert.match(comparePhases([...native, trace('beforeMove', first)], twice, seed, { noTravel: false }).problems.join(), /beforeMove ran 2 times in vanilla and 1 in the engine/);
});

test('on a real tick: sinking in water is a Vec3.add, which clears a horizontal -0.0', () => {
    // (vanilla's +0 at beforeLivingAiStep: the end of the tick never showed it, as the 0.003 cut comes after)
    const seen = replayNative(fixture('b_climb_sneak_hold_ladder_water'), { phases: true });
    assert.equal(seen.first, undefined);
});

test('a ridden vehicle moves once a tick, and ends where the engine ended it', () => {
    const recording = fixture('cf_ride_horse_stops_in_web');
    const clean = replayNative(recording, { phases: true });
    assert.equal(clean.first, undefined);
    assert.deepEqual(clean.problems, []);
    const at = recording.rows.find(r => r.vehiclePhases.length === 2)!.t + 10;
    const moved = { ...recording, rows: recording.rows.map(row => (row.t === at ? { ...row, vehiclePhases: row.vehiclePhases.map(p => (p.name === 'vehicleAfterMove' ? { ...p, state: { ...p.state, pos: [0, 0, 0] } } : p)) } : row)) };
    const seen = replayNative(moved, { phases: true });
    assert.deepEqual([seen.first?.tick, seen.first?.at, seen.first?.field], [at, 'vehicleAfterMove', 'vehicle.pos']);
    assert.equal(replayNative(moved).first, undefined, 'the tick\'s end alone sees nothing');
    const gone = { ...recording, rows: recording.rows.map(row => (row.t === at ? { ...row, vehiclePhases: [] } : row)) };
    assert.match(replayNative(gone, { phases: true }).problems.join(), /move has 0 points in vanilla and 2 in the engine/);
});

test('a recording from before the vehicle phases is read as it was', () => {
    const recording = fixture('v_dismount_boat_pocket');
    assert.ok(recording.rows.every(r => r.vehiclePhases.length === 0));
    assert.deepEqual(replayNative(recording, { phases: true }).problems, []);
});

/** The recording with one recorded value of a phase changed, and nothing else. */
function corrupt(recording: Recording, t: number, name: string, change: (s: Snapshot) => Snapshot): Recording {
    return { ...recording, rows: recording.rows.map(row => (row.t === t ? { ...row, phases: row.phases.map(p => (p.name === name ? { ...p, state: change(p.state) } : p)) } : row)) };
}

test('on a real tick: a change at one phase is reported there, and the endpoint alone sees nothing', () => {
    const recording = fixture('j_walk_f');
    const changed = corrupt(recording, 20, 'beforeMove', s => ({ ...s, vel: (s.vel as number[]).map(v => v + 1e-9) }));
    assert.equal(replayNative(changed).first, undefined);
    const seen = replayNative(changed, { phases: true });
    assert.deepEqual([seen.first?.tick, seen.first?.at, seen.first?.field], [20, 'beforeMove', 'vel']);
    assert.ok(seen.phases!.compared > 1000);
    assert.equal(replayNative(recording, { phases: true }).first, undefined);
});

test('on a real tick: a vanilla phase gone from the recording is a problem', () => {
    const recording = fixture('j_walk_f');
    const gone = { ...recording, rows: recording.rows.map(row => (row.t === 20 ? { ...row, phases: row.phases.filter(p => p.name !== 'afterMove') } : row)) };
    assert.match(replayNative(gone, { phases: true }).problems.join(), /t=20: vanilla has no afterMove/);
});

test('a traced tick is the same tick, to the bit', () => {
    const native = nativeBinding();
    const recording = fixture('j_hop_held');
    const { sync, area } = worldSync(recording);
    for (const row of recording.rows.slice(0, 30)) {
        const start = row.phases.find(p => p.name === 'tickStart')!.state;
        const decided = row.phases.find(p => p.name === 'beforeLivingAiStep')!.state;
        const box = start.box as number[];
        sync.sync(area, { minX: box[0]!, minY: box[1]! - 2, minZ: box[2]!, maxX: box[3]!, maxY: box[4]! + 2, maxZ: box[5]! }, 4);
        const state = toNative(start, decided, { version: '26.3', pre: row.pre, post: row.post, swiftSneak: 0 });
        const plain = native.simulateVersionedTick('26.3', sync.world as never, structuredClone(state), {});
        const traced = native.simulateVersionedTickTraced('26.3', sync.world as never, structuredClone(state), {});
        assert.deepEqual(traced.state, plain, `t=${row.t}`);
        assert.deepEqual(traced.phases.map(p => p.name), NATIVE_PHASES);
    }
});

test('a vehicle\'s move is held at its head and its tail, by motion and place, and any other count of them is a problem', () => {
    const at = (x: number, vx: number) => ({ pos: [x, 64, 0], vel: [vx, 0, 0] });
    const row = { t: 3, vehiclePhases: [{ name: 'vehicleBeforeMove', state: at(1, 0.5) }, { name: 'vehicleAfterMove', state: at(1.5, 0.5) }] } as never;
    const engine = (x: number, vx: number) => ({ position: { x, y: 64, z: 0 }, velocity: { x: vx, y: 0, z: 0 } });
    const same = [{ name: 'vehicleBeforeMove', ...engine(1, 0.5) }, { name: 'vehicleAfterMove', ...engine(1.5, 0.5) }];
    assert.deepEqual(compareVehicleMove(row, same, true), { divergences: [], problems: [] });
    // (the same end by another way: the head says so)
    const shifted = compareVehicleMove(row, [{ name: 'vehicleBeforeMove', ...engine(1.25, 0.25) }, same[1]!], true);
    assert.deepEqual(shifted.divergences.map(d => [d.at, d.field]), [['vehicleBeforeMove', 'vehicle.pos'], ['vehicleBeforeMove', 'vehicle.vel']]);
    assert.equal(compareVehicleMove(row, same.slice(0, 1), true).problems.length, 1);
    // (a recording from before the phases says nothing)
    assert.deepEqual(compareVehicleMove(row, [], false), { divergences: [], problems: [] });
});

test('the travel vector and the jump are held at beforeTravel: a wrong one is seen', () => {
    const recording = fixture('j_walk_f');
    const at = recording.rows.find(r => r.playerTicked && r.phases.some(p => p.name === 'beforeTravel'))!.t;
    const wrong = (field: string, value: unknown) => ({ ...recording, rows: recording.rows.map(row => (row.t === at ? { ...row, phases: row.phases.map(p => (p.name === 'beforeTravel' ? { ...p, state: { ...p.state, [field]: value } } : p)) } : row)) });
    assert.equal(replayNative(recording, { phases: true }).first, undefined);
    for (const [field, value] of [['xxa', 0.5], ['yya', 0.5], ['zza', 0.5], ['jumping', true]] as const) {
        const seen = replayNative(wrong(field, value), { phases: true });
        assert.deepEqual([seen.first?.tick, seen.first?.at, seen.first?.field], [at, 'beforeTravel', field]);
    }
});
