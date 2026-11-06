// The observation radius: a recording says how much of it the worst tick leaves.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Recording } from '../../schema/recording.ts';
import { observationMargin, OBSERVATION_RADIUS } from '../radius.ts';

const row = (t: number, x: number, entities: object[] = []) => ({
    t, pre: { pos: [x, 0, 0], nearbyEntities: entities }, post: { pos: [x + 1, 0, 0], bbWidth: 0.6, bbHeight: 1.8 },
}) as never;
const recording = (...rows: never[]) => ({ rows }) as unknown as Pick<Recording, 'rows'>;

test('the room left is the radius less both moves and both sizes, at the tick that leaves least', () => {
    const fast = { pos: [5, 0, 0], vel: [0, 2, 0], box: [4, 0, -1, 6, 2, 1] };
    const result = observationMargin(recording(row(0, 0), row(1, 0, [fast])));
    assert.equal(result.fastest, 2);
    assert.equal(result.largest, 1);
    assert.ok(Math.abs(result.margin - (OBSERVATION_RADIUS - 1 - 2 - 1 - 0.9)) < 1e-9);
});

test('what could reach the player from outside the list leaves no room', () => {
    const missile = { pos: [5, 0, 0], vel: [20, 0, 0], box: [4, 0, -1, 6, 2, 1] };
    assert.ok(observationMargin(recording(row(7, 0, [missile]))).margin <= 0);
});
