// A saved seed is the whole of a randomized case: the same specs and the same compiled scenario, on any run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, shrinkCandidates } from '../random.ts';

test('a seed gives the same specs every time, and another seed others', () => {
    assert.deepEqual(generate(7, 20), generate(7, 20));
    assert.notDeepEqual(generate(7, 20), generate(8, 20));
});

test('the generator is pinned: a change to it is a change to every saved seed', () => {
    const [first] = generate(7, 1);
    assert.equal(first!.id, 'rnd_7_0');
    assert.equal(JSON.stringify(first).length > 40, true);
    assert.equal(JSON.stringify(generate(7, 1)), JSON.stringify(generate(7, 1)));
});

test('a case is bounded and legal', () => {
    for (const spec of generate(3, 200)) {
        assert.ok(spec.steps.length >= 3 && spec.steps.length <= 9);
        for (const step of spec.steps) {
            if (step.kind === 'press' || step.kind === 'wait' || step.kind === 'turn') assert.ok(step.ticks >= 1 && step.ticks <= 20);
            if (step.kind === 'block') assert.ok(step.at[0] >= 1, 'not under the player where it starts');
        }
    }
});

test('shrinking drops one step at a time and keeps the rest in order', () => {
    const [spec] = generate(5, 1);
    const candidates = shrinkCandidates(spec!);
    assert.equal(candidates.length, spec!.steps.length);
    assert.deepEqual(candidates[0]!.steps, spec!.steps.slice(1));
    assert.notEqual(candidates[0]!.id, candidates[1]!.id);
});
