// A shulker box's lid with the player in its way: each facing opened with the player against that face, so the lid
// pushes it, then shut. The `_walk` cases walk after the lid as it closes. Before 1.17 a closing lid pushes as well
// (1.16.5 ShulkerBoxBlockEntity.java:65-85). What to compare: the player's path while the lid moves, which the block
// event alone drives (block_action in the recording, ShulkerBoxTracker in the replay).
//
// The box at x=2, y=1 of its lane (y=3 for facing=down, over the player's head). Lanes along z, 5 apart.
import '../_areas/index.ts'
import { F, USE, closeScreen, kase, press, registerAreas, screen, ticks } from '../../../dsl/physrec.ts'
import { aim, area, at1, feature, lookAt, start } from './_lib.ts'
import type { Pos } from '../../../dsl/physrec.ts'
import type { Scenario } from '../../../dsl/core.ts'

interface Facing {
  readonly facing: string
  readonly y: number
  readonly at: (z: number) => Pos
  readonly target: (z: number) => Pos
}

const FACINGS: readonly Facing[] = [
  { facing: 'west', y: 1, at: z => [1.69, 0, z + 0.5], target: z => [2, 1.5, z + 0.5] },
  { facing: 'east', y: 1, at: z => [3.31, 0, z + 0.5], target: z => [3, 1.5, z + 0.5] },
  { facing: 'north', y: 1, at: z => [2.5, 0, z - 0.31], target: z => [2.5, 1.5, z] },
  { facing: 'south', y: 1, at: z => [2.5, 0, z + 1.31], target: z => [2.5, 1.5, z + 1] },
  { facing: 'up', y: 1, at: z => [2.5, 1, z + 0.5], target: z => [2.5, 2, z + 0.5] },
  { facing: 'down', y: 3, at: z => [2.5, 0, z + 0.5], target: z => [2.5, 3, z + 0.5] },
]

const laneOf = (i: number): number => -12 + i * 5

export const areas = [
  area('cov_shulker', [-2, 6, laneOf(0) - 4, laneOf(FACINGS.length - 1) + 4],
    FACINGS.map((f, i) => at1(2, f.y, laneOf(i), `shulker_box[facing=${f.facing}]`, { since: '1.11' }))),
]

const cases: Scenario[] = []
FACINGS.forEach((f, i) => {
  const z = laneOf(i)
  const at = f.at(z)
  const target = f.target(z)
  const { yaw, pitch } = aim(at, target)
  const common = {
    ...feature(),
    area: 'cov_shulker',
    at,
    yaw,
    pitch,
    requires: ['shulker_box'],
    tags: ['coverage', 'shulker_box'],
    since: '1.11',
  }
  // long enough for the lid to open all the way, 10 ticks a side, and to close
  cases.push(kase(`sb_${f.facing}`, common,
    start(), lookAt(at, target), ticks(2), press(USE, 1), ticks(16), closeScreen(), screen('none', 20), ticks(16)))
  if (f.facing !== 'up' && f.facing !== 'down') {
    cases.push(kase(`sb_${f.facing}_walk`, common,
      start(), lookAt(at, target), ticks(2), press(USE, 1), ticks(16), closeScreen(), screen('none', 20), press(F, 16), ticks(4)))
  }
})

export default cases
registerAreas(areas)
