// The projectile comparison itself: a recorded path off by one ulp, or a fall in health no hit explains, must show.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadRecording } from '../load.ts';
import { outOfView, replayProjectiles } from '../projectile.ts';
import { findRecordings, recordingsRoot } from '../recordings.ts';

const files = findRecordings(recordingsRoot()).filter(f => f.id === 'physrec/pj_arrow_misses_target');
type Mutable = { pos: number[]; health?: number; type: string };

test('a projectile path off by one ulp is reported at its tick', { skip: files.length === 0 }, () => {
    const recording = loadRecording(files[0]!.file);
    assert.equal(replayProjectiles(recording).first, undefined);
    const rows = recording.rows.filter(row => (row.srv?.entities as unknown as Mutable[] | undefined)?.some(e => /arrow/i.test(e.type)));
    const row = rows[4]!;
    const arrow = (row.srv!.entities as unknown as Mutable[]).find(e => /arrow/i.test(e.type))!;
    arrow.pos[0] = arrow.pos[0]! * (1 + Number.EPSILON);
    const result = replayProjectiles(recording);
    assert.equal(result.first?.t, row.t);
    assert.equal(result.first?.field, 'pos');
});

test('a fall in health without a hit is reported', { skip: files.length === 0 }, () => {
    const recording = loadRecording(files[0]!.file);
    for (const row of recording.rows.slice(-8)) {
        for (const e of (row.srv?.entities ?? []) as unknown as Mutable[]) if (e.health !== undefined) e.health -= 1;
        break;
    }
    const result = replayProjectiles(recording);
    assert.equal(result.first?.field, 'hit');
});

test('a projectile flown out of the area\'s box is out of the server\'s view, not gone', () => {
    // (pj_firework_climbs_into_wall on 1.16: the area ends at x 26, and the rocket's next box starts past 27)
    const recording = { header: { world: { origin: [0, 100, 0], area: { box: [-18, -12, -14, 26, 26, 14] } } } } as never;
    const rocket = { pos: [23.734431575230197, 105.14, 0.5] as const, box: [23.609431575230197, 105.14, 0.375, 23.859431575230197, 105.39, 0.625] as const };
    assert.equal(outOfView(recording, rocket, { x: 27.2, y: 105.7, z: 0.5 }), true);
    assert.equal(outOfView(recording, rocket, { x: 26.9, y: 105.7, z: 0.5 }), false);
    // (below the area is still in it, down to y -256; above its top is not)
    assert.equal(outOfView(recording, rocket, { x: 0, y: 20, z: 0.5 }), false);
    assert.equal(outOfView(recording, rocket, { x: 0, y: 127.1, z: 0.5 }), true);
    assert.equal(outOfView(recording, undefined, { x: 99, y: 0, z: 0 }), false);
});
