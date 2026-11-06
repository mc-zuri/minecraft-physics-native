// Ported from physics-data-generator catalog/src/coverage/movement.mjs; maintained here now.
// Movement the existing families leave thin: coasting out of top speed on each kind of floor (release forward and
// glide: friction, the 9e-6 stop for players), letting go of one key of a diagonal, forward released with sprint still
// held, back-pedalling, jump held (a jump every 10 ticks), sprinting into a wall at small angles (under 8 degrees
// the collision is minor and sprint goes on), bed bounces and sneaking through them, and the 26.x friction, air drag
// and bounciness attributes.
import '../_areas/index.ts'
import { registerAreas, B, F, JUMP, L, SNEAK, SPRINT, hold, kase, press, release, releaseAll, ticks, untilOr } from '../../../dsl/physrec.ts'
import { area, fill } from './_lib.ts'
import type { KaseSpec } from '../../../dsl/physrec.ts'

const FLOORS = ['stone', 'ice', 'packed_ice', 'blue_ice', 'soul_sand', 'honey_block', 'slime_block', 'mud']
const SINCE: Readonly<Record<string, string>> = { blue_ice: '1.13', honey_block: '1.15', mud: '1.19' }
const laneZ = (i: number): number => -40 + i * 4

export const areas = [
  // One 70-long strip per floor, glass between the lanes.
  area('cov_coast', [-6, 72, -44, 36], FLOORS.flatMap((b, i) => [
    fill([-4, 0, laneZ(i) - 1], [70, 0, laneZ(i) + 1], b, SINCE[b] ? { since: SINCE[b] } : {}),
    fill([-4, 1, laneZ(i) - 2], [70, 2, laneZ(i) - 2], 'glass')]),
  // A wall along +x at z=+1 to sprint into at a small angle; beds and straw beds to fall on.
  fill([-4, 1, 1 + laneZ(FLOORS.length)], [70, 3, 1 + laneZ(FLOORS.length)], 'stone'),
  fill([10, 1, laneZ(FLOORS.length + 1)], [10, 1, laneZ(FLOORS.length + 1)], 'white_bed[part=foot,facing=east]', { since: '1.12' }),
  fill([11, 1, laneZ(FLOORS.length + 1)], [11, 1, laneZ(FLOORS.length + 1)], 'white_bed[part=head,facing=east]', { since: '1.12' }),
  fill([20, 1, laneZ(FLOORS.length + 1)], [20, 1, laneZ(FLOORS.length + 1)], 'straw_bed[part=foot,facing=east]', { since: '26.3' }),
  fill([21, 1, laneZ(FLOORS.length + 1)], [21, 1, laneZ(FLOORS.length + 1)], 'straw_bed[part=head,facing=east]', { since: '26.3' }))
]

const out = []
const lane = (i: number, extra: Partial<KaseSpec> = {}): KaseSpec => ({ area: 'cov_coast', at: [0.5, 0, laneZ(i) + 0.5], yaw: 270, tier: 2, tags: ['coverage', 'movement'], ...extra })
const GAITS = { walk: [F], sprint: [F, SPRINT], sneak: [F, SNEAK] }
FLOORS.forEach((floor, i) => {
  const base = lane(i, { requires: [floor], tags: ['coverage', 'movement', 'coast', floor], ...(SINCE[floor] ? { since: SINCE[floor] } : {}) })
  for (const [gait, keys] of Object.entries(GAITS)) {
    out.push(kase(`c_move_coast_${gait}_${floor}`, base,
      press(keys, 40),
      ticks(50),
    ))
  }
  // Sprint-jumping, then everything let go mid-air: the landing and the slide.
  out.push(kase(`c_move_coast_sprint_jump_${floor}`, base,
    hold(F, SPRINT),
    ticks(20),
    press(JUMP, 1),
    ticks(3),
    releaseAll(),
    ticks(50),
  ))
})

const stone = lane(0)
out.push(
  kase('c_move_diagonal_release_left_first', stone,
    hold(F, L, SPRINT),
    ticks(40),
    release(L),
    ticks(15),
    releaseAll(),
    ticks(30),
  ),
  kase('c_move_diagonal_release_forward_first', stone,
    hold(F, L, SPRINT),
    ticks(40),
    release(F, SPRINT),
    ticks(15),
    releaseAll(),
    ticks(30),
  ),
  kase('c_move_release_forward_keep_sprint', stone,
    hold(F, SPRINT),
    ticks(40),
    release(F),
    ticks(20),
    press(F, 20),
    releaseAll(),
    ticks(30),
  ),
  kase('c_move_backpedal', stone,
    press(B, 40),
    ticks(30),
  ),
  kase('c_move_backpedal_sprint_key', stone,
    press([B, SPRINT], 40),
    ticks(30),
  ),
  kase('c_move_reverse_at_speed', stone,
    hold(F, SPRINT),
    ticks(30),
    releaseAll(),
    hold(B),
    ticks(30),
    releaseAll(),
    ticks(30),
  ),
  kase('c_move_jump_held_sprint', stone,
    hold(F, SPRINT, JUMP),
    ticks(80),
    releaseAll(),
    ticks(30),
  ),
  kase('c_move_jump_held_in_place', stone,
    press(JUMP, 60),
    ticks(30),
  ),
  // the 26.x attributes
  kase('c_move_friction_modifier_half', {
    ...stone,
    setup: { attributes: { friction_modifier: 0.5 } },
  },
    press([F, SPRINT], 40),
    ticks(40),
  ),
  kase('c_move_friction_modifier_double', {
    ...stone,
    setup: { attributes: { friction_modifier: 1.6 } },
  },
    press([F, SPRINT], 40),
    ticks(40),
  ),
  kase('c_move_air_drag_modifier_half', {
    ...stone,
    setup: { attributes: { air_drag_modifier: 0.5 } },
  },
    hold(F, SPRINT),
    ticks(20),
    press(JUMP, 1),
    ticks(30),
    releaseAll(),
    ticks(20),
  ),
  kase('c_move_bounciness_half', {
    ...stone,
    at: [0.5, 8, laneZ(0) + 0.5],
    rest: [0.5, 0, laneZ(0) + 0.5],
    setup: { attributes: { bounciness: 0.5 } },
  },
    untilOr('onGround', 200),
    ticks(60),
  )
)

// Sprinting into the wall at small angles: yaw 270 + a runs toward +z, into the wall at z+1.
const wall = lane(FLOORS.length, { at: [0.5, 0, laneZ(FLOORS.length) + 0.5] })
for (const a of [3, 7, 9, 15]) {
  out.push(kase(`c_move_wall_sprint_${a}deg`, { ...wall, yaw: 270 + a },
    press([F, SPRINT], 50),
    ticks(20),
  ))
}

// Falling 6 blocks onto a bed: it bounces (restitution 0.75 in 26.x); sneaking cancels the bounce.
const bedLane = laneZ(FLOORS.length + 1) + 0.5
for (const [name, x, since] of [['bed', 10.5, '1.12'], ['straw_bed', 20.5, '26.3']] as const) {
  const fall = { area: 'cov_coast', at: [x, 6, bedLane], rest: [x - 4, 0, bedLane], yaw: 270, tier: 2, since, tags: ['coverage', 'movement', 'bounce'] }
  out.push(
    kase(`c_move_fall_on_${name}`, fall,
      untilOr('onGround', 200),
      ticks(60),
    ),
    kase(`c_move_fall_on_${name}_sneak`, fall,
      hold(SNEAK),
      untilOr('onGround', 200),
      ticks(40),
      releaseAll(),
      ticks(10),
    ))
}

export default out

registerAreas(areas)
