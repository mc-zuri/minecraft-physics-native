// Two rules no other case reaches, each told apart by what vanilla does on either side of its gate.
//
// iw_: isInWall. In 1.18 and 1.18.1 the block's shape is moved to the eye, so any non-empty shape round it holds it (1.18.1
// Entity.java:1698-1710); from 1.18.2 the shape stays in its cell (1.18.2 Entity.java:1640). So only an eye above the top of a
// partial suffocating block tells them apart: a soul sand's shape ends at 0.875, and an eye on 4 layers of snow is at 0.995 of it,
// on 3 layers at 0.87. The stone half under the player leaves it no pose it could crawl in, so it stands, and a whole layer of
// soul sand makes every column round it suffocate, so nothing pushes it out.
//
// mc_water_and_lava: a cart in both. 1.16 and 1.16.1 stop at the water and take nothing of the lava (1.16 Entity.java:1042-1047);
// 1.16.2 measures both (:1068). Water beside lava turns it to stone, so the two only touch by a corner, under a cart on two
// slabs, and the lava runs from a source a block on, so that its flow pushes. From 1.16.2 the lava ends a cart in two ticks, so it
// is summoned in the recording: a summon before it would be gone before the first tick anything compares.
import './_areas/index.ts'
import { kase, registerAreas, server, summon, ticks } from '../../dsl/physrec.ts'
import { area, fill } from './coverage/_lib.ts'
import type { Scenario } from '../../dsl/core.ts'

export const areas = [
  area('iw_partial_blocks', [-3, 4, -3, 6],
    fill([0, 1, 0], [0, 1, 0], 'snow[layers=4]'),
    fill([1, 1, 0], [1, 1, 0], 'stone'),
    fill([0, 1, 3], [0, 1, 3], 'snow[layers=3]'),
    fill([1, 1, 3], [1, 1, 3], 'stone'),
    fill([-1, 2, -1], [3, 2, 4], 'soul_sand')),
  area('mc_two_fluids', [-8, 5, -3, 4],
    fill([-1, 1, -1], [3, 1, 2], 'stone'),
    fill([0, 1, 0], [0, 1, 0], 'water'),
    fill([1, 1, 0], [1, 1, 0], 'stone_slab'),
    fill([0, 1, 1], [0, 1, 1], 'stone_slab'),
    fill([2, 1, 1], [2, 1, 1], 'lava'),
    fill([1, 1, 1], [1, 1, 1], 'lava[level=1]')),
]

const inWall = { area: 'iw_partial_blocks', yaw: 0, tier: 3, since: '1.14', tags: ['suffocation'] }
const cases: Scenario[] = [
  kase('iw_eye_over_a_soul_sand', { ...inWall, at: [0.95, 0.375, 0.5] }, ticks(10)),
  kase('iw_eye_in_a_soul_sand', { ...inWall, at: [0.95, 0.25, 3.5] }, ticks(10)),
  kase('mc_water_and_lava', {
    area: 'mc_two_fluids', at: [-5.5, 0, 0.5], yaw: 270, tier: 3, since: '1.14', tags: ['minecart'],
  }, ticks(3), server(summon('minecart', [1, 0.5, 1])), ticks(20)),
]

export default cases
registerAreas(areas)
