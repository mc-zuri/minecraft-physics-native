// Only a compared match is a match.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeTally, emptyTally, tallyFails, verdict, type Tally } from '../verdict.ts';
import type { Divergence } from '../compare.ts';

const blank = { problems: [], compared: 10, unmodelled: 0, interpolated: 0, results: [] };
const first = { tick: 3, field: 'vel' } as Divergence;
const diverged = { ...blank, first, results: [{ t: 3, divergences: [first] }] };
const known = { tick: 3, field: 'vel', fields: { vel: 1 }, reason: 'because' };

test('a compared recording with no difference is the only pass', () => {
    assert.equal(verdict(blank, undefined), 'pass');
});

test('a recording with no tick to compare is untested, not a match', () => {
    assert.equal(verdict({ ...blank, compared: 0 }, undefined), 'untested');
});

test('ticks the engine has no model for are unsupported, not a match', () => {
    assert.equal(verdict({ ...blank, compared: 0, unmodelled: 5 }, undefined), 'unsupported');
    assert.equal(verdict({ ...blank, compared: 0, interpolated: 5 }, undefined), 'unsupported');
});

test('a known failure holds only as listed', () => {
    assert.equal(verdict(diverged, known), 'known');
    assert.equal(verdict(diverged, { ...known, tick: 4 }), 'fail');
    assert.equal(verdict(diverged, { ...known, field: 'pos' }), 'fail');
    assert.equal(verdict(diverged, { ...known, fields: { vel: 2 } }), 'fail');
    assert.equal(verdict(diverged, undefined), 'fail');
});

test('a known failure that passes or is not compared any more is a failure of the list', () => {
    assert.equal(verdict(blank, known), 'fail');
    assert.equal(verdict({ ...blank, compared: 0 }, known), 'fail');
});

test('a recording unfit to compare fails, whatever else it says', () => {
    assert.equal(verdict({ ...blank, problems: ['status error'] }, undefined), 'fail');
});

test('a selection with nothing compared fails, and so does any failure', () => {
    const tally = (counts: Partial<Tally>): Tally => ({ ...emptyTally(), ...counts });
    assert.equal(tallyFails(tally({})), true);
    assert.equal(tallyFails(tally({ unsupported: 3, untested: 2 })), true);
    assert.equal(tallyFails(tally({ pass: 1, unsupported: 3 })), false);
    assert.equal(tallyFails(tally({ known: 1 })), false);
    assert.equal(tallyFails(tally({ pass: 5, fail: 1 })), true);
    assert.equal(describeTally(tally({ pass: 1, known: 2, unsupported: 3, untested: 4, fail: 5 })), '1 matching, 2 known, 3 unsupported, 4 untested, 5 unexpected');
});
