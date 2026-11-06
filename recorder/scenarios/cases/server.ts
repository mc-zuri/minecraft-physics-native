// What the server does to the player: velocity, knockback, explosions, teleports, effects and
// attribute changes, so the replay sees each S2C packet and the state it leaves.

import { at, cond, expect, floorArea, hold, releaseAll, scenario, server, srv, stopped, ticks, until } from '../dsl/index.ts';

const stone = floorArea('stone', 12);

export default [
    scenario('server/velocity_up', {
        tags: ['server', 'velocity'],
        area: stone,
        start: at(0, 0, 0),
        body: [ticks(3), server(srv.velocity([0.4, 0.5, 0])), until(cond.onGround(), 60), stopped(3)],
        expect: [expect.noCorrections()],
    }),

    scenario('server/velocity_while_walking', {
        tags: ['server', 'velocity'],
        area: stone,
        start: at(0, 0, -6),
        body: [hold('forward'), ticks(5), server(srv.velocity([0, 0.42, 0.6])), until(cond.onGround(), 60), releaseAll(), stopped(3)],
    }),

    scenario('server/explosion_knockback', {
        tags: ['server', 'explosion'],
        area: stone,
        start: at(0, 0, 0),
        body: [ticks(3), server(srv.explode([2.5, 0, 0.5], 2)), until(cond.onGround(), 80), stopped(3)],
    }),

    scenario('server/teleport_relative', {
        tags: ['server', 'teleport'],
        area: stone,
        start: at(0, 0, 0),
        body: [hold('forward'), ticks(4), server(srv.teleport([0, 2, 0], { relative: ['x', 'y', 'z', 'yRot', 'xRot'] })), until(cond.onGround(), 40), releaseAll(), stopped(3)],
    }),

    scenario('server/speed_effect_mid_walk', {
        tags: ['server', 'effect'],
        area: stone,
        start: at(0, 0, -8),
        body: [hold('forward'), ticks(5), server(srv.effect('speed', 1)), ticks(10), server(srv.removeEffect('speed')), ticks(5), releaseAll(), stopped(3)],
    }),

    scenario('server/movement_speed_attribute', {
        tags: ['server', 'attribute'],
        area: stone,
        start: at(0, 0, -8),
        body: [hold('forward'), ticks(5), server(srv.attribute('movement_speed', { base: 0.2 })), ticks(10), releaseAll(), stopped(3)],
    }),

    scenario('server/moved_too_quickly_correction', {
        tags: ['server', 'correction'],
        area: floorArea('stone', 30),
        start: at(0, 0, 0),
        body: [ticks(2), server(srv.velocity([12, 0.1, 0])), ticks(10), stopped(3)],
        expect: [expect.correctionsAllowed()],
    }),
];
