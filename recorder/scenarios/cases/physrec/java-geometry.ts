// Ported from physics-data-generator catalog/src/cases/java-geometry.mjs; maintained here now.
// Collision geometry: step-up onto every block height class (and the ones too high), ceilings at the stand / crouch /
// crawl clearances, sneak edge back-off from every side and corner, wall contact at every angle, thin blocks (panes,
// bars, fences, walls, doors, trapdoors, stair corners), chunk-border walls, crawl and crouch tunnels, being pushed
// out of a block.
import './_areas/index.ts'
import { DIRECTIONS, JUMP, SNEAK, SPRINT, hold, kase, press, releaseAll, stable, stopped, ticks, until } from '../../dsl/physrec.ts'
import { CEILINGS, OUTLINE_STEPS, RINGS, STEPS, laneZ, ringCenter } from './_areas/java-areas.ts'
import type { Pos } from '../../dsl/physrec.ts'

const name = (b: string): string => b.replace(/\[(.*?)\]/, (_: string, p: string) => '_' + p.replace(/[=,]/g, '_')).replace(/[^\w]/g, '_')
const out = []

const stepCases = (stepArea: string) => (block: string, i: number): void => {
  const base = { area: stepArea, at: [0.5, 0, laneZ(i) + 0.5], yaw: 270, tier: 1, tags: ['step', name(block)], requires: [block] }
  const n = name(block)
  out.push(
    kase(`g_step_walk_${n}`, base,
      press('forward', 30),
      stopped(3),
      ticks(3),
    ),
    kase(`g_step_sprint_${n}`, base,
      press(['forward', SPRINT], 20),
      stopped(3),
      ticks(3),
    ),
    kase(`g_step_sneak_${n}`, base,
      press(['forward', SNEAK], 50),
      stopped(3),
      ticks(3),
    ),
    kase(`g_step_jump_${n}`, base,
      hold('forward'),
      ticks(8),
      press(JUMP, 1),
      until('onGround', 40),
      ticks(10),
      releaseAll(),
      stopped(3),
    )
  )
}
STEPS.forEach(stepCases('steps'))
OUTLINE_STEPS.forEach(stepCases('outlineSteps'))
// The step height attribute: 1.0 climbs full blocks, 0.4 refuses a slab, 0 refuses carpet.
const stepAttr = (i: number, v: number) => ({ area: 'steps', at: [0.5, 0, laneZ(i) + 0.5], yaw: 270, tier: 2, tags: ['step', 'attribute'], requires: [STEPS[i]], setup: { attributes: { step_height: v } } })
out.push(
  kase('g_step_attr_1_full_block', stepAttr(STEPS.indexOf('stone'), 1.0),
    press('forward', 30),
    stopped(3),
  ),
  kase('g_step_attr_0_4_slab', stepAttr(STEPS.indexOf('stone_slab[type=bottom]'), 0.4),
    press('forward', 30),
    stopped(3),
  ),
  kase('g_step_attr_0_carpet', stepAttr(STEPS.indexOf('white_carpet'), 0),
    press('forward', 30),
    stopped(3),
  ),
  kase('g_step_attr_2_5_chest', stepAttr(STEPS.indexOf('chest[facing=west]'), 2.5),
    press('forward', 30),
    stopped(3),
  )
)

CEILINGS.forEach((c, i) => {
  // Clearances under 1.8 force a crouch or crawl only since 1.14 (poses); older players stay 1.8 tall in them.
  const forced = ['gap1_75', 'gap1_5', 'gap1'].includes(c.name)
  const base = { area: 'ceilings', at: [0.5, 0, laneZ(i) + 0.5], yaw: 270, tier: 1, tags: ['ceiling', c.name], ...(forced ? { since: '1.14' } : {}) }
  out.push(
    kase(`g_ceiling_walk_${c.name}`, base,
      press('forward', 40),
      stopped(3),
    ),
    kase(`g_ceiling_sneak_${c.name}`, base,
      press(['forward', SNEAK], 60),
      stopped(3),
    ),
    kase(`g_ceiling_sprint_jump_${c.name}`, base,
      hold('forward', SPRINT),
      ticks(12),
      press(JUMP, 1),
      until('onGround', 40),
      releaseAll(),
      stopped(3),
    ),
    kase(`g_ceiling_jump_under_${c.name}`, { ...base, at: [8.5, 0, laneZ(i) + 0.5] },
      press(JUMP, 1),
      stable(5),
      ticks(5),
    )
  )
})
// Head-hitter: sprint-jumping under a 2.5 ceiling repeatedly.
out.push(kase('g_head_hitter_hops', {
  area: 'ceilings',
  at: [0.5, 0, laneZ(CEILINGS.findIndex(c => c.name === 'gap2_5')) + 0.5],
  yaw: 270,
  tier: 4,
  tags: ['ceiling', 'jump', 'edge'],
},
  press(['forward', SPRINT, JUMP], 40),
  releaseAll(),
  stopped(3),
))

// Sneak edge back-off from the 3x3 block's middle toward every direction; the same walking (falls off); diagonals
// hit a corner. Also off a slab and off a carpet (sneak height difference below 0.6).
for (const [dir, keys] of Object.entries(DIRECTIONS)) {
  const base = { area: 'ledges', at: [0.5, 1, 0.5], tier: 1, tags: ['sneak', 'edge'], expect: 'on:stone' }
  out.push(
    kase(`g_edge_sneak_${dir}`, base,
      press([...keys, SNEAK], 40),
      ticks(5),
    ),
    kase(`g_edge_sneak_release_${dir}`, base,
      press([...keys, SNEAK], 30),
      stopped(3),
    ),
    kase(`g_edge_sprint_off_${dir}`, base,
      press([...keys, SPRINT], 15),
      stopped(3),
    )
  )
}
out.push(
  kase('g_edge_sneak_yaw_30', {
    area: 'ledges',
    at: [0.5, 1, 0.5],
    yaw: 30,
    tier: 4,
    tags: ['sneak', 'edge'],
  },
    press(['forward', SNEAK], 40),
    ticks(5),
  ),
  kase('g_edge_sneak_yaw_45', {
    area: 'ledges',
    at: [0.5, 1, 0.5],
    yaw: 45,
    tier: 4,
    tags: ['sneak', 'edge'],
  },
    press(['forward', SNEAK], 40),
    ticks(5),
  ),
  kase('g_edge_sneak_slab', {
    area: 'ledges',
    at: [7.5, 0.5, 0.5],
    yaw: 270,
    tier: 4,
    tags: ['sneak', 'edge'],
  },
    press(['forward', SNEAK], 40),
    ticks(5),
  ),
  kase('g_edge_sneak_carpet', {
    area: 'ledges',
    at: [-6.5, 0.0625, 0.5],
    yaw: 270,
    tier: 4,
    tags: ['sneak', 'edge'],
  },
    press(['forward', SNEAK], 40),
    ticks(5),
  ),
  kase('g_edge_sneak_jump', {
    area: 'ledges',
    at: [0.5, 1, 0.5],
    yaw: 270,
    tier: 4,
    tags: ['sneak', 'edge', 'jump'],
  },
    hold('forward', SNEAK),
    ticks(10),
    press(JUMP, 1),
    until('onGround', 40),
    ticks(10),
    releaseAll(),
  ),
  kase('g_edge_sneak_high_pillar', {
    area: 'ledges',
    at: [0.5, 3, 7.5],
    yaw: 0,
    tier: 4,
    tags: ['sneak', 'edge'],
  },
    press(['forward', SNEAK], 40),
    ticks(5),
  )
)

// Walls: head-on, shallow and steep angles (minor horizontal collision keeps a sprint), inner corner, chunk-border wall.
const wall = (n: string, at: Pos, yaw: number, keys: readonly string[], t = 30, tags: readonly string[] = []) => kase(`g_wall_${n}`, { area: 'walls', at, yaw, tier: 1, tags: ['collision', ...tags] },
  press(keys, t),
  stopped(3),
)
out.push(
  wall('head_on', [11.5, 0, 0.5], 270, ['forward']),
  wall('sprint_head_on', [8.5, 0, 0.5], 270, ['forward', SPRINT]),
  wall('sprint_1deg', [8.5, 0, 0.5], 271, ['forward', SPRINT], 40, ['minor_collision']),
  wall('sprint_5deg', [8.5, 0, 0.5], 275, ['forward', SPRINT], 40, ['minor_collision']),
  wall('sprint_8deg', [8.5, 0, 0.5], 278, ['forward', SPRINT], 40, ['minor_collision']),
  wall('sprint_10deg', [8.5, 0, 0.5], 280, ['forward', SPRINT], 40, ['minor_collision']),
  wall('sprint_45deg', [8.5, 0, 0.5], 315, ['forward', SPRINT], 40),
  wall('walk_89deg', [15.5, 0, -10.5], 359, ['forward'], 40),
  wall('inner_corner', [8.5, 0, -8.5], 45, ['forward'], 40),
  wall('inner_corner_sprint', [8.5, 0, -8.5], 45, ['forward', SPRINT], 40),
  wall('chunk_border_x', [13.5, 0, 0.5], 270, ['forward'], 20, ['chunk_border']),
  wall('glass_pane', [-6.5, 0, 3.5], 0, ['forward'], 30, ['thin']),
  wall('glass_pane_edge', [-5.9, 0, 3.5], 0, ['forward'], 30, ['thin']),
  wall('iron_bars', [-3.5, 0, 3.5], 0, ['forward'], 30, ['thin']),
  wall('cobblestone_wall', [0.5, 0, 3.5], 0, ['forward'], 30, ['thin']),
  wall('fence', [3.5, 0, 3.5], 0, ['forward'], 30, ['thin']),
  // The top of a fence or wall is in the cell above its own, where a probe under the feet finds it only from that cell too (B230).
  kase('g_stand_on_fence', { area: 'walls', at: [3.5, 1.5, 8.5], tier: 1, tags: ['fence'], expect: 'on:oak_fence' }, ticks(5)),
  kase('g_stand_on_cobblestone_wall', { area: 'walls', at: [0.5, 2.5, 8.5], tier: 1, tags: ['thin'], expect: 'on:cobblestone_wall' }, ticks(5)),
  wall('door_closed', [6.5, 0, 3.5], 0, ['forward'], 30, ['thin']),
  wall('trapdoor_open', [9.5, 0, 3.5], 0, ['forward'], 30, ['thin']),
  wall('stairs_inner_corner', [12.5, 0, 5.5], 0, ['forward'], 30, ['step']),
  wall('stairs_outer_corner', [12.5, 0, 8.5], 0, ['forward'], 30, ['step'])
)
out.push(kase('g_wall_jump_over_fence', {
  area: 'walls',
  at: [3.5, 0, 3.5],
  yaw: 0,
  tier: 1,
  tags: ['collision', 'jump'],
},
  hold('forward', SPRINT),
  ticks(5),
  press(JUMP, 1),
  until('onGround', 40),
  ticks(5),
  releaseAll(),
  stopped(3),
))
out.push(kase('g_wall_jump_over_wall_block', {
  area: 'walls',
  at: [0.5, 0, 3.5],
  yaw: 0,
  tier: 1,
  tags: ['collision', 'jump'],
},
  hold('forward'),
  ticks(5),
  press(JUMP, 1),
  until('onGround', 40),
  ticks(5),
  releaseAll(),
  stopped(3),
))

// Tunnels: teleported into a 1-high crawl space (swim pose on land), crawling out; crouching into a 1.5 gap.
out.push(
  kase('g_crawl_tunnel', {
    area: 'tunnels',
    at: [2.5, 0, -2.5],
    yaw: 270,
    tier: 2,
    tags: ['pose', 'crawl'],
  },
    ticks(5),
    press('forward', 80),
    stopped(3),
    ticks(10),
  ),
  kase('g_crawl_tunnel_sprint', {
    area: 'tunnels',
    at: [2.5, 0, -2.5],
    yaw: 270,
    tier: 2,
    tags: ['pose', 'crawl'],
  },
    ticks(5),
    press(['forward', SPRINT], 80),
    stopped(3),
    ticks(10),
  ),
  kase('g_crawl_tunnel_jump', {
    area: 'tunnels',
    at: [2.5, 0, -2.5],
    yaw: 270,
    tier: 4,
    tags: ['pose', 'crawl', 'jump'],
  },
    ticks(5),
    press(JUMP, 5),
    ticks(10),
  ),
  kase('g_crouch_tunnel_enter', {
    area: 'tunnels',
    at: [-2.5, 0, 3.5],
    yaw: 270,
    tier: 2,
    tags: ['pose', 'crouch'],
  },
    press(['forward', SNEAK], 60),
    press('forward', 20),
    stopped(3),
  ),
  kase('g_crouch_tunnel_stand_blocked', {
    area: 'tunnels',
    at: [-2.5, 0, 3.5],
    yaw: 270,
    tier: 2,
    tags: ['pose', 'crouch'],
  },
    press('forward', 40),
    stopped(3),
  ),
  kase('g_crouch_tunnel_release_inside', {
    area: 'tunnels',
    at: [-2.5, 0, 3.5],
    yaw: 270,
    tier: 4,
    tags: ['pose', 'crouch'],
  },
    press(['forward', SNEAK], 25),
    press('forward', 40),
    stopped(3),
  )
)

// Overlapping a block: vanilla pushes the player out (moveTowardsClosestSpace).
out.push(
  kase('g_pushout_x', {
    area: 'pushout',
    at: [-0.2, 0, 0.5],
    rest: [4.5, 0, 4.5],
    tier: 4,
    tags: ['collision', 'pushout'],
  },
    ticks(30),
  ),
  kase('g_pushout_z', {
    area: 'pushout',
    at: [0.5, 0, 1.25],
    rest: [4.5, 0, 4.5],
    tier: 4,
    tags: ['collision', 'pushout'],
  },
    ticks(30),
  ),
  kase('g_pushout_corner', {
    area: 'pushout',
    at: [1.2, 0, 1.2],
    rest: [4.5, 0, 4.5],
    tier: 4,
    tags: ['collision', 'pushout'],
  },
    ticks(30),
  ),
  kase('g_pushout_walking_in', {
    area: 'pushout',
    at: [-0.2, 0, 0.5],
    rest: [4.5, 0, 4.5],
    yaw: 270,
    tier: 4,
    tags: ['collision', 'pushout'],
    serverMoves: true,
  },
    press('forward', 20),
    ticks(20),
  )
)

// Each partial block, in both quadrants, into each corner of its ring on a diagonal, walking and in a sprint jump (B166, B172).
for (const [quadrant, area] of [['pos', 'ringsPos'], ['neg', 'ringsNeg']] as const) {
  RINGS.forEach((ring, i) => {
    for (const yaw of [45, 135, 225, 315]) {
      const base = { area, at: [ringCenter(i) + 0.5, 0, 0.5] as Pos, yaw, tier: 3, tags: ['collision', 'corner', ring] }
      out.push(
        kase(`rg_${ring}_${quadrant}_${yaw}_walk`, base,
          press('forward', 30),
          stopped(3),
        ),
        kase(`rg_${ring}_${quadrant}_${yaw}_jump`, base,
          hold('forward', SPRINT),
          ticks(6),
          press(JUMP, 1),
          ticks(22),
          releaseAll(),
          stopped(3),
        ),
      )
    }
  })
}

// The wall's face under the collision tolerances (B167): a box this far from it, walking in. The merger's and the query's 1e-7 either
// side of the face, on the x axis and past a corner. Proof: pos and horizontalCollision at afterMove.
for (const [name, gap] of [['in_2e7', -2e-7], ['in_5e8', -5e-8], ['flush', 0], ['out_5e8', 5e-8], ['out_2e7', 2e-7]] as const) {
  const at = 1 + 0.30000001192092896 + gap
  out.push(
    kase(`ce_wall_${name}`, { area: 'pushout', at: [at, 0, 0.5], rest: [4.5, 0, 4.5], yaw: 90, tier: 4, tags: ['collision', 'epsilon'], serverMoves: gap < 0 }, press('forward', 10), ticks(5)),
    kase(`ce_corner_${name}`, { area: 'pushout', at: [at, 0, at], rest: [4.5, 0, 4.5], yaw: 135, tier: 4, tags: ['collision', 'epsilon'], serverMoves: gap < 0 }, press('forward', 10), ticks(5)),
  )
}

export default out
