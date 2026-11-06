// The engine's world against the client's, cell by cell, with the neighbour-dependent blocks a fill does not say.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRecording } from '../load.ts';
import { compareWorld } from '../world-compare.ts';

const fixture = (name: string) => loadRecording(join(fileURLToPath(new URL('fixtures/26.3/physrec', import.meta.url)), `${name}.jsonl.gz`));

test('a neighbour-dependent setup: the client resolved fences, and the engine holds the same cells', () => {
    const recording = fixture('g_stand_on_fence');
    const palette = recording.header.world.blocks!.palette;
    assert.ok(palette.some(state => /fence.*(east|north|south|west)=true/.test(state)), 'a fence that connected, which the fills do not say');
    const seen = compareWorld(recording, { rows: 0 });
    assert.deepEqual(seen.differences.slice(0, 3), []);
    assert.ok(seen.solid > 100);
});

test('a fluid and a waterlogged block are held as the client has them', () => {
    const seen = compareWorld(fixture('wl_soak_slab'), { rows: 0 });
    assert.deepEqual(seen.differences.slice(0, 3), []);
    assert.ok(seen.fluid > 0);
});

test('the world edits of the rows arrive in the engine', () => {
    const recording = fixture('s_jump_farmland');
    const edited = recording.rows.find(r => r.blocks.length > 0)!;
    assert.ok(edited);
    assert.deepEqual(compareWorld(recording).differences.slice(0, 3), []);
});

test('a block the engine was not told of is a difference at its cell', () => {
    const recording = fixture('j_walk_f');
    const [x, y, z] = recording.rows[0]!.pre.pos as number[];
    const at = [Math.floor(x!) + 1, Math.floor(y!), Math.floor(z!)] as const;
    const seen = compareWorld(recording, { rows: 0, tamper: area => area.setState(...at, 'stone') });
    assert.deepEqual(seen.differences.map(d => [d.x, d.y, d.z, d.field]), [[...at, 'collision']]);
});

test('a fluid behind the engine is a difference of its own', () => {
    const recording = fixture('j_walk_f');
    const [x, y, z] = recording.rows[0]!.pre.pos as number[];
    const at = [Math.floor(x!) + 1, Math.floor(y!), Math.floor(z!)] as const;
    assert.deepEqual(compareWorld(recording, { rows: 0, tamper: area => area.setState(...at, 'water') }).differences.map(d => d.field), ['fluid']);
});
