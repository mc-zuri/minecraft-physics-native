// What the replay tells the engine of the movement speed attribute: the powder snow modifier apart
// from the others, under its UUID up to 1.20.6 and its id from 1.21.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speedAttribute } from '../seed.ts';

test('the frost modifier is told apart from the others', () => {
    const sprint = { id: 'x', amount: 0.3, operation: 'add_multiplied_total' as const };
    for (const [name, id] of [['generic.movement_speed', '1eaf83ff-7207-4596-b37a-d7a07b3ec4ce'], ['movement_speed', 'minecraft:powder_snow']] as const) {
        const attributes = { [name]: { base: 0.1, value: 0.09, modifiers: [{ id, amount: -0.01, operation: 'add_value' }, sprint] } };
        assert.deepEqual(speedAttribute({ attributes }), {
            movementSpeedAttribute: { base: 0.1, modifiers: [{ amount: 0.3, operation: 'add_multiplied_total' }], frost: -0.01 },
        });
    }
});

test('no frost modifier is no frost, and a snapshot with no attribute tells nothing', () => {
    const attributes = { movement_speed: { base: 0.1, value: 0.1, modifiers: [] } };
    assert.deepEqual(speedAttribute({ attributes }), { movementSpeedAttribute: { base: 0.1, modifiers: [] } });
    assert.deepEqual(speedAttribute({}), {});
});
