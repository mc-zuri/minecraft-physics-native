// Ported from physics-data-generator catalog/src/cases/mouse-clicks-extra.mjs; maintained here now.
// More mouse clicks (see mouse-clicks.mjs): the middle click (pick block / pick entity, in survival from the hotbar or
// the main inventory, in creative), clicks while paddling a boat (the hands are busy: no attack, no use), clicks on a
// block outside the world border, and the spear's charged stab. Recorded on their own: --filter "m_click2_*".
//
// Same lanes as mouse-clicks.mjs: the player at x=0.5 facing +x (yaw 270), the station block at x=2, y=1 (pitch 30
// looks at it). Each case waits first: from 26.3 the client ignores keys until it reports the lane loaded.
// Holding Ctrl (pick with block data) is not scripted: the recorder has no modifier keys.
import './_areas/index.ts'
import { ATTACK, F, HOTBAR, USE, command, commandBy, crosshair, hold, kase, look, press, release, server, ticks } from '../../dsl/physrec.ts'
import { FEATURE_LANES as L } from './_areas/java-areas.ts'
import type { KaseSpec, PhysrecItem, PhysrecSetup } from '../../dsl/physrec.ts'

// The middle click: the vanilla pick-item key (adapters with Bridge.supportsPickItem; the others skip the case).
const PICK = 'pickItem'
const item = (id: string, count = 1): PhysrecItem => ({ id, count, enchantments: {} })
const lane = (z: number, extra: Partial<KaseSpec> = {}): KaseSpec => ({ area: 'features', at: [0.5, 0, z + 0.5], yaw: 270, pitch: 0, features: true, serverMoves: true, tier: 3, verify: 1, ...extra })
const inventory = (slots: Readonly<Record<number, PhysrecItem>>, selected = 0): Pick<PhysrecSetup, 'inventory' | 'selected'> => ({ inventory: slots, selected })
const start = () => ticks(40)
const wait = (n = 5) => ticks(n)
const tags = (...more: string[]): string[] => ['features', 'click', ...more]
const cow = { entity: 'cow', at: [2.5, 0, L.mob + 0.5], yaw: 90 }
// The border's +x edge 1 block past the player (local x=1.5): the player stands inside, the station (x=2) is outside.
// Relative to the player, as the area's world position varies; reset to the default afterwards.
const borderCenter = commandBy({ '1.13': 'execute as @p at @s run worldborder center ~-4 ~', '1.8': 'execute @p ~ ~ ~ worldborder center ~-4 ~' })
const borderReset = () => server(command('worldborder set 59999968'), command('worldborder center 0 0'))

export default [
  // Stone in hotbar slot 3, slot 0 selected: the pick selects slot 3 (from 1.21.4 the server picks: pick_item_from_block).
  kase('m_click2_pick_hotbar', {
    ...lane(L.stone, { pitch: 30 }),
    setup: inventory({ 3: item('stone', 8) }),
    tags: tags('pick_item'),
  },
    start(),
    crosshair(),
    press(PICK, 1),
    wait(10),
  ),
  // Stone only in main inventory slot 20: swapped into the hotbar (pick_item; before 1.13 MC|PickItem; 1.8: nothing).
  kase('m_click2_pick_inventory', {
    ...lane(L.stone, { pitch: 30 }),
    setup: inventory({ 20: item('stone', 8) }),
    tags: tags('pick_item'),
  },
    start(),
    crosshair(),
    press(PICK, 1),
    wait(10),
  ),
  // Creative with dirt in the selected slot 0: stone goes to the next free hotbar slot (set_creative_slot).
  kase('m_click2_pick_creative', {
    ...lane(L.stone, { pitch: 30 }),
    gamemode: 'creative',
    setup: inventory({ 0: item('dirt', 8) }),
    tags: tags('pick_item', 'creative'),
  },
    start(),
    crosshair(),
    press(PICK, 1),
    wait(10),
  ),
  // Creative pick on a cow: its spawn egg.
  kase('m_click2_pick_entity_creative', {
    ...lane(L.mob, { pitch: 30 }),
    gamemode: 'creative',
    setup: { ...inventory({}), summon: [cow] },
    tags: tags('pick_item', 'creative', 'entities'),
  },
    start(),
    crosshair(),
    press(PICK, 1),
    wait(10),
  ),
  // In a boat on the lane's floor (pitch 25 from the seat looks at the station), paddling forward: use does nothing
  // (handsBusy, from the second tick after forward goes down). A pressed attack on the station still starts digging:
  // startAttack is blocked, but the held key's continueAttack is not. A pressed attack at the sky does nothing. Once
  // forward is released, a use places the torch on the station.
  kase('m_click2_boat_paddle', {
    ...lane(L.stone, { pitch: 25 }),
    since: '1.9',
    setup: { ...inventory({ 0: item('torch', 8) }), mount: { entity: 'oak_boat', yaw: 270 } },
    tags: tags('attack', 'use_item_on', 'vehicle', 'boat'),
  },
    start(),
    crosshair(),
    hold(F),
    ticks(2),
    press(ATTACK, 1),
    press(USE, 1),
    look(270, -60),
    press(ATTACK, 1),
    look(270, 25),
    release(F),
    wait(6),
    crosshair(),
    press(USE, 1),
    wait(10),
  ),
  // The station just outside the world border, the player inside: use with a snowball, then attack (a swing, no dig).
  kase('m_click2_border_use', {
    ...lane(L.stone, { pitch: 30 }),
    setup: inventory({ 0: item('snowball', 4) }),
    tags: tags('use_item_on', 'attack', 'world_border'),
  },
    server(borderCenter, command('worldborder set 10')),
    start(),
    crosshair(),
    press(USE, 1),
    wait(10),
    press(ATTACK, 1),
    wait(10),
    borderReset(),
    wait(5),
  ),
  // A spear just selected has no charge: a click does nothing; charged (25 ticks), it stabs; 2 ticks later, nothing.
  kase('m_click2_spear_charge', {
    ...lane(L.open, { pitch: -60 }),
    since: '1.21.11',
    setup: inventory({ 1: item('iron_spear') }),
    tags: tags('attack', 'spear'),
  },
    start(),
    crosshair(),
    press(HOTBAR(2), 1),
    press(ATTACK, 1),
    wait(25),
    press(ATTACK, 1),
    wait(2),
    press(ATTACK, 1),
    wait(10),
  )
]
