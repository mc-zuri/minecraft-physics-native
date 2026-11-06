// The codec the replay reads with is the fork mineflayer loads, wherever the checkout is: the published
// minecraft-protocol has no vecDelta and misreads lpVec3, and a worktree has no fork beside it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeClientbound } from '../packets.ts';

test('a low-precision motion reads as LpVec3 packs it and encodes back to its bytes', () => {
    // (hz_cactus_walk_into at t=13. 26.3 LpVec3.java:30-43: f9 is scale 1 and no continuation, and the 15-bit
    // fields of 7ffeebed ff f9 are 16383, 15356 and 16383: 0, -1027 / 16383 and 0)
    for (const [version, id] of [['1.21.9', '63'], ['26.2', '65'], ['26.3', '67']] as const) {
        const { params, roundTrip } = decodeClientbound(version, Buffer.from(`${id}01f9ff7ffeebed`, 'hex'));
        assert.deepEqual(params, { entityId: 1, velocity: { x: 0, y: -0.0783739241897089, z: 0 } });
        assert.equal(roundTrip, true);
    }
});

test('a motion past 3 carries the rest of its scale in a var-int', () => {
    // (LpVec3.write of 5.5, -0.25, 1: the scale 6 is 2 | 4 in the markers and 1 in the var-int, LpVec3.java:55-68)
    const { params, roundTrip } = decodeClientbound('26.3', Buffer.from('67014ed59554f55301', 'hex'));
    assert.deepEqual(params, { entityId: 1, velocity: { x: 5.5000915583226515, y: -0.25013733748397704, z: 1.0001831166453035 } });
    assert.equal(roundTrip, true);
});

test('26.3 reads the entity moves that carry their steps', () => {
    // (v_horse_walk at t=3. 26.3 ClientboundMoveEntityPacket.java:101-102: the id, then onGround and one step, its
    // 3 ticks and delta)
    const { name, params, roundTrip } = decodeClientbound('26.3', Buffer.from('36c1a4a83a030308fb00000000', 'hex'));
    assert.equal(name, 'rel_entity_move');
    assert.deepEqual(params, { entityId: 122294849, delta: { onGround: true, steps: [{ ticks: 3, dX: 2299, dY: 0, dZ: 0 }] } });
    assert.equal(roundTrip, true);
});
