// Ported from physics-data-generator catalog/src/cases/java-entities.mjs; maintained here now.
// Things that move the player other than its own input: solid entities (standing on a boat or shulker), mobs pushing,
// explosions and wind charges (knockback in the explosion packet), falling water, a piston.
import './_areas/index.ts'
import { type KaseSpec, type Pos, F, JUMP, SPRINT, USE, explode, hold, kase, press, releaseAll, server, setBlock, stable, stopped, ticks, until } from '../../dsl/physrec.ts'

const flat = { area: 'flat', at: [0.5, 0, 0.5], yaw: 270, tier: 3 }
const withEntity = (entity: string, at: Pos, extra: Partial<KaseSpec> = {}): KaseSpec => ({ ...flat, tags: ['entity', entity], setup: { summon: [{ entity, at, noAi: true }] }, ...extra })
const out = [
  // The server moves the pushed boat; when its position reaches the client varies, so this is recorded once.
  kase('n_walk_into_boat', { ...withEntity('oak_boat', [3.5, 0, 0.5]), verify: 1 },
    press(F, 30),
    stopped(3),
  ),
  kase('n_jump_onto_boat', withEntity('oak_boat', [2.5, 0, 0.5]),
    hold(F),
    ticks(3),
    press(JUMP, 1),
    until('onGround', 40),
    ticks(10),
    releaseAll(),
    stopped(3),
  ),
  kase('n_fall_onto_boat', withEntity('oak_boat', [0.5, 0, 0.5], { at: [0.5, 5, 0.5], rest: [4.5, 0, 4.5] }),
    until('onGround', 60),
    ticks(20),
  ),
  kase('n_walk_across_boat', withEntity('oak_boat', [2.5, 0, 0.5], { at: [2.5, 1, 0.5], rest: [4.5, 0, 4.5] }),
    press(F, 30),
    stopped(3),
  ),
  kase('n_stand_on_shulker', withEntity('shulker', [2.5, 0, 0.5], { at: [2.5, 1, 0.5], rest: [4.5, 0, 4.5] }),
    ticks(20),
    press(F, 20),
    stopped(3),
  ),
  kase('n_pushed_by_cow', withEntity('cow', [0.9, 0, 0.5], { at: [0.5, 0, 0.5], rest: [4.5, 0, 4.5] }),
    ticks(40),
  ),
  kase('n_walk_through_cow', withEntity('cow', [3.5, 0, 0.5]),
    press(F, 40),
    stopped(3),
  ),
  kase('n_sprint_into_cows', {
    ...flat,
    tags: ['entity', 'cow'],
    setup: { summon: [3, 4, 5].map(x => ({ entity: 'cow', at: [x + 0.5, 0, 0.5], noAi: true })) },
  },
    press([F, SPRINT], 40),
    stopped(3),
  ),

  kase('n_explosion_standing', { ...flat, tags: ['explosion'] },
    server(explode([3.5, 0, 0.5], 2)),
    ticks(40),
  ),
  // (the centre in the air above the floor: from y=-0.5, inside the floor block, the explosion sees nothing of the
  // player, Explosion.getSeenPercent is 0, and it gives no knockback at all)
  kase('n_explosion_mid_jump', { ...flat, tags: ['explosion'] },
    press(JUMP, 1),
    ticks(3),
    server(explode([0.5, 0, 2.5], 3)),
    until('onGround', 80),
    ticks(10),
  ),
  // (the player is about at x=3.25 when it goes off: behind and beside it, so it pushes it on and sideways mid-sprint;
  // at the start point with radius 1, where the generator had it, the player is out of its reach)
  kase('n_explosion_sprinting', { ...flat, tags: ['explosion'] },
    hold(F, SPRINT),
    ticks(10),
    server(explode([2.5, 0, 1.5], 2)),
    ticks(30),
    releaseAll(),
    stopped(3),
  ),
  kase('n_wind_charge_jump', {
    ...flat,
    pitch: 90,
    tags: ['explosion', 'wind_charge'],
    setup: { equipment: { mainhand: { id: 'wind_charge', count: 16, enchantments: {} } } },
  },
    press(JUMP, 1),
    ticks(1),
    press(USE, 1),
    until('onGround', 120),
    ticks(10),
  ),
  kase('n_wind_charge_forward', {
    ...flat,
    pitch: 60,
    tags: ['explosion', 'wind_charge'],
    setup: { equipment: { mainhand: { id: 'wind_charge', count: 16, enchantments: {} } } },
  },
    hold(F, SPRINT),
    ticks(6),
    press(JUMP, 1),
    ticks(2),
    press(USE, 1),
    until('onGround', 120),
    releaseAll(),
    stopped(3),
  ),

  kase('n_waterfall_inside', {
    area: 'waterfall',
    at: [0.5, 6, 0.5],
    rest: [4.5, 0, 4.5],
    tier: 3,
    tags: ['water', 'waterfall'],
    expect: 'in:water',
  },
    ticks(60),
  ),
  kase('n_waterfall_swim_up', {
    area: 'waterfall',
    at: [0.5, 2, 0.5],
    rest: [4.5, 0, 4.5],
    tier: 3,
    tags: ['water', 'waterfall'],
    expect: 'in:water',
  },
    press(JUMP, 60),
    ticks(10),
  ),
  kase('n_waterfall_walk_in', {
    area: 'waterfall',
    at: [0.5, 0, -2.5],
    yaw: 0,
    tier: 3,
    tags: ['water', 'waterfall'],
  },
    press(F, 10),
    ticks(40),
  ),

  kase('n_piston_push', {
    area: 'piston',
    at: [0.5, 0, 0.5],
    tier: 3,
    tags: ['piston'],
    serverMoves: true,
  },
    server(setBlock([-2, 1, 0], 'redstone_block')),
    ticks(30),
  ),
  kase('n_piston_push_jumping', {
    area: 'piston',
    at: [0.5, 0, 0.5],
    tier: 3,
    tags: ['piston'],
    serverMoves: true,
  },
    press(JUMP, 1),
    server(setBlock([-2, 1, 0], 'redstone_block')),
    ticks(40),
  )
]

// Pushes by the book (B168): Entity.push does nothing closer than 0.01F; a minecart, an armor stand and a shulker each take the
// player's walk their own way. A piston pushing the player into a collider (B169). Proof: pos and vel at afterMove.
const beside = (entity: string, x: number) => withEntity(entity, [x, 0, 0.5], { at: [0.5, 0, 0.5], rest: [4.5, 0, 4.5] })
const piston = (entity: string): KaseSpec => ({ area: 'piston', at: [0.5, 0, 0.5], tier: 3, tags: ['piston', entity], serverMoves: true, setup: { summon: [{ entity, at: [1.5, 0, 0.5], noAi: true }] } })
out.push(
  kase('n_cow_same_spot', beside('cow', 0.5), ticks(30)),
  kase('n_cow_under_0_01', beside('cow', 0.505), ticks(30)),
  kase('n_cow_over_0_01', beside('cow', 0.52), ticks(30)),
  kase('n_cows_both_sides', { ...beside('cow', 0.1), setup: { summon: [0.1, 0.9].map(x => ({ entity: 'cow', at: [x, 0, 0.5] as Pos, noAi: true })) } }, ticks(30)),
  kase('n_walk_into_minecart', { ...withEntity('minecart', [3.5, 0, 0.5]), verify: 1 }, press(F, 30), stopped(3)),
  kase('n_walk_into_armor_stand', withEntity('armor_stand', [3.5, 0, 0.5]), press(F, 30), stopped(3)),
  kase('n_walk_into_shulker', { ...withEntity('shulker', [3.5, 0, 0.5]), since: '1.9' }, press(F, 30), stopped(3)),
  kase('n_piston_push_into_cow', piston('cow'), server(setBlock([-2, 1, 0], 'redstone_block')), ticks(30)),
  kase('n_piston_push_into_shulker', { ...piston('shulker'), since: '1.9' }, server(setBlock([-2, 1, 0], 'redstone_block')), ticks(30)),
)

export default out
