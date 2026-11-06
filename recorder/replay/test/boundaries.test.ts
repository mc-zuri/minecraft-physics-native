// The seam between one row and the next: an input that arrives a tick early or late is a difference, on recordings of real
// ticks, and the conversions of what acts before and after the player are worked out by hand here. Changing only where a
// seed comes from must show, whatever the position does at the tick's end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIVE_SIM, PLAYER_FIELDS } from '../../schema/fields.ts';
import type { ExpandedRow, Recording, Snapshot } from '../../schema/recording.ts';
import { compareFields, compareNative } from '../compare.ts';
import { replayNative } from '../engine.ts';
import { loadRecording } from '../load.ts';
import { nearbyEntities, toNative } from '../seed.ts';
import { AreaWorld, baselineStats } from '../world.ts';

const fixture = (name: string) => loadRecording(join(fileURLToPath(new URL('fixtures/26.3/physrec', import.meta.url)), `${name}.jsonl.gz`));
const withRows = (r: Recording, rows: readonly ExpandedRow[]): Recording => ({ ...r, rows });
const swapped = (r: Recording, t: number, change: (row: ExpandedRow, next: ExpandedRow) => [ExpandedRow, ExpandedRow]): Recording => {
    const rows = [...r.rows];
    const i = rows.findIndex(x => x.t === t);
    [rows[i], rows[i + 1]] = change(rows[i]!, rows[i + 1]!);
    return withRows(r, rows);
};

const box = (x: number) => [x, 0, 0, x + 1, 1, 1];
const cow = (x: number, tickedBeforePlayer: boolean) => ({ id: 7, type: 'cow', pos: [x, 0, 0], box: box(x), tickedBeforePlayer, order: 0 });
const ctx = (pre: Snapshot, post: Snapshot) => ({ version: '26.3', pre, post, swiftSneak: 0 });

test('what ticks before the player is met from where it was, and what ticks after it from where it is', () => {
    // before the player: at tickStart it has moved already, so it starts at pre and its tick ended at tickStart
    const [before] = nearbyEntities({ nearbyEntities: [cow(2, true)] }, ctx({ nearbyEntities: [cow(1, true)] }, { nearbyEntities: [cow(9, true)] }));
    assert.equal(before!.position.x, 1);
    assert.equal(before!.tickPosition!.x, 2);
    assert.equal(before!.ticksBeforePlayer, true);
    // after it: at tickStart it has not, so it starts there and its tick ends at post
    const [after] = nearbyEntities({ nearbyEntities: [cow(2, false)] }, ctx({ nearbyEntities: [cow(1, false)] }, { nearbyEntities: [cow(9, false)] }));
    assert.equal(after!.position.x, 2);
    assert.equal(after!.tickPosition!.x, 9);
    assert.equal(after!.ticksBeforePlayer, false);
});

test('an entity with no snapshot on the far side stays where it is', () => {
    const [gone] = nearbyEntities({ nearbyEntities: [cow(2, false)] }, ctx({}, {}));
    assert.equal(gone!.tickPosition!.x, 2);
});

test('rockets count on their side of the player, in the row that attached them', () => {
    const start = { pos: [0, 0, 0], box: box(0), nearbyEntities: [] };
    const state: Snapshot = { ...start, vel: [0, 0, 0], oldPos: [0, 0, 0], look: [0, 0, 1], stuckSpeedMultiplier: [0, 0, 0], yRot: 0, xRot: 0 };
    const rockets = [{ id: 1, tickedBeforePlayer: true }, { id: 2, tickedBeforePlayer: false }];
    const seeded = toNative(state, state, ctx({}, { attachedRockets: rockets }));
    assert.equal(seeded.fireworkRockets, 2);
    assert.equal(seeded.fireworkRocketsBeforePlayer, 1);
    assert.equal(toNative(state, state, ctx({}, {})).fireworkRockets, undefined);
});

test('a rocket a tick late is a difference', () => {
    const recording = fixture('f_elytra_rocket_straight_down');
    assert.equal(replayNative(recording).first, undefined);
    const first = recording.rows.find(r => ((r.post.attachedRockets ?? []) as unknown[]).length > 0)!;
    const late = swapped(recording, first.t, (row, next) => [{ ...row, post: { ...row.post, attachedRockets: [] } }, next]);
    assert.ok(replayNative(late).first, 'the boost missing from its row');
});

test('a mount\'s released jump a row early or late is a difference', () => {
    const recording = fixture('v_horse_jump_short_charge');
    assert.equal(replayNative(recording).first, undefined);
    const row = recording.rows.find(r => r.ridingJump !== undefined)!;
    const { ridingJump, ...without } = row;
    const later = swapped(recording, row.t, (_, next) => [without, { ...next, ridingJump: ridingJump! }]);
    assert.ok(replayNative(later).first, 'released a row late');
    const before = recording.rows[recording.rows.indexOf(row) - 1]!;
    const earlier = swapped(recording, before.t, (prior) => [{ ...prior, ridingJump: ridingJump! }, without]);
    assert.ok(replayNative(earlier).first, 'released a row early');
});

test('a boat is compared at its own tick, and a row that moves its input shows', () => {
    const recording = fixture('v_dismount_boat_pocket');
    const clean = replayNative(recording);
    assert.equal(clean.first, undefined);
    assert.ok(clean.compared > 0);
    // the paddles the rider set before the tick, read a row out: the boat's tick starts from the row's pre
    const boat = (s: Snapshot) => (s.vehicle as { boat?: { inputUp: boolean } } | null | undefined)?.boat;
    const held = recording.rows.find(r => boat(r.pre) !== undefined)!;
    const shifted = withRows(recording, recording.rows.map(row => {
        const vehicle = row.pre.vehicle as { boat?: object } | null | undefined;
        return row.t === held.t && vehicle?.boat ? { ...row, pre: { ...row.pre, vehicle: { ...vehicle, boat: { ...vehicle.boat, inputUp: !boat(row.pre)!.inputUp } } } } : row;
    }));
    assert.ok(replayNative(shifted).first, 'a paddle from another row');
});

test('a mount that left and a vehicle that went are not matches', () => {
    const recording = fixture('v_horse_jump_short_charge');
    const row = recording.rows[20]!;
    const gone = swapped(recording, row.t, (r, next) => [{ ...r, post: { ...r.post, vehicle: null } }, next]);
    const seen = replayNative(gone);
    assert.ok(seen.unmodelled > 0, 'the tick is said to be uncompared');
    assert.ok(seen.compared < replayNative(recording).compared);
});

test('a moving piston is pushed by once: its block is no static shape as well', () => {
    const recording = fixture('n_piston_push');
    const seen = replayNative(recording);
    assert.equal(seen.first, undefined);
    assert.ok(seen.compared > 0);
    assert.ok(recording.rows.some(r => ((r.post.movingPistons ?? []) as unknown[]).length > 0), 'a recording with a piston moving');
});

test('the first and last rows and a lost server view are left out by name, not matched', () => {
    const recording = fixture('j_walk_f');
    const noServer = withRows(recording, recording.rows.map(({ srv: _srv, ...row }) => row));
    const seen = replayNative(noServer);
    assert.equal(seen.first, undefined);
    assert.equal(seen.compared, replayNative(recording).compared);
    // the last row has no row after it: whatever is expected from the next row's view is left out there, and not matched
    const cut = withRows(recording, recording.rows.slice(0, 1));
    const one = replayNative(cut);
    assert.equal(one.ticks, 1);
    assert.equal(one.first, undefined);
});

test('a seed from the wrong phase fails even where the tick still ends right', () => {
    const recording = fixture('j_hop_held');
    // the tick's start taken from the last tick's start: one row behind
    const rows = recording.rows.map((row, i) => {
        const earlier = recording.rows[i - 1]?.phases.find(p => p.name === 'tickStart');
        return earlier ? { ...row, phases: row.phases.map(p => (p.name === 'tickStart' ? earlier : p)) } : row;
    });
    assert.ok(replayNative(withRows(recording, rows)).first);
});

test('the seed is what the recording said: every directly mapped field comes through toNative unchanged', () => {
    // (the expected values are the recorded ones, not another conversion's)
    const row = fixture('j_walk_f').rows[20]!;
    const start = row.phases.find(p => p.name === 'tickStart')!.state;
    const seeded = toNative(start, row.phases.find(p => p.name === 'beforeLivingAiStep')!.state) as unknown as Record<string, { x: number; y: number; z: number } & number>;
    assert.deepEqual([seeded.position!.x, seeded.position!.y, seeded.position!.z], start.pos);
    assert.deepEqual([seeded.velocity!.x, seeded.velocity!.y, seeded.velocity!.z], start.vel);
    assert.equal(seeded.fallDistance, start.fallDistance);
    assert.equal(seeded.jumpTicks, start.noJumpDelay);
    assert.equal(seeded.tickCount, start.tickCount);
});

test('one category of each kind of field is compared, and its mutation shows', () => {
    const fields: Record<string, unknown[]> = {
        pos: ['position', { x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3.5 }],
        vel: ['velocity', { x: 0, y: 0, z: 0 }, { x: 0, y: 1e-12, z: 0 }],
        yRot: ['yaw', 0.5, 0.25],
        bbHeight: ['height', 1.8, 0.6],
        onGround: ['onGround', true, false],
        horizontalCollision: ['collidedHorizontally', false, true],
        isInWater: ['inWater', false, true],
        fallDistance: ['fallDistance', 0, 0.5],
        sprinting: ['sprinting', true, false],
        passenger: ['passenger', false, true],
    };
    for (const [field, [key, want, got]] of Object.entries(fields)) {
        assert.ok(field in PLAYER_FIELDS, field);
        const found = compareNative({ [key as string]: want }, { [key as string]: got }, { tick: 4, at: 'afterAiStep', source: 'native' }, new Set(Object.keys(NATIVE_SIM).filter(k => k !== key)));
        assert.deepEqual(found.map(d => [d.tick, d.at, d.field]), [[4, 'afterAiStep', field]], field);
        const missing = compareNative({ [key as string]: want }, {}, { tick: 4, at: 'afterAiStep', source: 'native' }, new Set(Object.keys(NATIVE_SIM).filter(k => k !== key)));
        assert.equal(missing[0]?.actual, '<missing>', `${field} left out by the engine`);
    }
});

test('effects are a set: their order is no difference, their amplifier and their number are', () => {
    const where = { tick: 0, at: 'post', source: 'native' as const };
    const speed = { id: 'speed', amplifier: 0 };
    const jump = { id: 'jump_boost', amplifier: 1 };
    assert.deepEqual(compareFields({ effects: [speed, jump] }, { effects: [jump, speed] }, ['effects'], where), []);
    assert.equal(compareFields({ effects: [speed, jump] }, { effects: [jump, { ...speed, amplifier: 1 }] }, ['effects'], where).length, 1);
    assert.equal(compareFields({ effects: [speed, jump] }, { effects: [jump] }, ['effects'], where).length, 1);
    assert.equal(compareFields({ effects: [speed] }, { effects: [speed, speed] }, ['effects'], where).length, 1);
});

test('the seed reads an effect whatever its place in the list', () => {
    const base = { pos: [0, 0, 0], vel: [0, 0, 0], oldPos: [0, 0, 0], look: [0, 0, 1], stuckSpeedMultiplier: [0, 0, 0], yRot: 0, xRot: 0 };
    const one = toNative(base, { ...base, effects: [{ id: 'speed', amplifier: 2 }, { id: 'levitation', amplifier: 1 }] });
    const other = toNative(base, { ...base, effects: [{ id: 'levitation', amplifier: 1 }, { id: 'speed', amplifier: 2 }] });
    assert.deepEqual(one, other);
    assert.equal(one.speedEffectAmplifier, 2);
    assert.equal(one.levitationAmplifier, 1);
});

test('passengers are an order: who comes first steers', () => {
    const where = { tick: 0, at: 'post', source: 'native' as const };
    const vehicle = (ids: number[]) => ({ id: 1, passengers: ids });
    assert.equal(compareFields({ vehicle: vehicle([2, 3]) }, { vehicle: vehicle([3, 2]) }, ['vehicle'], where).length, 1);
    assert.deepEqual(compareFields({ vehicle: vehicle([2, 3]) }, { vehicle: vehicle([2, 3]) }, ['vehicle'], where), []);
});

test('signed zero, a float widened and a double one bit away are exact', () => {
    const where = { tick: 0, at: 'afterAiStep', source: 'native' as const };
    const keep = new Set(Object.keys(NATIVE_SIM).filter(k => k !== 'fallDistance'));
    assert.equal(compareNative({ fallDistance: -0 }, { fallDistance: 0 }, where, keep).length, 1);
    assert.equal(compareNative({ fallDistance: Math.fround(0.1) }, { fallDistance: Math.fround(0.1) }, where, keep).length, 0);
    assert.equal(compareNative({ fallDistance: Math.fround(0.1) }, { fallDistance: 0.1 }, where, keep).length, 1);
    assert.equal(compareNative({ fallDistance: 0.1 }, { fallDistance: 0.1 + Number.EPSILON / 8 + 1e-17 }, where, keep).length, 1);
});

test('recordings that share a baseline share none of each other\'s changes', () => {
    const header = fixture('j_walk_f').header;
    const first = new AreaWorld(header);
    const second = new AreaWorld(header);
    const at = { x: 3, y: 100, z: 3 };
    const before = second.getBlockStateId(at);
    first.setState(at.x, at.y, at.z, 'gold_block');
    assert.notEqual(first.getBlockStateId(at), before);
    assert.equal(second.getBlockStateId(at), before);
    assert.equal(new AreaWorld(header).getBlockStateId(at), before, 'a later recording finds the baseline untouched');
    assert.ok(baselineStats.shared >= 2);
});

test('a world of another release or other content is not shared', () => {
    const header = fixture('j_walk_f').header;
    const blocks = header.world.blocks!;
    const other = { ...header, world: { ...header.world, blocks: { ...blocks, palette: blocks.palette.map(p => (p === 'air' ? 'air' : 'stone')) } } };
    const expanded = baselineStats.expanded;
    new AreaWorld(other);
    assert.equal(baselineStats.expanded, expanded + 1);
});

test('the replay of a recording is the same with its baseline shared', () => {
    const recording = fixture('j_hop_held');
    assert.equal(JSON.stringify(replayNative(recording)), JSON.stringify(replayNative(recording)));
});
