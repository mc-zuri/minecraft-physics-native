// Ported from physics-data-generator catalog/src/coverage/mount-click.mjs; maintained here now.
// Getting on by right click, as a player (and a bot's mount()) does: interact with the entity, the server seats the
// player (set_passengers), then riding packets; sneak gets off. Each mount stands without AI until the click (so it
// waits where it was put), then gets its AI back so the ridden ones can be steered. Also: putting a saddle on a pig
// and a harness on a happy ghast with a click, and sneak-clicking a tamed donkey (its inventory, not a ride).
import '../_areas/index.ts'
import { registerAreas, F, SNEAK, USE, commandBy, crosshair, hold, kase, press, release, server, ticks } from '../../../dsl/physrec.ts'
import { aim, area, feature, hands, item, start, useOnce } from './_lib.ts'
import type { PhysrecStep } from '../../../dsl/physrec.ts'

// entity, how high to aim (its middle), how far ahead it stands (the ghast is 4 wide), since, ready (tamed, saddled).
const MOUNTS = [
  { entity: 'horse', y: 0.8 },
  { entity: 'donkey', y: 0.75, chested: true },
  { entity: 'mule', y: 0.8 },
  { entity: 'skeleton_horse', y: 0.8 },
  { entity: 'zombie_horse', y: 0.8 },
  { entity: 'llama', y: 0.9, since: '1.11' },
  { entity: 'camel', y: 1.1, since: '1.20' },
  { entity: 'pig', y: 0.45, hold: item('carrot_on_a_stick') },
  { entity: 'strider', y: 0.85, since: '1.16', hold: item('warped_fungus_on_a_stick') },
  { entity: 'happy_ghast', y: 2, ahead: 4, since: '1.21.6', equipment: { body: 'white_harness' } },
  { entity: 'oak_boat', y: 0.3, plain: true },
  { entity: 'oak_chest_boat', y: 0.3, plain: true, since: '1.19' },
  { entity: 'minecart', y: 0.35, plain: true },
  { entity: 'cushion', y: 0.12, plain: true, since: '26.3' }
]
const STEP = 8
const laneOf = (i: number): number => -Math.floor(MOUNTS.length * STEP / 2) + i * STEP

export const areas = [area('cov_mount_click', [-6, 14, laneOf(0) - 6, laneOf(MOUNTS.length - 1) + 6])]

// Its AI back after the click, as the version's commands say it: entitydata and the old entity ids before 1.13 (horses
// of every kind were EntityHorse before 1.11).
const OLD_IDS: Readonly<Record<string, string>> = { horse: 'EntityHorse', donkey: 'EntityHorse', mule: 'EntityHorse', skeleton_horse: 'EntityHorse', zombie_horse: 'EntityHorse', pig: 'Pig' }
const ai = (entity: string): PhysrecStep => server(commandBy({
  '1.13': `execute as @p at @s run data merge entity @e[type=${entity},sort=nearest,limit=1] {NoAI:0b}`,
  '1.11': `entitydata @e[type=${entity},c=1] {NoAI:0b}`,
  '1.8': OLD_IDS[entity] ? `entitydata @e[type=${OLD_IDS[entity]},c=1] {NoAI:0b}` : null
}))
const out = []
MOUNTS.forEach((m, i) => {
  const z = laneOf(i) + 0.5
  const at = [0.5, 0, z]
  const x = 2.5 + (m.ahead ?? 0)
  const summon = { entity: m.entity, at: [x, 0, z], yaw: 90, noAi: true, ...(m.plain ? {} : { ready: true }),
    ...(m.equipment ? { equipment: m.equipment } : {}), ...(m.chested ? { chested: true } : {}) }
  const base = { ...feature(), area: 'cov_mount_click', at, ...aim(at, [x, 1 + m.y, z]), ...(m.since ? { since: m.since } : {}),
    tags: ['coverage', 'vehicle', 'use_entity', m.entity], setup: { ...hands({ 0: m.hold }), summon: [summon] } }
  out.push(kase(`m_c_mount_click_${m.entity}`, base,
    start(),
    crosshair(),
    press(USE, 1),
    ticks(5),
    m.plain ? [] : ai(m.entity),
    ticks(3),
    press(F, 30),
    ticks(10),
    press(SNEAK, 2),
    ticks(20),
  ))
})

// A saddle on an unsaddled pig, then (empty hand) on it; a harness on a happy ghast, then on it.
const at = [0.5, 0, laneOf(0) + 0.5]
const pig = { entity: 'pig', at: [2.5, 0, laneOf(0) + 0.5], yaw: 90, noAi: true }
out.push(kase('m_c_mount_click_pig_saddle_then_ride', {
  ...feature(),
  area: 'cov_mount_click',
  at,
  ...aim(at, [2.5, 1.45, laneOf(0) + 0.5]),
  tags: ['coverage', 'vehicle', 'use_entity', 'pig'],
  setup: { ...hands({ 0: item('saddle') }), summon: [{ ...pig, at: [2.5, 0, laneOf(0) + 0.5] }] },
},
  start(),
  crosshair(),
  press(USE, 1),
  ticks(10),
  press(USE, 1),
  ticks(10),
  press(SNEAK, 2),
  ticks(20),
))
const ghastAt = [0.5, 0, laneOf(9) + 0.5]
out.push(kase('m_c_mount_click_ghast_harness_then_ride', {
  ...feature(),
  area: 'cov_mount_click',
  at: ghastAt,
  ...aim(ghastAt, [6.5, 3, laneOf(9) + 0.5]),
  since: '1.21.6',
  tags: ['coverage', 'vehicle', 'use_entity', 'happy_ghast'],
  setup: { ...hands({ 0: item('white_harness') }), summon: [{ entity: 'happy_ghast', at: [6.5, 0, laneOf(9) + 0.5], yaw: 90, noAi: true }] },
},
  start(),
  crosshair(),
  press(USE, 1),
  ticks(10),
  press(USE, 1),
  ticks(5),
  ai('happy_ghast'),
  ticks(3),
  press(F, 30),
  ticks(10),
  press(SNEAK, 2),
  ticks(20),
))
// Sneak + use on a tamed, chested donkey opens its inventory instead of riding it.
const donkeyAt = [0.5, 0, laneOf(1) + 0.5]
out.push(kase('m_c_mount_click_donkey_sneak_inventory', {
  ...feature(),
  area: 'cov_mount_click',
  at: donkeyAt,
  ...aim(donkeyAt, [2.5, 1.75, laneOf(1) + 0.5], 1.27),
  tags: ['coverage', 'vehicle', 'use_entity', 'container', 'donkey'],
  setup: { ...hands({}), summon: [{ entity: 'donkey', at: [2.5, 0, laneOf(1) + 0.5], yaw: 90, noAi: true, ready: true, chested: true }] },
},
  start(),
  hold(SNEAK),
  ticks(5),
  crosshair(),
  useOnce(10),
  release(SNEAK),
  ticks(5),
))

export default out

registerAreas(areas)
