// Ported from physics-data-generator catalog/src/coverage/use-item.mjs; maintained here now.
// Items used on blocks and in the air, as the 26.3 client sends them: buckets (fluids are hit by the bucket's own
// ray: a source to pick up), milking, tools that change the block they are used on (hoe, shovel, axe, flint and
// steel), a firework launched from the floor, throwables held (one every 4 ticks), ender pearl flight and teleport,
// bow and trident released while sprinting, the spear's charge (no slowdown, sprinting allowed), the goat horn's
// cooldown, the drop and swap-hands keys.
import '../_areas/index.ts'
import { registerAreas, DROP, F, SPRINT, SWAP, USE, crosshair, hold, kase, look, press, release, releaseAll, ticks } from '../../../dsl/physrec.ts'
import { aim, area, at1, feature, hands, item, start } from './_lib.ts'
import type { KaseSpec, PhysrecSetup, PhysrecStep, PhysrecSteps, Pos } from '../../../dsl/physrec.ts'
import type { Scenario } from '../../../dsl/core.ts'

/** Where the player looks: fixed, or from where the lane puts the player. */
type View = { yaw: number; pitch: number } | ((at: Pos) => { yaw: number; pitch: number })

const LANES = ['water', 'lava', 'cow', 'dirt', 'grass', 'log', 'open', 'throw', 'fire']
const Z = Object.fromEntries(LANES.map((n, i) => [n, -20 + i * 5]))

export const areas = [
  area('cov_items', [-8, 60, -24, 24],
    at1(2, 0, Z.dirt, 'dirt'),
    at1(2, 0, Z.grass, 'grass_block[snowy=false]'),
    at1(2, 1, Z.log, 'oak_log[axis=y]'))
]

const out: Scenario[] = []
const use = (name: string, lane: string, view: View, setup: PhysrecSetup, steps: PhysrecSteps, extra: Partial<KaseSpec> = {}): void => {
  const at: Pos = [0.5, 0, Z[lane] + 0.5]
  out.push(kase(`m_c_item_${name}`, {
    ...feature(),
    area: 'cov_items',
    at,
    ...(typeof view === 'function' ? view(at) : view),
    tags: ['coverage', 'use_item'],
    setup,
    ...extra,
  },
    start(),
    crosshair(),
    steps,
  ))
}
const floorAhead = (at: Pos): { yaw: number; pitch: number } => aim(at, [2.5, 1, at[2]])
const once = (n = 10): PhysrecStep[] => [press(USE, 1), ticks(n)]

use('water_bucket_place_pickup', 'water', floorAhead, hands({ 0: item('water_bucket') }), [...once(15), ...once(15)])
use('lava_bucket_place_pickup', 'lava', floorAhead, hands({ 0: item('lava_bucket') }), [...once(15), ...once(15)])
use('bucket_milk_then_drink', 'cow', at => aim(at, [2.5, 1.7, at[2]]),
  { ...hands({ 0: item('bucket') }), summon: [{ entity: 'cow', at: [2.5, 0, Z.cow + 0.5], yaw: 90 }] },
  [...once(10), hold(USE), ticks(40), release(USE), ticks(10)])
use('hoe_till', 'dirt', at => aim(at, [2.5, 1, at[2]]), hands({ 0: item('iron_hoe') }), once())
use('shovel_path', 'grass', at => aim(at, [2.5, 1, at[2]]), hands({ 0: item('iron_shovel') }), once(), { since: '1.17' })
use('axe_strip', 'log', at => aim(at, [2.5, 1.5, at[2]]), hands({ 0: item('iron_axe') }), once(), { since: '1.13' })
use('flint_and_steel_fire', 'fire', floorAhead, hands({ 0: item('flint_and_steel') }), once(20))
use('firework_from_floor', 'open', floorAhead, hands({ 0: item('firework_rocket', 3) }), once(40))
use('snowball_held', 'throw', { yaw: 270, pitch: -10 }, hands({ 0: item('snowball', 16) }), [hold(USE), ticks(20), release(USE), ticks(10)])
use('ender_pearl_flight', 'throw', { yaw: 270, pitch: -25 }, hands({ 0: item('ender_pearl', 2) }), once(80))
use('goat_horn_cooldown', 'open', { yaw: 270, pitch: 0 }, hands({ 0: item('goat_horn') }), [...once(20), ...once(20)], { since: '1.19' })
use('bow_sprint_release', 'throw', { yaw: 270, pitch: -5 }, hands({ 0: item('bow'), 9: item('arrow', 16) }),
  [hold(F, SPRINT), ticks(15), hold(USE), ticks(25), release(USE), ticks(10), releaseAll(), ticks(15)])
use('trident_sprint_throw', 'throw', { yaw: 270, pitch: -5 }, hands({ 0: item('trident') }),
  [hold(F, SPRINT), ticks(15), hold(USE), ticks(15), release(USE), ticks(10), releaseAll(), ticks(15)], { since: '1.13' })
use('spear_charge_sprint', 'throw', { yaw: 270, pitch: 0 }, hands({ 0: item('wooden_spear') }),
  [hold(F, SPRINT), ticks(10), hold(USE), ticks(30), release(USE), ticks(10), releaseAll(), ticks(15)], { since: '1.21.11' })
use('shield_sprint', 'throw', { yaw: 270, pitch: 0 }, hands({ 40: item('shield') }),
  [hold(F, SPRINT), ticks(15), hold(USE), ticks(20), release(USE), ticks(15), releaseAll(), ticks(10)], { since: '1.9' })
use('drop_and_swap_keys', 'open', { yaw: 270, pitch: 0 }, hands({ 0: item('cobblestone', 8), 40: item('torch', 4) }),
  [press(DROP, 1), ticks(10), press(SWAP, 1), ticks(10), press(DROP, 1), ticks(10)], { since: '1.9' })
// Use with nothing to use and nothing in reach: nothing is sent.
use('empty_hand_air', 'open', { yaw: 270, pitch: -30 }, hands({}), [hold(USE), ticks(12), release(USE), ticks(5), look(270, 0), ticks(2)])

export default out

registerAreas(areas)
