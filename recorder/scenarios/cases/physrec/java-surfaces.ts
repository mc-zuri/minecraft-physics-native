// Ported from physics-data-generator catalog/src/cases/java-surfaces.mjs; maintained here now.
// Block surfaces: walk, sprint, sneak, sprint-jump and coasting on every friction / speed-factor / height class of
// floor; crossings between them; standing across two blocks (which one is the supporting block).
import './_areas/index.ts'
import { JUMP, SNEAK, SPRINT, hold, kase, press, releaseAll, stopped, ticks, until } from '../../dsl/physrec.ts'
import { SURFACES, TRANSITIONS, laneZ } from './_areas/java-areas.ts'

const name = (b: string): string => b.replace(/\[.*?layers=(\d)\]/, '_l$1').replace(/[[\]=,]/g, '_')
const out = []

SURFACES.forEach((block, i) => {
  const base = { area: 'surfaces', at: [0.5, 0, laneZ(i) + 0.5], yaw: 270, tier: 1, tags: ['surface', name(block)], requires: [block], ...(block === 'farmland' ? { serverMoves: true } : {}) }
  // snow[layers=1] is 2/16 high: the player stands on the stone below it; every other surface is stood on.
  const on = block === 'snow[layers=1]' ? [] : [`on:${block.replace(/\[.*/, '')}`]
  const s = name(block)
  out.push(
    kase(`s_walk_${s}`, { ...base, expect: on },
      press('forward', 30),
      stopped(3, 600),
      ticks(3),
    ),
    kase(`s_sprint_${s}`, { ...base, expect: on },
      press(['forward', SPRINT], 25),
      stopped(3, 600),
      ticks(3),
    ),
    kase(`s_sneak_${s}`, { ...base, expect: on },
      press(['forward', SNEAK], 30),
      stopped(3, 600),
      ticks(3),
    ),
    kase(`s_sprint_jump_${s}`, { ...base, expect: on },
      hold('forward', SPRINT),
      ticks(6),
      press(JUMP, 1),
      until('onGround', 40),
      releaseAll(),
      stopped(3, 600),
    ),
    kase(`s_jump_${s}`, { ...base, expect: on },
      press(JUMP, 1),
      until('onGround', 40),
      ticks(10),
    ),
    kase(`s_strafe_${s}`, { ...base, expect: on },
      press('left', 20),
      stopped(3, 600),
      ticks(3),
    )
  )
})

const LOWER_SLOW = new Set(['soul_sand', 'honey_block'])

TRANSITIONS.forEach(([a, b], i) => {
  const base = { area: 'transitions', at: [0.5, 0, laneZ(i) + 0.5], yaw: 270, tier: 1, tags: ['surface', 'transition'], requires: [a, b] }
  // The border is local x=6: start close before it (ice, slime and soul sand accelerate slowly or slow you down).
  // From 26.2 slime no longer micro-bounces under a walking player, which keeps its full slowdown.
  const from = a === 'slime_block' ? 5.2 : a === 'soul_sand' ? 4.7 : 3.5
  out.push(
    kase(`s_cross_${a}_to_${b}`, {
      ...base,
      at: [from, 0, laneZ(i) + 0.5],
      expect: [`on:${b}`],
    },
      press('forward', 40),
      stopped(3, 600),
    ),
    kase(`s_cross_sprint_${a}_to_${b}`, {
      ...base,
      at: [from, 0, laneZ(i) + 0.5],
      expect: [`on:${b}`],
    },
      press(['forward', SPRINT], 25),
      stopped(3, 600),
    ),
    kase(`s_coast_${a}_to_${b}`, {
      ...base,
      at: [from, 0, laneZ(i) + 0.5],
      // Before 1.20 friction follows the block under the player's centre: past the border a lower or stickier surface
      // stops the coast with the box's edge still above the first, which it then never leaves.
      expect: LOWER_SLOW.has(b) ? [`on:${b}@>=1.20`, `on:${a}@<1.20`] : [`on:${b}`],
    },
      press(['forward', SPRINT], 15),
      stopped(3, 600),
    )
  )
})

// The ice starts at local z=0: z=0.2 keeps the player's box on both stone (z<0) and ice.
const straddle = { area: 'straddle', yaw: 270, tier: 4, tags: ['surface', 'edge', 'supporting_block'] }
out.push(
  kase('s_straddle_mostly_stone', { ...straddle, at: [0.5, 0, -0.1] },
    press('forward', 30),
    stopped(3, 600),
  ),
  kase('s_straddle_mostly_ice', { ...straddle, at: [0.5, 0, 0.1] },
    press('forward', 30),
    stopped(3, 600),
  ),
  kase('s_straddle_center', { ...straddle, at: [0.5, 0, 0] },
    press(['forward', SPRINT], 20),
    stopped(3, 600),
  ),
  kase('s_straddle_drift_to_ice', { ...straddle, at: [0.5, 0, -0.35] },
    press(['forward', 'right'], 30),
    stopped(3, 600),
  )
)

export default out
