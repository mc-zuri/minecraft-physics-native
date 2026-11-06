// The chunk columns the client holds, from what the recorded packets say of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ChunkTracker, columnChanges } from '../chunks.ts';
import { replayNative } from '../engine.ts';
import { loadRecording } from '../load.ts';
import { recordingsRoot } from '../recordings.ts';

test('a full column brings a column, and on 1.8 one of no sections forgets it (1.8.9 ClientPlayNetworkHandler.java:566-574)', () => {
    assert.deepEqual(columnChanges('1.8.8', 'map_chunk', { x: 3, z: -4, groundUp: true, bitMap: 1 }), [[3, -4, true]]);
    assert.deepEqual(columnChanges('1.8.8', 'map_chunk', { x: 3, z: -4, groundUp: true, bitMap: 0 }), [[3, -4, false]]);
    assert.deepEqual(columnChanges('1.12.2', 'map_chunk', { x: 3, z: -4, groundUp: true, bitMap: 0 }), [[3, -4, true]]);
    // (from 1.17 there is no groundUp: every map_chunk is a column)
    assert.deepEqual(columnChanges('26.3', 'map_chunk', { x: 3, z: -4 }), [[3, -4, true]]);
});

test('a map_chunk of some sections changes no column', () => {
    assert.deepEqual(columnChanges('1.8.8', 'map_chunk', { x: 3, z: -4, groundUp: false, bitMap: 1 }), []);
});

test('the bulk packet of 1.8 brings its columns, and unload_chunk forgets one (1.8.9 :993-999, 1.12.2 :649-652)', () => {
    assert.deepEqual(columnChanges('1.8.8', 'map_chunk_bulk', { meta: [{ x: 1, z: 2 }, { x: 3, z: 4 }] }), [[1, 2, true], [3, 4, true]]);
    assert.deepEqual(columnChanges('1.12.2', 'unload_chunk', { chunkX: 5, chunkZ: 6 }), [[5, 6, false]]);
    assert.deepEqual(columnChanges('26.3', 'update_view_position', { chunkX: 5, chunkZ: 6 }), []);
});

const farTeleport = join(recordingsRoot(), '1.8.8', 'physrec', 'cu_tp_away_and_back.jsonl.gz');
test('1.8.8 cu_tp_away_and_back matches by the chunk packets alone', { skip: existsSync(farTeleport) ? false : 'no recording (set REPLAY_RECORDINGS)' }, () => {
    const recording = loadRecording(farTeleport);
    assert.equal(replayNative(recording).first, undefined);
    const removed = { ...recording, rows: recording.rows.map(row => ({ ...row, s2c: row.s2c.filter(p => !/chunk/i.test(p.name)) })) };
    const first = replayNative(removed).first;
    assert.equal(first?.tick, 4);
    assert.equal(first?.field, 'vel');
});

test('a respawn leaves the client only the columns that come after it', () => {
    const tracker = new ChunkTracker('26.3', []);
    assert.equal(tracker.holds(0, 0), true);
    tracker.respawned();
    assert.equal(tracker.holds(0, 0), false);
});
