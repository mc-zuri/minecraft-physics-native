// What moves on its own without a brain: primed TNT, falling blocks, dropped items and experience orbs. The player stands
// away from them unless the case is about it. The replay (recorder/replay/moving-entities.ts) runs each entity through the
// engine's tick from the server's state and compares it with the next server tick; these cases give it every branch of those
// ticks: the fall and the landing, water and lava, a current, friction, a slime block, a cobweb, being stuck in a block, the end
// of a fuse, a fall or an age, and an orb's pull.
import './_areas/index.ts'
import { type KaseSpec, type PhysrecAction, type Pos, command, commandBy, kase, server, setBlock, summon, ticks } from '../../dsl/physrec.ts'
import { MOVERS, PISTON_SURFACES, laneZ } from './_areas/java-areas.ts'

const spec = (area: string, at: Pos, entity: string, place: Pos, nbt: string, extra: Partial<KaseSpec> = {}): KaseSpec =>
  ({ area, at, yaw: 0, tier: 3, tags: ['moving_entity', entity], setup: { summon: [{ entity, at: place, nbt }] }, ...extra })

const motion = (x: number, y: number, z: number) => `Motion:[${x}d,${y}d,${z}d]`
const nbt = (...tags: string[]) => `{${tags.join(',')}}`
const tnt = (fuse: number, ...tags: string[]) => nbt(`Fuse:${fuse}s`, `fuse:${fuse}s`, ...tags)
const itemOf = (id: string, ...tags: string[]) => nbt(`Item:{id:"minecraft:${id}",Count:1b,count:1}`, ...tags)
const stone = (...tags: string[]) => itemOf('stone', ...tags)
const orb = (...tags: string[]) => nbt('Value:3s', ...tags)
// (from the second tick: a first tick before 1.18.2 takes the block out of the world, and there is none)
const carried = (block: string, ...tags: string[]) => nbt(`BlockState:{Name:"minecraft:${block}"}`, `Block:"minecraft:${block}"`, 'Time:1', ...tags)

// (within 16 blocks, which the client's view of them keeps, and out of an orb's 8)
const away: Pos = [-8.5, 0, 0.5]
const beside: Pos = [-3.5, 0, 7.5]
const offPool: Pos = [14.5, 1, -4.5]
const offLava: Pos = [-8.5, 0, 0.5]
const offFlow: Pos = [5.5, 0, 10.5]
const offPillar: Pos = [-7.5, 0, -7.5]
const lane = (name: keyof typeof MOVERS, x: number, y = 0): Pos => [x + 0.5, y, MOVERS[name] + 0.5]
const besideLane = (name: keyof typeof MOVERS): Pos => [-9.5, 0, MOVERS[name] + 0.5]

// (a monster cannot be on peaceful, which the recorder keeps: the difficulty is its for the case)
const HOSTILE = ['guardian', 'ghast', 'phantom', 'vex', 'blaze', 'drowned', 'spider', 'wither', 'slime', 'magma_cube', 'breeze', 'creeper']
const mob = (name: string, area: string, at: Pos, entity: string, place: Pos, since?: string, summoned = '', first: readonly PhysrecAction[] = [], length = 100) =>
  kase(name, { area, at, yaw: 0, tier: 3, tags: ['moving_entity', entity], ...(since ? { since } : {}) },
    ...(HOSTILE.includes(entity) ? [server(command('difficulty easy'))] : []),
    ticks(1), server(...first, summon(entity, place, { noAi: false, ...(summoned ? { nbt: summoned } : {}) })), ticks(length),
    ...(HOSTILE.includes(entity) ? [server(command('difficulty peaceful'))] : []))
const griefing = (on: boolean) => commandBy({ '1.21.11': `gamerule minecraft:mob_griefing ${on}`, '1.8': `gamerule mobGriefing ${on}` })
const web: Pos = [MOVERS.web + 0.5, 2.5, 7.5]
// (from 1.9 a phase of the dragon's by its id: 0 circles, 2 goes to land, 4 takes off, 5 sits, 10 hovers; none of them in 1.8, where it flies)
const dragon = (name: string, phase: number, first: readonly PhysrecAction[] = [], length = 200, place: Pos = [2.5, 12, 0.5], after: readonly PhysrecAction[] = [], since?: string) =>
  kase(name, { area: 'flat', at: [-20.5, 0, 0.5], yaw: 0, tier: 3, tags: ['moving_entity', 'ender_dragon'], ...(since ? { since } : {}) },
    ticks(1), server(...first, summon('ender_dragon', place, { noAi: false, nbt: `{DragonPhase:${phase}}` })), ticks(length),
    ...(after.length ? [server(...after)] : []))

const out = [
  // ---- TNT ----
  kase('me_tnt_falls_and_fuses', spec('movers', away, 'tnt', [2.5, 6, 0.5], tnt(50, motion(0.08, 0.2, 0.03))), ticks(60)),
  kase('me_tnt_on_ice', spec('movers', besideLane('ice'), 'tnt', lane('ice', 2, 0.5), tnt(70, motion(0.4, 0, 0))), ticks(80)),
  kase('me_tnt_on_slime', spec('movers', besideLane('slime'), 'tnt', lane('slime', 2, 4), tnt(60)), ticks(70)),
  kase('me_tnt_in_water', spec('water', offPool, 'tnt', [0.5, 3, 0.5], tnt(70)), ticks(80)),
  kase('me_tnt_in_lava', spec('lava', offLava, 'tnt', [6.5, 3, 0.5], tnt(70)), ticks(80)),
  kase('me_tnt_in_current', spec('flow', offFlow, 'tnt', [-3.5, 0.2, 0.5], tnt(70)), ticks(80)),
  kase('me_tnt_no_gravity', spec('movers', away, 'tnt', [2.5, 4, 0.5], tnt(30, 'NoGravity:1b', motion(0.1, 0, 0)), { since: '1.10' }), ticks(40)),

  // ---- Falling blocks ----
  kase('me_falling_sand_from_a_block', { area: 'movers', at: away, yaw: 0, tier: 3, tags: ['moving_entity', 'falling_block'] },
    ticks(3), server(setBlock([2, 8, 0], 'sand')), ticks(45)),
  kase('me_falling_gravel_lands_on_slime', { area: 'movers', at: besideLane('slime'), yaw: 0, tier: 3, tags: ['moving_entity', 'falling_block'] },
    ticks(3), server(setBlock([2, 7, MOVERS.slime], 'gravel')), ticks(45)),
  kase('me_falling_summoned_moving', spec('movers', away, 'falling_block', [2.5, 7, 0.5], carried('sand', motion(0.15, 0.1, 0.05))), ticks(50)),
  kase('me_falling_into_water', spec('water', offPool, 'falling_block', [0.5, 4, 0.5], carried('sand')), ticks(60)),
  kase('me_falling_concrete_stops_in_water', spec('water', offPool, 'falling_block', [0.5, 4, 0.5], carried('white_concrete_powder'), { since: '1.13' }), ticks(40)),
  kase('me_falling_onto_a_fence', spec('movers', away, 'falling_block', [MOVERS.fence + 0.5, 6, 7.5], carried('sand')), ticks(50)),
  kase('me_falling_through_cobweb', spec('movers', beside, 'falling_block', [MOVERS.web + 0.5, 6, 7.5], carried('sand')), ticks(120)),
  kase('me_falling_expires', spec('movers', away, 'falling_block', [2.5, 6, 0.5], nbt('BlockState:{Name:"minecraft:sand"}', 'Block:"minecraft:sand"', 'Time:596', 'DropItem:0b', 'NoGravity:1b'), { since: '1.10' }), ticks(10)),

  // ---- Items ----
  kase('me_item_falls_and_rests', spec('movers', away, 'item', [2.5, 4, 0.5], stone(motion(0.1, 0.2, 0.05))), ticks(80)),
  kase('me_item_slides_on_ice', spec('movers', besideLane('ice'), 'item', lane('ice', 2, 0.1), stone(motion(0.5, 0, 0))), ticks(100)),
  kase('me_item_slows_on_soul_sand', spec('movers', besideLane('soulSand'), 'item', lane('soulSand', 2, 0.5), stone(motion(0.3, 0, 0))), ticks(50)),
  kase('me_item_bounces_on_slime', spec('movers', besideLane('slime'), 'item', lane('slime', 2, 4), stone()), ticks(60)),
  kase('me_item_floats_in_water', spec('water', offPool, 'item', [0.5, 2, 0.5], stone()), ticks(120)),
  kase('me_item_in_current', spec('flow', offFlow, 'item', [-3.5, 0.2, 0.5], stone()), ticks(100)),
  kase('me_item_burns_in_lava', spec('lava', offLava, 'item', [6.5, 2, 0.5], stone()), ticks(40)),
  kase('me_item_floats_in_lava', spec('lava', offLava, 'item', [6.5, 2, 0.5], itemOf('netherite_ingot'), { since: '1.16' }), ticks(120)),
  // (summoned in the body: until 1.11 the client draws for it too, and what it draws in the setup does not repeat)
  kase('me_item_stuck_in_a_block', { area: 'pushout', at: offPillar, yaw: 0, tier: 3, tags: ['moving_entity', 'item'] },
    ticks(2), server(summon('item', [0.5, 1, 0.5], { nbt: stone() })), ticks(50)),
  kase('me_item_in_cobweb', spec('movers', beside, 'item', [MOVERS.web + 0.5, 3.5, 7.5], stone()), ticks(80)),
  kase('me_item_no_gravity', spec('movers', away, 'item', [2.5, 3, 0.5], stone('NoGravity:1b', motion(0.1, 0, 0)), { since: '1.10' }), ticks(40)),
  kase('me_item_despawns', spec('movers', away, 'item', [2.5, 0.1, 0.5], stone('Age:5990s')), ticks(20)),
  kase('me_items_merge', {
    area: 'movers', at: away, yaw: 0, tier: 3, tags: ['moving_entity', 'item'],
    setup: { summon: [{ entity: 'item', at: [2.5, 1, 0.5], nbt: stone() }, { entity: 'item', at: [2.8, 1, 0.5], nbt: stone() }] },
  }, ticks(60)),
  kase('me_item_picked_up', spec('movers', [2.5, 0, 0.5], 'item', [2.5, 1, 1.1], stone('PickupDelay:10s')), ticks(40)),

  // ---- Orbs ----
  kase('me_orb_falls_and_rests', spec('movers', away, 'experience_orb', [2.5, 4, 0.5], orb(motion(0.1, 0.2, 0.05))), ticks(80)),
  kase('me_orb_slides_on_ice', spec('movers', besideLane('ice'), 'experience_orb', lane('ice', 2, 0.1), orb(motion(0.5, 0, 0))), ticks(80)),
  kase('me_orb_bounces_on_slime', spec('movers', besideLane('slime'), 'experience_orb', lane('slime', 2, 4), orb()), ticks(60)),
  kase('me_orb_drawn_to_the_player', spec('movers', [2.5, 0, 0.5], 'experience_orb', [8.5, 1, 0.5], orb(), { setup: { summon: [{ entity: 'experience_orb', at: [8.5, 1, 0.5], nbt: orb() }], effects: [{ id: 'blindness' }] } }), ticks(60)),
  kase('me_orb_out_of_reach', spec('movers', [2.5, 0, 0.5], 'experience_orb', [12.5, 1, 0.5], orb(motion(-0.4, 0.1, 0))), ticks(60)),
  kase('me_orb_floats_in_water', spec('water', offPool, 'experience_orb', [0.5, 2, 0.5], orb()), ticks(120)),
  kase('me_orb_in_lava', spec('lava', offLava, 'experience_orb', [6.5, 2, 0.5], orb()), ticks(40)),
  kase('me_orb_stuck_in_a_block', { area: 'pushout', at: offPillar, yaw: 0, tier: 3, tags: ['moving_entity', 'experience_orb'] },
    ticks(2), server(summon('experience_orb', [0.5, 1, 0.5], { nbt: orb() })), ticks(40)),
  // ---- Mobs with a travel of their own: their AI runs, and the replay takes what it leaves ----
  mob('me_mob_squid_swims', 'water', offPool, 'squid', [0.5, -1.5, 0.5]),
  mob('me_mob_squid_on_land', 'movers', away, 'squid', [2.5, 1, 0.5]),
  mob('me_mob_cod_swims', 'water', offPool, 'cod', [0.5, -1.5, 0.5], '1.13'),
  mob('me_mob_cod_flops_on_land', 'movers', away, 'cod', [2.5, 1, 0.5], '1.13'),
  mob('me_mob_guardian_swims', 'water', offPool, 'guardian', [0.5, -1.5, 0.5]),
  mob('me_mob_guardian_on_land', 'movers', away, 'guardian', [2.5, 1, 0.5]),
  mob('me_mob_ghast_floats', 'flat', [-20.5, 0, 0.5], 'ghast', [2.5, 6, 0.5]),
  mob('me_mob_ghast_in_water', 'water', offPool, 'ghast', [0.5, -2, 0.5]),
  mob('me_mob_phantom_circles', 'flat', [-8.5, 0, 0.5], 'phantom', [2.5, 8, 0.5], '1.13'),
  mob('me_mob_allay_flies', 'movers', away, 'allay', [2.5, 3, 0.5], '1.19'),
  mob('me_mob_vex_flies', 'movers', away, 'vex', [2.5, 2, 0.5], '1.11'),
  // ---- Mobs with nothing of a travel of their own but a rule of LivingEntity's, and those that swim their own way ----
  // (a cow: a zombie burns by day, and what it draws for that no seed reaches before 1.14)
  mob('me_mob_blaze_falls_and_hovers', 'movers', away, 'blaze', [2.5, 6, 0.5]),
  mob('me_mob_bat_flutters', 'movers', away, 'bat', [2.5, 4, 0.5]),
  mob('me_mob_bee_flies', 'movers', away, 'bee', [2.5, 2, 0.5], '1.15'),
  mob('me_mob_bee_on_the_ground', 'movers', away, 'bee', [2.5, 0, 0.5], '1.15', '{Motion:[0.1d,0.3d,0d]}'),
  mob('me_mob_parrot_flies', 'movers', away, 'parrot', [2.5, 2, 0.5], '1.12'),
  mob('me_mob_cow_steps_up', 'movers', away, 'cow', [2.5, 0, 0.5], undefined, '{Motion:[0.4d,0d,0d]}', [setBlock([4, 0, 0], 'oak_slab[type=bottom]'), setBlock([4, 0, 1], 'oak_slab[type=bottom]')]),
  mob('me_mob_cow_falls', 'movers', away, 'cow', [2.5, 7, 0.5]),
  mob('me_mob_cow_in_water', 'water', offPool, 'cow', [0.5, -1.5, 0.5]),
  mob('me_mob_cow_on_ice', 'movers', [-9.5, 0, -19.5], 'cow', [2.5, 1, -19.5], undefined, '{Motion:[0.3d,0d,0d]}'),
  mob('me_mob_cow_on_slime', 'movers', [-9.5, 0, -14.5], 'cow', [2.5, 3, -14.5], undefined, '{Motion:[0.2d,0d,0d]}'),
  mob('me_mob_cow_in_cobweb', 'movers', beside, 'cow', web),
  mob('me_mob_spider_through_cobweb', 'movers', beside, 'spider', web),
  mob('me_mob_spider_climbs', 'movers', away, 'spider', [2.7, 0, 0.5], undefined, '{Motion:[0.3d,0d,0d]}', [0, 1, 2, 3].flatMap(y => [setBlock([4, y, 0], 'stone'), setBlock([4, y, 1], 'stone'), setBlock([4, y, -1], 'stone')])),
  mob('me_mob_wither_through_cobweb', 'movers', beside, 'wither', web),
  // powder snow by kind (B159): no equipment lets either walk on it, and a blaze's freezing is its own
  mob('me_mob_cow_in_powder_snow', 'powderSnowField', [0.5, 0, -6.5], 'cow', [0.5, 7, 0.5], '1.17'),
  mob('me_mob_blaze_in_powder_snow', 'powderSnowField', [0.5, 0, -6.5], 'blaze', [0.5, 7, 0.5], '1.17'),
  mob('me_mob_vex_in_cobweb', 'movers', beside, 'vex', web, '1.11'),
  mob('me_mob_polar_bear_swims', 'water', offPool, 'polar_bear', [0.5, -1.5, 0.5], '1.10'),
  mob('me_mob_dolphin_swims', 'water', offPool, 'dolphin', [0.5, -1.5, 0.5], '1.13'),
  mob('me_mob_dolphin_on_land', 'movers', away, 'dolphin', [2.5, 1, 0.5], '1.13'),
  mob('me_mob_turtle_swims', 'water', offPool, 'turtle', [0.5, -1.5, 0.5], '1.13'),
  mob('me_mob_axolotl_swims', 'water', offPool, 'axolotl', [0.5, -1.5, 0.5], '1.17'),
  mob('me_mob_frog_swims', 'water', offPool, 'frog', [0.5, -1.5, 0.5], '1.19'),
  mob('me_mob_drowned_swims', 'water', offPool, 'drowned', [0.5, -1.5, 0.5], '1.13'),
  // (a target in the water is what it swims for)
  mob('me_mob_drowned_hunts', 'water', offPool, 'drowned', [0.5, -1.5, 0.5], '1.13', '', [summon('villager', [4.5, -1.5, 0.5])], 160),
  mob('me_mob_cod_in_a_bubble_column', 'bubbleUpColumn', [-3.5, 0, 0.5], 'cod', [5.5, -6, 0.5], '1.13'),
  mob('me_mob_cow_in_a_bubble_column', 'bubbleDownColumn', [-3.5, 0, 0.5], 'cow', [5.5, -2, 0.5], '1.13'),
  mob('me_mob_cod_in_a_current', 'flow', offFlow, 'cod', [-3.5, 0.2, 0.5], '1.13'),
  mob('me_mob_squid_in_a_current', 'flow', offFlow, 'squid', [-3.5, 0.2, 0.5]),
  mob('me_mob_bat_in_lava', 'lava', offLava, 'bat', [6.5, 0.2, 0.5]),
  mob('me_mob_tadpole_swims', 'water', offPool, 'tadpole', [0.5, -1.5, 0.5], '1.19'),
  // (no travel of their own: the jump, the flutter or the hop is their AI's, and comes in as motion)
  mob('me_mob_chicken_flutters', 'movers', away, 'chicken', [2.5, 6, 0.5]),
  mob('me_mob_slime_hops', 'movers', away, 'slime', [2.5, 1, 0.5]),
  mob('me_mob_magma_cube_in_lava', 'lava', offLava, 'magma_cube', [6.5, 0.2, 0.5]),
  mob('me_mob_breeze_hops', 'movers', away, 'breeze', [2.5, 1, 0.5], '1.20.5'),
  mob('me_mob_iron_golem_stands', 'movers', away, 'iron_golem', [2.5, 3, 0.5]),
  mob('me_mob_rabbit_hops', 'movers', away, 'rabbit', [2.5, 1, 0.5]),
  mob('me_mob_creeper_in_water', 'water', offPool, 'creeper', [0.5, -1.5, 0.5]),
  kase('me_mob_cow_levitates', { area: 'movers', at: away, yaw: 0, tier: 3, tags: ['moving_entity', 'cow'], since: '1.9' },
    ticks(1), server(summon('cow', [2.5, 0, 0.5], { noAi: false })), ticks(2),
    server(commandBy({ '1.13': 'effect give @e[type=cow] minecraft:levitation 3 1', '1.9': 'effect @e[type=cow] levitation 3 1' })), ticks(80)),
  kase('me_mob_cow_falls_slowly', { area: 'movers', at: away, yaw: 0, tier: 3, tags: ['moving_entity', 'cow'], since: '1.13' },
    ticks(1), server(summon('cow', [2.5, 8, 0.5], { noAi: false })), ticks(1),
    server(command('effect give @e[type=cow] minecraft:slow_falling 10 0')), ticks(80)),
  kase('me_mob_cow_of_light_gravity', { area: 'movers', at: away, yaw: 0, tier: 3, tags: ['moving_entity', 'cow'], since: '1.20.5' },
    ticks(1), server(summon('cow', [2.5, 8, 0.5], { noAi: false })), ticks(1),
    server(commandBy({ '1.21.2': 'attribute @e[type=cow,limit=1] minecraft:gravity base set 0.02', '1.20.5': 'attribute @e[type=cow,limit=1] minecraft:generic.gravity base set 0.02' })), ticks(80)),
  kase('me_mob_cow_of_water_efficiency', { area: 'water', at: offPool, yaw: 0, tier: 3, tags: ['moving_entity', 'cow'], since: '1.21' },
    ticks(1), server(summon('cow', [0.5, -1.5, 0.5], { noAi: false })), ticks(1),
    server(commandBy({ '1.21.2': 'attribute @e[type=cow,limit=1] minecraft:water_movement_efficiency base set 1', '1.21': 'attribute @e[type=cow,limit=1] minecraft:generic.water_movement_efficiency base set 1' })), ticks(80)),
  mob('me_mob_armor_stand_falls', 'movers', away, 'armor_stand', [2.5, 5, 0.5]),
  mob('me_mob_armor_stand_without_gravity', 'movers', away, 'armor_stand', [2.5, 5, 0.5], undefined, '{NoGravity:1b,Motion:[0.1d,0d,0d]}'),
  mob('me_mob_strider_in_lava', 'lava', offLava, 'strider', [6.5, 2, 0.5], '1.16'),
  mob('me_mob_skeleton_horse_swims', 'water', offPool, 'skeleton_horse', [0.5, -1.5, 0.5]),
  mob('me_mob_sulfur_cube_swims', 'water', offPool, 'sulfur_cube', [0.5, -1.5, 0.5], '26.3'),
  // ---- The dragon: the flight of each kind of phase, a wall, its wings ----
  // (a hover from 1.14: before it its target is where it is, the climb is 0 / 0, and the dragon leaves the world at NaN)
  dragon('me_dragon_hovers', 10, [], 200, [2.5, 12, 0.5], [], '1.14'),
  dragon('me_dragon_circles', 0),
  dragon('me_dragon_goes_to_land', 2),
  dragon('me_dragon_takes_off', 4),
  dragon('me_dragon_sits', 5, [], 120),
  dragon('me_dragon_in_a_wall', 0, [griefing(false), ...[10, 11, 12, 13, 14].flatMap(y => [1, 2, 3, 4].flatMap(x => [setBlock([x, y, 0], 'stone'), setBlock([x, y, 1], 'stone'), setBlock([x, y, -1], 'stone')]))], 80, [2.5, 12, 0.5], [griefing(true)]),
  kase('me_dragon_wings_throw_a_mob', { area: 'flat', at: [-20.5, 0, 0.5], yaw: 0, tier: 3, tags: ['moving_entity', 'ender_dragon'] },
    ticks(1), server(griefing(false), summon('villager', [6.5, 0, 0.5]), summon('villager', [-1.5, 0, 0.5]), summon('ender_dragon', [2.5, 2, 0.5], { noAi: false, nbt: '{DragonPhase:5}' })), ticks(40), server(griefing(true))),

  kase('me_orb_despawns', spec('movers', away, 'experience_orb', [2.5, 0.1, 0.5], orb('Age:5990s')), ticks(20)),
]

// A piston against what is not a player (B088, B163): the replay's server side pushes them, and the client's follows.
const pistonAt = (z: number): PhysrecAction => setBlock([-2, 1, z], 'redstone_block')
const onPiston = (entity: string, place: Pos, z: number, tag: string, data: string, requires: string) =>
  kase(`me_${tag}`, { area: 'pistonSurfaces', at: [-6.5, 0, z + 2.5], yaw: 270, tier: 3, tags: ['moving_entity', 'piston', entity], requires: [requires], setup: { summon: [{ entity, at: place, nbt: data }] } },
    ticks(3), server(pistonAt(z)), ticks(35))
const slimeLane = laneZ(PISTON_SURFACES.indexOf('slime_east'))
const honeyLane = laneZ(PISTON_SURFACES.indexOf('honey_east'))
out.push(
  onPiston('item', [1.5, 0, slimeLane + 0.5], slimeLane, 'item_thrown_by_slime_piston', stone('PickupDelay:32767s', 'Age:-32768s'), 'slime_block'),
  onPiston('item', [0.5, 1, honeyLane + 0.5], honeyLane, 'item_carried_by_honey_piston', stone('PickupDelay:32767s', 'Age:-32768s'), 'honey_block'),
  onPiston('tnt', [1.5, 0, slimeLane + 0.5], slimeLane, 'tnt_thrown_by_slime_piston', tnt(30), 'slime_block'),
  onPiston('tnt', [0.5, 1, honeyLane + 0.5], honeyLane, 'tnt_carried_by_honey_piston', tnt(30), 'honey_block'),
  onPiston('item', [1.5, 0, honeyLane + 0.5], honeyLane, 'item_pushed_by_honey_piston', stone('PickupDelay:32767s', 'Age:-32768s'), 'honey_block'),
)

export default out
