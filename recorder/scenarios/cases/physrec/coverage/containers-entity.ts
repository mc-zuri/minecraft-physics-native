// Ported from physics-data-generator catalog/src/coverage/containers-entity.mjs; maintained here now.
// Containers that are entities: mount inventories opened with the inventory key while riding (horse, donkey, mule,
// llama, camel, nautilus: ClientboundMountScreenOpenPacket, not a menu type), chest boats (the inventory key while
// riding, sneak + use from outside), chest and hopper minecarts (use), the furnace minecart (use with coal pushes it)
// and the wandering trader (merchant). Each opens, clicks a slot (pick up and put back), and closes.
import '../_areas/index.ts'
import { registerAreas, F, INVENTORY, SNEAK, click, closeScreen, crosshair, hold, kase, press, release, screen, ticks } from '../../../dsl/physrec.ts'
import { aim, area, feature, fill, hands, item, start, useOnce } from './_lib.ts'
import { USE } from '../../../dsl/physrec.ts'

export const areas = [
  area('cov_containers', [-6, 14, -24, 24]),
  area('cov_containers_pool', [-8, 16, -8, 8], fill([-7, -3, -7], [15, 0, 7], 'water'))
]

const out = []
const openClose = () => [screen('container', 40), ticks(5), click(0, 0, 'PICKUP'), ticks(3), click(0, 0, 'PICKUP'), ticks(3),
  closeScreen(), screen('none', 20), ticks(5)]
const HORSE_STATS = { movement_speed: 0.2, jump_strength: 0.6 }

// Riding, then the inventory key.
const riding = [
  { entity: 'horse' }, { entity: 'donkey', chested: true }, { entity: 'mule', chested: true },
  // the llama's AI off (it would walk off on its own, at random): the inventory key is the case
  { entity: 'llama', chested: true, since: '1.11', noAi: true }, { entity: 'camel', since: '1.20' }
]
for (const m of riding) {
  out.push(kase(`m_c_open_${m.entity}_riding`, {
    ...feature(),
    area: 'cov_containers',
    at: [0.5, 0, 0.5],
    yaw: 270,
    settle: false,
    ...(m.since ? { since: m.since } : {}),
    tags: ['coverage', 'container', 'vehicle', m.entity],
    setup: { ...hands({ 0: item('cobblestone', 8) }), mount: { entity: m.entity, yaw: 270, ...(m.chested ? { chested: true } : {}), ...(m.noAi ? { noAi: true } : {}), attributes: m.entity === 'camel' ? {} : HORSE_STATS } },
  },
    start(),
    press(INVENTORY, 1),
    openClose(),
    press(F, 10),
    ticks(10),
  ))
}
out.push(kase('m_c_open_nautilus_riding', {
  ...feature(),
  area: 'cov_containers_pool',
  at: [0.5, -2, 0.5],
  yaw: 270,
  settle: false,
  since: '1.21.11',
  tags: ['coverage', 'container', 'vehicle', 'nautilus'],
  setup: { ...hands({}), mount: { entity: 'nautilus', yaw: 270 } },
},
  start(),
  press(INVENTORY, 1),
  openClose(),
))
out.push(kase('m_c_open_chest_boat_riding', {
  ...feature(),
  area: 'cov_containers_pool',
  at: [0.5, 0, 0.5],
  yaw: 270,
  since: '1.19',
  tags: ['coverage', 'container', 'vehicle', 'boat'],
  setup: { ...hands({ 0: item('cobblestone', 8) }), mount: { entity: 'oak_chest_boat', yaw: 270 } },
},
  start(),
  press(INVENTORY, 1),
  openClose(),
  press(F, 20),
  ticks(10),
))

// From the ground: aimed at the entity, use (sneak + use for the chest boat).
const ground = [
  { name: 'chest_minecart', entity: 'chest_minecart', y: 0.35 },
  { name: 'hopper_minecart', entity: 'hopper_minecart', y: 0.35 },
  { name: 'chest_boat_sneak', entity: 'oak_chest_boat', y: 0.3, sneak: true, since: '1.19' },
  { name: 'wandering_trader', entity: 'wandering_trader', y: 1.4, since: '1.14', screen: 'merchant' }
]
ground.forEach((g, i) => {
  const z = -20 + i * 6 + 0.5
  const at = [0.5, 0, z]
  out.push(kase(`m_c_open_${g.name}`, {
    ...feature(),
    area: 'cov_containers',
    at,
    ...aim(at, [2.5, 1 + g.y, z], g.sneak ? 1.27 : 1.62),
    ...(g.since ? { since: g.since } : {}),
    tags: ['coverage', 'container', 'use_entity', g.entity],
    setup: { ...hands({ 0: item('cobblestone', 8) }), summon: [{ entity: g.entity, at: [2.5, 0, z], yaw: 90, noAi: true }] },
  },
    start(),
    g.sneak ? [hold(SNEAK), ticks(5)] : [],
    crosshair(),
    press(USE, 1),
    g.screen ? [screen(g.screen, 40), ticks(5), closeScreen(), screen('none', 20), ticks(5)] : openClose(),
    g.sneak ? release(SNEAK) : [],
    ticks(5),
  ))
})
// The furnace minecart takes coal on use and starts pushing.
out.push(kase('m_c_use_furnace_minecart_coal', {
  ...feature(),
  area: 'cov_containers',
  at: [0.5, 0, 12.5],
  ...aim([0.5, 0, 12.5], [2.5, 1.35, 12.5]),
  tags: ['coverage', 'use_entity', 'furnace_minecart'],
  setup: { ...hands({ 0: item('coal', 4) }), summon: [{ entity: 'furnace_minecart', at: [2.5, 0, 12.5], yaw: 90, noAi: true }] },
},
  start(),
  crosshair(),
  useOnce(20),
))

export default out

registerAreas(areas)
