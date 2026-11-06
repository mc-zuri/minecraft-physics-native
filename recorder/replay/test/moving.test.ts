// The states of the moving blocks, from what the recording says of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movingBlocks } from '../moving.ts';
import type { AreaWorld } from '../world.ts';

const area = { block: (state: string) => state } as unknown as AreaWorld;
const piston = (over: object) => ({ pos: [1, 2, 3], facing: 'up', extending: true, source: true, progress: 0, ...over });
const blocks = (version: string, over: object) => {
    const problems: string[] = [];
    const out = movingBlocks(version, { movingPistons: [piston(over)] }, area, problems);
    return { out, problems };
};

test('a source piston shows its head from 1.11, short by its progress (26.3 PistonMovingBlockEntity.java:340-344)', () => {
    const head = 'minecraft:piston_head[facing=up,short=false,type=normal]';
    const held = (progress: number) => blocks('26.3', { moved: head, progress }).out[0]!.block;
    assert.equal(held(0), 'piston_head[facing=up,short=true]');
    assert.equal(held(0.5), 'piston_head[facing=up,short=true]');
    assert.equal(held(1), 'piston_head[facing=up,short=false]');
    const back = (progress: number) => blocks('26.3', { moved: 'minecraft:piston[extended=false,facing=up]', extending: false, progress }).out[0]!;
    assert.equal(back(0).block, 'piston_head[facing=up,short=false]');
    assert.equal(back(1).block, 'piston_head[facing=up,short=true]');
    assert.equal(back(0).base, 'piston[extended=true,facing=up]');
    // before 1.11 the block it holds, and no base
    const old = blocks('1.8.8', { moved: '#29:1', extending: false }).out[0]!;
    assert.equal(old.block, '#29:1');
    assert.equal(old.base, undefined);
    // the numbers of 1.11 - 1.12: the head's, and the base's with its extended bit
    const numbered = blocks('1.12.2', { moved: '#29:1', extending: false }).out[0]!;
    assert.equal(numbered.block, '#34:1');
    assert.equal(numbered.base, '#29:9');
});

test('a block it moves is that block; extending, nothing stays behind', () => {
    const moved = blocks('26.3', { moved: 'minecraft:stone', source: false }).out[0]!;
    assert.equal(moved.block, 'stone');
    assert.equal(moved.base, undefined);
    assert.equal(moved.facing, 1);
});

test('a moving piston with no block recorded is a problem, not an empty cell', () => {
    const { out, problems } = blocks('26.3', {});
    assert.deepEqual(out, []);
    assert.equal(problems.length, 1);
});
