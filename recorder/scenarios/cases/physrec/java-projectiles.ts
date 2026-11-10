// Projectiles among entities: what they hit, what they pass, and what becomes of them. The server view records every
// projectile with its target boxes, and `node recorder/replay/cli.ts --projectiles` flies the engine's projectile through them.
//
// The range runs along +x from the player at x=-6.5. A summoned arrow starts in a case's body, so that its whole flight
// is recorded; targets stand ready in the setup. Arrows fly at y=1.5 unless a case says otherwise; a block wall stands
// at x=12, and a villager's box is 0.6 wide about its position, so a graze at z=0.5 has the box's edge 0.3 from its centre.
import './_areas/index.ts'
import { type KaseSpec, type PhysrecAction, type PhysrecSetup, type PhysrecSummon, SNEAK, USE, command, commandBy, hold, kase, press, server, setBlock, summon, ticks } from '../../dsl/physrec.ts'

// (a monster is no entity on peaceful)
const range = { area: 'projectileRange', at: [-6.5, 0, 0.5], yaw: 270, tier: 3, difficulty: 'easy' } as const
const fast = '{Motion:[1.5d,0.0d,0.0d]}'
const faster = '{Motion:[3.0d,0.0d,0.0d]}'
const arrow = (x = 0.5, y = 1.5, z = 0.5, nbt = fast): PhysrecAction => summon('arrow', [x, y, z], { nbt })
const among = (entities: readonly PhysrecSummon[], extra: Partial<KaseSpec> = {}, setup: PhysrecSetup = {}): KaseSpec =>
  ({ ...range, tags: ['projectile'], setup: { ...setup, summon: entities.map(e => ({ noAi: true, ...e })) }, ...extra })
// (a villager neither burns by day, as a zombie does, nor needs a difficulty)
const villager = (x: number, z = 0.5, nbt?: string): PhysrecSummon => ({ entity: 'villager', at: [x, 0, z], ...(nbt ? { nbt } : {}) })
const fly = (flight: number, ...shots: PhysrecAction[]) => [ticks(3), server(...shots), ticks(flight)]

// The margin grows with the arrow's age from 1.21.6 (0.3 at its eighth tick): the target stands past that.
const graze = (offset: number) => villager(9.5, 0.5 + 0.3 + offset)

const bow: PhysrecSetup = { equipment: { mainhand: { id: 'bow', count: 1 }, offhand: { id: 'arrow', count: 64 } } }
const trident = (enchantments: Record<string, number> = {}): PhysrecSetup => ({ equipment: { mainhand: { id: 'trident', count: 1, enchantments } } })

const backwards = '{Motion:[-1.5d,0.0d,0.0d]}'
// (`direction` is the motion until 1.15, `power` the push until 1.20.6, `acceleration_power` from 1.21; no blast, whose fires are random)
const fireball = (x: number, push: number) =>
  `{Motion:[${x}d,0.0d,0.0d],direction:[${x}d,0.0d,0.0d],power:[${push}d,0.0d,0.0d],acceleration_power:${Math.abs(push)}d,ExplosionPower:0b}`
const blaze = fireball(1.5, 0)
const blazeBack = fireball(-1.5, 0)
const burning = fireball(0.5, 0.1)
const rocket = '{Motion:[1.0d,0.0d,0.0d],ShotAtAngle:1b,LifeTime:40}'
const thing = (entity: string, nbt = fast, x = 0.5, y = 1.5, z = 0.5): PhysrecAction => summon(entity, [x, y, z], { nbt })
const held = (id: string): PhysrecSetup => ({ equipment: { mainhand: { id, count: 16 } } })
const mortal = { ...range, tags: ['projectile'], mortal: true } as const

const out = [
  kase('pj_arrow_hits_target', among([villager(5.5)]), ...fly(20, arrow())),
  kase('pj_arrow_misses_target', among([villager(5.5, 2.5)]), ...fly(40, arrow())),
  kase('pj_arrow_grazes_margin', among([graze(0.29)]), ...fly(30, arrow())),
  kase('pj_arrow_misses_margin', among([graze(0.31)]), ...fly(30, arrow())),
  kase('pj_arrow_nearest_of_two', among([villager(7.5), villager(4.5)]), ...fly(20, arrow())),
  kase('pj_arrow_tied_targets', among([villager(5.5), villager(5.5)]), ...fly(20, arrow())),
  kase('pj_arrow_entity_behind_block', among([villager(13.5)]), ...fly(30, arrow(8.5))),
  kase('pj_arrow_over_baby', among([villager(5.5, 0.5, '{Age:-24000}')]), ...fly(20, arrow(0.5, 1.2))),
  kase('pj_arrow_into_slab', { ...range, tags: ['projectile'] }, ticks(3), server(setBlock([6, 1, 0], 'oak_slab[type=bottom]')), ...fly(20, arrow(0.5, 0.4, 0.5, faster))),
  kase('pj_arrow_into_fence', { ...range, tags: ['projectile'] }, ticks(3), server(setBlock([6, 1, 0], 'oak_fence')), ...fly(20, arrow(0.5, 0.9, 0.5, faster))),
  kase('pj_arrow_through_torch', { ...range, tags: ['projectile'] }, ticks(3), server(setBlock([6, 1, 0], 'torch')), ...fly(20, arrow(0.5, 0.4, 0.5, faster))),
  kase('pj_arrow_refused_turns_back', among([villager(5.5, 0.5, '{Invulnerable:1b}')]), ...fly(30, arrow())),
  kase('pj_arrow_slow_refused', among([villager(2.5, 0.5, '{Invulnerable:1b}')]), ...fly(30, arrow(0.5, 1.5, 0.5, '{Motion:[0.02d,0.0d,0.0d],NoGravity:1b}'))),
  kase('pj_arrow_enderman', among([{ entity: 'enderman', at: [5.5, 0, 0.5] }]), ...fly(30, arrow())),
  // (the dragon is no target itself: its parts are, and from 1.9 it sits until it is hurt)
  kase('pj_arrow_hits_dragon_body', among([{ entity: 'ender_dragon', at: [6.5, 0, 0.5], noAi: false, nbt: '{DragonPhase:5}' }]), ...fly(20, arrow())),
  kase('pj_arrow_through_dragon_box_past_parts', among([{ entity: 'ender_dragon', at: [6.5, 0, 0.5], noAi: false, nbt: '{DragonPhase:5}' }]), ...fly(20, arrow(0.5, 6.5))),
  kase('pj_arrow_breeze_deflects', among([{ entity: 'breeze', at: [5.5, 0, 0.5] }], { since: '1.20.5' }), ...fly(30, arrow())),
  kase('pj_pierce_through_two', among([villager(3.5), villager(5.5), villager(7.5)], { since: '1.14' }),
    ...fly(20, arrow(0.5, 1.5, 0.5, '{Motion:[1.5d,0.0d,0.0d],PierceLevel:1b}'))),
  kase('pj_pierce_then_wall', among([villager(10.5)], { since: '1.14' }),
    ...fly(20, arrow(3, 1.5, 0.5, '{Motion:[4.6d,0.0d,0.0d],PierceLevel:3b}'))),
  kase('pj_bow_past_owner', among([villager(-1.5)], {}, bow),
    press(USE, 22),
    ticks(30),
  ),
  kase('pj_bow_up_falls_on_owner', { ...range, tags: ['projectile'], pitch: -90, setup: bow },
    press(USE, 8),
    ticks(90),
  ),
  kase('pj_bow_up_from_boat', { ...range, tags: ['projectile'], pitch: -88, setup: { ...bow, mount: { entity: 'oak_boat', at: [-6.5, 0, 0.5] } } },
    press(USE, 8),
    ticks(70),
  ),
  kase('pj_trident_hits_target', among([villager(-2.5)], { since: '1.13' }, trident()),
    press(USE, 12),
    ticks(40),
  ),
  kase('pj_trident_loyalty_from_wall', { ...range, tags: ['projectile'], since: '1.13', at: [8.5, 0, 0.5], setup: trident({ loyalty: 3 }) },
    press(USE, 12),
    ticks(120),
  ),
  kase('pj_trident_loyalty_after_hit', among([villager(-2.5)], { since: '1.13' }, trident({ loyalty: 2 })),
    press(USE, 12),
    ticks(100),
  ),
  kase('pj_trident_without_loyalty_stays', { ...range, tags: ['projectile'], since: '1.13', at: [8.5, 0, 0.5], setup: trident() },
    press(USE, 12),
    ticks(40),
  ),
  // Entity.checkBelowWorld discards it: 64 below the world, whose bottom is 0 before 1.18 and -64 from it
  kase('pj_arrow_falls_out_of_the_world', { ...range, area: 'voidShaft', at: [-3.5, 0, 0.5], tags: ['projectile'] },
    ...fly(90, arrow(3.5, 1.5, 3.5, '{Motion:[0.0d,-4.0d,0.0d]}'))),

  // Thrown items, by hand (the player owns them) or summoned (no owner).
  kase('pj_snowball_hits_target', among([villager(0.5)], {}, held('snowball')), press(USE, 1), ticks(30)),
  kase('pj_snowball_nearest_of_two', among([villager(7.5), villager(4.5)]), ...fly(20, thing('snowball'))),
  kase('pj_snowball_grazes_margin', among([graze(0.29)]), ...fly(30, thing('snowball'))),
  kase('pj_snowball_misses_margin', among([graze(0.31)]), ...fly(30, thing('snowball'))),
  kase('pj_snowball_entity_behind_block', among([villager(13.5)]), ...fly(30, thing('snowball', fast, 8.5))),
  // (a torch stops the outlines of a thrown item until 1.16.1, and nothing later)
  kase('pj_snowball_through_torch', { ...range, tags: ['projectile'] }, ticks(3), server(setBlock([6, 1, 0], 'torch')), ...fly(20, thing('snowball', faster, 0.5, 0.4))),
  // (what stands by the thrower on the first tick is ignored from 1.9 until 1.15: a golem, as a villager would take the click)
  kase('pj_snowball_past_neighbour', among([{ entity: 'iron_golem', at: [-3.5, 0, 0.5] }], {}, held('snowball')), press(USE, 1), ticks(30)),
  kase('pj_snowball_through_water', { ...range, tags: ['projectile'] }, ticks(3), server(setBlock([4, 1, 0], 'water')), ...fly(25, thing('snowball'))),
  kase('pj_snowball_breeze_deflects', among([{ entity: 'breeze', at: [5.5, 0, 0.5] }], { since: '1.21' }), ...fly(30, thing('snowball'))),
  kase('pj_egg_hits_target', among([villager(0.5)], {}, held('egg')), press(USE, 1), ticks(30)),
  kase('pj_egg_into_wall', { ...range, tags: ['projectile'], setup: held('egg'), at: [8.5, 0, 0.5] }, press(USE, 1), ticks(20)),
  kase('pj_ender_pearl_hits_target', among([villager(0.5)], { serverMoves: true }, held('ender_pearl')), press(USE, 1), ticks(30)),
  kase('pj_ender_pearl_summoned_hits_target', among([villager(5.5)]), ...fly(20, thing('ender_pearl'))),
  kase('pj_potion_hits_target', among([villager(0.5)], {}, held('splash_potion')), press(USE, 1), ticks(30)),
  kase('pj_experience_bottle_hits_target', among([villager(0.5)], {}, held('experience_bottle')), press(USE, 1), ticks(30)),

  // Fireballs fly by the motion alone here: `power` of none, the acceleration of none.
  kase('pj_fireball_hits_target', among([villager(5.5)]), ...fly(20, thing('fireball', blaze))),
  kase('pj_fireball_into_wall', { ...range, tags: ['projectile'] }, ...fly(25, thing('fireball', blaze, 5.5))),
  kase('pj_small_fireball_hits_target', among([villager(5.5)]), ...fly(20, thing('small_fireball', blaze))),
  kase('pj_small_fireball_into_wall', { ...range, tags: ['projectile'] }, ...fly(25, thing('small_fireball', blaze, 5.5))),
  kase('pj_small_fireball_accelerates', { ...range, tags: ['projectile'] }, ...fly(25, thing('small_fireball', burning))),
  kase('pj_small_fireball_breeze_deflects', among([{ entity: 'breeze', at: [5.5, 0, 0.5] }], { since: '1.21' }), ...fly(30, thing('small_fireball', burning))),
  kase('pj_wither_skull_hits_target', among([villager(5.5)]), ...fly(20, thing('wither_skull', blaze))),
  kase('pj_dragon_fireball_hits_target', among([villager(5.5)], { since: '1.9' }), ...fly(20, thing('dragon_fireball', blaze))),
  kase('pj_wind_charge_hits_target', among([villager(5.5)], { since: '1.21' }), ...fly(20, thing('wind_charge', fast))),
  kase('pj_wind_charge_into_wall', { ...range, tags: ['projectile'], since: '1.21' }, ...fly(25, thing('wind_charge', fast, 5.5))),
  kase('pj_wind_charge_through_breeze', among([{ entity: 'breeze', at: [5.5, 0, 0.5] }], { since: '1.21' }), ...fly(25, thing('wind_charge', fast))),

  // Llama spit: gone at any hit until 1.13, through whatever it meets from 1.14.
  kase('pj_llama_spit_at_target', among([villager(5.5)], { since: '1.11' }), ...fly(20, thing('llama_spit'))),
  kase('pj_llama_spit_into_wall', { ...range, tags: ['projectile'], since: '1.11' }, ...fly(20, thing('llama_spit'))),

  // A shulker bullet without a target falls; a shulker's own steers by what the server draws.
  kase('pj_shulker_bullet_hits_target', among([villager(5.5)], { since: '1.9' }), ...fly(20, thing('shulker_bullet'))),
  kase('pj_shulker_bullet_into_wall', { ...range, tags: ['projectile'], since: '1.9' }, ...fly(20, thing('shulker_bullet', fast, 5.5))),
  kase('pj_shulker_bullet_steers_to_player', { ...mortal, since: '1.9', setup: { summon: [{ entity: 'shulker', at: [6.5, 0, 0.5], noAi: false }] } }, ticks(200)),

  // A rocket hits from 1.14; its lifetime is the server's, which the saved LifeTime states.
  kase('pj_firework_hits_target', among([villager(5.5)], { since: '1.14' }), ...fly(15, thing('firework_rocket', rocket))),
  kase('pj_firework_passes_target', among([villager(5.5)], { until: '1.14' }), ...fly(15, thing('firework_rocket', rocket))),
  kase('pj_firework_into_wall', { ...range, tags: ['projectile'], since: '1.14' }, ...fly(15, thing('firework_rocket', rocket, 8.5))),
  kase('pj_firework_bursts_with_age', { ...range, tags: ['projectile'] }, ...fly(25, thing('firework_rocket', '{LifeTime:10,Life:0}'))),

  // A fishing hook needs a player with a rod; before 1.11 it is another tick.
  kase('pj_fishing_hook_hits_target', among([villager(-2.5)], {}, held('fishing_rod')), press(USE, 1), ticks(40)),
  kase('pj_fishing_hook_on_ground', { ...range, tags: ['projectile'], setup: held('fishing_rod') }, press(USE, 1), ticks(40)),
  kase('pj_fishing_hook_into_wall', { ...range, tags: ['projectile'], at: [9.5, 0, 0.5], setup: held('fishing_rod') }, press(USE, 1), ticks(30)),

  // A mortal player: what hit it costs it health, which the server view states.
  kase('pj_mortal_arrow_hits_player', mortal, ...fly(20, arrow(-1.5, 1, 0.5, backwards))),
  kase('pj_mortal_trident_hits_player', { ...mortal, since: '1.13' }, ...fly(20, thing('trident', backwards, -1.5, 1))),
  kase('pj_mortal_small_fireball_hits_player', mortal, ...fly(20, thing('small_fireball', blazeBack, -1.5, 1))),
  kase('pj_mortal_fireball_hits_player', mortal, ...fly(20, thing('fireball', blazeBack, 0.5, 0.6))),
  kase('pj_mortal_shulker_bullet_hits_player', { ...mortal, since: '1.9' }, ...fly(20, thing('shulker_bullet', backwards, -1.5, 1))),
  kase('pj_mortal_snowball_hits_player', mortal, ...fly(20, thing('snowball', backwards, -1.5, 1))),
  kase('pj_mortal_own_arrow', { ...mortal, pitch: -90, setup: bow }, press(USE, 8), ticks(90)),
]

// ---- Bubble columns, first tick and after (B198). Summoned still in the column: `--projectiles` starts them from the summon. --
const still = '{Motion:[0.0d,0.0d,0.0d]}'
const inColumn = (area: string, entity: string, y: number, extra: Partial<KaseSpec> = {}, nbt = still) =>
  kase(`pj_${entity}_bubble_${area === 'bubbleUpColumn' ? 'up' : 'down'}_${y < -1 ? 'inside' : 'surface'}`, { area, at: [-3.5, 0, 0.5], yaw: 270, tier: 3, tags: ['projectile', 'bubble_column'], since: '1.13', ...extra },
    ...fly(25, thing(entity, nbt, 5.5, y)))
for (const area of ['bubbleUpColumn', 'bubbleDownColumn']) for (const entity of ['snowball', 'ender_pearl']) for (const y of [-3, -0.1]) out.push(inColumn(area, entity, y))
// An arrow's, a hurting projectile's and a shulker bullet's blocks push them too: an arrow's from 1.13, the others' from
// 1.16.2 (D-177; 1.16.2 AbstractHurtingProjectile.java:74, ShulkerBullet.java:227)
// (a shulker bullet is gone on peaceful: ShulkerBullet.checkDespawn)
for (const entity of ['arrow', 'trident', 'small_fireball', 'shulker_bullet']) for (const y of [-3, -0.1]) out.push(inColumn('bubbleUpColumn', entity, y, entity === 'shulker_bullet' ? { difficulty: 'easy' } : {}))
// A rocket moves by Entity.move, whose blocks act on it too; from 1.16 it puts its motion back after the move
out.push(inColumn('bubbleUpColumn', 'firework_rocket', -3, {}, '{Motion:[0.0d,0.0d,0.0d],ShotAtAngle:1b,LifeTime:20}'))

// ---- The world border, 12 either side of the player: its east edge at x=5.5 (B198). -----------------------------------------
const border = (...shots: PhysrecAction[]) => [
  server(commandBy({ '1.13': 'execute as @p at @s run worldborder center ~ ~', '1.8': 'execute @p ~ ~ ~ worldborder center ~ ~' }), command('worldborder set 24')), ticks(3),
  server(...shots), ticks(25), server(command('worldborder set 59999968'), command('worldborder center 0 0')), ticks(3),
]
const fenced = { ...range, tags: ['projectile', 'world_border'] }
out.push(
  kase('pj_arrow_border_crossing', fenced, ...border(arrow())),
  kase('pj_arrow_border_crossing_fast', fenced, ...border(arrow(0.5, 1.5, 0.5, faster))),
  kase('pj_arrow_border_from_outside', fenced, ...border(arrow(8.5))),
  kase('pj_trident_border_crossing', { ...fenced, since: '1.13' }, ...border(thing('trident'))),
  kase('pj_snowball_border_crossing', fenced, ...border(thing('snowball'))),
  kase('pj_fireball_border_crossing', fenced, ...border(thing('fireball', blaze))),
  kase('pj_firework_border_crossing', { ...fenced, since: '1.14' }, ...border(thing('firework_rocket', rocket))),
  kase('pj_wind_charge_border_crossing', { ...fenced, since: '1.21' }, ...border(thing('wind_charge', fast))),
)

// ---- Gravity off, no motion inside a block, water, a sliding rocket (B198). -------------------------------------------------
const plain = { ...range, tags: ['projectile'] }
const wet = server(setBlock([4, 1, 0], 'water'), setBlock([4, 2, 0], 'water'))
out.push(
  kase('pj_arrow_no_gravity', plain, ...fly(20, arrow(0.5, 1.5, 0.5, '{Motion:[1.5d,0.0d,0.0d],NoGravity:1b}'))),
  kase('pj_snowball_no_gravity', plain, ...fly(20, thing('snowball', '{Motion:[1.5d,0.0d,0.0d],NoGravity:1b}'))),
  kase('pj_arrow_still_in_stone', plain, ...fly(25, arrow(12.5, 1.5, 0.5, still))),
  // (short of where the spreading water, which the client hears of a tick late, reaches)
  kase('pj_arrow_through_water', plain, wet, ticks(3), ...fly(7, arrow())),
  kase('pj_trident_through_water', { ...plain, since: '1.13' }, wet, ticks(3), ...fly(7, thing('trident'))),
  kase('pj_fireball_through_water', plain, wet, ticks(3), ...fly(7, thing('fireball', blaze))),
  kase('pj_firework_through_water', { ...plain, since: '1.14' }, wet, ticks(3), ...fly(15, thing('firework_rocket', rocket))),
  kase('pj_firework_slides_along_wall', { ...plain, since: '1.14' }, ...fly(15, thing('firework_rocket', '{Motion:[1.0d,0.0d,0.3d],ShotAtAngle:1b,LifeTime:40}', 8.5, 1.5, -0.5))),
  kase('pj_firework_climbs_into_wall', plain, ...fly(15, thing('firework_rocket', '{Motion:[0.5d,0.0d,0.0d],LifeTime:40}', 8.5))),
)

// ---- Shapes and boxes a ray meets (B200). Blocks at x=6: entity y 0 is the block y 1 of setBlock. -----------------------------
const block = (state: string, ...shot: PhysrecAction[]) => [ticks(3), server(setBlock([6, 1, 0], state)), ...fly(20, ...shot)]
const stairs = 'oak_stairs[facing=east,half=bottom]'
const scaled = (scale: number) => `{attributes:[{id:"minecraft:scale",base:${scale}d}]}`
const level = '{Motion:[3.0d,0.0d,0.0d],NoGravity:1b}'
const inbound = '{Motion:[-1.5d,0.0d,0.0d],NoGravity:1b}'
// (past the player: what leaves the area leaves the server's view, which the replay takes for gone)
const stopper = [server(setBlock([-9, 2, 0], 'stone'))]
out.push(
  kase('pj_arrow_into_stairs_low', plain, ...block(stairs, arrow(0.5, 0.25, 0.5, faster))),
  kase('pj_arrow_into_stairs_high', plain, ...block(stairs, arrow(0.5, 0.75, 0.5, faster))),
  kase('pj_snowball_into_stairs_high', plain, ...block(stairs, thing('snowball', faster, 0.5, 0.75))),
  kase('pj_arrow_into_waterlogged_slab', { ...plain, since: '1.13' }, ...block('oak_slab[type=bottom,waterlogged=true]', arrow(0.5, 0.4, 0.5, faster))),
  kase('pj_arrow_over_waterlogged_slab', { ...plain, since: '1.13' }, ...block('oak_slab[type=bottom,waterlogged=true]', arrow(0.5, 0.75, 0.5, level))),
  kase('pj_arrow_through_open_gate', plain, ...block('oak_fence_gate[facing=east,open=true]', arrow(0.5, 0.75, 0.5, level))),
  kase('pj_snowball_through_open_gate', plain, ...block('oak_fence_gate[facing=east,open=true]', thing('snowball', level, 0.5, 0.75))),
  kase('pj_arrow_along_slab_top', plain, ...block('oak_slab[type=bottom]', arrow(0.5, 0.5, 0.5, level))),
  kase('pj_arrow_starts_inside_target', among([villager(5.5)], { since: '1.13' }), ...fly(20, arrow(5.5))),
  kase('pj_snowball_starts_inside_target', among([villager(5.5)], { since: '1.13' }), ...fly(20, thing('snowball', fast, 5.5))),
  kase('pj_arrow_sweeps_past_a_target_in_one_tick', among([villager(5.5)]), ...fly(10, arrow(0.5, 1.5, 0.5, '{Motion:[11.0d,0.0d,0.0d]}'))),
  kase('pj_arrow_over_small_target', among([villager(5.5, 0.5, scaled(0.5))], { since: '1.21.5' }), ...fly(20, arrow(0.5, 1.5))),
  kase('pj_arrow_at_large_target', among([villager(5.5, 0.5, scaled(2))], { since: '1.21.5' }), ...fly(20, arrow(0.5, 2.8, 0.5, '{Motion:[1.5d,0.0d,0.0d],NoGravity:1b}'))),
  kase('pj_mortal_arrow_passes_crouching_player', { ...mortal, since: '1.14' }, hold(SNEAK), ...stopper, ...fly(20, arrow(-1.5, 1.85, 0.5, inbound))),
  kase('pj_mortal_arrow_hits_standing_player', { ...mortal, since: '1.14' }, ...stopper, ...fly(20, arrow(-1.5, 1.85, 0.5, inbound))),
)

// ---- What has no collision box, whose outline stops a thrown item until 1.16.2 (B200). --------------------------------------
const planted = (name: string, state: string, y: number, soil?: string, extra: Partial<KaseSpec> = {}) =>
  kase(`pj_snowball_at_${name}`, { ...plain, ...extra }, ticks(3), server(...(soil ? [setBlock([6, 0, 0], soil)] : []), setBlock([6, 1, 0], state)), ...fly(12, thing('snowball', level, 0.5, y)))
out.push(
  planted('sapling', 'oak_sapling', 0.3, 'dirt'),
  planted('dandelion', 'dandelion', 0.3, 'dirt'),
  planted('short_grass', 'short_grass', 0.3, 'dirt'),
  planted('dead_bush', 'dead_bush', 0.3, 'sand'),
  planted('rail', 'rail[shape=east_west]', 0.05),
  planted('redstone_wire', 'redstone_wire', 0.03),
  planted('pressure_plate', 'stone_pressure_plate', 0.03),
  planted('lever', 'lever[face=floor,facing=north]', 0.3, undefined, { since: '1.9' }),
  planted('sign', 'oak_sign', 0.5),
  planted('cobweb', 'cobweb', 0.5),
  planted('wheat', 'wheat[age=7]', 0.2, 'farmland'),
  // a gate between walls: its top is lower from 1.9
  // soul sand's collision box is 14/16 high and its outline (before 1.13 its bounding box) the full block: a thrown item at
  // 0.9 meets it until 1.16.1 and passes from 1.16.2, an arrow meets it until 1.13.2 and passes from 1.14 (D-179, D-180)
  kase('pj_snowball_over_soul_sand', plain, ...block('soul_sand', thing('snowball', level, 0.5, 0.9))),
  kase('pj_arrow_over_soul_sand', plain, ...block('soul_sand', arrow(0.5, 0.9, 0.5, level))),
  // a shulker bullet's ray is the arrow's before 1.14: the bounding box of what has a collision box (D-180)
  // HoneyBlock.entityInside slides any entity down its side from 1.15, an arrow too
  kase('pj_arrow_slides_down_honey', { ...plain, since: '1.15' }, ...block('honey_block', arrow(5.78, 0.9, 0.5, '{Motion:[0.0d,-0.5d,0.0d]}'))),
  kase('pj_shulker_bullet_over_soul_sand', { ...plain, since: '1.9' }, ...block('soul_sand', thing('shulker_bullet', level, 0.5, 0.9))),
  kase('pj_snowball_over_gate_in_wall', plain, ticks(3), server(setBlock([6, 1, -1], 'cobblestone_wall'), setBlock([6, 1, 1], 'cobblestone_wall'), setBlock([6, 1, 0], 'oak_fence_gate[facing=east,open=true]')), ...fly(12, thing('snowball', level, 0.5, 0.9))),
)

export default out
