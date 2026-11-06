// A gate between two releases, on two vanilla recordings of one scenario: each side matches its own, and the older rules are
// thrown off the newer path by the case that selects the change and not by its control.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkGate, firstDifference, GATES, type Gate } from '../differential.ts';
import { loadRecording } from '../load.ts';

const FIXTURES = fileURLToPath(new URL('fixtures', import.meta.url));
const gate = (name: string) => GATES.find(g => g.gate === name)!;

test('the player\'s radial cutoff of 1.21.5 holds, and a profile shared across it is caught', () => {
    const result = checkGate(gate('1.21.5 horizontal cutoff'), FIXTURES);
    assert.deepEqual(result.problems, []);
    assert.equal(result.status, 'held');
    assert.equal(result.firstDifference, 1);
});

test('the restitution of 26.3 holds, on a landing at exactly the gravity', () => {
    const result = checkGate(gate('26.3 restitution and queries'), FIXTURES);
    assert.deepEqual(result.problems, []);
    assert.equal(result.status, 'held');
});

test('a case that runs the same on both sides selects no branch, and says so', () => {
    const blind: Gate = { ...gate('26.3 restitution and queries'), changed: 'physrec/cf_slime_landing_over_gravity' };
    const result = checkGate(blind, FIXTURES);
    assert.equal(result.status, 'broken');
    assert.match(result.problems.join(), /selects no changed branch/);
    assert.match(result.problems.join(), /cannot see the gate/);
});

test('a control that does move is no control', () => {
    const swapped: Gate = { ...gate('1.21.5 horizontal cutoff'), control: 'physrec/cf_cut_two_small_components' };
    assert.match(checkGate(swapped, FIXTURES).problems.join(), /it is no control/);
});

test('a side with no recording is unavailable: a neighbour does not stand in', () => {
    const empty = mkdtempSync(join(tmpdir(), 'differential-'));
    const result = checkGate(gate('1.21.5 horizontal cutoff'), empty);
    rmSync(empty, { recursive: true, force: true });
    assert.equal(result.status, 'unavailable');
});

test('the two sides of the cutoff are two vanilla runs, of one scenario', () => {
    const file = (v: string) => join(FIXTURES, v, 'physrec', 'cf_cut_two_small_components.jsonl.gz');
    const [older, newer] = [loadRecording(file('1.21.4')), loadRecording(file('1.21.5'))];
    assert.equal(older.header.scenario.id, newer.header.scenario.id);
    assert.notEqual(older.header.mc, newer.header.mc);
    assert.equal(firstDifference(older, newer), 1);
    assert.equal(firstDifference(older, older), undefined);
});
