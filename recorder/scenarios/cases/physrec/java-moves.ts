// Entity.move's flags, support and tolerances in the player's own move, next to OracleMove's bare Entity (scripts/java-oracle/move).
//
// mv_zy_: the moves with no vertical part (NoGravity) and with a tiny one, on a flat floor, at a wall, under a ceiling, onto a step and
// off a ledge (B081, B085). Proof: onGround, verticalCollision and mainSupportingBlockPos at afterMove, tick by tick.
// mv_sup_: the block chosen under a box across two or four blocks, at rest and walking off each way (B086, B171). Proof:
// mainSupportingBlockPos and friction in vel.
// mv_top_: falling onto a top from either side of the tolerances, in both quadrants (B167). Proof: pos.y and onGround at afterMove.
// mv_stepeq_: the step height on, under and over the height of the step (B167). Proof: pos.y as the walk meets it.
// mv_mix_: blocks of a seeded palette around the start, each walked into diagonally in both quadrants (B161, B172). The seed gives the
// palette: `mixPalette(seed)` is the case's whole world, and the case id names the seed.
import './_areas/index.ts'
import { JUMP, SNEAK, SPRINT, hold, impulse, kase, press, registerAreas, releaseAll, server, setNoGravity, stopped, ticks } from '../../dsl/physrec.ts'
import type { KaseSpec, PhysrecArea, PhysrecFill, Pos } from '../../dsl/physrec.ts'
import type { Scenario } from '../../dsl/core.ts'

const fill = (from: Pos, to: Pos, block: string, extra: Partial<PhysrecFill> = {}): PhysrecFill => ({ from, to, block, ...extra })
const floor = (extent: readonly number[], block = 'stone'): PhysrecFill => fill([extent[0], 0, extent[2]], [extent[1], 0, extent[3]], block)
const out: Scenario[] = []
const areas: PhysrecArea[] = []
const addArea = (name: string, extent: readonly number[], blocks: readonly PhysrecFill[], origin?: Pos): string => {
  areas.push({ name, extent, ...(origin ? { origin } : {}), blocks: [floor(extent), ...blocks] })
  return name
}

// The half width of the player's box, a float as a double.
const HALF = 0.30000001192092896

// mv_zy_
const noGravityOn = server(setNoGravity(true))
const noGravityOff = server(setNoGravity(false))
const LANES: readonly (readonly [string, readonly PhysrecFill[]])[] = [
  ['flat', []],
  ['wall', [fill([3, 1, -2], [3, 2, 2], 'stone')]],
  ['ceiling', [fill([-2, 3, -2], [6, 3, 2], 'stone')]],
  ['low', [fill([-2, 2, -2], [6, 2, 2], 'stone_slab[type=top]')]],
  ['step', [fill([3, 1, -2], [6, 1, 2], 'stone_slab[type=bottom]')]],
  ['ledge', [fill([3, 0, -2], [8, 0, 2], 'air')]],
]
for (const [name, blocks] of LANES) {
  const area = addArea(`moves_${name}`, [-6, 10, -6, 6], blocks)
  const base: KaseSpec = { area, at: [0.5, 0, 0.5], yaw: 270, tier: 3, tags: ['flags', 'zero_y'], since: '1.10', serverMoves: name === 'ledge' }
  out.push(
    kase(`mv_zy_${name}_walk`, base, noGravityOn, ticks(2), press('forward', 25), ticks(3), noGravityOff, ticks(25)),
    kase(`mv_zy_${name}_sprint`, base, noGravityOn, ticks(2), press(['forward', SPRINT], 18), ticks(3), noGravityOff, ticks(25)),
    kase(`mv_zy_${name}_tiny_down`, base, noGravityOn, ticks(2), server(impulse(0, -1.0e-6, 0)), press('forward', 25), noGravityOff, ticks(25)),
    kase(`mv_zy_${name}_tiny_up`, base, noGravityOn, ticks(2), server(impulse(0, 1.0e-6, 0)), press('forward', 25), noGravityOff, ticks(25)),
    kase(`mv_zy_${name}_idle`, { ...base, tags: ['flags', 'zero_y', 'idle'] }, ticks(3), noGravityOn, ticks(8), noGravityOff, ticks(8)),
  )
}

// mv_sup_: pairs of blocks of equal top split at the cell edge x=1, and four around the corner x=1, z=1
const PAIRS: readonly (readonly [string, string, string])[] = [
  ['stone', 'stone', 'stone'],
  ['slab', 'stone_slab[type=bottom]', 'stone_slab[type=bottom]'],
  ['iceside', 'stone', 'ice'],
  ['honey', 'stone', 'honey_block'],
  ['soul', 'stone', 'soul_sand'],
  ['carpets', 'white_carpet', 'stone_slab[type=bottom]'],
  ['fence', 'oak_fence', 'stone'],
]
const SPOTS: readonly (readonly [string, number, number])[] = [
  ['edge', 1 - 0.1, 0.5],
  ['split', 1, 0.5],
  ['corner', 1, 1],
  ['tiny', 1 + HALF - 1.0e-7, 0.5],
]
PAIRS.forEach(([name, a, b]) => {
  // what is under the cells: the left half one block, the right the other, stone below a partial one
  const raised = (block: string) => /slab|carpet|fence/.test(block)
  const left = raised(a) ? fill([-4, 1, -4], [0, 1, 6], a, /fence/.test(a) ? { update: true } : {}) : fill([-4, 0, -4], [0, 0, 6], a)
  const right = raised(b) ? fill([1, 1, -4], [6, 1, 6], b, /fence/.test(b) ? { update: true } : {}) : fill([1, 0, -4], [6, 0, 6], b)
  const area = addArea(`moves_sup_${name}`, [-6, 8, -6, 8], [left, right])
  const y = raised(a) && raised(b) ? (/carpet/.test(a) ? 0.0625 : 0.5) : 0
  const base: KaseSpec = { area, at: [0.5, 0, 0.5], tier: 3, tags: ['support'], requires: [a, b] }
  for (const [spot, x, z] of SPOTS) {
    if (/fence/.test(a) && spot !== 'edge') continue
    const at: Pos = [x, y, z]
    out.push(
      kase(`mv_sup_${name}_${spot}_rest`, { ...base, at, serverMoves: true }, ticks(12)),
      kase(`mv_sup_${name}_${spot}_east`, { ...base, at, yaw: 270, serverMoves: true }, press('forward', 16), stopped(3)),
      kase(`mv_sup_${name}_${spot}_west`, { ...base, at, yaw: 90, serverMoves: true }, press('forward', 16), stopped(3)),
      kase(`mv_sup_${name}_${spot}_jump`, { ...base, at, yaw: 45, serverMoves: true }, hold('forward'), ticks(2), press(JUMP, 1), ticks(14), releaseAll(), stopped(3)),
      kase(`mv_sup_${name}_${spot}_sneak`, { ...base, at, yaw: 270, serverMoves: true }, press(['forward', SNEAK], 20), stopped(3)),
    )
  }
})

// mv_top_: from just above and just inside the top of each block, in both quadrants
const TOPS: readonly (readonly [string, string, number])[] = [
  ['stone', 'stone', 1],
  ['slab', 'stone_slab[type=bottom]', 0.5],
  ['carpet', 'white_carpet', 0.0625],
  ['stairs', 'stone_stairs[facing=east]', 0.5],
  ['snow', 'snow[layers=3]', 0.25],
  ['fence', 'oak_fence', 1.5],
  ['trapdoor', 'oak_trapdoor[half=bottom,open=false]', 0.1875],
]
const GAPS: readonly (readonly [string, number])[] = [
  ['in_2e7', -2e-7], ['in_1e7', -1e-7], ['in_5e8', -5e-8], ['flush', 0], ['out_5e8', 5e-8], ['out_1e7', 1e-7], ['out_2e7', 2e-7], ['out_1e6', 1e-6],
]
for (const [quadrant, origin] of [['pos', undefined], ['neg', [-2000000, 100, -2000000]]] as const) {
  TOPS.forEach(([name, block, top]) => {
    const area = addArea(`moves_top_${name}_${quadrant}`, [-6, 6, -6, 6], [fill([0, 1, 0], [0, 1, 0], block, /fence/.test(block) ? { update: true } : {})], origin as Pos | undefined)
    const base: KaseSpec = { area, at: [0.5, 0, 0.5], tier: 3, tags: ['epsilon', 'top'], requires: [block], serverMoves: true }
    for (const [gap, value] of GAPS) {
      const at: Pos = [0.5, top - 1 + 1 + value, 0.5]
      out.push(
        kase(`mv_top_${name}_${quadrant}_${gap}`, { ...base, at }, ticks(8)),
        ...(/flush|_1e7/.test(gap) ? [kase(`mv_top_${name}_${quadrant}_${gap}_walk`, { ...base, at, yaw: 270 }, press('forward', 14), ticks(6))] : []),
      )
    }
  })
}

// mv_stepeq_: a step height the height of the step, a float under it and a float over it
const stepArea = addArea('moves_stepeq', [-6, 10, -6, 6], [fill([3, 1, -2], [6, 1, 2], 'stone_slab[type=bottom]')])
const stepAreaCarpet = addArea('moves_stepeq_carpet', [-6, 10, -6, 6], [fill([3, 1, -2], [6, 1, 2], 'white_carpet')])
const STEP_HEIGHTS: readonly (readonly [string, string, number])[] = [
  ['slab_eq', stepArea, 0.5], ['slab_under', stepArea, 0.49999997], ['slab_over', stepArea, 0.50000006],
  ['carpet_eq', stepAreaCarpet, 0.0625], ['carpet_under', stepAreaCarpet, 0.06249999], ['carpet_over', stepAreaCarpet, 0.062500015],
]
for (const [name, area, height] of STEP_HEIGHTS) {
  const base: KaseSpec = { area, at: [0.5, 0, 0.5], yaw: 270, tier: 3, tags: ['step', 'epsilon'], since: '1.20.5', setup: { attributes: { step_height: height } } }
  out.push(
    kase(`mv_stepeq_${name}_walk`, base, press('forward', 25), stopped(3)),
    kase(`mv_stepeq_${name}_jump`, base, hold('forward'), ticks(4), press(JUMP, 1), ticks(16), releaseAll(), stopped(3)),
  )
}

// mv_mix_: a small linear congruential generator, so the palette of a seed is the same on every run and in every language
const random = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}
const MIX = [
  'stone_slab[type=bottom]', 'stone_slab[type=top]', 'cobblestone_stairs[facing=north]', 'cobblestone_stairs[facing=east]', 'cobblestone_stairs[facing=south,half=top]',
  'oak_fence', 'cobblestone_wall', 'glass_pane', 'iron_bars', 'oak_fence_gate[facing=north,open=true]', 'oak_fence_gate[facing=east,open=false]',
  'oak_trapdoor[half=bottom,open=false]', 'oak_trapdoor[facing=north,open=true]', 'oak_door[half=lower,facing=east,open=false]', 'snow[layers=4]', 'white_carpet',
  'chest[facing=west]', 'stone_pressure_plate', 'lantern', 'hopper', 'cauldron', 'anvil',
]
/** The nine columns around (0, 0) but the middle one: its block, or none. */
export const mixPalette = (seed: number): readonly (readonly [number, number, string])[] => {
  const next = random(seed)
  const cells: [number, number, string][] = []
  for (const x of [-1, 0, 1]) {
    for (const z of [-1, 0, 1]) {
      const pick = MIX[Math.floor(next() * MIX.length)] as string
      if ((x !== 0 || z !== 0) && next() < 0.8) cells.push([x * 2, z * 2, pick])
    }
  }
  return cells
}
for (let seed = 1; seed <= 20; seed += 1) {
  for (const [quadrant, origin] of [['pos', undefined], ['neg', [-3000000, 80, -3000000]]] as const) {
    const blocks = mixPalette(seed).map(([x, z, block]) => fill([x, 1, z], [x, 1, z], block, { update: true }))
    const area = addArea(`moves_mix_${seed}_${quadrant}`, [-6, 6, -6, 6], blocks, origin as Pos | undefined)
    const base: KaseSpec = { area, at: [0.5, 0, 0.5], tier: 3, tags: ['collision', 'mix', `seed${seed}`], requires: mixPalette(seed).map(([, , block]) => block) }
    const yaw = 45 + 90 * (seed % 4)
    out.push(
      kase(`mv_mix_${seed}_${quadrant}_walk`, { ...base, yaw }, press('forward', 30), stopped(3)),
      kase(`mv_mix_${seed}_${quadrant}_jump`, { ...base, yaw: yaw + 12 }, hold('forward', SPRINT), ticks(4), press(JUMP, 1), ticks(16), releaseAll(), stopped(3)),
    )
  }
}

registerAreas(areas)

export default out
