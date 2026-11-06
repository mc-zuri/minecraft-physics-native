// Ported from physics-data-generator catalog/src/coverage/use-block.mjs; maintained here now.
// The right-click matrix: every block the 26.3 client can use (Block.useWithoutItem / useItemOn), clicked with an empty
// hand, a stick, a block (cobblestone) and, where the block takes one, its own item (a disc for the jukebox, a book for
// the lectern, ...), standing and sneaking. Sneaking with anything in a hand skips the block (the item is used on it:
// the cobblestone is placed against it); with empty hands it does not. The block resets with its lane every case.
// What to compare: use_item_on (hand, face, cursor, inside, sequence), the swing, which hand goes first, the screen it
// opens (container screens are closed again by the client), the block changes the server answers with.
//
// Lanes along z, 3 apart; the player at x=0.5 facing +x, the block at x=2, y=1 (aimed at its centre, or where its
// shape is: aimY above its bottom). The hands: 0 empty, 1 cobblestone, 2 stick, 3 the block's own item.
import '../_areas/index.ts'
import { registerAreas, SNEAK, crosshair, hold, kase, release, ticks } from '../../../dsl/physrec.ts'
import { EYE, EYE_CROUCH, aim, area, at1, feature, hands, item, lookAt, slot, start, useOnce } from './_lib.ts'
import type { PhysrecItem, Pos } from '../../../dsl/physrec.ts'
import type { Scenario } from '../../../dsl/core.ts'

/** A block of a station: [dx, dy, dz, state] from the station. */
type StationBlock = readonly [number, number, number, string]
interface StationBase {
  readonly id: string
  readonly aimY?: number
  readonly extra?: PhysrecItem
  readonly since?: string
  readonly legacy?: readonly StationBlock[]
}
/** One block (state), or several (blocks) with the block id the case requires. */
type Station = StationBase & (
  | { readonly state: string; readonly blocks?: undefined; readonly requires?: undefined }
  | { readonly state?: undefined; readonly blocks: readonly StationBlock[]; readonly requires: string })

// id: case name part; blocks: [dx, dy, dz, state] from the station (x=2, y=1); aimY: height of the aim point above
// the station's bottom; extra: the block's own item; since: first release (the case requires the block).
const STATIONS: readonly Station[] = [
  { id: 'chest', state: 'chest[facing=west]', extra: item('cobblestone', 4) },
  { id: 'double_chest', blocks: [[0, 0, 0, 'chest[facing=west,type=right]'], [0, 0, 1, 'chest[facing=west,type=left]']], requires: 'chest',
    legacy: [[0, 0, 0, 'chest[facing=west]'], [0, 0, 1, 'chest[facing=west]']] },
  { id: 'trapped_chest', state: 'trapped_chest[facing=west]' },
  { id: 'copper_chest', state: 'copper_chest[facing=west]', since: '1.21.9' },
  { id: 'ender_chest', state: 'ender_chest[facing=west]' },
  { id: 'barrel', state: 'barrel[facing=up]', since: '1.14' },
  { id: 'shulker_box', state: 'shulker_box[facing=up]', since: '1.11' },
  { id: 'furnace', state: 'furnace[facing=west]', extra: item('coal', 4) },
  { id: 'smoker', state: 'smoker[facing=west]', since: '1.14' },
  { id: 'blast_furnace', state: 'blast_furnace[facing=west]', since: '1.14' },
  { id: 'crafting_table', state: 'crafting_table' },
  { id: 'crafter', state: 'crafter[orientation=west_up]', since: '1.21' },
  { id: 'anvil', state: 'anvil[facing=north]' },
  { id: 'enchanting_table', state: 'enchanting_table', aimY: 0.4, extra: item('lapis_lazuli', 4) },
  { id: 'brewing_stand', state: 'brewing_stand', aimY: 0.3, extra: item('blaze_powder', 2) },
  { id: 'beacon', state: 'beacon' },
  { id: 'hopper', state: 'hopper[facing=down]', aimY: 0.8 },
  { id: 'dispenser', state: 'dispenser[facing=west]' },
  { id: 'dropper', state: 'dropper[facing=west]' },
  { id: 'loom', state: 'loom[facing=west]', since: '1.14' },
  { id: 'stonecutter', state: 'stonecutter[facing=west]', aimY: 0.3, since: '1.14' },
  { id: 'grindstone', state: 'grindstone[face=floor,facing=west]', aimY: 0.6, since: '1.14' },
  { id: 'smithing_table', state: 'smithing_table', since: '1.14' },
  { id: 'cartography_table', state: 'cartography_table', since: '1.14' },
  { id: 'fletching_table', state: 'fletching_table', since: '1.14' },
  { id: 'lectern', state: 'lectern[facing=west]', aimY: 0.8, extra: item('writable_book'), since: '1.14' },
  { id: 'oak_door', blocks: [[0, 0, 0, 'oak_door[facing=east,half=lower]'], [0, 1, 0, 'oak_door[facing=east,half=upper]']], requires: 'oak_door' },
  { id: 'iron_door', blocks: [[0, 0, 0, 'iron_door[facing=east,half=lower]'], [0, 1, 0, 'iron_door[facing=east,half=upper]']], requires: 'iron_door' },
  { id: 'oak_trapdoor', state: 'oak_trapdoor[facing=west,half=bottom]', aimY: 0.1 },
  { id: 'oak_fence_gate', state: 'oak_fence_gate[facing=east]' },
  { id: 'lever', state: 'lever[face=floor,facing=east]', aimY: 0.2, legacy: [[0, 0, 0, 'lever[facing=up_x]']] },
  { id: 'stone_button', state: 'stone_button[face=floor,facing=east]', aimY: 0.05, legacy: [[0, 0, 0, 'stone_button[facing=up]']] },
  { id: 'repeater', state: 'repeater[facing=west]', aimY: 0.06 },
  { id: 'comparator', state: 'comparator[facing=west]', aimY: 0.06 },
  { id: 'note_block', state: 'note_block' },
  { id: 'redstone_wire', state: 'redstone_wire', aimY: 0.02 },
  { id: 'cake', state: 'cake', aimY: 0.3 },
  { id: 'composter', state: 'composter', aimY: 0.9, extra: item('wheat_seeds', 8), since: '1.14' },
  { id: 'cauldron', state: 'cauldron', aimY: 0.9, extra: item('water_bucket') },
  { id: 'jukebox', state: 'jukebox', extra: item('music_disc_13') },
  { id: 'bell', state: 'bell[attachment=floor,facing=east]', aimY: 0.5, since: '1.14' },
  { id: 'campfire', state: 'campfire[facing=west,lit=true]', aimY: 0.3, extra: item('beef'), since: '1.14' },
  { id: 'flower_pot', state: 'flower_pot', aimY: 0.2, extra: item('poppy') },
  { id: 'decorated_pot', state: 'decorated_pot[facing=west]', since: '1.20', extra: item('stick') },
  { id: 'chiseled_bookshelf', state: 'chiseled_bookshelf[facing=west]', since: '1.20', extra: item('book', 2) },
  { id: 'oak_shelf', state: 'oak_shelf[facing=west]', since: '1.21.9' },
  { id: 'white_bed', blocks: [[0, 0, 0, 'white_bed[part=foot,facing=east]'], [1, 0, 0, 'white_bed[part=head,facing=east]']], aimY: 0.3, requires: 'white_bed', since: '1.12' },
  { id: 'straw_bed', blocks: [[0, 0, 0, 'straw_bed[part=foot,facing=east]'], [1, 0, 0, 'straw_bed[part=head,facing=east]']], aimY: 0.3, requires: 'straw_bed', since: '26.3' },
  { id: 'respawn_anchor', state: 'respawn_anchor[charges=0]', since: '1.16' },
  { id: 'sweet_berry_bush', state: 'sweet_berry_bush[age=3]', since: '1.14' },
  { id: 'pumpkin', state: 'pumpkin', extra: item('shears') },
  { id: 'copper_golem_statue', state: 'copper_golem_statue', aimY: 0.4, since: '1.21.9' }
]

const STEP = 3
const laneOf = (i: number): number => -Math.floor(STATIONS.length * STEP / 2) + i * STEP
const blocksOf = (s: Station): readonly StationBlock[] => s.blocks ?? [[0, 0, 0, s.state]]

export const areas = [
  area('cov_use', [-6, 8, laneOf(0) - 3, laneOf(STATIONS.length - 1) + 3],
    // Placed as written, with no neighbour updates (a bed's foot or a door's lower half alone would break).
    // A station with a `legacy` form: that one before the flattening (no chest type, no button or lever face then; the
    // old adapters reject a property their block lacks), the modern one from 1.13.
    STATIONS.flatMap((s, i) => [
      ...blocksOf(s).map(([dx, dy, dz, state]) =>
        at1(2 + dx, 1 + dy, laneOf(i) + dz, state, s.legacy ? { since: '1.13' } : s.since ? { since: s.since } : {})),
      ...(s.legacy ?? []).map(([dx, dy, dz, state]) => at1(2 + dx, 1 + dy, laneOf(i) + dz, state, { until: '1.13' }))
    ]))
]

const cases: Scenario[] = []
STATIONS.forEach((s, i) => {
  const z = laneOf(i)
  const at: Pos = [0.5, 0, z + 0.5]
  const target: Pos = [2.5, 1 + (s.aimY ?? 0.5), z + 0.5]
  const id = s.requires ?? s.state.replace(/\[.*/, '')
  const inventory = hands({ 1: item('cobblestone', 16), 2: item('stick'), 3: s.extra })
  // Empty hand first, the cobblestone last: a sneaking click places it against the block, in front of the next aim.
  const order = [0, 2, ...(s.extra ? [3] : []), 1]
  for (const sneak of [false, true]) {
    const eye = sneak ? EYE_CROUCH : EYE
    const { yaw, pitch } = aim(at, target, EYE)
    cases.push(kase(`m_c_use_${s.id}${sneak ? '_sneak' : ''}`, {
      ...feature(),
      area: 'cov_use',
      at,
      yaw,
      pitch,
      requires: [id],
      tags: ['coverage', 'use_item_on', id, ...(sneak ? ['sneak'] : [])],
      ...(s.since ? { since: s.since } : {}),
      // the cake is eaten only when hungry
      setup: { ...inventory, ...(s.id === 'cake' ? { food: 10 } : {}) },
    },
      start(),
      sneak ? [hold(SNEAK), ticks(5)] : [],
      lookAt(at, target, eye),
      ticks(2),
      crosshair(),
      order.flatMap(h => [slot(h), ticks(2), ...useOnce()]),
      sneak ? [release(SNEAK), ticks(5)] : [],
    ))
  }
})

export default cases

registerAreas(areas)
