// Ported from physics-data-generator catalog/src/coverage/use-entity.mjs; maintained here now.
// Right clicks on entities, as the vanilla client sends them (use_entity / interact: INTERACT_AT, then INTERACT, the
// swing, the off hand when the main hand's use passes) and as the server answers them: shears and dye on a sheep, a
// name tag on a mob, a bucket on a fish and an axolotl, a bucket on a goat, a bowl on a mooshroom, a saddle on a tamed
// horse and on a strider, a lead tied to a fence, an item frame (an item put in, turned, knocked out) and an armor
// stand (a helmet put on and taken off), standing and sneaking where sneaking changes the click.
//
// The mobs are summoned without AI by setup commands, 2 blocks ahead of the player (+x): by the version's entity name
// (Sheep, MushroomCow, EntityHorse before 1.11) and its execute syntax (execute <entity> <x y z> before 1.13). The item
// frame and the armor stand are placed by the player first, with their items: every version has them that way.
// Lanes along z, 6 apart; the player at x=0.5 facing +x. The pool: the fish and the axolotl in water, the player on a
// stone pier a block under the water's top.
import '../_areas/index.ts'
import { registerAreas, ATTACK, SNEAK, crosshair, hold, kase, press, release, ticks } from '../../../dsl/physrec.ts'
import { EYE, EYE_CROUCH, aim, area, at1, feature, fill, hands, item, lookAt, slot, start, useOnce } from './_lib.ts'
import type { PhysrecItem, Pos } from '../../../dsl/physrec.ts'

interface MobCase {
  readonly name: string
  readonly mob: string
  readonly y: number
  readonly hands: Readonly<Record<number, PhysrecItem>>
  readonly since?: string
  readonly until?: string
  readonly nbt?: string
  readonly sneak?: boolean
}

// name, the mob, how high to aim above its feet, since (the mob or the item), the hands, extra NBT for the mob
const MOBS: readonly MobCase[] = [
  { name: 'sheep_shears', mob: 'sheep', y: 0.65, hands: { 0: item('shears') }, sneak: true },
  { name: 'sheep_dye', mob: 'sheep', y: 0.65, hands: { 0: item('blue_dye', 2) }, since: '1.14' },
  // (before 1.14 the blue dye is lapis lazuli, dye:4 before 1.13)
  { name: 'sheep_dye_legacy', mob: 'sheep', y: 0.65, hands: { 0: item('lapis_lazuli', 2) }, until: '1.14' },
  { name: 'name_tag_cow', mob: 'cow', y: 0.7, hands: { 0: item('name_tag') } },
  { name: 'goat_bucket', mob: 'goat', y: 0.65, hands: { 0: item('bucket') }, since: '1.17' },
  { name: 'mooshroom_bowl', mob: 'mooshroom', y: 0.7, hands: { 0: item('bowl', 2) } },
  { name: 'horse_saddle', mob: 'horse', y: 0.8, hands: { 0: item('saddle') }, nbt: 'Tame:1b', sneak: true },
  { name: 'strider_saddle', mob: 'strider', y: 0.85, hands: { 0: item('saddle') }, since: '1.16' }
]
const POOL_MOBS: readonly MobCase[] = [
  { name: 'cod_bucket', mob: 'cod', y: 0.15, hands: { 0: item('water_bucket') }, since: '1.13' },
  { name: 'axolotl_bucket', mob: 'axolotl', y: 0.2, hands: { 0: item('water_bucket') }, since: '1.17' }
]
// the entity names before 1.11 (EntityList), and before 1.13 the horse's variant by its Type
const LEGACY_IDS: Readonly<Record<string, string>> = { sheep: 'Sheep', cow: 'Cow', mooshroom: 'MushroomCow', horse: 'EntityHorse' }

const STEP = 6
const LANES = MOBS.length + 3
const laneOf = (i: number): number => -Math.floor(LANES * STEP / 2) + i * STEP
const FENCE = MOBS.length
const FRAME = MOBS.length + 1
const STAND = MOBS.length + 2

export const areas = [
  area('cov_use_entity', [-6, 10, laneOf(0) - 4, laneOf(LANES - 1) + 4],
    // the fence the lead is tied to, the block the item frame hangs on
    at1(2, 1, laneOf(FENCE), 'oak_fence'),
    at1(3, 1, laneOf(FRAME), 'stone'), at1(3, 2, laneOf(FRAME), 'stone')),
  area('cov_use_entity_pool', [-6, 10, -10, 10],
    fill([-5, -3, -9], [9, 0, 9], 'water'),
    fill([-5, -3, -9], [1, -1, 9], 'stone'))
]

// The mob ahead of the player (2 blocks along +x), without AI, by the version's name and syntax.
const summonAhead = (mob: string, nbt = ''): Record<string, string | null> => {
  const tags = `{NoAI:1b${nbt ? `,${nbt}` : ''}}`
  const legacyTags = mob === 'horse' ? `{NoAI:1b${nbt ? `,${nbt}` : ''},Type:0}` : tags
  const pos = '~2 ~ ~'
  return {
    '1.13': `execute as @p at @s run summon minecraft:${mob} ${pos} ${tags}`,
    '1.11': `execute @p ~ ~ ~ summon ${mob === 'horse' ? 'horse' : mob} ${pos} ${tags}`,
    '1.8': LEGACY_IDS[mob] ? `execute @p ~ ~ ~ summon ${LEGACY_IDS[mob]} ${pos} ${legacyTags}` : null
  }
}

const out = []
const mobCase = (m: MobCase, sneak: boolean, area: string, at: Pos): void => {
  const z = at[2]
  const target = [2.5, 1 + at[1] + m.y, z]
  const eye = sneak ? EYE_CROUCH : EYE
  out.push(kase(`m_c_use_entity_${m.name}${sneak ? '_sneak' : ''}`, {
    ...feature(),
    area,
    at,
    ...aim(at, target),
    tags: ['coverage', 'use_entity', m.mob, ...(sneak ? ['sneak'] : [])],
    ...(m.since ? { since: m.since } : {}),
    ...(m.until ? { until: m.until } : {}),
    setup: { ...hands(m.hands), commands: [summonAhead(m.mob, m.nbt)] },
  },
    start(),
    sneak ? [hold(SNEAK), ticks(5)] : [],
    lookAt(at, target, eye),
    ticks(2),
    crosshair(),
    // the use, then again (sheared, dyed, saddled, a bucket full: what the mob answers the second time), then the empty
    // hand
    useOnce(),
    useOnce(),
    slot(8),
    ticks(2),
    useOnce(),
    sneak ? [release(SNEAK), ticks(5)] : [],
  ))
}

MOBS.forEach((m, i) => {
  const at = [0.5, 0, laneOf(i) + 0.5]
  mobCase(m, false, 'cov_use_entity', at)
  if (m.sneak) mobCase(m, true, 'cov_use_entity', at)
})
// In the pool: the player on the pier, in a block of water over it, the mob in the water ahead at its feet' level.
POOL_MOBS.forEach((m, i) => mobCase(m, false, 'cov_use_entity_pool', [0.5, -1, -6 + i * 6 + 0.5]))

// A cow on a lead (a click with the lead), then the fence it is tied to (LeadItem.useOn: the leashed mobs near the
// player go to the fence), then the knot (it comes off).
{
  const z = laneOf(FENCE) + 0.5
  const at = [0.5, 0, z]
  const fence = [2.5, 1.9, z]
  out.push(kase('m_c_use_entity_lead_fence', {
    ...feature(),
    area: 'cov_use_entity',
    at,
    ...aim(at, fence),
    tags: ['coverage', 'use_entity', 'lead', 'fence'],
    setup: {
      ...hands({ 0: item('lead', 2) }),
      // the cow beside the fence's lane, 2 blocks to the side
      commands: [{
        '1.13': 'execute as @p at @s run summon minecraft:cow ~2 ~ ~2 {NoAI:1b}',
        '1.11': 'execute @p ~ ~ ~ summon cow ~2 ~ ~2 {NoAI:1b}',
        '1.8': 'execute @p ~ ~ ~ summon Cow ~2 ~ ~2 {NoAI:1b}'
      }]
    },
  },
    start(),
    lookAt(at, [2.5, 1.7, z + 2]),
    ticks(2),
    crosshair(),
    useOnce(),
    lookAt(at, fence),
    ticks(2),
    crosshair(),
    useOnce(),
    // the knot, as it hangs on the fence
    lookAt(at, [2.5, 1.55, z]),
    ticks(2),
    crosshair(),
    slot(8),
    ticks(2),
    useOnce(10),
  ))
}

// An item frame put on the block ahead (its west face), a stick put in, turned once, knocked out; sneaking: the same
// (the frame is an entity: sneaking does not skip it).
for (const sneak of [false, true]) {
  const z = laneOf(FRAME) + 0.5
  const at = [0.5, 0, z]
  const face = [3, 2.5, z]
  out.push(kase(`m_c_use_entity_item_frame${sneak ? '_sneak' : ''}`, {
    ...feature(),
    area: 'cov_use_entity',
    at,
    ...aim(at, face),
    tags: ['coverage', 'use_entity', 'item_frame', ...(sneak ? ['sneak'] : [])],
    setup: hands({ 0: item('item_frame'), 1: item('stick', 2) }),
  },
    start(),
    sneak ? [hold(SNEAK), ticks(5)] : [],
    lookAt(at, face, sneak ? EYE_CROUCH : EYE),
    ticks(2),
    crosshair(),
    useOnce(10),
    crosshair(),
    slot(1),
    ticks(2),
    useOnce(),
    useOnce(),
    press(ATTACK, 1),
    ticks(10),
    sneak ? [release(SNEAK), ticks(5)] : [],
  ))
}

// An armor stand put on the floor ahead, an iron helmet put on it, then taken off with the empty hand (at its head).
for (const sneak of [false, true]) {
  const z = laneOf(STAND) + 0.5
  const at = [0.5, 0, z]
  const floor = [2.5, 1, z]
  const eye = sneak ? EYE_CROUCH : EYE
  out.push(kase(`m_c_use_entity_armor_stand${sneak ? '_sneak' : ''}`, {
    ...feature(),
    area: 'cov_use_entity',
    at,
    ...aim(at, floor),
    tags: ['coverage', 'use_entity', 'armor_stand', ...(sneak ? ['sneak'] : [])],
    setup: hands({ 0: item('armor_stand'), 1: item('iron_helmet') }),
  },
    start(),
    sneak ? [hold(SNEAK), ticks(5)] : [],
    lookAt(at, floor, eye),
    ticks(2),
    crosshair(),
    useOnce(10),
    lookAt(at, [2.5, 2.3, z], eye),
    ticks(2),
    crosshair(),
    slot(1),
    ticks(2),
    useOnce(),
    lookAt(at, [2.5, 2.7, z], eye),
    ticks(2),
    crosshair(),
    slot(8),
    ticks(2),
    useOnce(),
    sneak ? [release(SNEAK), ticks(5)] : [],
  ))
}

export default out

registerAreas(areas)
