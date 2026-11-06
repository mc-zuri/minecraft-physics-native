// The border the replay gives the engine, and the landing comparison: no recording has either yet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BorderTracker } from '../border.ts';
import { afterProtection, compareLandings, featherFallingProtection } from '../compare.ts';
import { decodeClientbound } from '../packets.ts';
import { loadRecording, packetBytes } from '../load.ts';
import { existsSync } from 'node:fs';

test('a moving border is read at the size before its last tick and ends static', () => {
    // 26.3 WorldBorder.java:346-357, 370-373, 393-398: the extent starts at `from` with previousSize the same; each
    // level tick takes one tick of the lerp
    const border = new BorderTracker('26.3');
    border.apply('world_border_lerp_size', { oldDiameter: 20, newDiameter: 10, speed: 4 });
    assert.equal(border.changed, true);
    assert.deepEqual(border.state(), { centerX: 0, centerZ: 0, size: 20, previousSize: 20, absoluteMaxSize: 29999984 });
    assert.equal(border.changed, false);
    const sizes = [];
    for (let i = 0; i < 5; i += 1) {
        border.tick();
        const { size, previousSize } = border.state();
        sizes.push([size, previousSize]);
    }
    assert.deepEqual(sizes, [[17.5, 20], [15, 17.5], [12.5, 15], [10, undefined], [10, undefined]]);
});

test('a size or a center takes over at once, in both packet forms', () => {
    const modern = new BorderTracker('1.20.4');
    modern.apply('world_border_center', { x: -3.5, z: 18.5 });
    modern.apply('world_border_size', { diameter: 10 });
    assert.deepEqual(modern.state(), { centerX: -3.5, centerZ: 18.5, size: 10, absoluteMaxSize: 29999984 });
    const legacy = new BorderTracker('1.8.8');
    legacy.apply('world_border', { action: 2, x: -3.5, z: 18.5 });
    legacy.apply('world_border', { action: 0, radius: 10 });
    assert.deepEqual(legacy.state(), { centerX: -3.5, centerZ: 18.5, size: 10, absoluteMaxSize: 29999984 });
    legacy.apply('world_border', { action: 4, warning_time: 15 });
    assert.equal(legacy.changed, false);
});

test('a moving border before 1.21.11 is refused: it runs on the wall clock', () => {
    const border = new BorderTracker('1.21.10');
    border.apply('world_border_lerp_size', { oldDiameter: 20, newDiameter: 10, speed: 4000 });
    assert.equal(border.problems.length, 1);
});

test('the recorded border packets of a release read as the tracker expects', () => {
    for (const version of ['1.8.8', '1.20.4', '26.3']) {
        const root = process.env.REPLAY_RECORDINGS ?? new URL('../../out/recordings', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
        const file = `${root}/${version}/physrec/m_click2_border_use.jsonl.gz`;
        if (!existsSync(file)) continue;
        const border = new BorderTracker(version);
        const row = loadRecording(file).rows.find(r => r.s2c.some(p => /Border/.test(p.name)))!;
        assert.ok(decodeClientbound(version, packetBytes(row.s2c.find(p => /Border/.test(p.name))!.b)));
        border.packets(row.s2c);
        const { size, centerX } = border.state();
        assert.equal(size, 10, version);
        assert.equal(centerX, -3.5, version);
    }
});

test('each landing is held against the health the server took for it', () => {
    const health = [{ t: 0, health: 20 }, { t: 9, health: 20 }, { t: 10, health: 18 }, { t: 11, health: 18 }];
    assert.deepEqual(compareLandings([{ t: 9, damage: 2 }], health), []);
    assert.deepEqual(compareLandings([], [{ t: 0, health: 20 }, { t: 1, health: 20 }]), []);
    assert.deepEqual(compareLandings([{ t: 9, damage: 1 }], health).map(d => [d.expected, d.actual]), [[2, 1]]);
    assert.deepEqual(compareLandings([], health).map(d => [d.expected, d.actual]), [[2, 0]]);
    assert.deepEqual(compareLandings([{ t: 3, damage: 4 }], [{ t: 0, health: 20 }]).map(d => [d.expected, d.actual]), [[0, 4]]);
});

test('a landing through Feather Falling is the float the enchantment leaves, off the health as a float', () => {
    const lost = Math.fround(20 - afterProtection(3, featherFallingProtection(4)));
    assert.equal(lost, 18.440000534057617);
    const health = [{ t: 1, health: 20 }, { t: 2, health: lost }];
    assert.deepEqual(compareLandings([{ t: 1, damage: 3 }], health, featherFallingProtection(4)), []);
    assert.equal(compareLandings([{ t: 1, damage: 3 }], health).length, 1);
    assert.equal(compareLandings([{ t: 1, damage: 4 }], health, featherFallingProtection(4)).length, 1);
});
