// The projectile comparison itself: a recorded path off by one ulp, or a fall in health no hit explains, must show.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadRecording } from '../load.ts';
import { replayProjectiles } from '../projectile.ts';
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
