// Ported from physics-data-generator catalog/src/cases/java-equipment.mjs; maintained here now.
// Enchantments and items that change movement: Depth Strider, Soul Speed, Swift Sneak, Frost Walker, Riptide, and the
// slowdown while using an item (eating, shield, bow, crossbow, spyglass, trident charge).
import './_areas/index.ts'
import { type KaseSpec, type PhysrecItem, type PhysrecSetup, type PhysrecStep, F, JUMP, SNEAK, SPRINT, USE, commandBy, hold, kase, press, releaseAll, server, setBlock, stable, stopped, ticks, until } from '../../dsl/physrec.ts'
import { SURFACES, laneZ } from './_areas/java-areas.ts'

const item = (id: string, enchantments: Readonly<Record<string, number>> = {}): PhysrecItem => ({ id, enchantments })
const out = []
const pool = { area: 'water', rest: [-8.5, 0, 0.5], yaw: 270, tier: 2 }

// Proof: the swim slows on the tick the boots go, the enchantment read from what is worn and not kept. From 1.21 it is a
// modifier of WATER_MOVEMENT_EFFICIENCY, which the server sends and takes back.
out.push(kase('q_depth_strider_boots_off_mid_swim', {
  ...pool,
  at: [0.5, -3, 0.5],
  setup: { equipment: { feet: item('diamond_boots', { depth_strider: 3 }) } },
  since: '1.13',
  tags: ['enchant', 'depth_strider', 'water', 'equipment'],
},
  hold(F),
  ticks(15),
  server(commandBy({ '1.17': 'item replace entity @p armor.feet with air', '1.13': 'replaceitem entity @p armor.feet air' })),
  ticks(25),
  releaseAll(),
  stable(5),
))

for (const level of [1, 2, 3]) {
  const setup = { equipment: { feet: item('diamond_boots', { depth_strider: level }) } }
  out.push(
    kase(`q_depth_strider_${level}_walk_bottom`, {
      ...pool,
      at: [0.5, -3, 0.5],
      setup,
      tags: ['enchant', 'depth_strider', 'water'],
    },
      press(F, 40),
      stable(5),
    ),
    kase(`q_depth_strider_${level}_swim_surface`, {
      ...pool,
      at: [0.5, -0.5, 0.5],
      setup,
      tags: ['enchant', 'depth_strider', 'water'],
    },
      press(F, 40),
      stable(5),
    ),
    kase(`q_depth_strider_${level}_sprint_swim`, {
      ...pool,
      at: [0.5, -2, 0.5],
      setup,
      tags: ['enchant', 'depth_strider', 'water'],
    },
      press([F, SPRINT], 40),
      stable(5),
    ),
    kase(`q_depth_strider_${level}_jump_bottom`, {
      ...pool,
      at: [0.5, -3, 0.5],
      setup,
      tags: ['enchant', 'depth_strider', 'water'],
    },
      hold(F),
      press(JUMP, 1),
      ticks(30),
      releaseAll(),
      stable(5),
    )
  )
}
for (const level of [1, 3]) {
  const setup = { equipment: { feet: item('diamond_boots', { soul_speed: level }) } }
  for (const block of ['soul_sand', 'soul_soil']) {
    const at = [0.5, 0, laneZ(SURFACES.indexOf(block)) + 0.5]
    out.push(
      kase(`q_soul_speed_${level}_walk_${block}`, {
        area: 'surfaces',
        requires: [block],
        at,
        yaw: 270,
        setup,
        tier: 2,
        tags: ['enchant', 'soul_speed'],
      },
        press(F, 30),
        stopped(3),
      ),
      kase(`q_soul_speed_${level}_sprint_${block}`, {
        area: 'surfaces',
        requires: [block],
        at,
        yaw: 270,
        setup,
        tier: 2,
        tags: ['enchant', 'soul_speed'],
      },
        press([F, SPRINT], 30),
        stopped(3),
      )
    )
  }
}
for (const level of [1, 2, 3]) {
  const setup = { equipment: { legs: item('diamond_leggings', { swift_sneak: level }) } }
  out.push(kase(`q_swift_sneak_${level}`, {
    area: 'flat',
    at: [0.5, 0, 0.5],
    setup,
    tier: 2,
    tags: ['enchant', 'swift_sneak'],
  },
    press([F, SNEAK], 30),
    stopped(3),
  ))
  out.push(kase(`q_swift_sneak_${level}_edge`, {
    area: 'ledges',
    at: [0.5, 1, 0.5],
    yaw: 270,
    setup,
    tier: 2,
    tags: ['enchant', 'swift_sneak', 'edge'],
  },
    press([F, SNEAK], 40),
    ticks(5),
  ))
}
// Frost Walker freezes the water ahead; the block changes are part of the recording.
for (const level of [1, 2]) {
  const setup = { equipment: { feet: item('diamond_boots', { frost_walker: level }) } }
  // Starts 5.5 blocks from the water: Frost Walker (radius 2 + level) must not freeze anything while settling.
  out.push(kase(`q_frost_walker_${level}`, {
    area: 'water',
    at: [-15.5, 0, 0.5],
    yaw: 270,
    setup,
    tier: 2,
    tags: ['enchant', 'frost_walker'],
    // (one melt step at the case's far end, behind the player, comes or does not: the cause is not known yet)
    serverTimed: 'when frosted ice melts',
    serverTimedUntil: '1.13',
  },
    press(F, 80),
    stopped(3),
  ))
}

const HORSE = { entity: 'horse', attributes: { movement_speed: 0.2, jump_strength: 0.6, step_height: 1.0 } }

// Using an item: the input is scaled down while it is in use, and sprinting stops.
const use = (n: string, id: string, extra: PhysrecSetup = {}): KaseSpec => ({ area: 'flat', at: [0.5, 0, 0.5], tier: 2, tags: ['item_use', n], setup: { equipment: { mainhand: item(id) }, food: 10, ...extra } })
out.push(
  kase('q_eat_walk', use('eat', 'bread'),
    hold(USE),
    ticks(5),
    press(F, 25),
    releaseAll(),
    stopped(3),
  ),
  kase('q_eat_sprint', use('eat', 'bread'),
    hold(F, SPRINT),
    ticks(10),
    hold(USE),
    ticks(20),
    releaseAll(),
    stopped(3),
  ),
  kase('q_eat_until_done', use('eat', 'bread'),
    hold(USE, F),
    ticks(50),
    releaseAll(),
    stopped(3),
  ),
  kase('q_bow_draw_walk', use('bow', 'bow', { equipment: { mainhand: item('bow'), offhand: { id: 'arrow', count: 64, enchantments: {} } } }),
    hold(USE),
    press(F, 30),
    releaseAll(),
    stopped(3),
  ),
  kase('q_bow_draw_sprint_jump', use('bow', 'bow', { equipment: { mainhand: item('bow'), offhand: { id: 'arrow', count: 64, enchantments: {} } } }),
    hold(F, SPRINT, USE),
    ticks(10),
    press(JUMP, 1),
    until('onGround', 40),
    releaseAll(),
    stopped(3),
  ),
  // a passenger's input is not slowed by the item it uses (26.3 LocalPlayer.java:695 isUsingItem() && !isPassenger(); 1.8.9
  // ClientPlayerEntity.tickMovement isUsingItem() && !hasVehicle()): a horse goes on at the seat's speed
  kase('q_eat_riding_horse', { ...use('eat', 'bread'), tier: 3, setup: { equipment: { mainhand: item('bread') }, food: 10, mount: { yaw: 0, ...HORSE } } },
    hold(USE),
    ticks(5),
    press(F, 25),
    releaseAll(),
    stopped(3),
  ),
  kase('q_shield_riding_horse', { ...use('shield', 'shield'), tier: 3, setup: { equipment: { offhand: item('shield') }, mount: { yaw: 0, ...HORSE } } },
    hold(USE),
    press(F, 30),
    releaseAll(),
    stopped(3),
  ),
  // a use whose speed is zero (the use_effects component, 1.21.11: UseEffects.speedMultiplier, LocalPlayer.itemUseSpeedMultiplier)
  kase('q_eat_speed_zero', { ...use('eat', 'bread'), since: '1.21.11', setup: { equipment: { mainhand: item('bread') }, food: 10,
    commands: [{ '1.21.11': 'item replace entity @p weapon.mainhand with minecraft:bread[minecraft:use_effects={speed_multiplier:0.0}]' }] } },
    hold(USE),
    ticks(5),
    press(F, 25),
    releaseAll(),
    stopped(3),
  ),
  kase('q_shield_walk', use('shield', 'shield', { equipment: { offhand: item('shield') } }),
    hold(USE),
    press(F, 30),
    releaseAll(),
    stopped(3),
  ),
  kase('q_shield_sneak', use('shield', 'shield', { equipment: { offhand: item('shield') } }),
    hold(USE),
    press([F, SNEAK], 30),
    releaseAll(),
    stopped(3),
  ),
  kase('q_spyglass_walk', use('spyglass', 'spyglass'),
    hold(USE),
    press(F, 30),
    releaseAll(),
    stopped(3),
  ),
  kase('q_crossbow_load_walk', use('crossbow', 'crossbow', { equipment: { mainhand: item('crossbow'), offhand: { id: 'arrow', count: 64, enchantments: {} } } }),
    hold(USE),
    press(F, 40),
    releaseAll(),
    stopped(3),
  ),
  kase('q_trident_charge_walk', use('trident', 'trident'),
    hold(USE),
    press(F, 30),
    releaseAll(),
    stopped(3),
  ),
  kase('q_use_in_air', use('eat', 'bread'),
    press(JUMP, 1),
    hold(USE, F),
    until('onGround', 40),
    ticks(10),
    releaseAll(),
    stopped(3),
  )
)

// Riptide: charging a Riptide trident in water and letting go launches the player (spin attack pose).
for (const level of [1, 3]) {
  const setup = { equipment: { mainhand: item('trident', { riptide: level }) } }
  out.push(
    kase(`q_riptide_${level}_surface`, {
      area: 'water',
      at: [0.5, 0, 0.5],
      rest: [-8.5, 0, 0.5],
      yaw: 270,
      pitch: -30,
      setup,
      tier: 3,
      tags: ['enchant', 'riptide'],
    },
      press(USE, 15),
      ticks(60),
      stable(5, 200),
    ),
    kase(`q_riptide_${level}_underwater_level`, {
      area: 'water',
      at: [0.5, -2, 0.5],
      rest: [-8.5, 0, 0.5],
      yaw: 270,
      pitch: 0,
      setup,
      tier: 3,
      tags: ['enchant', 'riptide'],
    },
      press(USE, 15),
      ticks(60),
      stable(5, 200),
    )
  )
}
out.push(kase('q_riptide_short_charge', {
  area: 'water',
  at: [0.5, 0, 0.5],
  rest: [-8.5, 0, 0.5],
  yaw: 270,
  pitch: -30,
  setup: { equipment: { mainhand: item('trident', { riptide: 3 }) } },
  tier: 3,
  tags: ['enchant', 'riptide'],
},
  press(USE, 5),
  ticks(30),
))

// Riptide on rain alone (Entity.isInRain, Level.isRainingAt): the sky, the blocks above and the biome decide. The rain level
// passes 0.2 some 20 ticks after the command; the level is left to fall below it again.
const rain = server(commandBy({ '1.13': 'weather rain' }))
const clear = [server(commandBy({ '1.13': 'weather clear' })), ticks(60)]
const biomeAround = (name: string) => server(commandBy({ '1.19.4': `execute at @p run fillbiome ~-6 -64 ~-6 ~6 ~20 ~6 minecraft:${name}` }))
const rainCase = (name: string, extra: Partial<KaseSpec>, ...before: PhysrecStep[]) => kase(`q_rain_${name}`, {
  area: 'flat',
  at: [0.5, 0, 0.5],
  rest: [0.5, 0, 0.5],
  yaw: 270,
  pitch: -30,
  since: '1.13',
  setup: { equipment: { mainhand: item('trident', { riptide: 1 }) } },
  tier: 3,
  tags: ['enchant', 'riptide', 'rain'],
  ...extra,
}, ...before)
const charge = [ticks(40), press(USE, 15), ticks(20)]
out.push(
  rainCase('open', {}, rain, ...charge, ...clear),
  rainCase('roofed', {}, server(setBlock([0, 4, 0], 'stone')), rain, ...charge, ...clear, server(setBlock([0, 4, 0], 'air'))),
  rainCase('clear_sky', {}, ...charge),
  rainCase('snowy_biome', { since: '1.19.4' }, biomeAround('snowy_plains'), rain, ...charge, ...clear, biomeAround('plains')),
  rainCase('desert', { since: '1.19.4' }, biomeAround('desert'), rain, ...charge, ...clear, biomeAround('plains')),
)

export default out
