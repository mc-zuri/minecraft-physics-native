// The moving entities' replay must not hide an engine difference, and must read the entity's random as Java does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Recording, Snapshot } from '../../schema/recording.ts';
import { nativeBinding } from '../engine.ts';
import { loadRecording } from '../load.ts';
import { drawsBetween, replayMovingEntities } from '../moving-entities.ts';
import { findRecordings } from '../recordings.ts';

const file = findRecordings().find(f => f.id === 'physrec/me_item_falls_and_rests');

test('the draws between two states of a random are java.util.Random\'s', () => {
    // new Random(42): setSeed scrambles the seed, and the first nextFloat() is 0.7275637F
    const seed = (42n ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n);
    const next = (seed * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n);
    assert.deepEqual(drawsBetween(seed, next)!.map(x => Math.fround(x)), [Math.fround(0.7275637)]);
    assert.deepEqual(drawsBetween(seed, seed), []);
    assert.equal(drawsBetween(seed, 12345n, 8), undefined);
});

/** The recording with the one entity of the server's view at tick t changed. */
function changed(r: Recording, t: number, change: (e: Snapshot) => Snapshot | null): Recording {
    const rows = r.rows.map(row => {
        if (row.t !== t || !row.srv) return row;
        const entities = row.srv.entities.map(change).filter(e => e !== null) as Snapshot[];
        return { ...row, srv: { ...row.srv, entities } };
    });
    return { ...r, rows };
}

test('a recorded motion changed by one ulp is reported at its tick and entity', { skip: file ? false : 'no recording' }, () => {
    const recording = loadRecording(file!.file);
    assert.equal(replayMovingEntities(recording, nativeBinding()).diverged, 0);
    const t = 5;
    const moved = changed(recording, t, e => {
        const [x, y, z] = e.vel as number[];
        return { ...e, vel: [x! * (1 + Number.EPSILON), y, z] };
    });
    const result = replayMovingEntities(moved, nativeBinding());
    assert.equal(result.first?.tick, t);
    assert.equal(result.first?.field, 'vel');
    assert.match(result.first?.at ?? '', /^item#/);
});

test('an entity the engine keeps and the server lost is counted, not matched', { skip: file ? false : 'no recording' }, () => {
    const recording = loadRecording(file!.file);
    const result = replayMovingEntities(changed(recording, 5, () => null), nativeBinding());
    assert.equal(result.gone, 1);
});

const dragon = findRecordings().find(f => f.id === 'physrec/me_dragon_circles');
const cow = findRecordings().find(f => f.id === 'physrec/me_mob_cow_falls');

test('a dragon\'s flight and a part of it changed by one ulp are reported', { skip: dragon ? false : 'no recording' }, () => {
    const recording = loadRecording(dragon!.file);
    assert.equal(replayMovingEntities(recording, nativeBinding()).diverged, 0);
    const t = recording.rows.find(row => (row.srv?.entities as unknown as { dragon?: { from?: unknown } }[] | undefined)?.some(e => e.dragon?.from))!.t;
    const pos = changed(recording, t, e => {
        const seen = e as unknown as { dragon?: { to: { vel: number[] } } };
        if (!seen.dragon) return e;
        const [x, y, z] = seen.dragon.to.vel;
        return { ...e, dragon: { ...seen.dragon, to: { ...seen.dragon.to, vel: [x! * (1 + Number.EPSILON), y, z] } } } as unknown as Snapshot;
    });
    assert.equal(replayMovingEntities(pos, nativeBinding()).first?.field, 'vel');
    const part = changed(recording, t, e => {
        const seen = e as unknown as { dragon?: { parts: { box: number[] }[] } };
        if (!seen.dragon) return e;
        const parts = seen.dragon.parts.map((p, i) => i === 2 ? { ...p, box: [p.box[0]! + 1e-9, ...p.box.slice(1)] } : p);
        return { ...e, dragon: { ...seen.dragon, parts } } as unknown as Snapshot;
    });
    assert.equal(replayMovingEntities(part, nativeBinding()).first?.field, 'part 2 box');
});

test('a mob\'s fall distance changed is reported', { skip: cow ? false : 'no recording' }, () => {
    const recording = loadRecording(cow!.file);
    assert.equal(replayMovingEntities(recording, nativeBinding()).diverged, 0);
    const t = recording.rows.find(row => (row.srv?.entities as unknown as { travelTo?: { fallDistance: number } }[] | undefined)?.some(e => (e.travelTo?.fallDistance ?? 0) > 1))!.t;
    const moved = changed(recording, t, e => {
        const seen = e as unknown as { travelTo?: Record<string, unknown> };
        return seen.travelTo ? { ...e, travelTo: { ...seen.travelTo, fallDistance: 0 } } as unknown as Snapshot : e;
    });
    assert.equal(replayMovingEntities(moved, nativeBinding()).first?.field, 'fallDistance');
});
