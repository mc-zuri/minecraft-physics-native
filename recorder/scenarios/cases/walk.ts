// Ground movement on a flat floor: walking, sprinting, sneaking and jumping in every direction.

import {
    DIRS8, at, cond, expect, floorArea, hold, look, matrix, press, release, releaseAll, scenario, stopped, ticks, turn, until,
} from '../dsl/index.ts';

const stone = floorArea('stone', 12);

export default [
    scenario('walk/forward_stone', {
        tags: ['walk', 'smoke'],
        area: stone,
        start: at(0, 0, -8),
        body: [press('forward', 40), stopped(3)],
        expect: [expect.on('stone'), expect.noCorrections(), expect.staysInArea()],
    }),

    ...matrix({ dir: DIRS8, mode: ['walk', 'sprint', 'sneak'] as const }, ({ dir, mode }) =>
        scenario(`walk/${mode}_${dir.name}`, {
            tags: ['walk', mode],
            area: stone,
            start: at(0, 0, 0),
            body: [
                hold(...dir.keys, ...(mode === 'walk' ? [] : [mode])),
                ticks(20),
                releaseAll(),
                stopped(3),
            ],
            expect: [expect.on('stone'), expect.noCorrections()],
        })),

    ...matrix({ dir: DIRS8, sprint: [false, true] }, ({ dir, sprint }) =>
        scenario(`jump/stone_${dir.name}${sprint ? '_sprint' : ''}`, {
            tags: ['jump'],
            area: stone,
            start: at(0, 0, 0),
            body: [
                hold(...dir.keys, ...(sprint ? ['sprint' as const] : [])),
                ticks(2),
                press('jump', 1),
                until(cond.onGround(), 40),
                releaseAll(),
                stopped(3),
            ],
            expect: [expect.on('stone')],
        })),

    scenario('jump/held_bunny_hop', {
        tags: ['jump'],
        area: stone,
        start: at(0, 0, -8),
        body: [hold('forward', 'sprint', 'jump'), ticks(60), releaseAll(), stopped(3)],
    }),

    scenario('walk/turn_while_sprinting', {
        tags: ['walk', 'look'],
        area: stone,
        start: at(0, 0, -6),
        body: [hold('forward', 'sprint'), ticks(5), turn(180, 0, 20), release('sprint'), ticks(5), look(-90, 30), ticks(5), releaseAll(), stopped(3)],
    }),
];
