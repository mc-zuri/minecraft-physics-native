// Ported from physics-data-generator catalog/src/cases/java-blocks.mjs; maintained here now.
// Falling onto and walking into every block with its own physics: landing pads (bounce, cushion, slowdown, liquid),
// fluids (swim, sink, float, jump out, flow push, bubble columns), climbables (ladder, vines, scaffolding, trapdoor top,
// underwater ladder), slowdown blocks (cobweb, berry bush, powder snow), the honey wall slide.
import './_areas/index.ts'
import { B, F, JUMP, L, R, SNEAK, SPRINT, hold, kase, look, press, release, releaseAll, settleFor, stable, ticks, turn, until, untilOr } from '../../dsl/physrec.ts'
import { CLIMBS, LANDINGS, laneZ } from './_areas/java-areas.ts'
import type { KaseSpec, PhysrecSteps, Pos } from '../../dsl/physrec.ts'
import type { Scenario } from '../../dsl/core.ts'

const name = (b: string): string => b.replace(/\[(.*?)\]/, (_: string, p: string) => '_' + p.replace(/[=,]/g, '_')).replace(/[^\w]/g, '_')
const out: Scenario[] = []
// Landing on farmland tramples it: the server lifts the player out of the dirt with a position packet.
const trampled = (block: string): Partial<KaseSpec> => block === 'farmland' ? { serverMoves: true } : {}
// 1.21.4's client and server disagree on powder snow's collision above 2.5 fall distance (see below)
const powderSnowCorrected: Partial<KaseSpec> = { serverMovesIn: ['1.21.4'] }

// Landings: dropped from 3, 10 and 30 onto the pad's centre, from 10 while sneaking and while walking over it.
LANDINGS.forEach((block, i) => {
  const z = laneZ(i) + 0.5
  const base = { area: 'landing', rest: [-4.5, 0, z], tier: 2, tags: ['landing', name(block)], requires: [block], ...trampled(block) }
  for (const h of [3, 10, 30]) {
    out.push(kase(`b_land_${h}_${name(block)}`, { ...base, at: [4.5, h, z], ...(block === 'powder_snow' && h <= 10 ? powderSnowCorrected : {}) },
      untilOr('onGround || isInWater || isInLava || y<-1.9', 600),
      ticks(30),
      settleFor(5, 200),
    ))
  }
  out.push(
    kase(`b_land_sneak_${name(block)}`, { ...base, at: [4.5, 10, z], ...(block === 'powder_snow' ? powderSnowCorrected : {}) },
      hold(SNEAK),
      untilOr('onGround || isInWater || isInLava || y<-1.9', 600),
      ticks(30),
      releaseAll(),
      settleFor(5, 200),
    ),
    kase(`b_land_walk_over_${name(block)}`, { ...base, at: [1.5, 6, z], yaw: 270 },
      press('forward', 30),
      ticks(20),
      settleFor(5, 200),
    )
  )
})
// 1.21.4's own client and server disagree on powder snow's collision once the fall distance is above 2.5 (the server
// takes the falling shape, the client keeps fall distance 0): the server corrects these landings there, natively, and
// the corrections are the case's (tools/native-evidence/1.21.4-powder-snow.json). The runner takes serverMovesIn as
// serverMoves on those versions (this replaced native-catalog-policy.cjs's projection of the catalog, which tied a
// 1.21.4 recording to one catalog revision, so that 1.21.4 could not record the current catalog at all).
// b_land_3_powder_snow, b_land_10_powder_snow and b_land_sneak_powder_snow take it (powderSnowCorrected above).
// Bouncing repeatedly on slime and beds, and jumping on them.
const pad = (b: string) => ({ area: 'landing', rest: [-4.5, 0, laneZ(LANDINGS.indexOf(b)) + 0.5], tier: 2, tags: ['landing', 'bounce'], requires: [b] })
out.push(
  kase('b_bounce_slime_20_to_rest', { ...pad('slime_block'), at: [4.5, 20, laneZ(1) + 0.5] },
    ticks(200),
  ),
  kase('b_bounce_bed_20_to_rest', {
    ...pad('white_bed[part=foot,facing=east]'),
    at: [4.5, 20, laneZ(2) + 0.5],
  },
    ticks(120),
  ),
  kase('b_jump_on_bed', {
    ...pad('white_bed[part=foot,facing=east]'),
    at: [4.5, 0.5625, laneZ(2) + 0.5],
    rest: undefined,
  },
    press(JUMP, 1),
    ticks(40),
  ),
  kase('b_slime_sneak_after_bounce', { ...pad('slime_block'), at: [4.5, 8, laneZ(1) + 0.5] },
    until('onGround', 100),
    ticks(3),
    hold(SNEAK),
    ticks(40),
  )
)

// Water: shallow shelf walk, swim in every direction, sprint-swim (swim pose), turn and pitch while swimming, sneak
// to sink, float up, jump out onto the 1-block ledge, kelp, a waterlogged slab, stepping out of the pool.
const water = (n: string, at: Pos, steps: PhysrecSteps, extra: Partial<KaseSpec> = {}) => out.push(kase(`b_water_${n}`, {
  area: 'water',
  rest: [-8.5, 0, 0.5],
  at,
  tier: 1,
  tags: ['water'],
  expect: 'in:water',
  ...extra,
},
  steps,
))
water('walk_shelf_in', [-7.5, 0, 0.5], [press('forward', 40), stable(5)], { yaw: 270, rest: undefined })
for (const [d, keys] of Object.entries({ f: [F], b: [B], l: [L], r: [R], fl: [F, L] })) {
  water(`swim_${d}`, [4.5, -2, 0.5], [press(keys, 30), stable(5)], { yaw: 270 })
}
water('sprint_swim', [0.5, -2, 0.5], [press([F, SPRINT], 40), stable(5)], { yaw: 270, tags: ['water', 'swim_pose'] })
water('sprint_swim_turn', [0.5, -2, 0.5], [hold(F, SPRINT), turn(6, 0, 40), releaseAll(), stable(5)], { yaw: 270, tags: ['water', 'swim_pose'] })
water('sprint_swim_dive', [0.5, -1, 0.5], [press([F, SPRINT], 30), stable(5)], { yaw: 270, pitch: 45, tags: ['water', 'swim_pose'] })
water('sprint_swim_surface_up', [0.5, -2, 0.5], [press([F, SPRINT], 30), stable(5)], { yaw: 270, pitch: -60, tags: ['water', 'swim_pose'] })
water('sprint_swim_release_sprint', [0.5, -2, 0.5], [hold(F, SPRINT), ticks(20), release(SPRINT), ticks(20), releaseAll(), stable(5)], { yaw: 270, tags: ['water', 'swim_pose'] })
water('sneak_sink', [4.5, -1, 0.5], [press(SNEAK, 40), stable(5)])
water('float_up_hold_jump', [4.5, -2.5, 0.5], [press(JUMP, 50), stable(5)])
water('surface_idle', [4.5, 0, 0.5], [ticks(60)])
water('surface_walk', [4.5, 0, 0.5], [press(F, 40), stable(5)], { yaw: 270 })
water('jump_out_on_ledge', [12.5, -0.3, -6.5], [press([F, JUMP], 40), stable(5)], { yaw: 270, tags: ['water', 'jump_out'] })
water('jump_out_sprint', [10.5, -1, -6.5], [press([F, SPRINT, JUMP], 40), stable(5)], { yaw: 270, tags: ['water', 'jump_out'] })
water('kelp_climb', [2.5, -2, 6.5], [press(JUMP, 40), stable(5)], { tags: ['water', 'kelp'], requires: ['kelp_plant'] })
water('waterlogged_slab_walk', [8.5, -0.5, 0.5], [press(F, 40), stable(5)], { yaw: 0, tags: ['water', 'waterlogged'], requires: ['stone_slab[type=bottom,waterlogged=true]'] })
water('walk_out_to_land', [-4.5, -0.5, 0.5], [press(F, 40), stable(5)], { yaw: 90, tags: ['water', 'exit'] })
water('fall_in_from_10', [4.5, 10, 0.5], [until('isInWater', 60), ticks(40), stable(5)], { tags: ['water', 'fall'] })
water('fall_in_sprinting', [-8.5, 6, 0.5], [press([F, SPRINT], 50), stable(5)], { yaw: 270, tags: ['water', 'fall'] })

// Flowing water: idle drift down the channel and around the bend, walking against and across the flow.
const flow = (n: string, at: Pos, steps: PhysrecSteps, yaw = 0, extra: Partial<KaseSpec> = {}) => out.push(kase(`b_flow_${n}`, {
  area: 'flow',
  at,
  rest: [0.5, 0, -5.5],
  yaw,
  tier: 2,
  tags: ['water', 'flow'],
  expect: 'in:water',
  ...extra,
},
  steps,
))
// (the last source cell, x=-3: the one before it has a source on each side and no current)
flow('idle_drift', [-2.5, 0, 0.5], [ticks(200)], 0, { checks: 'x > 0' })
flow('drift_around_bend', [-3.5, 0, 6.5], [ticks(250)])
flow('walk_against', [9.5, 0, 0.5], [press(F, 60), stable(5)], 90)
flow('walk_around_bend', [-3.5, 0, 6.5], [press(F, 18), look(0, 0), press(F, 25), stable(5)], 270)
flow('walk_across', [3.5, 0, -1.5], [press(F, 20), stable(5)], 0)
flow('sprint_with_flow', [-3.5, 0, 0.5], [press([F, SPRINT], 30), stable(5)], 270)

// Lava.
const lava = (n: string, at: Pos, steps: PhysrecSteps, extra: Partial<KaseSpec> = {}) => out.push(kase(`b_lava_${n}`, {
  area: 'lava',
  rest: [-8.5, 0, 0.5],
  at,
  tier: 1,
  tags: ['lava'],
  expect: 'in:lava',
  ...extra,
},
  steps,
))
lava('walk_in', [-6.5, 0, 0.5], [press(F, 40), stable(5)], { yaw: 270, rest: undefined })
lava('swim_forward', [0.5, -2, 0.5], [press(F, 30), stable(5)], { yaw: 270 })
lava('float_up', [0.5, -2.5, 0.5], [press(JUMP, 40), stable(5)])
lava('jump_out', [-4.5, -0.5, 0.5], [press([F, JUMP], 40), stable(5)], { yaw: 90 })
lava('sneak_sink', [0.5, -1, 0.5], [press(SNEAK, 40), stable(5)])
lava('fall_in', [0.5, 10, 0.5], [until('isInLava', 60), ticks(40), stable(5)])

// Bubble columns: inside and at the surface (air above), rising and dragged down, swimming out sideways.
const bubble = (n: string, area: string, at: Pos, steps: PhysrecSteps) => out.push(kase(`b_bubble_${n}`, {
  area,
  rest: [-4.5, 0, 0.5],
  at,
  tier: 1,
  tags: ['bubble_column'],
  expect: 'in:bubble_column',
},
  steps,
))
bubble('up_from_bottom', 'bubbleUpColumn', [5.5, -7, 0.5], [ticks(60), settleFor(5, 60)])
bubble('up_surface_idle', 'bubbleUpColumn', [5.5, 0, 0.5], [ticks(60)])
bubble('up_swim_out', 'bubbleUpColumn', [5.5, -4, 0.5], [press(L, 30), settleFor(5, 100)])
bubble('down_from_surface', 'bubbleDownColumn', [5.5, 0, 0.5], [ticks(60), stable(5, 200)])
bubble('down_hold_jump', 'bubbleDownColumn', [5.5, -3, 0.5], [press(JUMP, 60), stable(5, 200)])
bubble('down_fall_in', 'bubbleDownColumn', [5.5, 8, 0.5], [ticks(80), stable(5, 200)])

// Climbing: up by walking into it, up by jump only, holding still with sneak, sliding down, jumping off, sprinting.
CLIMBS.forEach((c, i) => {
  const z = laneZ(i) + 0.5
  const needs = { ladder_trapdoor: ['ladder', 'oak_trapdoor'], ladder_water: ['ladder[waterlogged=true]'], scaffolding: ['scaffolding'] }[c] ?? [c]
  // (the wet lane's ladder is waterlogged all the way up: climbing it is in water and off the floor; 1.13's travel has no
  // climb in its water branch, LivingEntity.java:1605 only out of water, so there a walker stays at the foot)
  const wet = c === 'ladder_water' ? { expect: 'in:ladder in:water', checks: 'highest > 1@>=1.14' } : {}
  const base = { area: 'climbs', at: [0.5, 0, z], yaw: 270, tier: 1, tags: ['climb', c], requires: needs, ...wet }
  out.push(
    kase(`b_climb_walk_up_${c}`, base,
      press(F, 60),
      stable(5, 200),
    ),
    kase(`b_climb_jump_up_${c}`, { ...base, at: [5.5, 0, z] },
      press(JUMP, 40),
      stable(5, 200),
    ),
    kase(`b_climb_sneak_hold_${c}`, base,
      hold(F),
      ticks(25),
      hold(SNEAK),
      ticks(30),
      releaseAll(),
      stable(5, 200),
    ),
    kase(`b_climb_slide_down_${c}`, base,
      press(F, 40),
      ticks(40),
      stable(5, 200),
    ),
    kase(`b_climb_sprint_up_${c}`, base,
      press([F, SPRINT], 50),
      stable(5, 200),
    ),
    kase(`b_climb_back_off_${c}`, base,
      press(F, 35),
      press(B, 10),
      stable(5, 200),
    )
  )
})

// Slowdown blocks: walking and sprinting in, jumping inside, falling in (cobweb field, berry bushes, powder snow).
for (const [area, blockId, id] of [['cobwebField', 'cobweb', 'cobweb'], ['berryBushField', 'sweet_berry_bush', 'berry'], ['powderSnowField', 'powder_snow', 'powder_snow']]) {
  const base = { area, rest: [0.5, 0, -7.5], tier: 1, tags: ['slowdown', id], expect: `in:${blockId}`, requires: [blockId] }
  out.push(
    kase(`b_${id}_sprint_in`, { ...base, at: [0.5, 0, -7.5], rest: undefined },
      press([F, SPRINT], 40),
      stable(5, 200),
    ),
    kase(`b_${id}_walk_in_diagonal`, {
      ...base,
      at: [-2.5, 0, -7.5],
      rest: undefined,
      yaw: -45,
    },
      press(F, 60),
      stable(5, 200),
    ),
    kase(`b_${id}_jump_inside`, { ...base, at: [0.5, 0, 0.5] },
      press(JUMP, 1),
      ticks(40),
      stable(5, 200),
    ),
    kase(`b_${id}_sneak_inside`, { ...base, at: [0.5, 0, 0.5] },
      press([F, SNEAK], 40),
      stable(5, 200),
    )
  )
}
// Powder snow with leather boots: stands on it, sinks when sneaking, walks on top.
const boots = { requires: ['powder_snow'], setup: { equipment: { feet: { id: 'leather_boots' } } } }
out.push(
  kase('b_powder_snow_boots_walk_on', {
    area: 'powderSnowField',
    at: [0.5, 6, -4.5],
    rest: [0.5, 0, -7.5],
    yaw: 0,
    tier: 2,
    tags: ['powder_snow', 'equipment'],
    ...boots,
  },
    press(F, 40),
    stable(5, 200),
  ),
  kase('b_powder_snow_boots_sneak_sink', {
    area: 'powderSnowField',
    at: [0.5, 6.5, 0.5],
    rest: [0.5, 0, -7.5],
    tier: 2,
    tags: ['powder_snow', 'equipment'],
    ...boots,
  },
    until('onGround', 60),
    ticks(5),
    press(SNEAK, 40),
    stable(5, 200),
  ),
  kase('b_powder_snow_boots_fall_on', {
    area: 'powderSnowField',
    at: [0.5, 12, 0.5],
    rest: [0.5, 0, -7.5],
    tier: 2,
    tags: ['powder_snow', 'equipment'],
    ...boots,
    serverMoves: true,
  },
    ticks(60),
    stable(5, 200),
  ),
  kase('b_powder_snow_boots_climb_out', {
    area: 'powderSnowField',
    at: [0.5, -3, 0.5],
    rest: [0.5, 0, -7.5],
    tier: 2,
    tags: ['powder_snow', 'equipment'],
    ...boots,
  },
    press(JUMP, 60),
    stable(5, 200),
  )
)

// Honey wall slide: falling beside the wall, pressed into it, and not touching it.
// Starts at y 17: the ledge over the wall is the stone at y 20, and at 18 the player's head would be in it (forced
// into the crawling pose).
const honey = { area: 'honeyWall', tier: 2, tags: ['honey', 'wall_slide'], rest: [-4.5, 0, 0.5], requires: ['honey_block'] }
out.push(
  kase('b_honey_slide_pressed', { ...honey, at: [1.5, 17, 0.5], yaw: 270 },
    hold(F),
    ticks(100),
    releaseAll(),
    stable(5),
  ),
  kase('b_honey_slide_touching', { ...honey, at: [1.7, 17, 0.5] },
    ticks(100),
    stable(5),
  ),
  kase('b_honey_slide_sneak', { ...honey, at: [1.5, 17, 0.5], yaw: 270 },
    hold(F, SNEAK),
    ticks(100),
    releaseAll(),
    stable(5),
  ),
  kase('b_honey_fall_near_not_touching', { ...honey, at: [0.5, 17, 0.5] },
    ticks(60),
    stable(5),
  ),
  kase('b_honey_jump_against', { ...honey, at: [1.5, 0, 0.5], rest: undefined, yaw: 270 },
    hold(F),
    press(JUMP, 1),
    ticks(30),
    releaseAll(),
    stable(5),
  )
)

export default out
