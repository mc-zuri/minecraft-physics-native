// Ported from physics-data-generator catalog/src/cases/java-effects.mjs; maintained here now.
// Status effects, attributes and hunger: each at several strengths including the extremes, alone and combined, and
// switched on or off in the middle of a movement (the recording shows the tick the client learns of it).
import './_areas/index.ts'
import { type KaseSpec, type PhysrecSetup, F, JUMP, SNEAK, SPRINT, clearEffects, commandBy, giveEffect, hold, kase, press, releaseAll, server, setAttribute, setFood, stable, stopped, ticks, until, untilOr } from '../../dsl/physrec.ts'
import { SURFACES, laneZ } from './_areas/java-areas.ts'

const flat = { area: 'flat', at: [0.5, 0, 0.5], tier: 2 }
const effects = (...list: [string, number][]): PhysrecSetup => ({ effects: list.map(([id, amplifier]) => ({ id, amplifier })) })
const out = []
const run = [press(F, 30), stopped(3)]
const sprint = [press([F, SPRINT], 30), stopped(3)]
const sprintJump = [hold(F, SPRINT), ticks(8), press(JUMP, 1), until('onGround', 60), releaseAll(), stopped(3)]
const jump = [press(JUMP, 1), until('onGround', 200), ticks(5)]

for (const amp of [0, 1, 4, 9]) {
  const setup = effects(['speed', amp])
  out.push(
    kase(`e_speed_${amp + 1}_walk`, { ...flat, setup, tags: ['effect', 'speed'] },
      run,
    ),
    kase(`e_speed_${amp + 1}_sprint`, { ...flat, setup, tags: ['effect', 'speed'] },
      sprint,
    ),
    kase(`e_speed_${amp + 1}_sprint_jump`, { ...flat, setup, tags: ['effect', 'speed'] },
      sprintJump,
    )
  )
}
for (const amp of [0, 3, 6, 9]) {
  const setup = effects(['slowness', amp])
  out.push(
    kase(`e_slowness_${amp + 1}_walk`, { ...flat, setup, tags: ['effect', 'slowness'] },
      run,
    ),
    kase(`e_slowness_${amp + 1}_sprint`, { ...flat, setup, tags: ['effect', 'slowness'] },
      sprint,
    )
  )
}
for (const amp of [0, 1, 4, 9, 127]) {
  const setup = effects(['jump_boost', amp])
  // Jump Boost 128 throws the player ~800 blocks up: record the first 300 ticks. A dedicated server takes that launch
  // as moving too quickly and corrects it (the singleplayer owner is never checked): the correction is part of the
  // case, as a bot on a server gets it.
  const high = amp > 100
  out.push(
    kase(`e_jump_boost_${amp + 1}`, { ...flat, setup, tags: ['effect', 'jump_boost'], ...(high ? { serverMoves: true } : {}) },
      high ? [press(JUMP, 1), ticks(300)] : jump,
    ),
    ...(high ? [] : [kase(`e_jump_boost_${amp + 1}_sprint_jump`, {
      ...flat,
      setup,
      tags: ['effect', 'jump_boost'],
    },
      sprintJump,
    )])
  )
}
for (const amp of [0, 4, 31, 127]) {
  const on = server(giveEffect('levitation', amp))
  out.push(
    kase(`e_levitation_${amp + 1}`, { ...flat, tags: ['effect', 'levitation'] },
      on,
      ticks(40),
      server(clearEffects()),
      untilOr('onGround', 600),
      ticks(5),
    ),
    kase(`e_levitation_${amp + 1}_walk`, { ...flat, tags: ['effect', 'levitation'] },
      on,
      press(F, 30),
      server(clearEffects()),
      untilOr('onGround', 600),
      ticks(5),
    )
  )
}
out.push(
  kase('e_levitation_under_ceiling', {
    area: 'ceilings',
    at: [8.5, 0, laneZ(0) + 0.5],
    tier: 2,
    tags: ['effect', 'levitation', 'ceiling'],
  },
    server(giveEffect('levitation', 2)),
    ticks(30),
    server(clearEffects()),
    until('onGround', 100),
    ticks(5),
  ),
  kase('e_slow_falling_fall_30', {
    ...flat,
    at: [0.5, 30, 0.5],
    rest: [0.5, 0, 0.5],
    setup: effects(['slow_falling', 0]),
    tags: ['effect', 'slow_falling'],
  },
    until('onGround', 1200),
    ticks(5),
  ),
  kase('e_slow_falling_walk_off', {
    area: 'sneakEdgePlatform',
    at: [0.5, 5, 4.5],
    tier: 2,
    setup: effects(['slow_falling', 0]),
    tags: ['effect', 'slow_falling'],
  },
    press([F, SPRINT], 30),
    until('onGround', 400),
    stopped(3),
  ),
  kase('e_slow_falling_jump', {
    ...flat,
    setup: effects(['slow_falling', 0]),
    tags: ['effect', 'slow_falling'],
  },
    jump,
  ),
  kase('e_slow_falling_in_water', {
    area: 'water',
    at: [4.5, 6, 0.5],
    rest: [-8.5, 0, 0.5],
    tier: 2,
    setup: effects(['slow_falling', 0]),
    tags: ['effect', 'slow_falling', 'water'],
  },
    ticks(120),
    stable(5),
  ),
  kase('e_slow_falling_levitation', {
    ...flat,
    setup: effects(['slow_falling', 0]),
    tags: ['effect', 'slow_falling', 'levitation'],
  },
    server(giveEffect('levitation', 1)),
    ticks(30),
    server(clearEffects()),
    until('onGround', 300),
  ),
  kase('e_dolphins_grace_swim', {
    area: 'water',
    at: [0.5, -2, 0.5],
    rest: [-8.5, 0, 0.5],
    yaw: 270,
    tier: 2,
    setup: effects(['dolphins_grace', 0]),
    tags: ['effect', 'dolphins_grace', 'water'],
  },
    press(F, 30),
    stable(5),
  ),
  kase('e_dolphins_grace_sprint_swim', {
    area: 'water',
    at: [0.5, -2, 0.5],
    rest: [-8.5, 0, 0.5],
    yaw: 270,
    tier: 2,
    setup: effects(['dolphins_grace', 0]),
    tags: ['effect', 'dolphins_grace', 'water'],
  },
    press([F, SPRINT], 30),
    stable(5),
  ),
  kase('e_blindness_sprint', {
    ...flat,
    setup: effects(['blindness', 0]),
    tags: ['effect', 'blindness', 'sprint'],
  },
    sprint,
  ),
  kase('e_blindness_mid_sprint', { ...flat, tags: ['effect', 'blindness', 'sprint'] },
    hold(F, SPRINT),
    ticks(15),
    server(giveEffect('blindness')),
    ticks(20),
    releaseAll(),
    stopped(3),
  ),
  kase('e_darkness_sprint', {
    ...flat,
    setup: effects(['darkness', 0]),
    tags: ['effect', 'sprint'],
  },
    sprint,
  ),
  kase('e_speed_and_slowness', {
    ...flat,
    setup: effects(['speed', 1], ['slowness', 1]),
    tags: ['effect', 'speed', 'slowness'],
  },
    sprint,
  ),
  kase('e_jump_boost_on_honey', {
    area: 'honeySurface',
    at: [0.5, 0, 0.5],
    tier: 2,
    setup: effects(['jump_boost', 1]),
    tags: ['effect', 'jump_boost', 'honey'],
  },
    jump,
  ),
  kase('e_speed_on_ice', {
    area: 'iceSurface',
    at: [0.5, 0, 0.5],
    tier: 2,
    setup: effects(['speed', 2]),
    tags: ['effect', 'speed', 'ice'],
  },
    press([F, SPRINT], 30),
    stopped(3, 600),
  ),
  kase('e_speed_on_mid_walk', { ...flat, tags: ['effect', 'speed'] },
    hold(F),
    ticks(15),
    server(giveEffect('speed', 1)),
    ticks(25),
    releaseAll(),
    stopped(3),
  ),
  kase('e_speed_off_mid_sprint', {
    ...flat,
    setup: effects(['speed', 1]),
    tags: ['effect', 'speed'],
  },
    hold(F, SPRINT),
    ticks(15),
    server(clearEffects()),
    ticks(25),
    releaseAll(),
    stopped(3),
  ),
  kase('e_jump_boost_on_in_air', { ...flat, tags: ['effect', 'jump_boost'] },
    press(JUMP, 1),
    server(giveEffect('jump_boost', 4)),
    until('onGround', 60),
    press(JUMP, 1),
    until('onGround', 60),
  )
)

// Hunger: sprinting needs more than 6 food; running out mid-sprint stops it.
out.push(
  kase('e_food_6_sprint', { ...flat, setup: { food: 6 }, tags: ['food', 'sprint'] },
    sprint,
  ),
  kase('e_food_7_sprint', { ...flat, setup: { food: 7 }, tags: ['food', 'sprint'] },
    sprint,
  ),
  kase('e_food_drop_mid_sprint', { ...flat, tags: ['food', 'sprint'] },
    hold(F, SPRINT),
    ticks(15),
    server(setFood(6)),
    ticks(25),
    releaseAll(),
    stopped(3),
  ),
  kase('e_food_0_walk_jump', { ...flat, setup: { food: 0 }, tags: ['food'] },
    hold(F),
    press(JUMP, 1),
    until('onGround', 40),
    releaseAll(),
    stopped(3),
  )
)

// Attributes (1.20.5+ / 1.21+), at ordinary and extreme values.
const attr = (id: string, value: number, extra: Partial<KaseSpec> = {}): KaseSpec => ({ ...flat, setup: { attributes: { [id]: value } }, tags: ['attribute', id], ...extra })
for (const v of [0, 0.05, 0.2, 1.0]) out.push(kase(`e_attr_movement_speed_${v}`, attr('movement_speed', v),
  press([F, SPRINT], v >= 1 ? 8 : 30),
  stopped(3),
))
for (const v of [0, 0.2, 1.0, 2.0]) out.push(kase(`e_attr_jump_strength_${v}`, attr('jump_strength', v, { since: '1.20.5' }),
  jump,
))
// Gravity is set as the first step: with zero or negative gravity the player would never settle on the ground.
for (const v of [0, 0.02, 0.16, -0.02]) {
  const g = server(setAttribute('gravity', v))
  out.push(kase(`e_attr_gravity_${v}_jump`, { ...flat, tags: ['attribute', 'gravity'] },
    g,
    ticks(3),
    press(JUMP, 1),
    ticks(60),
  ))
  out.push(kase(`e_attr_gravity_${v}_fall`, {
    ...flat,
    at: [0.5, 10, 0.5],
    rest: [0.5, 0, 0.5],
    tags: ['attribute', 'gravity'],
  },
    g,
    ticks(60),
  ))
}
for (const v of [0.25, 0.5, 2.0, 4.0]) {
  out.push(kase(`e_attr_scale_${v}_walk_jump`, attr('scale', v),
    hold(F),
    ticks(10),
    press(JUMP, 1),
    until('onGround', 60),
    releaseAll(),
    stopped(3),
  ))
  out.push(kase(`e_attr_scale_${v}_step`, {
    ...attr('scale', v),
    requires: ['stone'],
    area: 'steps',
    at: [0.5, 0, laneZ(13) + 0.5],
    yaw: 270,
  },
    press(F, 30),
    stopped(3),
  ))
}
for (const v of [0, 0.1, 1.0]) out.push(kase(`e_attr_sneaking_speed_${v}`, attr('sneaking_speed', v),
  press([F, SNEAK], 30),
  stopped(3),
))
for (const v of [0.5, 1.0]) {
  out.push(kase(`e_attr_movement_efficiency_${v}_soul_sand`, {
    ...attr('movement_efficiency', v),
    requires: ['soul_sand'],
    area: 'surfaces',
    at: [0.5, 0, laneZ(SURFACES.indexOf('soul_sand')) + 0.5],
    yaw: 270,
  },
    press(F, 30),
    stopped(3),
  ))
  out.push(kase(`e_attr_movement_efficiency_${v}_honey`, {
    ...attr('movement_efficiency', v),
    requires: ['honey_block'],
    area: 'surfaces',
    at: [0.5, 0, laneZ(SURFACES.indexOf('honey_block')) + 0.5],
    yaw: 270,
  },
    press(F, 30),
    stopped(3),
  ))
}
for (const v of [0.33, 1.0]) {
  out.push(kase(`e_attr_water_movement_efficiency_${v}`, {
    ...attr('water_movement_efficiency', v),
    area: 'water',
    at: [0.5, -3, 0.5],
    rest: [-8.5, 0, 0.5],
    yaw: 270,
  },
    press(F, 30),
    stable(5),
  ))
}
out.push(
  kase('e_attr_movement_speed_mid_walk', { ...flat, tags: ['attribute', 'movement_speed'] },
    hold(F),
    ticks(15),
    server(setAttribute('movement_speed', 0.2)),
    ticks(25),
    releaseAll(),
    stopped(3),
  ),
  kase('e_attr_gravity_mid_jump', { ...flat, tags: ['attribute', 'gravity'] },
    press(JUMP, 1),
    ticks(3),
    server(setAttribute('gravity', 0.01)),
    ticks(60),
  )
)

// An effect that runs out on its own: the client only counts it down, and the server's removal ends it.
const giveFor = (id: string, seconds: number, amplifier: number) =>
  commandBy({ '1.13': `effect give @p ${id} ${seconds} ${amplifier}`, '1.8': `effect @p ${id} ${seconds} ${amplifier}` })
out.push(
  kase('e_speed_runs_out_walk', { ...flat, tags: ['effect', 'speed'] },
    server(giveFor('speed', 1, 1)),
    hold(F),
    ticks(40),
    releaseAll(),
    stopped(3),
  ),
  kase('e_levitation_runs_out', { ...flat, since: '1.9', tags: ['effect', 'levitation'] },
    server(giveFor('levitation', 1, 0)),
    ticks(40),
    untilOr('onGround', 200),
    ticks(5),
  )
)

export default out
