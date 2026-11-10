// Ported from physics-data-generator catalog/src/java-areas.mjs; maintained here now.
// Java-only courses, in the same local coordinates as the observer's: block y=0 is the floor, a case's `at` y=0 is
// standing on it. Lanes run along +x (yaw 270 faces +x), one lane per variant, so one area serves a whole family.

// First release with each block (by its modern id). Fills of newer blocks are left out on older versions; cases about
// a lane's block list it in `requires`, so only they are skipped.
import type { PhysrecArea, PhysrecFill, Pos } from '../../../dsl/physrec.ts'

export const SINCE: Readonly<Record<string, string>> = {
  end_rod: '1.9', frosted_ice: '1.9', magma_block: '1.10', white_bed: '1.12', blue_ice: '1.13', kelp: '1.13',
  kelp_plant: '1.13', bubble_column: '1.13', scaffolding: '1.14', lectern: '1.14', composter: '1.14', stonecutter: '1.14',
  lantern: '1.14', sweet_berry_bush: '1.14', honey_block: '1.15', soul_soil: '1.16', twisting_vines: '1.16',
  twisting_vines_plant: '1.16', weeping_vines: '1.16', weeping_vines_plant: '1.16', powder_snow: '1.17',
  pointed_dripstone: '1.17', dripstone_block: '1.17', cave_vines: '1.17', cave_vines_plant: '1.17', sculk_sensor: '1.17',
  dirt_path: '1.9', mud: '1.18.99', campfire: '1.14', soul_campfire: '1.16', copper_grate: '1.20.3'
}
export const sinceOf = (state: string): string | undefined => SINCE[state.replace(/\[.*/, '')]
// Waterlogged states need 1.13.
const gate = (block: string): string | undefined => sinceOf(block) ?? (/waterlogged=true/.test(block) ? '1.13' : undefined)
type Extra = Omit<PhysrecFill, 'from' | 'to' | 'block'>
const fill = (from: Pos, to: Pos, block: string, extra: Extra = {}): PhysrecFill => ({ from, to, block, ...(gate(block) ? { since: gate(block) } : {}), ...extra })
const floor = (extent: readonly number[], block = 'stone'): PhysrecFill => fill([extent[0], 0, extent[2]], [extent[1], 0, extent[3]], block)
const area = (name: string, extent: readonly number[], ...blocks: (PhysrecFill | readonly PhysrecFill[])[]): PhysrecArea => ({ name, extent, blocks: [floor(extent), ...blocks.flat()] })

// Lane z for variant i: lanes are 4 apart, separated by glass walls so nothing leaks across.
export const laneZ = (i: number): number => -20 + i * 4
function lanes<T> (variants: readonly T[], build: (v: T, z: number) => PhysrecFill | readonly PhysrecFill[]): PhysrecFill[] {
  const blocks: PhysrecFill[] = []
  variants.forEach((v, i) => {
    const z = laneZ(i)
    blocks.push(fill([-6, 1, z - 2], [22, 3, z - 2], 'glass'))
    blocks.push(...[build(v, z)].flat() as PhysrecFill[])
  })
  return blocks
}

// Surfaces: one pad per block, walkable from x=-4 to 18 with room to coast.
export const SURFACES = ['ice', 'packed_ice', 'blue_ice', 'frosted_ice', 'slime_block', 'honey_block', 'soul_sand', 'soul_soil',
  'mud', 'farmland', 'dirt_path', 'snow_block', 'magma_block', 'sand', 'grass_block', 'oak_planks', 'glass', 'hay_block',
  'white_wool', 'snow[layers=8]', 'snow[layers=1]']
const surfaces = area('surfaces', [-8, 24, -24, SURFACES.length * 4 - 16],
  lanes(SURFACES, (b, z) => fill([-4, 0, z - 1], [22, 0, z + 1], b)))

// Transitions: first half one block, second half another.
export const TRANSITIONS = [['stone', 'ice'], ['ice', 'stone'], ['ice', 'soul_sand'], ['slime_block', 'ice'],
  ['blue_ice', 'honey_block'], ['packed_ice', 'slime_block'], ['stone', 'soul_sand'], ['soul_sand', 'stone']]
const transitions = area('transitions', [-8, 24, -24, TRANSITIONS.length * 4 - 16],
  lanes(TRANSITIONS, ([a, b], z) => [fill([-4, 0, z - 1], [5, 0, z + 1], a), fill([6, 0, z - 1], [22, 0, z + 1], b)]))

// Step targets: walk +x from x=0 into a row of the block at x=3..5.
export const STEPS = ['stone_slab[type=bottom]', 'white_bed[part=foot,facing=east]', 'stonecutter', 'white_carpet',
  'snow[layers=2]', 'snow[layers=4]', 'snow[layers=5]', 'snow[layers=6]', 'sculk_sensor', 'enchanting_table',
  'soul_sand', 'farmland', 'chest[facing=west]', 'stone', 'stone_stairs[facing=east]', 'stone_stairs[facing=west]',
  'oak_trapdoor[half=bottom,open=false]', 'oak_trapdoor[half=top,open=false]', 'lectern', 'cauldron', 'hopper',
  'composter', 'end_rod[facing=up]', 'lantern', 'pointed_dripstone', 'lily_pad', 'oak_fence', 'cobblestone_wall']
// The player's lanes (java-player-edges): water at the eyes alone, then at the feet too; a pool that ends in a dry crawl
// tunnel; a deep pool under open sky for the eyes at its surface.
export const PLAYER_LANES = ['eyes', 'exit', 'surface'] as const
const playerEdges = area('playerEdges', [-8, 24, -24, PLAYER_LANES.length * 4 - 16],
  lanes(PLAYER_LANES, (lane, z) => lane === 'eyes'
    ? [fill([4, 2, z - 1], [12, 2, z + 1], 'water'), fill([9, 1, z - 1], [12, 1, z + 1], 'water'), fill([4, 3, z - 1], [12, 3, z + 1], 'stone'), fill([13, 1, z - 1], [13, 3, z + 1], 'stone')]
    : lane === 'exit'
      ? [fill([-4, 1, z - 1], [7, 2, z + 1], 'water'), fill([-4, 3, z - 1], [7, 3, z + 1], 'stone'), fill([8, 2, z - 1], [16, 3, z + 1], 'stone')]
      : [fill([-4, 1, z - 1], [12, 3, z + 1], 'water')]))
// Blocks that take their shape from their neighbours, placed with updates: before 1.13 the client works it out at each
// query (fences, panes, walls, stairs), from it the state says. Lanes along x, a run at x 3 to 5 with a branch at x 5.
export const NEIGHBOUR_LANES = ['oak_fence', 'cobblestone_wall', 'glass_pane', 'iron_bars', 'stairs', 'gate'] as const
const neighbours = area('neighbours', [-8, 24, -24, NEIGHBOUR_LANES.length * 4 - 16],
  lanes(NEIGHBOUR_LANES, (lane, z) => lane === 'stairs'
    ? [fill([3, 1, z], [3, 1, z], 'oak_stairs[facing=east]', { update: true }), fill([3, 1, z + 1], [3, 1, z + 1], 'oak_stairs[facing=north]', { update: true }),
        fill([5, 1, z], [5, 1, z], 'oak_stairs[facing=west]', { update: true }), fill([5, 1, z - 1], [5, 1, z - 1], 'oak_stairs[facing=west]', { update: true }), fill([6, 1, z - 1], [6, 1, z - 1], 'oak_stairs[facing=north]', { update: true })]
    : lane === 'gate'
      ? [fill([4, 1, z - 1], [4, 1, z + 1], 'cobblestone_wall', { update: true }), fill([4, 1, z], [4, 1, z], 'oak_fence_gate[facing=east]', { update: true })]
      : [fill([3, 1, z], [5, 1, z], lane, { update: true }), fill([5, 1, z + 1], [5, 1, z + 1], lane, { update: true }), fill([3, 1, z - 1], [3, 1, z - 1], 'stone')]))
// Offset blocks a player can stand in: the grid of what it is already inside (Block.getOffset), and the block under it for dripstone.
export const INSIDE_LANES = ['bamboo', 'pointed_dripstone'] as const
const inside = area('insideOffset', [-8, 24, -24, INSIDE_LANES.length * 4 - 16],
  lanes(INSIDE_LANES, (block, z) => [fill([3, 1, z], [3, 1, z], block), fill([6, 1, z - 1], [6, 1, z - 1], block), fill([7, 1, z + 1], [7, 1, z + 1], block)]))
const steps = area('steps', [-8, 24, -24, STEPS.length * 4 - 16],
  lanes(STEPS, (b, z) => fill([3, 1, z - 1], [5, 1, z + 1], b, /fence|wall/.test(b) ? { update: true } : {})))

// Step targets whose outline leaves their cell, unlike their collision: a pitcher crop's lower half starts at -1/16
// (26.3 PitcherCropBlock.java:53), as a lectern's top plate reaches 18/16 (26.3 LecternBlock.java:231).
export const OUTLINE_STEPS = ['pitcher_crop[half=lower,age=4]']
const outlineSteps = area('outlineSteps', [-8, 24, -24, OUTLINE_STEPS.length * 4 - 16],
  lanes(OUTLINE_STEPS, (b, z) => fill([3, 1, z - 1], [5, 1, z + 1], b)))

// Ceilings above a walk lane: the clearance decides stand / forced crouch / crawl. Floors raise the clearance edge
// cases: carpet leaves 1.9375, snow layers 2 and 3 leave 1.875 and 1.75 under a 2-high ceiling.
/** A ceiling lane: the blocks on its floor ([state, y]), its ceiling height, and whether the ceiling is open. */
export interface Ceiling { readonly name: string; readonly blocks: readonly (readonly [string, number])[]; readonly ceilingY?: number; readonly open?: boolean }
export const CEILINGS: readonly Ceiling[] = [
  { name: 'gap2', blocks: [] },
  { name: 'gap1_9375', blocks: [['white_carpet', 1]] },
  { name: 'gap1_875', blocks: [['snow[layers=2]', 1]] },
  { name: 'gap1_75', blocks: [['snow[layers=3]', 1]] },
  { name: 'gap1_5', blocks: [['stone_slab[type=top]', 2]], ceilingY: 2 },
  { name: 'gap1', blocks: [], ceilingY: 2 },
  { name: 'gap2_5', blocks: [['stone_slab[type=top]', 3]], ceilingY: 3, open: true }
]
const ceilings = area('ceilings', [-8, 24, -24, CEILINGS.length * 4 - 16],
  lanes(CEILINGS, (c, z) => {
    const top = c.ceilingY ?? 3
    const out = [fill([4, top, z - 1], [16, top, z + 1], c.open ? 'air' : 'stone')]
    for (const [block, y] of c.blocks) out.push(fill([4, y, z - 1], [16, y, z + 1], block))
    return out
  }))

// Landing pads: fall targets 3x3 at x=4 (pad blocks replace the floor when full, sit on it otherwise).
export const LANDINGS = ['stone', 'slime_block', 'white_bed[part=foot,facing=east]', 'hay_block', 'water', 'cobweb',
  'powder_snow', 'scaffolding', 'honey_block', 'white_carpet', 'snow[layers=4]', 'cauldron', 'hopper', 'soul_sand',
  'farmland', 'twisting_vines_plant', 'sweet_berry_bush[age=3]', 'oak_leaves[persistent=true]', 'ladder[facing=west]',
  'bubble_column[drag=false]', 'lava', 'mud', 'pointed_dripstone', 'dripstone_block']
const LIQUID_PADS = new Set(['water', 'lava', 'bubble_column[drag=false]', 'powder_snow'])
const landing = area('landing', [-8, 12, -24, LANDINGS.length * 4 - 16],
  lanes(LANDINGS, (b, z) => {
    if (LIQUID_PADS.has(b)) {
      // Two deep: a pool below the floor, the column's soul sand under a bubble column.
      return [fill([3, -2, z - 1], [5, 0, z + 1], b.startsWith('bubble') ? 'water' : b),
        ...(b.startsWith('bubble') ? [fill([3, -3, z - 1], [5, -3, z + 1], 'soul_sand'), fill([3, -2, z - 1], [5, 0, z + 1], b)] : [])]
    }
    if (b.startsWith('ladder')) return [fill([6, 1, z - 1], [6, 12, z + 1], 'stone'), fill([5, 1, z - 1], [5, 12, z + 1], b)]
    const full = ['stone', 'slime_block', 'hay_block', 'honey_block', 'soul_sand', 'farmland', 'mud', 'dripstone_block'].includes(b)
    return [fill([3, full ? 0 : 1, z - 1], [5, full ? 0 : 1, z + 1], b)]
  }))

// Ledges: a raised 3x3 block, for sneak-edge in every direction and walking off.
const ledges = area('ledges', [-12, 12, -12, 12],
  fill([-1, 1, -1], [1, 1, 1], 'stone'),
  fill([6, 1, -1], [8, 1, 1], 'stone_slab[type=bottom]'),
  fill([-8, 1, -1], [-6, 1, 1], 'white_carpet'),
  fill([-1, 1, 6], [1, 3, 8], 'stone'))

// Walls for collision angles, corners and chunk-border contact: the long wall's face is local x=16, a chunk border
// (packed origins have x=0).
const walls = area('walls', [-8, 24, -12, 12],
  fill([16, 1, -12], [16, 3, 12], 'stone'),
  fill([5, 1, -12], [5, 3, -6], 'stone'),
  fill([5, 1, -6], [10, 3, -6], 'stone'),
  fill([-6, 1, 6], [-6, 3, 12], 'glass_pane', { update: true }),
  fill([-3, 1, 6], [-3, 3, 12], 'iron_bars', { update: true }),
  fill([0, 1, 6], [0, 2, 12], 'cobblestone_wall', { update: true }),
  fill([3, 1, 6], [3, 1, 12], 'oak_fence', { update: true }),
  fill([6, 1, 6], [6, 2, 6], 'oak_door[facing=west,half=lower,open=false]'),
  fill([6, 2, 6], [6, 2, 6], 'oak_door[facing=west,half=upper,open=false]'),
  fill([9, 1, 6], [9, 1, 12], 'oak_trapdoor[facing=west,half=bottom,open=true]'),
  fill([12, 1, 8], [12, 1, 8], 'stone_stairs[facing=east,shape=inner_left]'),
  fill([12, 1, 10], [12, 1, 10], 'stone_stairs[facing=east,shape=outer_left]'))

// Climbables: one column each against a wall at x=6, player comes from x=0 walking +x.
export const CLIMBS = ['ladder[facing=west]', 'vine[east=true]', 'scaffolding', 'twisting_vines', 'weeping_vines',
  'cave_vines', 'ladder_trapdoor', 'ladder_water']
const climbs = area('climbs', [-8, 12, -24, CLIMBS.length * 4 - 16],
  lanes(CLIMBS, (c, z) => {
    const wall = fill([6, 1, z - 1], [6, 12, z + 1], 'stone')
    switch (c) {
      case 'scaffolding': return [fill([5, 1, z], [5, 10, z], 'scaffolding[distance=0]')]
      case 'twisting_vines': return [wall, fill([5, 1, z], [5, 9, z], 'twisting_vines_plant'), fill([5, 10, z], [5, 10, z], 'twisting_vines')]
      case 'weeping_vines': return [wall, fill([5, 11, z], [5, 11, z], 'stone'), fill([5, 2, z], [5, 9, z], 'weeping_vines_plant'), fill([5, 1, z], [5, 1, z], 'weeping_vines')]
      case 'cave_vines': return [wall, fill([5, 11, z], [5, 11, z], 'stone'), fill([5, 2, z], [5, 10, z], 'cave_vines_plant'), fill([5, 1, z], [5, 1, z], 'cave_vines')]
      case 'ladder_trapdoor': return [wall, fill([5, 1, z], [5, 4, z], 'ladder[facing=west]'), fill([5, 5, z], [5, 5, z], 'oak_trapdoor[facing=west,half=bottom,open=true]')]
      // (nothing in front: a walker comes to it from x=0 as to the others, and no block update reaches this water)
      case 'ladder_water': return [wall, fill([5, 1, z], [5, 8, z], 'ladder[facing=west,waterlogged=true]'), fill([5, 1, z - 1], [5, 1, z - 1], 'glass'), fill([5, 1, z + 1], [5, 1, z + 1], 'glass')]
      default: return [wall, fill([5, 1, z], [5, 10, z], c)]
    }
  }))

// Fluids: a 3-deep pool with a shallow shelf, a ledge to jump out on, kelp and a waterlogged row; a flowing channel
// (static flowing states, so the flow is fixed) with an L bend; a lava pool.
const water = area('water', [-16, 24, -16, 16],
  fill([-10, -3, -10], [20, 0, 10], 'water'),
  fill([-10, -3, -10], [-6, -1, 10], 'stone'),
  fill([14, -3, -10], [20, 1, -4], 'stone'),
  fill([2, -2, 6], [2, 0, 6], 'kelp_plant'),
  fill([2, -3, 6], [2, -3, 6], 'sand'),
  fill([6, -1, -2], [10, -1, 2], 'stone_slab[type=bottom,waterlogged=true]'))

// Flow: level 0 is a source; levels 1-7 flow toward higher numbers. A wide straight channel (two blocks per level, a
// fixed flow along +x) and a 1-wide L path that follows real spreading: source, 4 blocks +x, then 3 blocks +z.
const channel = []
for (let i = 0; i <= 7; i++) channel.push(fill([-4 + i * 2, 1, -1], [-3 + i * 2, 1, 1], `water[level=${i}]`))
const bendPath = [[-4, 6, 0], [-3, 6, 1], [-2, 6, 2], [-1, 6, 3], [0, 6, 4], [0, 7, 5], [0, 8, 6], [0, 9, 7]]
const flow = area('flow', [-8, 16, -8, 16],
  fill([-6, 1, -3], [12, 2, -3], 'stone'), fill([-6, 1, 3], [12, 2, 3], 'stone'), fill([12, 1, -3], [12, 2, 3], 'stone'),
  fill([-6, 1, -3], [-6, 2, 3], 'stone'),
  channel,
  fill([-6, 1, 4], [2, 3, 12], 'stone'),
  bendPath.map(([x, z]) => fill([x, 1, z], [x, 2, z], 'air')),
  bendPath.map(([x, z, level]) => fill([x, 1, z], [x, 1, z], `water[level=${level}]`)),
  fill([-6, 3, 4], [2, 3, 12], 'glass'))

const lava = area('lava', [-16, 16, -16, 16],
  fill([-10, -3, -10], [10, 0, 10], 'lava'), fill([-10, -3, -10], [-6, 0, 10], 'stone'))

// Honey wall to slide down beside, and a soul-sand bubble column next to a magma one with air above both.
const honeyWall = area('honeyWall', [-10, 10, -10, 10],
  fill([2, 1, -3], [2, 20, 3], 'honey_block'), fill([-2, 20, -1], [1, 20, 1], 'stone'))

// Tunnels: 1-high crawl tunnel, 1.5-high crouch tunnel, and a pool whose exit is a 1-high gap (swim pose on land).
const tunnels = area('tunnels', [-10, 24, -10, 10],
  fill([0, 2, -4], [16, 2, -2], 'stone'), fill([0, 1, -4], [16, 1, -4], 'stone'), fill([0, 1, -2], [16, 1, -2], 'stone'),
  fill([0, 2, 2], [16, 2, 4], 'stone_slab[type=bottom]'), fill([0, 1, 2], [16, 1, 2], 'stone'), fill([0, 1, 4], [16, 1, 4], 'stone'),
  fill([-6, 0, -3], [-2, 0, -3], 'stone'))

// Rails for minecarts: straight with a powered stretch, a slope and a curve.
const rails = area('rails', [-8, 40, -12, 12],
  fill([0, 1, 0], [9, 1, 0], 'rail[shape=east_west]'),
  fill([10, 1, 0], [15, 1, 0], 'powered_rail[shape=east_west,powered=true]'),
  fill([16, 1, 0], [30, 1, 0], 'rail[shape=east_west]'),
  fill([31, 1, 0], [31, 1, 0], 'rail[shape=south_west]'),
  fill([31, 1, 1], [31, 1, 8], 'rail[shape=north_south]'),
  fill([0, 1, -6], [5, 1, -6], 'rail[shape=east_west]'),
  fill([6, 1, -6], [6, 1, -6], 'rail[shape=ascending_east]'),
  fill([7, 1, -6], [7, 1, -6], 'stone'), fill([7, 2, -6], [7, 2, -6], 'rail[shape=ascending_east]'),
  fill([8, 1, -6], [8, 2, -6], 'stone'), fill([8, 3, -6], [12, 3, -6], 'rail[shape=east_west]'),
  fill([8, 1, -6], [12, 2, -6], 'stone'))

// Boats: open water with a shore, an ice run and a drop from a ledge into the water.
const boats = area('boats', [-10, 40, -12, 12],
  fill([-6, -1, -8], [24, 0, 8], 'water'),
  fill([25, 0, -8], [40, 0, 8], 'stone'),
  fill([-10, 0, 10], [40, 0, 12], 'ice'),
  fill([-10, 0, -12], [40, 0, -10], 'blue_ice'),
  fill([-6, 1, -9], [24, 1, -9], 'stone'),
  fill([-6, 4, 4], [-3, 4, 8], 'stone'))

// Mounts: flat run with a 1-block step and a 2-block wall to jump.
const mounts = area('mounts', [-10, 50, -12, 12],
  fill([20, 1, -12], [20, 1, 12], 'stone'),
  fill([35, 1, -12], [35, 2, 12], 'stone'))

// Mount course: a run into a 3-deep pool, a ledge over the floor, a ledge over a lava pit.
const mountCourse = area('mountCourse', [-10, 40, -12, 12],
  fill([11, -3, -12], [35, -1, 12], 'stone'), fill([12, -2, -11], [34, 0, 11], 'water'),
  fill([-6, 0, 6], [-2, 3, 10], 'stone'),
  fill([-6, 0, -10], [-2, 3, -5], 'stone'),
  fill([-2, -3, -11], [7, -1, -4], 'stone'), fill([-1, -2, -10], [6, 0, -5], 'lava'))

// Elytra: a 30-high launch tower over a 400-block runway, and a short one ending in a wall.
const sky = area('sky', [-40, 40, -8, 280], fill([-2, 1, -2], [2, 30, 2], 'stone'))
// A tower over a lava pool, for an elytra-sized box reaching lava (the legacy test turns its contracted box inside out).
const skyLava = area('skyLava', [-12, 12, -8, 48], fill([-2, 1, -2], [2, 30, 2], 'stone'), fill([-12, -3, 3], [12, 0, 48], 'lava'))
const skyWall = area('skyWall', [-12, 12, -8, 50], fill([-2, 1, -2], [2, 30, 2], 'stone'), fill([-12, 1, 40], [12, 30, 40], 'stone'))

// Rings of a partial block around a start, in a quadrant of positive and of negative coordinates (B166, B172): each ring is
// 7 across, a case walks a diagonal into its corner. `update`: the fences, walls and panes connect.
export const RINGS = ['slab', 'stairs', 'fence', 'wall', 'pane', 'gate', 'snow'] as const
const STAIR = 'cobblestone_stairs[half=bottom,facing='
const ringBlocks: Record<(typeof RINGS)[number], { x: [string, string]; z: [string, string]; corners?: [string, string, string, string]; update?: true }> = {
  slab: { x: ['stone_slab[type=bottom]', 'stone_slab[type=bottom]'], z: ['stone_slab[type=bottom]', 'stone_slab[type=bottom]'] },
  stairs: {
    x: [`${STAIR}north]`, `${STAIR}south]`], z: [`${STAIR}west]`, `${STAIR}east]`],
    corners: [`${STAIR}north,shape=inner_left]`, `${STAIR}north,shape=inner_right]`, `${STAIR}south,shape=inner_right]`, `${STAIR}south,shape=inner_left]`],
  },
  fence: { x: ['oak_fence', 'oak_fence'], z: ['oak_fence', 'oak_fence'], update: true },
  wall: { x: ['cobblestone_wall', 'cobblestone_wall'], z: ['cobblestone_wall', 'cobblestone_wall'], update: true },
  pane: { x: ['glass_pane', 'glass_pane'], z: ['glass_pane', 'glass_pane'], update: true },
  gate: {
    x: ['oak_fence_gate[facing=north,open=true]', 'oak_fence_gate[facing=south,open=true]'], z: ['oak_fence_gate[facing=west,open=true]', 'oak_fence_gate[facing=east,open=true]'],
    corners: ['oak_fence', 'oak_fence', 'oak_fence', 'oak_fence'],
  },
  snow: { x: ['snow[layers=4]', 'snow[layers=4]'], z: ['snow[layers=4]', 'snow[layers=4]'] },
}
export const ringCenter = (i: number): number => -30 + i * 10
const ringOf = (kind: (typeof RINGS)[number], cx: number): PhysrecFill[] => {
  const { x, z, corners, update } = ringBlocks[kind]
  const extra = update ? { update: true } : {}
  const r = 3
  const at = (a: number, b: number, c: number, d: number, block: string) => fill([a, 1, b], [c, 1, d], block, extra)
  const corner = corners ?? [x[0], x[0], x[1], x[1]]
  return [
    at(cx - r + 1, -r, cx + r - 1, -r, x[0]), at(cx - r + 1, r, cx + r - 1, r, x[1]),
    at(cx - r, -r + 1, cx - r, r - 1, z[0]), at(cx + r, -r + 1, cx + r, r - 1, z[1]),
    at(cx - r, -r, cx - r, -r, corner[0]), at(cx + r, -r, cx + r, -r, corner[1]),
    at(cx - r, r, cx - r, r, corner[2]), at(cx + r, r, cx + r, r, corner[3]),
  ]
}
const ringQuadrant = (name: string, origin: readonly [number, number, number]): PhysrecArea => ({
  name, extent: [-36, 36, -6, 6], origin, blocks: [floor([-36, 36, -6, 6]), ...RINGS.flatMap((kind, i) => ringOf(kind, ringCenter(i)))],
})

const nearWall = (z: number) => area(`skyWall${z}`, [-12, 12, -8, 20], fill([-2, 1, -2], [2, 30, 2], 'stone'), fill([-12, 1, z], [12, 30, z], 'stone'))

// Creative/spectator flight: open air with a wall and a ceiling.
const flight = area('flight', [-16, 40, -16, 16],
  fill([30, 1, -16], [30, 12, 16], 'stone'), fill([-16, 12, 8], [40, 12, 16], 'stone'))

// Far from the origin: float/double precision of positions, negative block rounding, and the world border.
const far = (name: string, x: number, z: number): PhysrecArea => ({ name, extent: [-12, 12, -12, 12], origin: [x, 100, z], blocks: [floor([-12, 12, -12, 12]), fill([6, 1, -12], [6, 3, 12], 'stone')] })
const farAreas = [far('far1m', 1000000, 0), far('farNeg', -1000000, -1000000), far('far29m', 29999000, 0),
  // The world border is at 29999984: the lane at local x=-2..12 runs into it at local x=+8 (origin 29999976).
  { name: 'border', extent: [-12, 7, -12, 12], origin: [29999976, 100, 0], blocks: [floor([-12, 7, -12, 12])] }]

// Falling water: a source on top of a column of falling water (level 8) beside a platform to walk in from.
const waterfall = area('waterfall', [-8, 8, -8, 8],
  fill([0, 10, 0], [0, 10, 0], 'water'), fill([0, 1, 0], [0, 9, 0], 'water[level=8]'),
  fill([-1, 11, -1], [1, 11, 1], 'stone'), fill([1, 1, -1], [1, 10, -1], 'stone'), fill([-1, 1, -1], [-1, 10, -1], 'stone'),
  fill([1, 1, 1], [1, 10, 1], 'stone'), fill([-1, 1, 1], [-1, 10, 1], 'stone'), fill([1, 1, 0], [1, 10, 0], 'stone'))

// A piston facing +x that the case powers with a redstone block behind it.
const piston = area('piston', [-8, 12, -8, 8], fill([-1, 1, 0], [-1, 1, 0], 'piston[facing=east]'))

// Support edge: player straddling ice and stone (the supporting block decides friction).
const straddle = area('straddle', [-8, 24, -8, 8], fill([-4, 0, 0], [22, 0, 8], 'ice'))

// Push-out: a column the player is teleported into, overlapping it.
const pushout = area('pushout', [-8, 8, -8, 8], fill([0, 1, 0], [0, 3, 0], 'stone'))

// Features (mineflayer coverage): one lane per station along z, the player at x=0.5 facing +x, the station at x=2.
// Lane z: -18 command block, -15 fishing water ahead, -12 villager/mob spot, -9 chest, -6 furnace, -3 crafting table,
// 0 open floor, 3 anvil, 6 enchanting table, 9 bed, 12 note block, 15 dirt, 18 stone.
export const FEATURE_LANES = { commandBlock: -18, fishing: -15, mob: -12, chest: -9, furnace: -6, crafting: -3, open: 0,
  anvil: 3, enchanting: 6, bed: 9, note: 12, dirt: 15, stone: 18 }
const L = FEATURE_LANES
const station = (z: number, block: string): PhysrecFill => fill([2, 1, z], [2, 1, z], block)
const features = area('features', [-12, 24, -20, 20],
  station(L.commandBlock, 'command_block[facing=up]'),
  fill([3, -2, L.fishing - 2], [12, 0, L.fishing + 2], 'water'),
  station(L.chest, 'chest[facing=west]'),
  station(L.furnace, 'furnace[facing=west]'),
  station(L.crafting, 'crafting_table'),
  station(L.anvil, 'anvil[facing=north]'),
  station(L.enchanting, 'enchanting_table'),
  fill([2, 1, L.bed], [2, 1, L.bed], 'white_bed[part=foot,facing=east]'),
  fill([3, 1, L.bed], [3, 1, L.bed], 'white_bed[part=head,facing=east]'),
  // before 1.12 there is one (red) bed, which the adapters' LegacyNames give for white_bed: the m_bed station there
  fill([2, 1, L.bed], [2, 1, L.bed], 'white_bed[part=foot,facing=east]', { since: undefined, until: '1.12' }),
  fill([3, 1, L.bed], [3, 1, L.bed], 'white_bed[part=head,facing=east]', { since: undefined, until: '1.12' }),
  station(L.note, 'note_block'),
  station(L.dirt, 'dirt'),
  station(L.stone, 'stone'))

// Currents across block and chunk edges (java-interactions): static flowing states, as `flow`, 1 wide between stone so
// that the only neighbours are the channel's own. Local x=0 and z=0 are chunk edges in both areas, the far one's origin
// is chunk-aligned. Levels 0-7 two blocks each: +x at z=-5, -x at z=5, +z at x=12; a basin of four levels around the
// corner where four chunks meet.
const walled = (from: Pos, to: Pos): PhysrecFill[] => {
  const [x0 = 0, , z0 = 0] = from
  const [x1 = 0, , z1 = 0] = to
  return [
    fill([x0 - 1, 1, z0 - 1], [x1 + 1, 2, z0 - 1], 'stone'), fill([x0 - 1, 1, z1 + 1], [x1 + 1, 2, z1 + 1], 'stone'),
    fill([x0 - 1, 1, z0 - 1], [x0 - 1, 2, z1 + 1], 'stone'), fill([x1 + 1, 1, z0 - 1], [x1 + 1, 2, z1 + 1], 'stone'),
  ]
}
const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7]
const currentBlocks: PhysrecFill[] = [
  floor([-16, 16, -16, 16]),
  walled([-8, 1, -5], [7, 1, -5]), LEVELS.map(i => fill([-8 + i * 2, 1, -5], [-7 + i * 2, 1, -5], `water[level=${i}]`)),
  walled([-8, 1, 5], [7, 1, 5]), LEVELS.map(i => fill([6 - i * 2, 1, 5], [7 - i * 2, 1, 5], `water[level=${i}]`)),
  walled([12, 1, -8], [12, 1, 7]), LEVELS.map(i => fill([12, 1, -8 + i * 2], [12, 1, -7 + i * 2], `water[level=${i}]`)),
  walled([-2, 1, -2], [1, 1, 1]),
  fill([-2, 1, -2], [-1, 1, -1], 'water[level=1]'), fill([0, 1, -2], [1, 1, -1], 'water[level=2]'),
  fill([-2, 1, 0], [-1, 1, 1], 'water[level=2]'), fill([0, 1, 0], [1, 1, 1], 'water[level=3]'),
].flat()
const currents: PhysrecArea = { name: 'currents', extent: [-16, 16, -16, 16], blocks: currentBlocks }
const currentsNeg: PhysrecArea = { name: 'currentsNeg', extent: [-16, 16, -16, 16], origin: [-2000000, 100, -2000000], blocks: currentBlocks }
const currentsHigh: PhysrecArea = { name: 'currentsHigh', extent: [-16, 16, -16, 16], origin: [-8000, 220, -8000], blocks: currentBlocks }

// Lava levels 0-7 down a 1-wide channel at z=0; the same under a layer of lava at z=4 (same fluid above); a falling column
// beside solid faces at (0, z=8), one with nothing beside it at (6, z=8).
const lavaLevels = (z: number): PhysrecFill[] => LEVELS.map(i => fill([-4 + i * 2, 1, z], [-3 + i * 2, 1, z], `lava[level=${i}]`))
const lavaFlow = area('lavaFlow', [-8, 16, -8, 16],
  walled([-4, 1, 0], [11, 1, 0]), lavaLevels(0),
  walled([-4, 1, 4], [11, 1, 4]), fill([-5, 3, 3], [12, 3, 5], 'stone'), lavaLevels(4), fill([-4, 2, 4], [11, 2, 4], 'lava[level=8]'),
  fill([0, 10, 8], [0, 10, 8], 'lava'), fill([0, 1, 8], [0, 9, 8], 'lava[level=8]'), fill([1, 1, 8], [1, 10, 8], 'stone'),
  fill([6, 10, 8], [6, 10, 8], 'lava'), fill([6, 1, 8], [6, 9, 8], 'lava[level=8]'))

// Waterlogged blocks in a 1-wide stone room x=8..12, so that a toggled block's water stays in it: a row to stand on, or one
// block (at x=10) to walk into from the room's floor. y: the height a case starts at.
export const WATERLOGGED = [
  { id: 'slab', state: 'stone_slab[type=bottom,waterlogged=true]', y: 0.5, row: true },
  { id: 'trapdoor_closed', state: 'oak_trapdoor[facing=north,half=bottom,open=false,waterlogged=true]', y: 0.1875, row: true },
  { id: 'trapdoor_open', state: 'oak_trapdoor[facing=north,half=bottom,open=true,waterlogged=true]', y: 0, row: true },
  { id: 'stairs', state: 'cobblestone_stairs[facing=east,half=bottom,shape=straight,waterlogged=true]', y: 0, row: false },
  { id: 'fence', state: 'oak_fence[waterlogged=true]', y: 0, row: false },
] as const
const waterlogged = area('waterlogged', [-8, 16, -24, WATERLOGGED.length * 4 - 16],
  lanes(WATERLOGGED, (v, z) => [...walled([8, 1, z], [12, 1, z]), fill([v.row ? 8 : 10, 1, z], [v.row ? 12 : 10, 1, z], v.state)]))

// One-block cells of fluid, stone on every side: nothing beside them to make a current. Depth (8 - level) / 9.
export const SHALLOW_CELLS = ['water[level=5]', 'lava[level=5]', 'water', 'lava']
const shallowCells = area('shallowCells', [-8, 12, -24, SHALLOW_CELLS.length * 4 - 16],
  lanes(SHALLOW_CELLS, (b, z) => [...walled([4, 1, z], [4, 1, z]), fill([4, 1, z], [4, 1, z], b)]))

// Climbables and fluids in the same box. `_side`: the climbable's column with lava in the next cell, so that a player against
// the wall stands in the climbable and touches the lava.
export const FLUID_CLIMBS = ['ladder_lava_side', 'vine_lava_side', 'ladder_over_lava', 'ladder_wet', 'scaffolding_wet', 'scaffolding_dry']
const fluidClimb = area('fluidClimb', [-8, 12, -24, FLUID_CLIMBS.length * 4 - 16],
  lanes(FLUID_CLIMBS, (c, z) => {
    const wall = fill([6, 1, z - 1], [6, 10, z + 1], 'stone')
    switch (c) {
      case 'ladder_lava_side': return [wall, fill([5, 1, z], [5, 6, z], 'ladder[facing=west]'), fill([5, 1, z + 1], [5, 2, z + 1], 'lava')]
      case 'vine_lava_side': return [wall, fill([5, 1, z], [5, 6, z], 'vine[east=true]'), fill([5, 1, z + 1], [5, 2, z + 1], 'lava')]
      case 'ladder_over_lava': return [wall, fill([3, 1, z - 1], [5, 1, z + 1], 'lava'), fill([5, 2, z], [5, 8, z], 'ladder[facing=west]')]
      case 'ladder_wet': return [wall, fill([3, 1, z - 1], [4, 2, z + 1], 'water'), fill([5, 1, z], [5, 8, z], 'ladder[facing=west,waterlogged=true]')]
      case 'scaffolding_wet': return [fill([5, 1, z], [5, 8, z], 'scaffolding[distance=0,waterlogged=true]')]
      default: return [fill([5, 1, z], [5, 8, z], 'scaffolding[distance=0]')]
    }
  }))

// A pool with a wall of cobweb across it: a web holds no water, so a box overlaps the web and the water beside it.
const webPool = area('webPool', [-14, 14, -10, 10],
  fill([-6, -3, -6], [10, 0, 6], 'water'), fill([2, -3, -6], [2, 0, 6], 'cobweb'))

// FlowingFluid.getFlow looks past a neighbour with no fluid of its own to the fluid below it, unless the block stops it. The
// source at (2, 2) stands on a shelf with the blocker at (3, 2) and a pool under the blocker: pushed +x only if the block does
// not stop the flow, whatever its collision shape.
export const FLOW_BLOCKERS = ['air', 'oak_sign', 'white_carpet', 'snow[layers=1]', 'stone_slab[type=bottom]', 'stone_slab[type=top]',
  'cobblestone_stairs[facing=east]', 'oak_fence', 'oak_trapdoor[facing=north,half=bottom,open=false]',
  'oak_trapdoor[facing=north,half=bottom,open=true]', 'oak_trapdoor[facing=north,half=bottom,open=false,waterlogged=true]', 'stone']
const flowBlockers = area('flowBlockers', [-8, 16, -24, FLOW_BLOCKERS.length * 4 - 16],
  lanes(FLOW_BLOCKERS, (b, z) => [
    fill([0, 1, z - 1], [9, 2, z + 1], 'stone'), fill([1, 2, z], [2, 2, z], 'water'), fill([3, 1, z], [8, 2, z], 'air'),
    fill([3, 1, z], [8, 1, z], 'water'), fill([3, 2, z], [3, 2, z], b),
  ]))

// Falling water (level 8) beside a column of one block: FlowingFluid.isSolidFace turns the flow down for a sturdy face.
// `stone_single`: one block, at y=6, so the face is only there for part of the way down.
export const FALLING_FACES = ['stone', 'stone_single', 'stone_slab[type=bottom]', 'stone_slab[type=top]', 'cobblestone_stairs[facing=east]',
  'cobblestone_stairs[facing=west]', 'cobblestone_stairs[facing=north]', 'oak_fence', 'oak_trapdoor[facing=north,half=bottom,open=false]', 'ice',
  'packed_ice', 'glass', 'oak_leaves[persistent=true]', 'stone_slab[type=bottom,waterlogged=true]', 'cobblestone_stairs[facing=west,waterlogged=true]', 'air']
const fallingFaces = area('fallingFaces', [-8, 12, -24, FALLING_FACES.length * 4 - 16],
  lanes(FALLING_FACES, (b, z) => [
    fill([5, 1, z], [5, 12, z], 'water[level=8]'),
    b === 'stone_single' ? fill([6, 6, z], [6, 6, z], 'stone') : fill([6, 1, z], [6, 12, z], b),
  ]))

// Pistons, one setup a lane, facing +x from x=-1 (powered from x=-2) unless the lane says otherwise.
export const PISTON_LANES = ['plain', 'sticky', 'vertical', 'vertical_sticky', 'limit12', 'limit13', 'obsidian', 'twin', 'opposed',
  'web_ahead', 'web_cell', 'step_slab', 'step_rise']
const pistonCourse = area('pistonCourse', [-8, 24, -24, PISTON_LANES.length * 4 - 16],
  lanes(PISTON_LANES, (p, z) => {
    const east = fill([-1, 1, z], [-1, 1, z], 'piston[facing=east]')
    switch (p) {
      case 'sticky': return [fill([-1, 1, z], [-1, 1, z], 'sticky_piston[facing=east]'), fill([0, 1, z], [0, 1, z], 'stone')]
      // in the floor, powered from under it (y=-1)
      case 'vertical': return [fill([2, 0, z], [2, 0, z], 'piston[facing=up]')]
      case 'vertical_sticky': return [fill([2, 0, z], [2, 0, z], 'sticky_piston[facing=up]'), fill([2, 1, z], [2, 1, z], 'stone')]
      // 12 blocks is what a piston pushes
      case 'limit12': return [east, fill([0, 1, z], [11, 1, z], 'stone')]
      case 'limit13': return [east, fill([0, 1, z], [12, 1, z], 'stone')]
      case 'obsidian': return [east, fill([0, 1, z], [0, 1, z], 'obsidian')]
      // one along x, one along z, both heads in cells the player's box is in; (1, z-2), the second's power, is the lane's glass
      case 'twin': return [east, fill([1, 1, z - 1], [1, 1, z - 1], 'piston[facing=south]')]
      // head to head: x=0 and x=1
      case 'opposed': return [east, fill([2, 1, z], [2, 1, z], 'piston[facing=west]')]
      case 'web_ahead': return [east, fill([1, 1, z], [3, 1, z], 'cobweb')]
      case 'web_cell': return [east, fill([0, 1, z], [0, 1, z], 'cobweb')]
      case 'step_slab': return [east, fill([0, 1, z], [0, 1, z], 'stone_slab[type=bottom]')]
      // rising in the path of a walk along +x
      case 'step_rise': return [fill([3, 0, z], [3, 0, z], 'piston[facing=up]'), fill([3, 1, z], [3, 1, z], 'stone_slab[type=bottom]')]
      default: return [east]
    }
  }))

// Blocks that hurt on contact.
export const HAZARDS = ['cactus', 'campfire', 'campfire_unlit', 'soul_campfire', 'campfire_wet']
const hazards = area('hazards', [-8, 16, -24, HAZARDS.length * 4 - 16],
  lanes(HAZARDS, (h, z) => {
    const row = (state: string) => [fill([4, 1, z - 1], [8, 1, z + 1], state)]
    switch (h) {
      case 'cactus': return [fill([3, 0, z - 1], [8, 0, z + 1], 'sand'), fill([5, 1, z], [5, 1, z], 'cactus')]
      case 'campfire': return row('campfire[lit=true]')
      case 'campfire_unlit': return row('campfire[lit=false]')
      case 'soul_campfire': return row('soul_campfire[lit=true]')
      default: return row('campfire[lit=false,waterlogged=true]')
    }
  }))

// Entity colliders above a step (26.3 asks for them over the step height too). The shulker cases summon one at y=2, under the
// stone it clings to: 0.2 over a standing head, in the way of one that steps up the slab.
const entitySteps = area('entitySteps', [-8, 16, -12, 12],
  fill([3, 1, -1], [8, 1, 1], 'stone_slab[type=bottom]'), fill([3, 4, 0], [3, 4, 0], 'stone'), fill([3, 4, 6], [3, 4, 6], 'stone'))

// The world border's absolute limit on the negative side, as `border`: local x=-8 is -29999984.
const borderNeg: PhysrecArea = { name: 'borderNeg', extent: [-7, 12, -12, 12], origin: [-29999976, 100, 0], blocks: [floor([-7, 12, -12, 12])] }

// A tower as skyLava's, over what a glide ends on. From the top a pitch of 45 lands near z=37, a pitch of 60 near z=14; the
// climbable walls are at z=20, stone behind them.
const glide = (name: string, ...blocks: (PhysrecFill | readonly PhysrecFill[])[]): PhysrecArea => area(name, [-12, 12, -8, 48], fill([-2, 1, -2], [2, 30, 2], 'stone'), ...blocks)
const climbWall = (block: string): PhysrecFill[] => [fill([-12, 1, 20], [12, 30, 20], block), fill([-12, 1, 21], [12, 30, 21], 'stone')]
const skyWater = glide('skyWater', fill([-12, -3, 3], [12, 0, 48], 'water'))
const skyShallow = glide('skyShallow', fill([-12, 1, 3], [12, 1, 48], 'water'))
const skySlime = glide('skySlime', fill([-12, 0, 3], [12, 0, 48], 'slime_block'))
const skyLadder = glide('skyLadder', climbWall('ladder[facing=north]'))
const skyVine = glide('skyVine', climbWall('vine[south=true]'))
const skyScaffolding = glide('skyScaffolding', climbWall('scaffolding[distance=0]'))

// A boat gets ashore over what is lower than its keel: afloat its bottom is at local y -0.48, a carpet's top 0.44 under that
// (the carpet stands in the water's own layer), where a full block's top at y 0 is a wall (boats, cov_pool).
const boatShore = area('boatShore', [-10, 34, -8, 8], [
  fill([-10, -3, -8], [14, 0, 8], 'water'),
  fill([15, 0, -8], [34, 0, 8], 'white_carpet'),
])

// Horses in water, from dry ground at x<10: 6 deep at z -8..8, 1 deep at z 12..14, a shore to walk out on at x=30.
const horsePool = area('horsePool', [-10, 40, -10, 16], [
  fill([10, -5, -8], [29, 0, 8], 'water'),
  fill([10, 0, 12], [29, 0, 14], 'water'),
])

// Getting off where the side the vehicle sets its rider down on is taken. Lanes run along x, a vehicle at x=4.5 in the middle
// of its lane. corridor: 2 wide, every side blocked; pocket: 2 by 2 and 3 high around x=5; low: a 1 high gap under the side walls.
export const DISMOUNT_LANES = ['corridor', 'pocket', 'low']
const dismounts = area('dismounts', [-8, 16, -24, DISMOUNT_LANES.length * 4 - 16], DISMOUNT_LANES.flatMap((lane, i) => {
  const z = laneZ(i)
  const walls = [fill([0, 1, z - 1], [9, 3, z - 1], 'stone'), fill([0, 1, z + 2], [9, 3, z + 2], 'stone')]
  switch (lane) {
    case 'corridor': return walls
    case 'pocket': return [...walls, fill([3, 1, z], [3, 3, z + 1], 'stone'), fill([6, 1, z], [6, 3, z + 1], 'stone'), fill([3, 4, z - 1], [6, 4, z + 2], 'stone')]
    default: return [fill([0, 2, z - 1], [9, 2, z - 1], 'stone'), fill([0, 2, z + 2], [9, 2, z + 2], 'stone')]
  }
}))

// Portals. A nether portal 2 wide and 3 high in the plane x=6, walked through along z=0; an end portal strip in the floor at
// x=20, its shape under the floor's top; end portal frames at x=8, without their eye at z 8..10, with it at z 12..14.
const portals = area('portals', [-8, 30, -12, 16], [
  fill([6, 0, -2], [6, 4, 1], 'obsidian'),
  fill([6, 1, -1], [6, 3, 0], 'nether_portal[axis=z]'),
  fill([20, 0, -8], [20, 0, -4], 'end_portal'),
  fill([8, 1, 8], [8, 1, 10], 'end_portal_frame[facing=east,eye=false]'),
  fill([8, 1, 12], [8, 1, 14], 'end_portal_frame[facing=east,eye=true]'),
])

// A honey pillar with the fall past it open on every side (B156): the stone over honeyWall stops a fall from high up.
const honeyPost = area('honeyPost', [-6, 12, -6, 6], fill([4, 1, 0], [4, 8, 0], 'honey_block'))

// What a jump under a ceiling 1.8125 over the floor meets (B157): the head stops a move still within 0.2 of the floor block.
export const LOW_CEILINGS = ['slime_block', 'honey_block', 'stone']
const lowCeilings = area('lowCeilings', [-8, 12, -24, LOW_CEILINGS.length * 4 - 16],
  lanes(LOW_CEILINGS, (b, z) => [fill([2, 0, z - 1], [7, 0, z + 1], b), fill([2, 2, z - 1], [7, 2, z + 1], 'oak_trapdoor[half=top,open=false]')]))

// Bubble columns in a shaft under something (B144): nothing above the column, a block with no shape, a shape, a fluid. Rising
// lanes at even indices, dragging at odd. Off the lanes, one block of column in the air, for a fall that crosses it in a tick.
export const BUBBLE_TOPS = ['air', 'oak_sign', 'torch', 'white_carpet', 'stone', 'oak_fence', 'cobweb', 'water']
export const BUBBLE_LANES = BUBBLE_TOPS.flatMap(top => [top, top])
const bubbleTops = area('bubbleTops', [-8, 12, -24, BUBBLE_LANES.length * 4 - 16],
  lanes(BUBBLE_LANES, (top, z) => {
    const drag = BUBBLE_LANES.indexOf(top) * 4 - 20 !== z
    return [
      fill([4, 1, z - 1], [6, 6, z + 1], 'stone'), fill([5, 1, z], [5, 1, z], drag ? 'magma_block' : 'soul_sand'),
      fill([5, 2, z], [5, 5, z], `bubble_column[drag=${drag}]`), fill([5, 6, z], [5, 6, z], top),
    ]
  }),
  fill([-2, 8, 0], [-2, 8, 0], 'bubble_column[drag=false]'), fill([-2, 8, 2], [-2, 8, 2], 'bubble_column[drag=true]'))

// Getting out of a pool over a ledge (B143), water and lava: the 0.3 hop needs the box 0.6 up and the move's way free of shapes
// and fluid, so what stands on the bank decides it. `ceiling`: stone over the way out.
export const LEDGES = ['stone', 'stone_slab[type=bottom]', 'stone_slab[type=top]', 'oak_fence', 'cobblestone_wall', 'white_carpet', 'snow[layers=4]', 'tall', 'ceiling']
export const LEDGE_LANES = ['water', 'lava'].flatMap(fluid => LEDGES.map(ledge => ({ fluid, ledge })))
const ledgePools = area('ledgePools', [-8, 12, -24, LEDGE_LANES.length * 4 - 16],
  lanes(LEDGE_LANES, ({ fluid, ledge }, z) => {
    const wall = (block: string, top = 1): PhysrecFill => fill([5, 1, z - 1], [5, top, z + 1], block, /fence|wall/.test(block) ? { update: true } : {})
    const pool = fill([1, 0, z - 1], [4, 0, z + 1], fluid)
    if (ledge === 'tall') return [pool, wall('stone', 2)]
    if (ledge === 'ceiling') return [pool, wall('stone'), fill([3, 3, z - 1], [7, 3, z + 1], 'stone')]
    if (ledge === 'white_carpet' || ledge.startsWith('snow')) return [pool, wall('stone'), fill([5, 2, z - 1], [5, 2, z + 1], ledge)]
    return [pool, wall(ledge)]
  }))

// Water beside lava, and on it (B138): each fluid's height and current in one box. Stone around and under them.
const mixedFluids = area('mixedFluids', [-8, 16, -12, 12],
  fill([-1, -3, -3], [10, 2, 3], 'stone'),
  fill([0, 1, -2], [4, 1, -1], 'water'), fill([5, 1, -2], [9, 1, -1], 'lava'),
  fill([0, 0, 1], [4, 1, 2], 'water'), fill([5, 0, 1], [9, 1, 2], 'lava'))

// Blocks a piston moves that do something to what they meet (B163). Facing +x from x=-1 unless the lane says otherwise, powered
// from behind it (`up`: from under it, in the floor; `south`, `north`: from the lanes' glass; `west`: from x=5; `down`: from over it).
// Obsidian under a block that goes sideways: slime and honey take the blocks they touch along, and the floor would be too many.
export const PISTON_SURFACES = ['slime_east', 'honey_east', 'slime_up', 'honey_up', 'slime_south', 'slime_north', 'slime_west', 'slime_down',
  'slime_sticky', 'honey_sticky', 'honey_row', 'honey_web']
const pistonSurfaces = area('pistonSurfaces', [-8, 24, -24, PISTON_SURFACES.length * 4 - 16],
  lanes(PISTON_SURFACES, (p, z) => {
    const under = (from: Pos, to: Pos): PhysrecFill => fill(from, to, 'obsidian')
    const east = (block: string, piston = 'piston'): PhysrecFill[] => [
      under([0, 0, z], [1, 0, z]), fill([-1, 1, z], [-1, 1, z], `${piston}[facing=east]`), fill([0, 1, z], [0, 1, z], block),
    ]
    switch (p) {
      case 'slime_east': return east('slime_block')
      case 'honey_east': return east('honey_block')
      case 'slime_up': return [fill([2, 0, z], [2, 0, z], 'piston[facing=up]'), fill([2, 1, z], [2, 1, z], 'slime_block')]
      case 'honey_up': return [fill([2, 0, z], [2, 0, z], 'piston[facing=up]'), fill([2, 1, z], [2, 1, z], 'honey_block')]
      case 'slime_south': return [under([2, 0, z], [2, 0, z + 1]), fill([2, 1, z - 1], [2, 1, z - 1], 'piston[facing=south]'), fill([2, 1, z], [2, 1, z], 'slime_block')]
      case 'slime_north': return [under([2, 0, z - 1], [2, 0, z]), fill([2, 1, z + 1], [2, 1, z + 1], 'piston[facing=north]'), fill([2, 1, z], [2, 1, z], 'slime_block')]
      case 'slime_west': return [under([2, 0, z], [3, 0, z]), fill([4, 1, z], [4, 1, z], 'piston[facing=west]'), fill([3, 1, z], [3, 1, z], 'slime_block')]
      case 'slime_down': return [fill([2, 1, z], [2, 1, z], 'stone'), fill([2, 5, z], [2, 5, z], 'piston[facing=down]'), fill([2, 4, z], [2, 4, z], 'slime_block')]
      case 'slime_sticky': return east('slime_block', 'sticky_piston')
      case 'honey_sticky': return east('honey_block', 'sticky_piston')
      case 'honey_row': return [under([0, 0, z], [2, 0, z]), fill([-1, 1, z], [-1, 1, z], 'piston[facing=east]'), fill([0, 1, z], [1, 1, z], 'honey_block')]
      default: return [...east('honey_block'), fill([0, 2, z], [0, 2, z], 'cobweb')]
    }
  }))

// Floors that hurt, and the bushes (B160).
export const HOT_FLOORS = ['magma_block', 'sweet_berry_bush[age=2]', 'sweet_berry_bush[age=0]', 'campfire[lit=true]']
const hotFloors = area('hotFloors', [-8, 16, -24, HOT_FLOORS.length * 4 - 16],
  lanes(HOT_FLOORS, (b, z) => [fill([4, b === 'magma_block' ? 0 : 1, z - 1], [8, b === 'magma_block' ? 0 : 1, z + 1], b)]))

// Projectiles fly along +x over a floor, to a wall at x=12 and z -1..2 three blocks high (java-projectiles).
const projectileRange = area('projectileRange', [-10, 18, -6, 6], fill([12, 1, -1], [12, 3, 2], 'stone'))
// A hole through the floor over the void; the air far down stretches the area, whose box is the server view, past the
// line at which an entity falls out of the world (y=-128 from 1.18; the area stands at y=100).
const voidShaft = area('voidShaft', [-6, 6, -6, 6], fill([2, -11, 2], [4, 0, 4], 'air'), fill([3, -245, 3], [3, -245, 3], 'air'))

// The minecart cases' tracks, all in one area so that a case's cart runs where nothing else is: z 0 a plain run to a stone,
// z 3 powered then unpowered rail to an end in the air, z 6 a powered rail at a block, z 9 the four corners, z 12 bare
// floor, z 18 up and over a hill with a north-south slope beyond, z -3 an activator rail, z -6 a valley, z -12 rail on soul
// sand, z -15 a web on the track, z 30 a rail that ends at a ledge.
const minecarts = area('minecarts', [-8, 44, -18, 36],
  fill([0, 1, 0], [39, 1, 0], 'rail[shape=east_west]'), fill([40, 1, 0], [40, 1, 0], 'stone'),
  fill([0, 1, 3], [9, 1, 3], 'rail[shape=east_west]'), fill([10, 1, 3], [13, 1, 3], 'powered_rail[shape=east_west,powered=true]'),
  fill([14, 1, 3], [17, 1, 3], 'powered_rail[shape=east_west,powered=false]'), fill([18, 1, 3], [29, 1, 3], 'rail[shape=east_west]'),
  fill([1, 1, 6], [1, 1, 6], 'stone'), fill([2, 1, 6], [2, 1, 6], 'powered_rail[shape=east_west,powered=true]'), fill([3, 1, 6], [20, 1, 6], 'rail[shape=east_west]'),
  fill([0, 1, 9], [9, 1, 9], 'rail[shape=east_west]'), fill([10, 1, 9], [10, 1, 9], 'rail[shape=south_west]'), fill([10, 1, 10], [10, 1, 14], 'rail[shape=north_south]'),
  fill([10, 1, 15], [10, 1, 15], 'rail[shape=north_east]'), fill([11, 1, 15], [20, 1, 15], 'rail[shape=east_west]'), fill([21, 1, 15], [21, 1, 15], 'rail[shape=north_west]'),
  fill([21, 1, 10], [21, 1, 14], 'rail[shape=north_south]'), fill([21, 1, 9], [21, 1, 9], 'rail[shape=south_east]'), fill([22, 1, 9], [30, 1, 9], 'rail[shape=east_west]'),
  fill([0, 1, 18], [5, 1, 18], 'rail[shape=east_west]'), fill([6, 1, 18], [6, 1, 18], 'rail[shape=ascending_east]'),
  fill([7, 1, 18], [7, 1, 18], 'stone'), fill([7, 2, 18], [7, 2, 18], 'rail[shape=ascending_east]'),
  fill([8, 1, 18], [11, 2, 18], 'stone'), fill([8, 3, 18], [11, 3, 18], 'rail[shape=east_west]'),
  fill([12, 1, 18], [12, 1, 18], 'stone'), fill([12, 2, 18], [12, 2, 18], 'rail[shape=ascending_west]'), fill([13, 1, 18], [13, 1, 18], 'rail[shape=ascending_west]'), fill([14, 1, 18], [20, 1, 18], 'rail[shape=east_west]'),
  fill([35, 1, 18], [35, 1, 24], 'rail[shape=north_south]'), fill([35, 1, 25], [35, 1, 25], 'rail[shape=ascending_south]'), fill([35, 1, 26], [35, 1, 26], 'stone'),
  fill([35, 2, 26], [35, 2, 26], 'rail[shape=ascending_south]'), fill([35, 1, 27], [35, 2, 31], 'stone'), fill([35, 3, 27], [35, 3, 31], 'rail[shape=north_south]'),
  fill([0, 1, -3], [5, 1, -3], 'rail[shape=east_west]'), fill([6, 1, -3], [6, 1, -3], 'activator_rail[shape=east_west,powered=true]'), fill([7, 1, -3], [7, 1, -3], 'detector_rail[shape=east_west]'), fill([8, 1, -3], [20, 1, -3], 'rail[shape=east_west]'),
  fill([3, 1, -6], [4, 1, -6], 'stone'), fill([3, 2, -6], [4, 2, -6], 'rail[shape=east_west]'), fill([5, 1, -6], [5, 1, -6], 'stone'), fill([5, 2, -6], [5, 2, -6], 'rail[shape=ascending_west]'),
  fill([6, 1, -6], [6, 1, -6], 'rail[shape=ascending_west]'), fill([7, 1, -6], [7, 1, -6], 'rail[shape=ascending_east]'), fill([8, 1, -6], [8, 1, -6], 'stone'), fill([8, 2, -6], [8, 2, -6], 'rail[shape=ascending_east]'),
  fill([9, 1, -6], [10, 2, -6], 'stone'), fill([9, 3, -6], [10, 3, -6], 'rail[shape=east_west]'),
  fill([0, 0, -12], [20, 0, -12], 'soul_sand'), fill([0, 1, -12], [20, 1, -12], 'rail[shape=east_west]'),
  fill([0, 1, -15], [20, 1, -15], 'rail[shape=east_west]'), fill([9, 2, -15], [9, 2, -15], 'cobweb'),
  fill([0, 1, 30], [8, 2, 34], 'stone'), fill([0, 3, 30], [8, 3, 30], 'rail[shape=east_west]'))

// The minecart cases in water: a waterlogged run, a slope in it, and a pool with nothing laid in it.
const minecartsWet = area('minecartsWet', [-8, 40, -6, 24],
  fill([-2, 1, -2], [32, 3, 2], 'stone'), fill([-1, 1, -1], [31, 3, 1], 'water'),
  fill([0, 1, 0], [30, 1, 0], 'rail[shape=east_west,waterlogged=true]'),
  fill([-2, 1, 6], [32, 4, 10], 'stone'), fill([-1, 1, 7], [31, 4, 9], 'water'),
  fill([0, 1, 8], [10, 1, 8], 'rail[shape=east_west,waterlogged=true]'), fill([11, 1, 8], [11, 1, 8], 'rail[shape=ascending_east,waterlogged=true]'),
  fill([12, 1, 8], [12, 1, 8], 'stone'), fill([12, 2, 8], [12, 2, 8], 'rail[shape=ascending_east,waterlogged=true]'),
  fill([13, 1, 8], [20, 2, 8], 'stone'), fill([13, 3, 8], [20, 3, 8], 'rail[shape=east_west,waterlogged=true]'),
  fill([-2, 1, 14], [32, 4, 22], 'stone'), fill([-1, 1, 15], [31, 4, 21], 'water'))
// What a TNT, falling block, item or orb lands on and meets: lanes of blocks every release has, at the z of MOVERS, a fence and a
// cobweb column on the stone at z=7. Stone elsewhere.
export const MOVERS = { ice: -20, slime: -15, soulSand: -10, packedIce: -5, fence: 2, web: 6 }
const moverLane = (z: number, block: string): PhysrecFill => fill([-4, 0, z - 1], [22, 0, z + 2], block)
const movers = area('movers', [-24, 24, -24, 24],
  moverLane(MOVERS.ice, 'ice'), moverLane(MOVERS.slime, 'slime_block'), moverLane(MOVERS.soulSand, 'soul_sand'), moverLane(MOVERS.packedIce, 'packed_ice'),
  fill([MOVERS.fence, 1, 7], [MOVERS.fence, 1, 7], 'oak_fence'), fill([MOVERS.web, 1, 7], [MOVERS.web, 3, 7], 'cobweb'))


// Ice along a sprint, and ice under what a player can stand on: the friction block is not the one the feet touch (B155).
export const ICE_LANES = ['ice_to_stone', 'packed_to_blue', 'blue_to_ice', 'carpet_on_ice', 'snow_layer_on_ice', 'slab_on_ice', 'trapdoor_on_ice', 'blue_under_stairs']
const iceLanes = area('iceLanes', [-14, 24, -24, ICE_LANES.length * 4 - 16], lanes(ICE_LANES, (l, z) => {
  const stretch = (from: number, to: number, block: string, y = 0, since?: string) => fill([from, y, z - 1], [to, y, z + 1], block, since ? { since } : {})
  const floor = stretch(-14, -7, 'stone')
  switch (l) {
    case 'ice_to_stone': return [floor, stretch(-6, 2, 'ice'), stretch(3, 20, 'stone')]
    case 'packed_to_blue': return [floor, stretch(-6, 2, 'packed_ice'), stretch(3, 20, 'blue_ice', 0, '1.13')]
    case 'blue_to_ice': return [floor, stretch(-6, 2, 'blue_ice', 0, '1.13'), stretch(3, 20, 'ice')]
    case 'carpet_on_ice': return [floor, stretch(-6, 20, 'ice'), stretch(-6, 20, 'white_carpet', 1)]
    case 'snow_layer_on_ice': return [floor, stretch(-6, 20, 'ice'), stretch(-6, 20, 'snow[layers=2]', 1)]
    case 'slab_on_ice': return [floor, stretch(-6, 20, 'ice'), stretch(-6, 20, 'stone_slab[type=bottom]', 1)]
    case 'trapdoor_on_ice': return [floor, stretch(-6, 20, 'ice'), stretch(-6, 20, 'oak_trapdoor[half=bottom]', 1)]
    default: return [floor, stretch(-6, 20, 'blue_ice', 0, '1.13'), stretch(-6, 20, 'oak_stairs[half=bottom,facing=west]', 1)]
  }
}))

// Water as lavaFlow's lava (B137): levels 1-7 down a channel at z=0, the same under water at z=4, a falling column beside
// solid faces at (0, z=8) and one with nothing beside it at (6, z=8). Near the build limit too, where the heights are large.
const waterLevels = (z: number): PhysrecFill[] => LEVELS.map(i => fill([-4 + i * 2, 1, z], [-3 + i * 2, 1, z], `water[level=${i}]`))
const waterStackBlocks: PhysrecFill[] = [
  floor([-8, 16, -8, 16]),
  walled([-4, 1, 0], [11, 1, 0]), waterLevels(0),
  walled([-4, 1, 4], [11, 1, 4]), fill([-5, 3, 3], [12, 3, 5], 'stone'), waterLevels(4), fill([-4, 2, 4], [11, 2, 4], 'water[level=8]'),
  fill([0, 10, 8], [0, 10, 8], 'water'), fill([0, 1, 8], [0, 9, 8], 'water[level=8]'), fill([1, 1, 8], [1, 10, 8], 'stone'),
  fill([6, 10, 8], [6, 10, 8], 'water'), fill([6, 1, 8], [6, 9, 8], 'water[level=8]'),
].flat()
const waterStack: PhysrecArea = { name: 'waterStack', extent: [-8, 16, -8, 16], blocks: waterStackBlocks }
const waterStackHigh: PhysrecArea = { name: 'waterStackHigh', extent: [-8, 16, -8, 16], origin: [8000, 220, 8000], blocks: waterStackBlocks }

// What holds water by itself or by its state, in a room of source water 3 high (B139): one lane each, a row of the block
// down the middle of it from x=2 to x=8, kelp and the tall ones stacked.
export const WATER_HOLDERS = ['kelp_plant', 'seagrass', 'tall_seagrass', 'tube_coral_fan[waterlogged=true]', 'sea_pickle[pickles=1,waterlogged=true]',
  'chain[waterlogged=true]', 'lantern[waterlogged=true]', 'oak_fence[waterlogged=true]', 'cobblestone_stairs[facing=west,waterlogged=true]',
  'iron_bars[waterlogged=true]', 'cobblestone_wall[waterlogged=true]', 'rail[shape=east_west,waterlogged=true]']
const waterHolders = area('waterHolders', [-8, 24, -24, WATER_HOLDERS.length * 4 - 16], lanes(WATER_HOLDERS, (b, z) => {
  const bare = b.replace(/\[.*/, '')
  const room = [fill([-4, 1, z - 1], [14, 3, z + 1], 'stone'), fill([-3, 1, z], [13, 3, z], 'water'), fill([-4, 4, z - 1], [14, 4, z + 1], 'glass')]
  if (bare === 'tall_seagrass') {
    return [...room, fill([2, 1, z], [8, 1, z], 'tall_seagrass[half=lower]'), fill([2, 2, z], [8, 2, z], 'tall_seagrass[half=upper]')]
  }
  if (bare === 'kelp_plant') return [...room, fill([2, 1, z], [8, 2, z], 'kelp_plant'), fill([2, 3, z], [8, 3, z], 'kelp')]
  return [...room, fill([2, 1, z], [8, 1, z], b)]
}))

// Climbables where a current meets them (B145): the wall at x=6, climbables at x=5, a current toward them over x=2..4.
export const CLIMB_CURRENTS = ['ladder_wet', 'vine_side', 'twisting_side', 'weeping_side', 'trapdoor_over_ladder', 'vine_lava_flow']
const climbCurrents = area('climbCurrents', [-8, 24, -24, CLIMB_CURRENTS.length * 4 - 16], lanes(CLIMB_CURRENTS, (c, z) => {
  const wall = fill([6, 1, z - 1], [6, 8, z + 1], 'stone')
  const fluid = c === 'vine_lava_flow' ? 'lava' : 'water'
  const current = [fill([1, 1, z - 1], [5, 3, z - 1], 'stone'), fill([1, 1, z + 1], [5, 3, z + 1], 'stone'), fill([1, 1, z], [1, 3, z], 'stone'),
    fill([2, 1, z], [2, 1, z], `${fluid}[level=1]`), fill([3, 1, z], [3, 1, z], `${fluid}[level=2]`), fill([4, 1, z], [4, 1, z], `${fluid}[level=3]`)]
  switch (c) {
    case 'ladder_wet': return [wall, ...current, fill([5, 1, z], [5, 1, z], 'ladder[facing=west,waterlogged=true]'), fill([5, 2, z], [5, 7, z], 'ladder[facing=west]')]
    case 'trapdoor_over_ladder': return [wall, ...current, fill([5, 1, z], [5, 1, z], 'ladder[facing=west,waterlogged=true]'), fill([5, 2, z], [5, 2, z], 'oak_trapdoor[facing=west,half=bottom,open=true]')]
    case 'twisting_side': return [wall, ...current, fill([5, 1, z], [5, 6, z], 'twisting_vines_plant', { since: '1.16' }), fill([5, 7, z], [5, 7, z], 'twisting_vines', { since: '1.16' })]
    case 'weeping_side': return [wall, ...current, fill([5, 8, z], [5, 8, z], 'stone'), fill([5, 2, z], [5, 7, z], 'weeping_vines_plant', { since: '1.16' }), fill([5, 1, z], [5, 1, z], 'weeping_vines', { since: '1.16' })]
    default: return [wall, ...current, fill([5, 1, z], [5, 7, z], 'vine[east=true]')]
  }
}))

// A fence, a wall and a gate at x=4 each reaching west into the cell of the case's x=3.85, an upward dripstone tip on
// top that a player at that x stands clear of: Entity.getOnPos stops at the supporting block from 1.20, so the tip is
// not what it lands on (26.3 Entity.java:1115).
export const FENCE_TOPS = ['oak_fence[west=true]', 'cobblestone_wall[west=low]', 'oak_fence_gate[facing=north]']
const fenceTops = area('fenceTops', [-8, 12, -24, FENCE_TOPS.length * 4 - 16],
  lanes(FENCE_TOPS, (b, z) => [fill([4, 1, z], [4, 1, z], b), fill([4, 2, z], [4, 2, z], 'pointed_dripstone')]))

// What a cart's side effects need, each on a run of its own. z 0 a powered activator rail at x 10 and on to a stone, z 3 an
// unpowered one, z 6 netherrack with fire, z 9 a run into a lava pool, z 13 a cactus on the floor, z 16 honey and z 19 slime
// under a rail then bare, z 22 a honey wall, z 26 and z 30 bubble columns up and down, z 34 soul fire.
const minecartHazards = area('minecartHazards', [-8, 44, -4, 38],
  fill([0, 1, 0], [9, 1, 0], 'rail[shape=east_west]'), fill([10, 1, 0], [10, 1, 0], 'activator_rail[shape=east_west,powered=true]'),
  fill([11, 1, 0], [39, 1, 0], 'rail[shape=east_west]'), fill([40, 1, 0], [40, 1, 0], 'stone'),
  fill([0, 1, 3], [9, 1, 3], 'rail[shape=east_west]'), fill([10, 1, 3], [10, 1, 3], 'activator_rail[shape=east_west,powered=false]'),
  fill([11, 1, 3], [39, 1, 3], 'rail[shape=east_west]'),
  fill([0, 0, 6], [20, 0, 6], 'netherrack'), fill([14, 1, 6], [16, 1, 6], 'fire'),
  fill([-2, 0, 8], [30, 0, 10], 'stone'), fill([0, 1, 9], [9, 1, 9], 'rail[shape=east_west]'), fill([10, 0, 8], [28, 0, 10], 'lava'), fill([10, 1, 8], [28, 1, 10], 'lava'),
  fill([10, 1, 13], [10, 1, 13], 'cactus'), fill([20, 1, 12], [20, 1, 15], 'stone'),
  fill([0, 0, 16], [10, 0, 16], 'honey_block'), fill([0, 1, 16], [10, 1, 16], 'rail[shape=east_west]'), fill([11, 0, 16], [30, 0, 16], 'honey_block'),
  fill([0, 0, 19], [10, 0, 19], 'slime_block'), fill([0, 1, 19], [10, 1, 19], 'rail[shape=east_west]'), fill([11, 0, 19], [30, 0, 19], 'slime_block'),
  fill([10, 1, 22], [10, 10, 22], 'honey_block'),
  fill([8, 1, 25], [12, 6, 27], 'stone'), fill([9, 1, 26], [9, 1, 26], 'soul_sand'), fill([9, 2, 26], [9, 5, 26], 'bubble_column[drag=false]'), fill([9, 6, 26], [9, 6, 26], 'air'),
  fill([11, 1, 26], [11, 1, 26], 'magma_block'), fill([11, 2, 26], [11, 5, 26], 'bubble_column[drag=true]'), fill([11, 6, 26], [11, 6, 26], 'air'),
  fill([0, 0, 34], [20, 0, 34], 'soul_soil', { since: '1.16' }))

// One row of a partial block across its lane at x=3, walked into from x=0 (B161): the states the rings and the steps leave out.
// A door or a tall block has its upper half at y=2.
export const PARTIALS: readonly (readonly [string, string?])[] = [
  ['oak_door[facing=east,half=lower,hinge=left,open=false]', 'oak_door[facing=east,half=upper,hinge=left,open=false]'],
  ['oak_door[facing=west,half=lower,hinge=left,open=false]', 'oak_door[facing=west,half=upper,hinge=left,open=false]'],
  ['oak_door[facing=north,half=lower,hinge=left,open=true]', 'oak_door[facing=north,half=upper,hinge=left,open=true]'],
  ['oak_door[facing=east,half=lower,hinge=right,open=true]', 'oak_door[facing=east,half=upper,hinge=right,open=true]'],
  ['white_bed[facing=east,part=head]'], ['white_bed[facing=north,part=head]'],
  ['oak_fence_gate[facing=east,open=false]'], ['oak_fence_gate[facing=east,open=true]'], ['oak_fence_gate[facing=north,open=false]'],
  ['oak_trapdoor[facing=east,half=top,open=false]'], ['oak_trapdoor[facing=east,half=bottom,open=true]'],
  ['oak_trapdoor[facing=west,half=top,open=true]'], ['oak_trapdoor[facing=north,half=bottom,open=true]'], ['oak_trapdoor[facing=south,half=top,open=true]'],
  ['cobblestone_stairs[facing=east,half=top]'], ['cobblestone_stairs[facing=west,half=top]'], ['cobblestone_stairs[facing=north,half=bottom]'],
  ['cobblestone_stairs[facing=south,half=top]'],
  ['oak_sign'], ['rail[shape=east_west]'], ['oak_pressure_plate'], ['cake'], ['anvil[facing=east]'], ['anvil[facing=north]'], ['brewing_stand'],
  ['flower_pot'], ['end_portal_frame[facing=east]'], ['iron_bars'], ['glass_pane'], ['ladder[facing=east]'], ['chest[facing=north]'],
]
const partials = area('partials', [-8, 24, -24, PARTIALS.length * 4 - 16], lanes(PARTIALS, ([lower, upper], z) => [
  fill([3, 1, z - 1], [3, 1, z + 1], lower, /bars|pane/.test(lower) ? { update: true } : {}),
  ...(upper ? [fill([3, 2, z - 1], [3, 2, z + 1], upper)] : []),
]))

// As flowBlockers, for the blocks it leaves out (B148, B164): each of these asks its own question of the flow, whatever it collides with.
export const FLOW_BLOCKERS_MORE = ['oak_wall_sign[facing=east]', 'ladder[facing=east]', 'oak_door[facing=east,half=lower]', 'rail[shape=east_west]',
  'iron_bars', 'glass_pane', 'cobblestone_wall', 'lever[face=floor,facing=east]', 'torch', 'flower_pot', 'oak_pressure_plate', 'oak_fence_gate[facing=east,open=true]',
  'oak_leaves[persistent=true]', 'cactus', 'sugar_cane', 'lily_pad', 'dead_bush', 'white_bed[facing=east,part=foot]', 'cobweb', 'chest[facing=north]', 'glass']
const flowBlockersMore = area('flowBlockersMore', [-8, 16, -24, FLOW_BLOCKERS_MORE.length * 4 - 16],
  lanes(FLOW_BLOCKERS_MORE, (b, z) => [
    fill([0, 1, z - 1], [9, 2, z + 1], 'stone'), fill([1, 2, z], [2, 2, z], 'water'), fill([3, 1, z], [8, 2, z], 'air'),
    fill([3, 1, z], [8, 1, z], 'water'), fill([3, 2, z], [3, 2, z], b, /^lever/.test(b) ? { since: '1.13' } : {}),
  ]))

// As fallingFaces, for each height of snow (a full face at 8 alone: SnowLayerBlock.getBlockSupportShape), the faces of a stair it
// leaves out, and what sturdiness and collision disagree on (B148, B153, B164).
export const FALLING_FACES_MORE = ['snow[layers=1]', 'snow[layers=2]', 'snow[layers=3]', 'snow[layers=4]', 'snow[layers=5]', 'snow[layers=6]',
  'snow[layers=7]', 'snow[layers=8]', 'cobblestone_stairs[facing=south]', 'cobblestone_stairs[facing=east,half=top]', 'cobblestone_stairs[facing=west,half=top]',
  'oak_leaves[persistent=true,waterlogged=true]', 'soul_sand', 'farmland', 'dirt_path', 'oak_trapdoor[facing=west,half=bottom,open=true]',
  'oak_trapdoor[facing=east,half=bottom,open=true]', 'stone_slab[type=double]', 'chest[facing=north]']
const fallingFacesMore = area('fallingFacesMore', [-8, 12, -24, FALLING_FACES_MORE.length * 4 - 16],
  lanes(FALLING_FACES_MORE, (b, z) => [fill([5, 1, z], [5, 12, z], 'water[level=8]'), fill([6, 1, z], [6, 12, z], b)]))

// A column 3 high to be pushed out of (B164): collides and suffocates apart. Glass and leaves collide and do not suffocate, a
// top slab and low snow collide in part, a carpet barely, and a sign not at all.
export const SUFFOCATORS = ['stone', 'glass', 'oak_leaves[persistent=true]', 'soul_sand', 'stone_slab[type=double]', 'stone_slab[type=top]', 'stone_slab[type=bottom]',
  'snow[layers=8]', 'snow[layers=7]', 'snow[layers=1]', 'oak_fence', 'chest[facing=north]', 'ice', 'white_carpet', 'oak_sign', 'farmland', 'mud', 'piston[facing=up]', 'sand']
const suffocators = area('suffocators', [-8, 16, -24, SUFFOCATORS.length * 4 - 16],
  lanes(SUFFOCATORS, (b, z) => [fill([0, 1, z], [0, 3, z], b)]))

// One anvil in its lane at (3, 1), with room on its x and z sides: 1.8 keeps its bounds on the block, not the state (B161).
export const ANVILS = ['anvil[facing=east]', 'anvil[facing=north]', 'anvil[facing=west]', 'anvil[facing=south]']
const anvils = area('anvils', [-8, 16, -24, ANVILS.length * 4 - 16], lanes(ANVILS, (b, z) => [fill([3, 1, z], [3, 1, z], b)]))

// A waterlogged copper grate 3 high with a neighbour at x=1 (B149): its fluid is a falling source, turned down beside a sturdy
// face. It is a full cube, so only a box pushed out of it meets that water.
export const GRATE_NEIGHBOURS = ['stone', 'air', 'glass', 'stone_slab[type=top]']
const grates = area('grates', [-8, 16, -24, GRATE_NEIGHBOURS.length * 4 - 16], lanes(GRATE_NEIGHBOURS, (b, z) => [
  fill([0, 1, z], [0, 3, z], 'copper_grate[waterlogged=true]'), fill([1, 1, z], [1, 3, z], b),
]))

// A row of flowing water ending at a block that holds water (B139, B148): the toggles of java-fluid-edges happen at x=8.
export const WET_NEIGHBOURS = [
  { id: 'slab', state: 'stone_slab[type=bottom,waterlogged=true]' },
  { id: 'stairs', state: 'cobblestone_stairs[facing=west,half=bottom,shape=straight,waterlogged=true]' },
  { id: 'fence', state: 'oak_fence[waterlogged=true]' },
  { id: 'trapdoor', state: 'oak_trapdoor[facing=north,half=bottom,open=false,waterlogged=true]' },
] as const
const wetNeighbours = area('wetNeighbours', [-8, 16, -24, WET_NEIGHBOURS.length * 4 - 16],
  lanes(WET_NEIGHBOURS, (n, z) => [
    ...walled([4, 1, z], [8, 1, z]),
    fill([4, 1, z], [4, 1, z], 'water[level=3]'), fill([5, 1, z], [5, 1, z], 'water[level=2]'), fill([6, 1, z], [7, 1, z], 'water[level=1]'),
    fill([8, 1, z], [8, 1, z], n.state),
  ]))

// A source one block deep and walled in, under what the eyes' height depends on from 26.3 (B148): FluidState.getHeightForCamera
// is 1 under a face sturdy below, the 8/9 of getHeight otherwise.
export const CAMERA_CEILINGS = ['air', 'stone', 'stone_slab[type=bottom]', 'stone_slab[type=top]', 'oak_trapdoor[facing=north,half=top,open=false]', 'oak_fence', 'glass']
const cameraCeilings = area('cameraCeilings', [-8, 12, -24, CAMERA_CEILINGS.length * 4 - 16],
  lanes(CAMERA_CEILINGS, (c, z) => [...walled([4, 1, z], [4, 1, z]), fill([4, 1, z], [4, 1, z], 'water'), fill([4, 2, z], [4, 2, z], c)]))

// Chunk column x<0 holds water over a hole, the floor ends at the column's edge (B120): what the client forgets of it is what it
// loses, while the server's player passes through water alone and no correction comes.
const unloadedColumn = area('unloadedColumn', [-8, 8, 2, 14], fill([-8, -11, 2], [-1, 0, 14], 'air'), fill([-8, 1, 4], [-1, 2, 12], 'water'))

// What a boat runs on (B155), and a boat held under (B146).
export const BOAT_FLOORS = ['frosted_ice', 'ice_half', 'lily_on_ice', 'ice_then_stone', 'blue_then_ice', 'under_stone', 'under_falling']
const boatFloors = area('boatFloors', [-8, 30, -24, BOAT_FLOORS.length * 4 - 16],
  lanes(BOAT_FLOORS, (l, z) => {
    const run = (from: number, to: number, block: string): PhysrecFill => fill([from, 0, z - 1], [to, 0, z + 1], block)
    switch (l) {
      case 'frosted_ice': return [run(-8, 24, 'frosted_ice')]
      // the boat's box over both: ice on the near half of the lane
      case 'ice_half': return [fill([-8, 0, z - 1], [24, 0, z], 'ice')]
      // (before 1.15 the client breaks a pad a boat touches too, and is left apart from the server: 1.14 LilyPadBlock.java:21-26,
      // 1.15 :22-24 asks for a ServerWorld. No fixture can hold that, so from 1.15 only.)
      case 'lily_on_ice': return [run(-8, 24, 'ice'), fill([0, 1, z - 1], [12, 1, z + 1], 'lily_pad', { since: '1.15' })]
      case 'ice_then_stone': return [run(-8, 4, 'ice')]
      case 'blue_then_ice': return [run(-8, 4, 'blue_ice'), run(5, 24, 'ice')]
      case 'under_stone': return [fill([-8, -3, z - 1], [24, 1, z + 1], 'water'), fill([-8, 2, z - 1], [24, 2, z + 1], 'stone')]
      default: return [fill([-8, -3, z - 1], [24, 0, z + 1], 'water'), fill([2, 1, z - 1], [24, 1, z + 1], 'water[level=8]'), fill([2, 2, z - 1], [24, 2, z + 1], 'glass')]
    }
  }))

// Bubble columns three wide in a pool, wide enough for a boat, under what ends them (B144).
export const BOAT_COLUMN_TOPS = ['air', 'oak_sign', 'stone', 'water']
export const BOAT_COLUMN_LANES = BOAT_COLUMN_TOPS.flatMap(top => [{ top, drag: false }, { top, drag: true }])
const boatColumns = area('boatColumns', [-8, 12, -24, BOAT_COLUMN_LANES.length * 4 - 16],
  lanes(BOAT_COLUMN_LANES, (l, z) => [
    fill([-5, -4, z - 2], [5, -1, z + 2], 'stone'), fill([-4, -3, z - 1], [4, 0, z + 1], 'water'),
    fill([1, -4, z - 1], [3, -4, z + 1], l.drag ? 'magma_block' : 'soul_sand'), fill([1, -3, z - 1], [3, 0, z + 1], `bubble_column[drag=${l.drag}]`),
    fill([1, 1, z - 1], [3, 1, z + 1], l.top), ...(l.top === 'water' ? [fill([1, 2, z - 1], [3, 2, z + 1], 'glass')] : []),
  ]))

// Lava for a strider to take from the bank at x=0 (B147): `covered` has lava over lava from x=4, `flowing` is no source, `deep` a pit to rise from.
export const STRIDER_LANES = ['still', 'flowing', 'covered', 'deep']
const striderLanes = area('striderLanes', [-8, 20, -24, STRIDER_LANES.length * 4 - 16],
  lanes(STRIDER_LANES, (l, z) => {
    const pit = (block: string, low = 0): PhysrecFill[] => [fill([1, low - 1, z - 2], [17, 0, z + 2], 'stone'), fill([2, low, z - 1], [16, 0, z + 1], block)]
    switch (l) {
      case 'flowing': return pit('lava[level=2]')
      case 'covered': return [...pit('lava'), fill([4, 1, z - 1], [16, 1, z + 1], 'lava')]
      case 'deep': return pit('lava', -3)
      default: return pit('lava')
    }
  }))

// Full cauldrons at x=4 of a lane, to jump into from x=2 (B159).
export const CAULDRONS = [{ id: 'powder', state: 'powder_snow_cauldron[level=3]' }, { id: 'water', state: 'water_cauldron[level=3]' }]
const cauldrons = area('cauldrons', [-8, 12, -24, CAULDRONS.length * 4 - 16],
  lanes(CAULDRONS, (c, z) => [fill([4, 1, z], [4, 1, z], c.state, { since: '1.17' })]))

// Lava the same in both dimensions (B138), in the blocks' own coordinates: a channel whose level goes down by one at each block,
// the slope lava keeps in an ultra-warm dimension, walled in on stone, and a pool three deep. java-fluid-edges builds it in the nether.
export const ULTRA_LAVA: readonly (readonly [Pos, Pos, string])[] = [
  [[-1, 1, -1], [8, 2, -1], 'stone'], [[-1, 1, 1], [8, 2, 1], 'stone'], [[-1, 1, 0], [-1, 2, 0], 'stone'], [[8, 1, 0], [8, 2, 0], 'stone'],
  [[0, 1, 0], [0, 1, 0], 'lava'], ...[1, 2, 3, 4, 5, 6, 7].map(i => [[i, 1, 0], [i, 1, 0], `lava[level=${i}]`] as const),
  [[-1, -3, 4], [7, 0, 8], 'stone'], [[0, -2, 5], [6, 0, 7], 'lava'],
]
const ultraLava = area('ultraLava', [-10, 18, -10, 10], ULTRA_LAVA.map(([from, to, block]) => fill(from, to, block)))

// A pool against the west edge of one chunk, deep in the nether's rock when it is built there (B140): see uw_chunk_edge.
export const ULTRA_EDGE_ORIGIN: Pos = [3200, 10, 3200]
export const ULTRA_EDGE: readonly (readonly [Pos, Pos, string])[] = [
  [[0, -2, 0], [15, 6, 15], 'stone'], [[0, 1, 2], [4, 3, 6], 'air'], [[0, 1, 2], [4, 1, 6], 'lava'],
]
const ultraEdge: PhysrecArea = { name: 'ultraEdge', extent: [-8, 24, -8, 24], origin: ULTRA_EDGE_ORIGIN, blocks: ULTRA_EDGE.map(([from, to, block]) => fill(from, to, block)) }

// A fence on y=1 at x=1 that a piston at x=2 pushes west into x=0, its power the redstone block x=3 takes. A player on the post
// at x=1.35 has the destination cell at x=0 on the edge of the cells the 1.14-1.17.1 walk reads on x, under its feet on y:
// the walk reads a moving piston there (1.17.1 Shapes.java:268) and the fence's 1.5 high post holds it up (B290).
const pistonFence = area('pistonFence', [-8, 12, -8, 8], fill([1, 1, 0], [1, 1, 0], 'oak_fence'), fill([2, 1, 0], [2, 1, 0], 'piston[facing=west]'))

// A web in lava, and a pool to fall through it (B145).
export const FLUID_WEBS = ['lava_web', 'lava_web_deep']
const fluidWebs = area('fluidWebs', [-8, 16, -24, FLUID_WEBS.length * 4 - 16],
  lanes(FLUID_WEBS, (l, z) => [
    fill([1, -3, z - 2], [12, 0, z + 2], 'stone'), fill([2, l === 'lava_web' ? 0 : -2, z - 1], [11, 0, z + 1], 'lava'), fill([6, l === 'lava_web' ? 0 : -2, z - 1], [6, 1, z + 1], 'cobweb'),
  ]))

// A one-high space to crawl along, over and through what slows or carries a player (B132).
export const CRAWL_LANES = ['water', 'cobweb', 'soul_sand', 'powder_snow']
const crawlFields = area('crawlFields', [-8, 20, -24, CRAWL_LANES.length * 4 - 16],
  lanes(CRAWL_LANES, (l, z) => [
    ...walled([0, 1, z], [16, 1, z]), fill([0, 2, z - 1], [16, 2, z + 1], 'stone'),
    l === 'soul_sand' ? fill([6, 0, z], [10, 0, z], l) : fill([6, 1, z], [10, 1, z], l),
  ]))

export default [playerEdges, neighbours, inside, surfaces, transitions, steps, outlineSteps, ceilings, landing, ledges, walls, climbs, water, flow, lava, honeyWall,
  tunnels, rails, boats, mounts, sky, skyWall, flight, waterfall, piston, straddle, pushout, ...farAreas, features, skyLava,
  currents, currentsNeg, currentsHigh, lavaFlow, waterlogged, shallowCells, fluidClimb, webPool, flowBlockers, fallingFaces, pistonCourse,
  hazards, entitySteps, borderNeg, skyWater, skyShallow, skySlime, skyLadder, skyVine, skyScaffolding, boatShore, horsePool, dismounts, portals, mountCourse, nearWall(6), nearWall(9), nearWall(12), ringQuadrant('ringsPos', [96, 100, 96]), ringQuadrant('ringsNeg', [-96, 100, -96]), honeyPost, lowCeilings, bubbleTops, ledgePools, mixedFluids, pistonSurfaces, hotFloors, projectileRange, minecarts, minecartsWet, voidShaft, movers, waterStack, waterStackHigh, waterHolders, climbCurrents, iceLanes, fenceTops, minecartHazards, partials, flowBlockersMore, fallingFacesMore, suffocators, anvils, grates, wetNeighbours, cameraCeilings, unloadedColumn, boatFloors, boatColumns, striderLanes, fluidWebs, crawlFields, cauldrons, ultraLava, ultraEdge, pistonFence]
