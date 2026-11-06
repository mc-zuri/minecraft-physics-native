// The health a block's contact took, against what the engine reports.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareContact, compareFreezing, compareWallImpacts } from '../compare.ts';

const healths = (...drops: number[]) => {
    let health = 20;
    return Array.from({ length: 40 }, (_, t) => {
        if (drops.includes(t)) health -= 1;
        return { t, health };
    });
};
const touching = (from: number, to: number, damage = 1) => Array.from({ length: to - from }, (_, i) => ({ t: from + i, damage }));

test('hits of the damage reported, a tick after it or on it, match', () => {
    assert.deepEqual(compareContact(touching(11, 30), healths(12, 21)), []);
    assert.deepEqual(compareContact(touching(8, 30), healths(8, 18, 28)), []);
});

test('a hit of another damage than the engine reported fails', () => {
    const [wrong] = compareContact(touching(11, 20, 2), healths(12));
    assert.deepEqual([wrong?.field, wrong?.tick, wrong?.expected, wrong?.actual], ['contactDamage', 12, 1, 2]);
});

test('a freeze hit is one fall of the health, on its tick or the next', () => {
    const hits = (...ticks: number[]) => ticks.map(t => ({ t, damage: 1 }));
    assert.deepEqual(compareFreezing(hits(11, 31), healths(12, 32)), []);
    assert.deepEqual(compareFreezing(hits(12), healths(12)), []);
    // (a hit no fall answers, even within what a block's contact is allowed)
    const [unanswered] = compareFreezing(hits(11, 19), healths(12));
    assert.deepEqual([unanswered?.field, unanswered?.tick, unanswered?.expected, unanswered?.actual], ['freezeDamage', 19, 0, 1]);
    assert.equal(compareFreezing([], healths(12))[0]?.actual, 0);
});

test('a hit with no contact reported fails, and contact with no hit', () => {
    assert.equal(compareContact([], healths(12))[0]?.actual, 0);
    assert.equal(compareContact(touching(11, 20), [])[0]?.expected, 0);
    // (past what invulnerability keeps out)
    assert.equal(compareContact(touching(11, 30), healths(12)).length, 1);
});

test('a wall impact is a fall of the health of its damage, a tick after it or on it', () => {
    const health = (t0: number, lost: number) => Array.from({ length: 20 }, (_, t) => ({ t, health: t >= t0 ? 20 - lost : 20 }));
    assert.deepEqual(compareWallImpacts([{ t: 9, damage: 6.5 }], health(10, 6.5)), []);
    assert.deepEqual(compareWallImpacts([{ t: 10, damage: 6.5 }], health(10, 6.5)), []);
    assert.equal(compareWallImpacts([{ t: 9, damage: 6 }], health(10, 6.5))[0]?.actual, 6);
    assert.equal(compareWallImpacts([], health(10, 6.5))[0]?.actual, 0);
    assert.equal(compareWallImpacts([{ t: 9, damage: 6.5 }], health(30, 6.5))[0]?.expected, 0);
});
