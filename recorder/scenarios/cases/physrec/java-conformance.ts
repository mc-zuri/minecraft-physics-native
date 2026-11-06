// What the conformance tickets ask for by name and the catalog crossed only by chance: a mount that stays in a web, a world
// edit, a push and a mounted jump in one case, long runs for the continuous replay, the angles on both sides of the wrap, and
// a small motion that tells the radial cutoff of 1.21.5 from the per-component one.
import './_areas/index.ts'
import { F, JUMP, SNEAK, SPRINT, command, commandBy, giveEffect, hold, impulse, kase, look, press, registerAreas, releaseAll, server, setAttribute, setBlock, stopped, summon, ticks, turn } from '../../dsl/physrec.ts'
import { area, fill } from './coverage/_lib.ts'

registerAreas([
  // A strip of web across the mounts' way, with clear ground on both sides.
  area('cf_web', [-10, 40, -12, 12], fill([8, 1, -12], [11, 2, 12], 'cobweb')),
  // Slime underfoot, for a landing at exactly the gravity.
  area('cf_slime', [-8, 8, -8, 8], fill([-8, 0, -8], [8, 0, 8], 'slime_block')),
  // Soul sand, ice and stone in turn along a long run, with a wall the world edit opens.
  area('cf_course', [-10, 120, -12, 12],
    fill([10, 0, -12], [19, 0, 12], 'soul_sand'),
    fill([20, 0, -12], [39, 0, 12], 'blue_ice'),
    fill([40, 0, -12], [49, 0, 12], 'honey_block'),
    fill([60, 1, -12], [60, 3, 12], 'stone')),
])

// Horses with fixed stats, as a spawned one rolls its speed and its jump.
const HORSE = { entity: 'horse', attributes: { movement_speed: 0.2, jump_strength: 0.6, step_height: 1.0 } }
const riding = (name: string) => ({ area: name, at: [0.5, 0, 0.5], yaw: 270, tier: 3, tags: ['conformance', 'vehicle'], setup: { mount: { yaw: 270, ...HORSE } } })
const walking = { area: 'cf_course', at: [0.5, 0, 0.5], yaw: 270, tier: 3, tags: ['conformance', 'long'] }
const flat = { area: 'flat', at: [0.5, 0, 0.5], tier: 3, tags: ['conformance', 'angles'] }

const out = [
  // B245: into the web, through it and out: the slowdown is held on each tick inside and goes with the last.
  kase('cf_ride_horse_through_web', riding('cf_web'), press(F, 120), ticks(20)),
  kase('cf_ride_horse_stops_in_web', riding('cf_web'), press(F, 50), ticks(40), press(F, 60), ticks(20)),
  // B236: a world edit, a push from the server and a mounted jump, in that order and a tick apart.
  kase('cf_ride_edit_push_jump', riding('cf_web'),
    press(F, 10), server(setBlock([12, 1, 0], 'stone')), press(F, 1), server(impulse(0, 0.2, 0)), press([F, JUMP], 8), press(F, 40), ticks(20)),
  // B247: sustained movement over blocks that keep state, with the jump's cooldown, a turn and a world edit in one run.
  kase('cf_long_walk_course', walking, press(F, 300), ticks(20)),
  kase('cf_long_sprint_hop_course', walking, press([F, SPRINT, JUMP], 300), releaseAll(), stopped(3)),
  kase('cf_long_edit_wall_opens', walking, hold(F, SPRINT), ticks(180), server(setBlock([60, 1, 0], 'air'), setBlock([60, 2, 0], 'air')), ticks(60), releaseAll(), stopped(3)),
  kase('cf_long_turning_jumps', walking, hold(F, JUMP), turn(3, 0, 120), turn(-3, 0, 120), releaseAll(), stopped(3)),
  // B245: an arrow summoned inside a block: what holds it is the first thing its tick asks, before it flies.
  kase('cf_arrow_summoned_inside_stone', { area: 'walls', at: [0.5, 0, 0.5], tier: 3, tags: ['conformance', 'projectile'] },
    server(setBlock([4, 2, 0], 'stone')), ticks(2), server(summon('arrow', [4.5, 1.5, 0.5], { nbt: '{Motion:[1.0,0.0,0.0]}' })), ticks(40)),
]

// B249: a motion of exactly the gravity onto a bouncy block: resting from 26.3 (-y <= gravity), a bounce before (-y < gravity).
// A motion packet's values are a grid: -0.08 arrives as AT_GRAVITY, so the gravity attribute is set to that.
const AT_GRAVITY = 0.08002197399743638
out.push(
  kase('cf_slime_landing_at_gravity', { area: 'cf_slime', at: [0.5, 0, 0.5], since: '26.2', tier: 3, tags: ['conformance', 'restitution'] }, ticks(5), server(setAttribute('gravity', AT_GRAVITY)), ticks(5), server(impulse(0, -0.08, 0)), ticks(15)),
  kase('cf_slime_landing_over_gravity', { area: 'cf_slime', at: [0.5, 0, 0.5], since: '26.2', tier: 3, tags: ['conformance', 'restitution'] }, ticks(5), server(impulse(0, -0.09, 0)), ticks(15)),
)

// B243: walking and sprinting at the look's wrap: the sign of the yaw and the table index on each side of it.
for (const yaw of [179.99, 180, 180.01, -179.99, -180, -180.01, 0.01, -0.01]) {
  const name = String(yaw).replace('.', '_').replace('-', 'neg_')
  out.push(
    kase(`cf_yaw_walk_${name}`, { ...flat, yaw }, press(F, 12), stopped(3)),
    kase(`cf_yaw_sprint_jump_${name}`, { ...flat, yaw }, press([F, SPRINT, JUMP], 12), releaseAll(), stopped(3)),
  )
}
out.push(
  kase('cf_look_turn_through_wrap', { ...flat, yaw: 170 }, hold(F), turn(2, 0, 20), releaseAll(), stopped(3)),
  kase('cf_look_pitch_edges', { ...flat, pitch: 89.99 }, hold(F), ticks(6), look(undefined, -89.99), ticks(6), releaseAll(), stopped(3)),
)

// B243, B249: both components under the 0.003 cut, the length over it: the rule per component stops it, the radial one from
// 1.21.5 does not. (A controlled mount takes no motion from its server, so no case can set one this way.)
out.push(
  kase('cf_cut_two_small_components', { ...flat, tags: ['conformance', 'cutoff'] }, server(impulse(0.0025, 0, 0.0025)), ticks(20)),
  kase('cf_cut_one_small_component', { ...flat, tags: ['conformance', 'cutoff'] }, server(impulse(0.0025, 0, 0)), ticks(20)),
)

// B243: a mount on a diagonal, slowing by itself through the cut: both components under it with the length still over, which a
// controlled mount cannot be given by its server.
const diagonal = { ...riding('flat'), yaw: 45, setup: { mount: { yaw: 45, ...HORSE } }, tags: ['conformance', 'cutoff'] }
out.push(kase('cf_cut_mount_diagonal', diagonal, press(F, 20), ticks(60)))

// B244: a speed of zero, which is not a speed that is missing; a scale changing under a crouch.
const still = { ...riding('flat'), setup: { mount: { yaw: 270, ...HORSE, attributes: { ...HORSE.attributes, movement_speed: 0 } } }, tags: ['conformance', 'attribute'] }
out.push(
  kase('cf_ride_horse_zero_speed', still, press(F, 30), ticks(10)),
  kase('cf_scale_changes_crouching', { ...flat, since: '1.20.5', tags: ['conformance', 'attribute'] },
    press(SNEAK, 5), server(setAttribute('scale', 0.5)), press([F, SNEAK], 10), server(setAttribute('scale', 1.5)), press([F, SNEAK], 10), server(setAttribute('scale', 1)), ticks(10)),
)

// B245: a projectile in and out of water within its flight, and past the border from each side (its clip changes at 1.21.2).
const range = { area: 'projectileRange', at: [-6.5, 0, 0.5], yaw: 270, tier: 3, tags: ['conformance', 'projectile'] }
const shot = (entity: string, x: number) => summon(entity, [x, 1.5, 0.5], { nbt: '{Motion:[1.5d,0.0d,0.0d]}' })
const pool = [0, 1, 2, 3].map(i => setBlock([2 + i, 2, 0], 'water'))
const centered = commandBy({ '1.13': 'execute as @p at @s run worldborder center ~10 ~', '1.8': 'execute @p ~ ~ ~ worldborder center ~10 ~' })
const unset = server(command('worldborder set 59999968'), command('worldborder center 0 0'))
out.push(
  kase('cf_arrow_crosses_water', range, server(...pool), ticks(3), server(shot('arrow', -4.5)), ticks(30)),
  kase('cf_snowball_crosses_water', range, server(...pool), ticks(3), server(shot('snowball', -4.5)), ticks(30)),
  kase('cf_arrow_starts_past_border', { ...range, serverMoves: true }, server(centered, command('worldborder set 10')), ticks(2), server(shot('arrow', -4.5)), ticks(20), unset, ticks(3)),
  kase('cf_arrow_leaves_the_border', { ...range, serverMoves: true }, server(centered, command('worldborder set 10')), ticks(2), server(shot('arrow', 0.5)), ticks(20), unset, ticks(3)),
)

// B244: what the capability table found with no case: an effect and the attributes the engine reads, and a level of armour.
const wall = server(setBlock([3, 1, 0], 'stone'))
const fire = server(setBlock([3, 1, 0], 'fire'))
const attribute = (id: string, value: number, since: string) => ({ ...flat, yaw: 270, since, setup: { attributes: { [id]: value } }, tags: ['conformance', 'attribute', id] })
out.push(
  kase('cf_weaving_through_web', { area: 'cf_web', at: [0.5, 0, 0.5], yaw: 270, since: '1.20.5', tier: 3, tags: ['conformance', 'effect'] }, server(giveEffect('weaving')), press(F, 80), ticks(10)),
  kase('cf_attr_step_height_0', attribute('step_height', 0, '1.20.5'), wall, ticks(2), press(F, 40), ticks(5)),
  kase('cf_attr_step_height_1_5', attribute('step_height', 1.5, '1.20.5'), wall, ticks(2), press(F, 40), ticks(5)),
  kase('cf_attr_fall_damage_multiplier', { ...attribute('fall_damage_multiplier', 0, '1.20.5'), at: [0.5, 6, 0.5], rest: [0.5, 0, 0.5] }, ticks(30)),
  kase('cf_attr_burning_time', attribute('burning_time', 0.25, '1.21'), fire, ticks(2), press(F, 30), ticks(40)),
  kase('cf_feather_falling_boots', { ...flat, at: [0.5, 6, 0.5], rest: [0.5, 0, 0.5], tags: ['conformance', 'enchantment'], setup: { equipment: { feet: { id: 'diamond_boots', count: 1, enchantments: { feather_falling: 4 } } } } }, ticks(30)),
)

// B244: the same three held to what they deal. mortal: `invulnerable` keeps every other case's health at 20 and a player's fire
// ticks at 1 (Player.setRemainingFireTicks); no regeneration follows on easy below 18 food (replay/engine.ts, as for fd_*). Standing
// in the fire is what reaches its ignition: the walk through it above leaves before the ticks rise to 0.
const mortal = { mortal: true, difficulty: 'easy', tier: 2 }
const food = { food: 10 }
const mortalFall = [ticks(30)]
out.push(
  kase('cf_attr_fall_damage_multiplier_mortal', { ...flat, ...mortal, since: '1.20.5', at: [0.5, 6, 0.5], rest: [0.5, 0, 0.5], tags: ['conformance', 'attribute', 'fall_damage'], setup: { ...food, attributes: { fall_damage_multiplier: 0.5 } } }, ...mortalFall),
  kase('cf_feather_falling_boots_mortal', { ...flat, ...mortal, since: '1.9', at: [0.5, 6, 0.5], rest: [0.5, 0, 0.5], tags: ['conformance', 'enchantment', 'fall_damage'], setup: { ...food, equipment: { feet: { id: 'diamond_boots', count: 1, enchantments: { feather_falling: 4 } } } } }, ...mortalFall),
  kase('cf_attr_burning_time_burns', { ...attribute('burning_time', 0.25, '1.21'), ...mortal, setup: { ...food, attributes: { burning_time: 0.25 } } }, server(setBlock([0, 1, 0], 'fire')), ticks(30), press(F, 12), ticks(70)),
)

export default out
