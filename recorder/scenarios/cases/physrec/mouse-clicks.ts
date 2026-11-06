// Ported from physics-data-generator catalog/src/cases/mouse-clicks.mjs; maintained here now.
// Mouse clicks: what the vanilla client sends for a right (use) or left (attack) click, by hand, held item and target,
// so a bot's click logic can be checked against it packet for packet: which hands it tries (main, then off hand,
// unless one consumes the click), use_item_on vs use_item vs interact, the swing that goes with each, and what holding
// a button repeats (use every 4 ticks, a creative break every 6, a held attack on nothing or an entity: nothing).
// Recorded on their own: --filter "m_click_*".
//
// Lanes as in mineflayer-features.mjs: the player at x=0.5 facing +x (yaw 270); the station block at x=2, y=1 (pitch
// 30 looks at it). Each case waits first: from 26.3 the client ignores keys until it reports the lane loaded.
// crosshair() records what the click is aimed at.
import './_areas/index.ts'
import { ATTACK, F, SNEAK, SPRINT, USE, closeScreen, commandBy, crosshair, hold, kase, look, press, release, screen, server, setBlock, ticks } from '../../dsl/physrec.ts'
import { FEATURE_LANES as L } from './_areas/java-areas.ts'
import type { KaseSpec, PhysrecItem, PhysrecSetup, PhysrecStep } from '../../dsl/physrec.ts'

const item = (id: string, count = 1): PhysrecItem => ({ id, count, enchantments: {} })
const lane = (z: number, extra: Partial<KaseSpec> = {}): KaseSpec => ({ area: 'features', at: [0.5, 0, z + 0.5], yaw: 270, pitch: 0, features: true, serverMoves: true, tier: 3, verify: 1, ...extra })
const hands = (main: PhysrecItem | null, off?: PhysrecItem): Pick<PhysrecSetup, 'inventory' | 'selected'> => ({ inventory: { ...(main ? { 0: main } : {}), ...(off ? { 40: off } : {}) }, selected: 0 })
const start = () => ticks(40)
const wait = (n = 5) => ticks(n)
const once = (key: string): PhysrecStep[] => [press(key, 1), wait(10)]
const tags = (...more: string[]): string[] => ['features', 'click', ...more]
const torch = item('torch', 8)
const snowball = item('snowball', 4)
const cow = { entity: 'cow', at: [2.5, 0, L.mob + 0.5], yaw: 90 }
/** Beyond a spear's reach to start with (AttackRange 2 - 4.5, 26.3 Item.java:524), and within it for the sprint. */
const spearCow = { entity: 'cow', at: [4.5, 0, L.mob + 0.5], yaw: 90 }

export default [
  // Use on a block with an empty main hand: nothing to do with the main hand, so the off-hand torch is placed.
  kase('m_click_stone_empty_torch', {
    ...lane(L.stone, { pitch: 30 }),
    since: '1.9',
    setup: hands(null, torch),
    tags: tags('use_item_on'),
  },
    start(),
    crosshair(),
    ...once(USE),
  ),
  // A block in the main hand is placed: the off hand is not tried.
  kase('m_click_stone_block_torch', {
    ...lane(L.stone, { pitch: 30 }),
    since: '1.9',
    setup: hands(item('stone', 8), torch),
    tags: tags('use_item_on'),
  },
    start(),
    crosshair(),
    ...once(USE),
  ),
  // A sword does nothing on a block (use_item_on passes, use_item passes): the off-hand torch then.
  kase('m_click_stone_sword_torch', {
    ...lane(L.stone, { pitch: 30 }),
    since: '1.9',
    setup: hands(item('iron_sword'), torch),
    tags: tags('use_item_on', 'use_item'),
  },
    start(),
    crosshair(),
    ...once(USE),
  ),
  // The chest opens with a block in hand: nothing is placed.
  kase('m_click_chest_block_torch', {
    ...lane(L.chest, { pitch: 30 }),
    since: '1.9',
    setup: hands(item('stone', 8), torch),
    tags: tags('use_item_on', 'chest'),
  },
    start(),
    crosshair(),
    press(USE, 1),
    screen('container', 40),
    wait(5),
    closeScreen(),
    screen('none', 20),
    wait(5),
  ),
  // Sneaking skips the chest: the block is placed against it.
  kase('m_click_chest_sneak_block', {
    ...lane(L.chest, { pitch: 30 }),
    setup: hands(item('stone', 8)),
    tags: tags('use_item_on', 'sneak'),
  },
    start(),
    crosshair(),
    hold(SNEAK),
    wait(3),
    press(USE, 1),
    wait(5),
    release(SNEAK),
    wait(5),
  ),
  // A lever on the floor of the open lane takes the click with an empty main hand: the off-hand torch is not placed.
  // Placed by command: its floor state has no 1.8-1.12 property names (metadata 6: on the ground along x).
  kase('m_click_lever_empty_torch', {
    ...lane(L.open, { pitch: 40 }),
    since: '1.9',
    setup: hands(null, torch),
    tags: tags('use_item_on', 'lever'),
  },
    server(commandBy({ '1.13': 'execute as @p at @s run setblock ~1.5 ~ ~ minecraft:lever[face=floor,facing=east]',
      '1.8': 'execute @p ~ ~ ~ setblock ~2 ~ ~ minecraft:lever 6' })),
    start(),
    crosshair(),
    ...once(USE),
  ),
  // An iron door does not open by hand: the click goes on to the off-hand torch.
  kase('m_click_iron_door_empty_torch', {
    ...lane(L.open, { pitch: 30 }),
    since: '1.9',
    setup: hands(null, torch),
    tags: tags('use_item_on', 'door'),
  },
    server(setBlock([2, 1, L.open], 'iron_door[half=lower,facing=east]'), setBlock([2, 2, L.open], 'iron_door[half=upper,facing=east]')),
    start(),
    crosshair(),
    ...once(USE),
  ),
  // Use in the air. Bread with a full food bar cannot be eaten (mortal: newer versions let an invulnerable player eat
  // anyway): the off-hand snowball is thrown.
  kase('m_click_air_full_food_snowball', {
    ...lane(L.open, { pitch: -60 }),
    since: '1.9',
    mortal: true,
    setup: { ...hands(item('bread', 4), snowball), food: 20 },
    tags: tags('use_item'),
  },
    start(),
    crosshair(),
    ...once(USE),
  ),
  // A bow without arrows fails: the off-hand snowball is thrown.
  kase('m_click_air_bow_no_arrows_snowball', {
    ...lane(L.open, { pitch: -60 }),
    since: '1.9',
    setup: hands(item('bow'), snowball),
    tags: tags('use_item'),
  },
    start(),
    crosshair(),
    ...once(USE),
  ),
  // A snowball in the main hand is thrown: the off hand is not tried.
  kase('m_click_air_snowball_snowball', {
    ...lane(L.open, { pitch: -60 }),
    since: '1.9',
    setup: hands(snowball, item('snowball', 4)),
    tags: tags('use_item'),
  },
    start(),
    crosshair(),
    ...once(USE),
  ),
  // Use on a cow with empty hands (interact_at and interact for each hand), then held: repeated every 4 ticks.
  kase('m_click_cow_empty', {
    ...lane(L.mob, { pitch: 30 }),
    setup: { ...hands(null), summon: [cow] },
    tags: tags('use_entity', 'entities'),
  },
    start(),
    crosshair(),
    press(USE, 1),
    wait(10),
    hold(USE),
    ticks(9),
    release(USE),
    wait(5),
  ),
  // Attack at nothing: one miss swing per click; held, nothing more.
  kase('m_click_attack_air', {
    ...lane(L.open, { pitch: -60 }),
    setup: hands(null),
    tags: tags('attack'),
  },
    start(),
    crosshair(),
    press(ATTACK, 1),
    wait(5),
    hold(ATTACK),
    ticks(10),
    release(ATTACK),
    wait(5),
  ),
  // Creative: a held attack breaks a block at once, then the next one every 6 ticks (with a swing each tick).
  kase('m_click_creative_break_hold', {
    ...lane(L.dirt, { pitch: 30 }),
    gamemode: 'creative',
    setup: hands(null),
    tags: tags('attack', 'digging', 'creative'),
  },
    start(),
    crosshair(),
    hold(ATTACK),
    ticks(15),
    release(ATTACK),
    wait(5),
  ),
  // A held use places a block every 4 ticks, each on the one before.
  kase('m_click_place_hold', {
    ...lane(L.open, { pitch: 60 }),
    setup: hands(item('dirt', 32)),
    tags: tags('use_item_on', 'place'),
  },
    start(),
    crosshair(),
    hold(USE),
    ticks(20),
    release(USE),
    wait(5),
  ),
  // A copper golem statue takes an empty-handed click (it changes its pose): the off-hand torch is not placed.
  kase('m_click_copper_golem_statue', {
    ...lane(L.open, { pitch: 30 }),
    since: '1.21.9',
    setup: hands(null, torch),
    tags: tags('use_item_on', 'copper_golem_statue'),
  },
    server(setBlock([2, 1, L.open], 'copper_golem_statue')),
    start(),
    crosshair(),
    ...once(USE),
  ),
  // Spectator: use on a block, then in the air.
  kase('m_click_spectator_use', {
    ...lane(L.stone, { pitch: 30 }),
    gamemode: 'spectator',
    setup: { ...hands(item('stone', 8)), flying: true },
    tags: tags('use_item_on', 'use_item', 'spectator'),
  },
    start(),
    crosshair(),
    ...once(USE),
    look(270, -60),
    wait(3),
    crosshair(),
    ...once(USE),
  ),
  // Attack a cow once, then hold attack: a held attack hits no entity again.
  kase('m_click_cow_attack_hold', {
    ...lane(L.mob, { pitch: 30 }),
    setup: { ...hands(null), summon: [cow] },
    tags: tags('attack', 'entities'),
  },
    start(),
    crosshair(),
    press(ATTACK, 1),
    wait(5),
    hold(ATTACK),
    ticks(10),
    release(ATTACK),
    wait(5),
  ),
  // A spear's stab: the client only says so (STAB, 26.3 MultiPlayerGameMode.java:513-516); the server's Player.stabAttack
  // recoils its own copy of the player and ends its sprint (26.3 Player.java:1117, 1.21.11 :1174). Spears come in 1.21.11.
  kase('m_click_spear_stab_cow', {
    ...lane(L.mob, { pitch: 12, since: '1.21.11' }),
    setup: { ...hands(item('iron_spear')), summon: [spearCow] },
    tags: tags('attack', 'entities', 'spear'),
  },
    start(),
    crosshair(),
    press(ATTACK, 1),
    wait(10),
  ),
  kase('m_click_spear_stab_cow_sprinting', {
    ...lane(L.mob, { pitch: 12, since: '1.21.11' }),
    setup: { ...hands(item('iron_spear')), summon: [spearCow] },
    tags: tags('attack', 'entities', 'spear'),
  },
    start(),
    hold(F, SPRINT),
    ticks(4),
    crosshair(),
    press(ATTACK, 1),
    ticks(4),
    release(F, SPRINT),
    wait(10),
  )
]
