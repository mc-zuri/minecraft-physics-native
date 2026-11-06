// Block surfaces and the blocks a player moves through: friction, speed factors, bounce, stuck
// multipliers and climbing.

import { area, at, b, cond, expect, floorArea, hold, matrix, press, releaseAll, scenario, stopped, ticks, until, type BlockName } from '../dsl/index.ts';

const FLOORS = ['ice', 'packed_ice', 'blue_ice', 'slime_block', 'honey_block', 'soul_sand', 'mud', 'magma_block'] as const satisfies readonly BlockName[];

export default [
    ...matrix({ floor: FLOORS, sprint: [false, true] }, ({ floor, sprint }) =>
        scenario(`surface/${floor}${sprint ? '_sprint' : ''}`, {
            tags: ['surface'],
            area: floorArea(floor, 12),
            start: at(0, 0, -8),
            body: [hold('forward', ...(sprint ? ['sprint' as const] : [])), ticks(20), releaseAll(), stopped(3, 300)],
            expect: [expect.on(floor)],
        })),

    ...matrix({ floor: FLOORS }, ({ floor }) =>
        scenario(`surface/${floor}_jump`, {
            tags: ['surface', 'jump'],
            area: floorArea(floor, 12),
            start: at(0, 0, -8),
            body: [hold('forward'), ticks(3), press('jump', 1), until(cond.onGround(), 60), releaseAll(), stopped(3, 300)],
        })),

    scenario('surface/slime_fall_bounce', {
        tags: ['surface', 'fall'],
        area: floorArea('slime_block', 6),
        start: at(0, 8, 0, { grounded: false }),
        body: [until(cond.onGround(), 200), stopped(5, 400)],
    }),

    scenario('surface/cobweb_walk', {
        tags: ['surface', 'stuck'],
        area: area('cobweb_lane', { radius: 10 }, a => a.floor('stone', 8).walls(8).fill([0, 0, -2], [0, 1, 4], 'cobweb')),
        start: at(0, 0, -4),
        body: [hold('forward'), ticks(60), releaseAll(), stopped(3)],
        expect: [expect.in('cobweb')],
    }),

    scenario('surface/top_slab_step', {
        tags: ['collision', 'step'],
        area: floorArea(b('smooth_stone_slab', { type: 'double' }), 8),
        start: at(0, 0, -6),
        body: [hold('forward'), ticks(30), releaseAll(), stopped(3)],
    }),
];
