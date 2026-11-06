// Ported from physics-data-generator catalog/src/coverage/dig.mjs; maintained here now.
// Digging as the 26.3 client does it (MultiPlayerGameMode.startDestroyBlock / continueDestroyBlock / stopDestroyBlock):
// START, progress each tick by the tool, the effects, the water and the ground, STOP when it breaks, then 5 ticks
// before the next; a new target (or a new held item) ABORTs the old one first; a new face of the same block sends
// CHANGE_DESTROY_DIRECTION (26.x); a released key ABORTs; a teleport stops it. A swing (punch) every digging tick.
// Mineflayer's bot.dig times all of this itself; these show where its timing or packets differ.
//
// Lanes along z, 4 apart; the player at x=0.5 facing +x; the block(s) at x=2.., y=1.
import '../_areas/index.ts'
import { registerAreas, ATTACK, F, JUMP, USE, commandBy, effect, hold, kase, look, press, release, releaseAll, server, ticks } from '../../../dsl/physrec.ts'
import { aim, area, at1, fill, feature, hands, item, start } from './_lib.ts'
import { crosshair } from '../../../dsl/physrec.ts'
import type { KaseSpec, PhysrecStep, PhysrecSteps } from '../../../dsl/physrec.ts'

const LANES = ['dirt', 'stone', 'log', 'row', 'stack', 'wall', 'creative_row', 'gravel']
const Z = Object.fromEntries(LANES.map((n, i) => [n, -16 + i * 4]))

export const areas = [
  area('cov_dig', [-6, 10, -20, 18],
    at1(2, 1, Z.dirt, 'dirt'),
    at1(2, 1, Z.stone, 'stone'),
    at1(2, 1, Z.log, 'oak_log[axis=y]'),
    fill([2, 1, Z.row], [4, 1, Z.row], 'dirt'),
    fill([2, 1, Z.stack], [2, 2, Z.stack], 'dirt'),
    at1(3, 1, Z.wall, 'dirt'),
    fill([2, 1, Z.creative_row], [4, 1, Z.creative_row], 'stone'),
    // gravel on gravel: the upper one falls into the gap when the lower breaks
    fill([2, 1, Z.gravel], [2, 2, Z.gravel], 'gravel'))
]

const PICK = item('iron_pickaxe')
const AXE = item('iron_axe')
const out = []
const dig = (name: string, lane: string, steps: PhysrecSteps, extra: Partial<KaseSpec> = {}): void => {
  const at = [0.5, 0, Z[lane] + 0.5]
  const { yaw, pitch } = aim(at, [2.5, 1.5, Z[lane] + 0.5])
  out.push(kase(`m_c_dig_${name}`, {
    ...feature(),
    area: 'cov_dig',
    at,
    yaw,
    pitch,
    tags: ['coverage', 'digging'],
    setup: hands({}),
    ...extra,
  },
    start(),
    crosshair(),
    steps,
  ))
}
const holdFor = (n: number): PhysrecStep[] => [hold(ATTACK), ticks(n), release(ATTACK), ticks(10)]

dig('dirt_hand', 'dirt', holdFor(30))
dig('stone_iron_pickaxe', 'stone', holdFor(20), { setup: hands({ 0: PICK }) })
dig('log_iron_axe', 'log', holdFor(20), { setup: hands({ 0: AXE }) })
dig('log_hand', 'log', holdFor(70))
// Released halfway: ABORT, and the progress starts over on the next press.
dig('stone_hand_abort_restart', 'stone', [hold(ATTACK), ticks(20), release(ATTACK), ticks(5), ...holdFor(15)])
// The held item changes mid-dig (hotbar key): the client ABORTs and starts again with the new tool.
dig('switch_tool_mid_dig', 'stone', [hold(ATTACK), ticks(10), press('hotbar2', 1), ticks(25), release(ATTACK), ticks(10)],
  { setup: hands({ 1: PICK }) })
// Held across a row: each block breaks, 5 ticks pass, the next one behind it starts (pitch 15 reaches all three).
dig('row_held', 'row', [look(270, 15), ticks(2), ...holdFor(90)])
// The crosshair moves to another block mid-dig: ABORT the first, START the second.
dig('switch_target', 'stack', [hold(ATTACK), ticks(8), look(270, 0), ticks(30), release(ATTACK), ticks(10)])
// The same block from another face (front, then top): CHANGE_DESTROY_DIRECTION.
dig('change_face', 'stone', [look(270, 35), ticks(2), hold(ATTACK), ticks(15), look(270, 18), ticks(15), release(ATTACK), ticks(10)])
// Walking into the block while digging it: once it breaks the player walks on.
dig('walk_into', 'wall', [hold(F, ATTACK), ticks(50), releaseAll(), ticks(10)])
// Jumping while digging: in the air the progress is 5 times slower.
dig('jumping', 'dirt', [hold(ATTACK, JUMP), ticks(60), releaseAll(), ticks(10)])
dig('haste_2', 'dirt', holdFor(20), { setup: { ...hands({}), effects: [effect('haste', 1)] } })
dig('mining_fatigue', 'dirt', holdFor(80), { setup: { ...hands({}), effects: [effect('mining_fatigue', 0)] } })
// A teleport mid-dig stops it (ClientPacketListener.handleMovePlayer -> stopDestroyBlock).
dig('teleport_mid_dig', 'stone', [hold(ATTACK), ticks(10), server(commandBy({ '1.13': 'execute as @p at @s run tp @s ~ ~ ~', '1.8': 'tp @p ~ ~ ~' })), ticks(20), release(ATTACK), ticks(10)])
// Use is not tried while digging; after the release it is (the off-hand torch is placed).
dig('use_while_digging', 'stone', [hold(ATTACK), ticks(10), press(USE, 1), ticks(10), release(ATTACK), ticks(5), press(USE, 1), ticks(10)],
  { setup: hands({ 0: PICK, 40: item('torch', 4) }) })
// Gravel falls into the gap left by the one under it (a falling block entity, then a block again).
dig('gravel_falls', 'gravel', [...holdFor(20), ticks(30)], { setup: hands({ 0: item('iron_shovel') }) })
// Creative: every block breaks at once, the next after 5 ticks.
dig('creative_row', 'creative_row', [look(270, 15), ticks(2), ...holdFor(30)], { gamemode: 'creative' })

// Under water (5 times slower without aqua affinity), in the pool of mounts.mjs: dirt on its floor.
out.push(kase('m_c_dig_underwater', {
  ...feature(),
  area: 'cov_dig_pool',
  at: [0.5, 0, 0.5],
  tags: ['coverage', 'digging', 'water'],
  setup: hands({}),
  ...aim([0.5, 0, 0.5], [2.5, 1.5, 0.5]),
},
  start(),
  crosshair(),
  holdFor(100),
))
areas.push(area('cov_dig_pool', [-6, 8, -4, 4],
  fill([-6, 1, -4], [8, 4, -4], 'stone'), fill([-6, 1, 4], [8, 4, 4], 'stone'),
  fill([-6, 1, -3], [-6, 4, 3], 'stone'), fill([8, 1, -3], [8, 4, 3], 'stone'),
  fill([-5, 1, -3], [7, 4, 3], 'water'), at1(2, 1, 0, 'dirt')))

export default out

registerAreas(areas)
