// The replay must not hide an engine difference: a change to one recorded value is reported at its tick and field,
// a value the engine does not give back is a divergence, and every field the registry maps is compared.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_SIM } from '../../schema/fields.ts';
import type { Recording, Snapshot } from '../../schema/recording.ts';
import { compareNative } from '../compare.ts';
import { replayNative } from '../engine.ts';
import { loadRecording } from '../load.ts';
import { findRecordings } from '../recordings.ts';

const where = { tick: 0, at: 'afterAiStep', source: 'native' as const };

test('a value the engine leaves out is a divergence', () => {
    const d = compareNative({ position: { x: 1, y: 2, z: 3 } }, {}, where);
    assert.deepEqual(d.map(x => [x.field, x.actual]), [['pos', '<missing>']]);
});

test('every field the registry maps from the recording is compared', () => {
    const mapped = Object.entries(NATIVE_SIM).filter(([, m]) => 'from' in m && typeof m.from === 'string').map(([k]) => k);
    // each gets its own sentinel on one side only: all must come back as divergences
    const expected = Object.fromEntries(mapped.map(k => [k, 1]));
    const actual = Object.fromEntries(mapped.map(k => [k, 2]));
    assert.equal(compareNative(expected, actual, where).length, mapped.length);
});

test('-0 and 0 differ', () => {
    assert.equal(compareNative({ velocity: { x: -0, y: 0, z: 0 } }, { velocity: { x: 0, y: 0, z: 0 } }, where).length, 1);
});

const file = findRecordings().find(f => f.id === 'physrec/j_strafe_circle');

/** The recording with one value at afterAiStep of tick t changed. */
function corrupt(r: Recording, t: number, field: string, change: (v: unknown) => unknown): Recording {
    const rows = r.rows.map(row => {
        if (row.t !== t) return row;
        const phases = row.phases.map(p => (p.name === 'afterAiStep' ? { ...p, state: { ...p.state, [field]: change(p.state[field]) } as Snapshot } : p));
        return { ...row, phases };
    });
    return { ...r, rows };
}

test('a recorded value changed by one ulp is reported at its tick and field', { skip: file ? false : 'no recording of physrec/j_strafe_circle' }, () => {
    const r = loadRecording(file!.file);
    assert.equal(replayNative(r).first, undefined, 'the recording replays clean to begin with');
    const t = r.rows[20]!.t;
    const ulp = (v: unknown) => {
        const [x, y, z] = v as number[];
        const next = new Float64Array([x!]);
        new BigInt64Array(next.buffer)[0]! += 1n;
        return [next[0], y, z];
    };
    const result = replayNative(corrupt(r, t, 'pos', ulp));
    assert.equal(result.first?.tick, t);
    assert.equal(result.first?.field, 'pos');
    assert.equal(result.diverged, 1);
});

test('a changed flag is reported too', { skip: file ? false : 'no recording' }, () => {
    const r = loadRecording(file!.file);
    const t = r.rows[10]!.t;
    const result = replayNative(corrupt(r, t, 'isInWater', v => !v));
    assert.equal(result.first?.tick, t);
    assert.equal(result.first?.field, 'isInWater');
});
