// Ported from physics-data-generator catalog/src/cases/java-vehicles.mjs; maintained here now.
// Riding: boats on water, ice, blue ice and land, off a ledge, into a shore, in bubble columns; minecarts on straight,
// powered, sloped and curved rails (simulated by the server: the recording keeps the server's view per server tick);
// horse walking, charged jumps and step-ups; camel dash; pig with a carrot on a stick; strider on lava.
import './_areas/index.ts'
import { DISMOUNT_LANES, laneZ } from './_areas/java-areas.ts'
import { type KaseSpec, type PhysrecMount, type Pos, B, F, JUMP, L, R, SNEAK, SPRINT, commandBy, hold, kase, press, releaseAll, server, stable, ticks, turn, untilOr } from '../../dsl/physrec.ts'

const out = []
const boat = (at: Pos, extra: Partial<KaseSpec> = {}): KaseSpec => ({ area: 'boats', at, yaw: 270, tier: 3, tags: ['vehicle', 'boat'], setup: { mount: { entity: 'oak_boat', yaw: 270 } }, ...extra })
const water = boat([0.5, 0, 0.5])

out.push(
  kase('v_boat_idle_water', water,
    ticks(60),
  ),
  kase('v_boat_forward', water,
    press(F, 60),
    ticks(40),
  ),
  kase('v_boat_back', water,
    press(B, 40),
    ticks(40),
  ),
  kase('v_boat_turn_left', water,
    press(L, 40),
    ticks(20),
  ),
  kase('v_boat_turn_right', water,
    press(R, 40),
    ticks(20),
  ),
  kase('v_boat_forward_left', water,
    press([F, L], 60),
    ticks(40),
  ),
  kase('v_boat_forward_right_back', water,
    press([F, R], 30),
    press([B, L], 30),
    ticks(40),
  ),
  kase('v_boat_sprint_key_ignored', water,
    press([F, SPRINT], 40),
    ticks(20),
  ),
  kase('v_boat_into_shore_wall', { ...water, yaw: 180 },
    press(F, 60),
    ticks(20),
  ),
  // Up the carpet of boatShore (a boat does not climb the stone of `boats`). The rider's y: -0.9 afloat, under -1.1 on the carpet.
  kase('v_boat_onto_land', { ...water, area: 'boatShore', at: [10.5, 0, 0.5], expect: 'in:water', checks: 'x > 16.5 && y < -1.1' },
    hold(F),
    untilOr('x > 18', 160),
    releaseAll(),
    ticks(40),
  ),
  kase('v_boat_on_land_push', boat([30.5, 0, 0.5]),
    press(F, 60),
    ticks(40),
  ),
  kase('v_boat_ice', boat([-6.5, 0, 11.5]),
    press(F, 60),
    ticks(60),
  ),
  kase('v_boat_ice_turning', boat([-6.5, 0, 11.5]),
    press([F, R], 60),
    ticks(40),
  ),
  kase('v_boat_blue_ice', { ...boat([-6.5, 0, -11.5]), requires: ['blue_ice'] },
    press(F, 60),
    ticks(80),
  ),
  // Astride the edge of the ice: the boat's ground friction is the float average of the blocks under it
  // (Boat.getGroundFriction), which no one block's friction gives.
  kase('v_boat_astride_ice', boat([-6.5, 0, 10]),
    press(F, 60),
    ticks(60),
  ),
  // Over the ledge's edge, then into the water 4 under it. The rider starts at y 3.6 and floats at -0.9. (1.8.8's boat is slow on land.)
  kase('v_boat_off_ledge_into_water', { ...boat([-5.5, 4, 6.5]), expect: 'in:water', checks: 'highest > 3 && y < 0' },
    hold(F),
    untilOr('y < 3', 320),
    releaseAll(),
    ticks(60),
  ),
  kase('v_boat_dismount', { ...water, serverMoves: true },
    press(F, 20),
    press(SNEAK, 2),
    ticks(40),
  ),
  // Starts settled on the land beside the column (a boat in a rising column bobs forever) and drives in.
  kase('v_boat_bubble_up', {
    area: 'bubbleUpColumn',
    at: [-3.5, 0, 0.5],
    yaw: 270,
    tier: 3,
    tags: ['vehicle', 'boat', 'bubble_column'],
    expect: 'in:bubble_column',
    checks: 'x > 1.7 && highest > 0',
    setup: { mount: { entity: 'oak_boat', yaw: 270 } },
  },
    hold(F),
    untilOr('x > 2', 160),
    releaseAll(),
    ticks(80),
  ),
  // Like the rising column: starts settled on the land beside it and drives in (a boat placed on a dragging column
  // is pulled under and throws the player out before the recording starts).
  kase('v_boat_bubble_down', {
    area: 'bubbleDownColumn',
    at: [-3.5, 0, 0.5],
    yaw: 270,
    tier: 3,
    tags: ['vehicle', 'boat', 'bubble_column'],
    expect: 'in:bubble_column',
    checks: 'x > 1.7 && y < -3',
    serverMoves: true,
    setup: { mount: { entity: 'oak_boat', yaw: 270 } },
  },
    hold(F),
    untilOr('x > 2', 160),
    releaseAll(),
    ticks(100),
  ),
  kase('v_raft_forward', { ...water, setup: { mount: { entity: 'bamboo_raft', yaw: 270 } } },
    press(F, 60),
    ticks(40),
  )
)

const cart = (at: Pos, extra: Partial<KaseSpec> = {}): KaseSpec => ({ area: 'rails', at, yaw: 270, tier: 3, tags: ['vehicle', 'minecart'], setup: { mount: { entity: 'minecart', yaw: 270 } }, ...extra })
out.push(
  kase('v_minecart_idle', cart([2.5, 0, 0.5]),
    ticks(40),
  ),
  kase('v_minecart_push_forward', cart([2.5, 0, 0.5]),
    press(F, 100),
    ticks(100),
  ),
  kase('v_minecart_powered_start', cart([12.5, 0, 0.5]),
    ticks(200),
  ),
  kase('v_minecart_curve', cart([26.5, 0, 0.5]),
    press(F, 120),
    ticks(60),
  ),
  kase('v_minecart_slope_up', cart([2.5, 0, -5.5]),
    press(F, 100),
    ticks(60),
  ),
  kase('v_minecart_slope_down', cart([11.5, 2, -5.5], { yaw: 90 }),
    press(F, 20),
    ticks(100),
  ),
  kase('v_minecart_look_around', cart([2.5, 0, 0.5]),
    hold(F),
    turn(5, 0, 60),
    releaseAll(),
    ticks(40),
  )
)

// Living mounts with fixed stats (a spawned horse rolls random speed and jump strength otherwise).
const horse = { entity: 'horse', yaw: 270, attributes: { movement_speed: 0.225, jump_strength: 0.7, step_height: 1.0 } }
const ride = (entity: PhysrecMount, at: Pos = [0.5, 0, 0.5], extra: Partial<KaseSpec> = {}): KaseSpec => ({ area: 'mounts', at, yaw: 270, tier: 3, tags: ['vehicle', entity.entity], setup: { mount: entity }, ...extra })
out.push(
  kase('v_horse_walk', ride(horse),
    press(F, 40),
    ticks(30),
  ),
  kase('v_horse_back_strafe', ride(horse),
    press([B, L], 40),
    ticks(30),
  ),
  kase('v_horse_turn', ride(horse),
    hold(F),
    turn(6, 0, 40),
    releaseAll(),
    ticks(30),
  ),
  kase('v_horse_jump_short_charge', ride(horse),
    press(JUMP, 3),
    ticks(40),
  ),
  kase('v_horse_jump_full_charge', ride(horse),
    press(JUMP, 12),
    ticks(40),
  ),
  kase('v_horse_jump_overcharge', ride(horse),
    press(JUMP, 40),
    ticks(40),
  ),
  kase('v_horse_running_jump', ride(horse),
    hold(F),
    ticks(15),
    press(JUMP, 10),
    ticks(30),
    releaseAll(),
    ticks(30),
  ),
  kase('v_horse_step_up_block', ride(horse, [14.5, 0, 0.5]),
    press(F, 40),
    ticks(20),
  ),
  kase('v_horse_jump_wall', ride(horse, [28.5, 0, 0.5]),
    hold(F),
    ticks(8),
    press(JUMP, 12),
    ticks(40),
    releaseAll(),
    ticks(20),
  ),
  // Short after the dismount: the horse's own AI moves it next and may push the player.
  kase('v_horse_dismount', { ...ride(horse), serverMoves: true },
    press(F, 20),
    press(SNEAK, 2),
    ticks(8),
  ),
  kase('v_camel_walk', ride({ entity: 'camel', yaw: 270 }),
    press(F, 40),
    ticks(30),
  ),
  kase('v_camel_dash', ride({ entity: 'camel', yaw: 270 }),
    hold(F),
    ticks(10),
    press(JUMP, 10),
    ticks(40),
    releaseAll(),
    ticks(20),
  ),
  kase('v_camel_sprint', ride({ entity: 'camel', yaw: 270 }),
    press([F, SPRINT], 40),
    ticks(30),
  ),
  kase('v_pig_carrot_on_a_stick', {
    ...ride({ entity: 'pig', yaw: 270 }),
    settle: false,
    verify: 1,
    setup: { mount: { entity: 'pig', yaw: 270 }, equipment: { mainhand: { id: 'carrot_on_a_stick', enchantments: {} } } },
  },
    ticks(60),
  ),
  kase('v_strider_on_lava', {
    area: 'lava',
    at: [0.5, 0, 0.5],
    // (the rest on the stone: a player resting in lava flickers on fire, invulnerable, and the last packet of that lands on either side of the first tick)
    rest: [-8.5, 0, 0.5],
    yaw: 270,
    tier: 3,
    settle: false,
    verify: 1,
    tags: ['vehicle', 'strider'],
    setup: { mount: { entity: 'strider', yaw: 270, at: [0.5, 0, 0.5] }, equipment: { mainhand: { id: 'warped_fungus_on_a_stick', enchantments: {} } } },
  },
    ticks(60),
  ),
  // cold, with a modifier of the same kind as the suffocating one: they add up, they do not multiply
  kase('v_strider_cold_modified', {
    area: 'mounts',
    at: [0.5, 0, 0.5],
    yaw: 270,
    tier: 3,
    settle: false,
    verify: 1,
    since: '1.16',
    tags: ['vehicle', 'strider'],
    setup: { mount: { entity: 'strider', yaw: 270 }, equipment: { mainhand: { id: 'warped_fungus_on_a_stick', enchantments: {} } } },
  },
    server(commandBy({
      '1.21.2': 'attribute @e[type=strider,limit=1] minecraft:movement_speed modifier add minecraft:faster 0.4 add_multiplied_base',
      '1.21': 'attribute @e[type=strider,limit=1] minecraft:generic.movement_speed modifier add minecraft:faster 0.4 add_multiplied_base',
      '1.20.5': 'attribute @e[type=strider,limit=1] minecraft:generic.movement_speed modifier add 00000000-0000-0000-0000-000000000001 faster 0.4 add_multiplied_base',
      '1.16': 'attribute @e[type=strider,limit=1] minecraft:generic.movement_speed modifier add 00000000-0000-0000-0000-000000000001 faster 0.4 multiply_base',
    })),
    ticks(60),
  )
)

// ---- Horse-family mounts in water ---------------------------------------------------------------------------------------
// From dry ground into horsePool, 6 deep and 1 deep, a jump in the deep, and out over the far shore. A horse floats with its rider
// above the water, a skeleton horse sinks with it. The proof is the rider's y under what it is on land (0.72 to 0.84, a camel's 1.4),
// and x. Fixed stats as coverage/mounts.ts; the armour keeps a zombie horse from burning. A llama nobody steers is left out: with
// its AI on it walks off at random, with it off it hangs in the air.
const STATS = { movement_speed: 0.2, jump_strength: 0.6, step_height: 1.0 }
// Mounts by other than their defaults (B090, B187): SCALE from 1.20.5, whose box and step the mount must take; the effects a mount keeps
const scaled = (entity: string, scale: number): KaseSpec => ride({ entity, noAi: true, attributes: { ...STATS, scale } }, [0.5, 0, 0.5], { since: '1.20.5', serverMoves: true })
const effects = (...commands: string[]) => server(...commands.map(text => commandBy({ '1.13': `effect give @e[type=horse] ${text}` })))
out.push(
  kase('v_scaled_horse_walk', scaled('horse', 2), press(F, 20), ticks(5)),
  kase('v_scaled_horse_small_walk', scaled('horse', 0.5), press(F, 20), ticks(5)),
  kase('v_scaled_horse_jump', scaled('horse', 2), press(JUMP, 8), ticks(25)),
  kase('v_scaled_donkey_step_up', { ...scaled('donkey', 1.5), at: [0.5, 0, 0.5] }, press(F, 30), ticks(5)),
  kase('v_effect_horse_jump_boost', { ...ride(horse), since: '1.13' }, effects('minecraft:jump_boost 30 2'), ticks(2), press(JUMP, 8), ticks(25)),
  kase('v_effect_horse_levitation', { ...ride(horse), since: '1.13', serverMoves: true }, effects('minecraft:levitation 2 1'), ticks(45)),
  kase('v_effect_horse_slow_falling', { ...ride(horse), since: '1.13' }, effects('minecraft:slow_falling 30 0'), ticks(2), press(JUMP, 8), ticks(25)),
)
const swimmers: readonly { name: string, mount: PhysrecMount, under?: number, extra?: Partial<KaseSpec> }[] = [
  { name: 'horse', mount: { entity: 'horse', attributes: STATS } },
  { name: 'donkey', mount: { entity: 'donkey', attributes: STATS } },
  { name: 'mule', mount: { entity: 'mule', attributes: STATS } },
  { name: 'skeleton_horse', mount: { entity: 'skeleton_horse', attributes: STATS } },
  { name: 'zombie_horse', mount: { entity: 'zombie_horse', equipment: { body: 'iron_horse_armor' }, attributes: STATS } },
  // (it stands too high for water to reach its rider)
  { name: 'camel', mount: { entity: 'camel' }, under: 1.1, extra: { since: '1.20', expect: [] } },
]
const inPool = (entity: PhysrecMount, at: Pos, extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area: 'horsePool', at, yaw: 270, tier: 3, serverMoves: true, tags: ['vehicle', entity.entity, 'water'], setup: { mount: { yaw: 270, ...entity } }, expect: 'in:water', ...extra,
})
for (const { name, mount, under = 0.5, extra } of swimmers) {
  out.push(
    kase(`v_swim_${name}_deep`, inPool(mount, [6.5, 0, 0.5], { ...extra, checks: `x > 18 && lowest < ${under}` }),
      hold(F), untilOr('x > 20', 140), releaseAll(), ticks(40)),
    kase(`v_swim_${name}_deep_jump`, inPool(mount, [6.5, 0, 0.5], { ...extra, checks: `x > 13 && lowest < ${under}` }),
      hold(F), untilOr('x > 13', 60), press(JUMP, 11), ticks(30), releaseAll(), ticks(20)),
    kase(`v_swim_${name}_shallow`, inPool(mount, [6.5, 0, 13.5], { ...extra, checks: `x > 12 && lowest < ${under}` }),
      hold(F), untilOr('x > 15', 80), releaseAll(), ticks(30)),
    kase(`v_swim_${name}_out_onto_shore`, inPool(mount, [24.5, 0, 13.5], { ...extra, expect: [], checks: `x > 30.5 && lowest < ${under}` }),
      hold(F), untilOr('x > 31.5', 100), releaseAll(), ticks(20)),
  )
}

// ---- Getting off with no room -----------------------------------------------------------------------------------------
// The server places the rider (serverMoves) where the vehicle says, and with nothing free on the vehicle's cell or on top of the
// walls: a rider is never on the ground, so onGround at the end says it got off. pos at the dismount is the proof of where. The AI
// off: a horse moves off and pushes otherwise.
const obstructed = (mount: PhysrecMount, lane: string): KaseSpec => ({
  area: 'dismounts', at: [lane === 'pocket' ? 5 : 4.5, 0, laneZ(DISMOUNT_LANES.indexOf(lane)) + 1], yaw: 270, tier: 3, serverMoves: true,
  tags: ['vehicle', 'dismount', mount.entity, lane], checks: 'onGround', setup: { mount: { yaw: 270, ...mount } },
})
const getsOff = [ticks(10), press(SNEAK, 2), ticks(15)]
for (const lane of DISMOUNT_LANES) {
  out.push(
    kase(`v_dismount_horse_${lane}`, obstructed({ entity: 'horse', noAi: true, attributes: STATS }, lane), getsOff),
    kase(`v_dismount_boat_${lane}`, obstructed({ entity: 'oak_boat' }, lane), getsOff),
    kase(`v_dismount_pig_${lane}`, obstructed({ entity: 'pig', noAi: true }, lane), getsOff),
    kase(`v_dismount_minecart_${lane}`, obstructed({ entity: 'minecart' }, lane), getsOff),
    kase(`v_dismount_camel_${lane}`, { ...obstructed({ entity: 'camel', noAi: true }, lane), since: '1.20' }, getsOff),
  )
}

// What the flat runs of coverage/mounts.ts do not reach: water, a ledge, lava (B184, B187).
const steed = (entity: string, movement_speed: number, jump_strength: number): PhysrecMount => ({ entity, yaw: 270, attributes: { movement_speed, jump_strength, step_height: 1.0 } })
// (serverMoves: an old server takes a rider under water off its mount, 1.9.4 LivingEntity.baseTick)
const pool = { area: 'mountCourse', serverMoves: true }
for (const [entity, speed, jump] of [['donkey', 0.175, 0.5], ['skeleton_horse', 0.2, 0.42], ['zombie_horse', 0.2, 0.42]] as const) {
  out.push(kase(`v_${entity}_into_water`, { ...ride(steed(entity, speed, jump), [8.5, 0, 0.5], pool), since: '1.11' },
    press(F, 70),
    ticks(40),
  ))
}
out.push(
  kase('v_horse_into_water', ride(horse, [8.5, 0, 0.5], pool),
    press(F, 70),
    ticks(40),
  ),
  kase('v_horse_off_ledge', ride(horse, [-3.5, 3, 8.5], { area: 'mountCourse' }),
    press(F, 12),
    ticks(40),
  ),
  kase('v_horse_into_lava', ride(horse, [-3.5, 3, -7.5], { area: 'mountCourse' }),
    press(F, 12),
    ticks(40),
  ),
  kase('v_camel_into_water', { ...ride({ entity: 'camel', yaw: 270 }, [8.5, 0, 0.5], pool), since: '1.20' },
    press(F, 70),
    ticks(40),
  ),
  kase('v_camel_off_ledge', { ...ride({ entity: 'camel', yaw: 270 }, [-3.5, 3, 8.5], { area: 'mountCourse' }), since: '1.20' },
    press(F, 40),
    ticks(40),
  ),
  kase('v_pig_into_water', {
    ...ride({ entity: 'pig', yaw: 270 }, [8.5, 0, 0.5], pool),
    settle: false,
    setup: { mount: { entity: 'pig', yaw: 270 }, equipment: { mainhand: { id: 'carrot_on_a_stick', enchantments: {} } } },
  },
    ticks(80),
  ),
  kase('v_strider_into_water', {
    ...ride({ entity: 'strider', yaw: 270 }, [8.5, 0, 0.5], pool),
    settle: false,
    since: '1.16',
    setup: { mount: { entity: 'strider', yaw: 270 }, equipment: { mainhand: { id: 'warped_fungus_on_a_stick', enchantments: {} } } },
  },
    ticks(80),
  ),
  kase('v_strider_off_ledge_into_lava', {
    ...ride({ entity: 'strider', yaw: 270 }, [-3.5, 3, -7.5], { area: 'mountCourse', serverMoves: true }),
    settle: false,
    since: '1.16',
    setup: { mount: { entity: 'strider', yaw: 270 }, equipment: { mainhand: { id: 'warped_fungus_on_a_stick', enchantments: {} } } },
  },
    ticks(60),
  ),
  kase('v_pig_off_ledge_into_lava', {
    ...ride({ entity: 'pig', yaw: 270 }, [-3.5, 3, -7.5], { area: 'mountCourse', serverMoves: true }),
    settle: false,
    setup: { mount: { entity: 'pig', yaw: 270 }, equipment: { mainhand: { id: 'carrot_on_a_stick', enchantments: {} } } },
  },
    ticks(50),
  ),
  // A ridden vehicle's own Entity.collide meets the entities: a boat all that are pushable, and everything up to 1.10; a mount only
  // what any entity collides with. Proof: vehicle.pos and horizontalCollision while the key is held.
  ...['cow', 'armor_stand', 'minecart', 'oak_boat'].map(entity => kase(`v_boat_into_${entity}`, {
    ...boat([30.5, 0, 0.5]), setup: { mount: { entity: 'oak_boat', yaw: 270 }, summon: [{ entity, at: [33.5, 0, 0.5], noAi: true }] },
  }, press(F, 50), ticks(15))),
  kase('v_boat_water_into_oak_boat', { ...water, setup: { mount: { entity: 'oak_boat', yaw: 270 }, summon: [{ entity: 'oak_boat', at: [6.5, 0, 0.5], noAi: true }] } }, press(F, 50), ticks(15)),
  ...['cow', 'oak_boat'].map(entity => kase(`v_horse_into_${entity}`, {
    ...ride(horse), setup: { ...ride(horse).setup, summon: [{ entity, at: [5.5, 0, 0.5], noAi: true }] },
  }, press(F, 40), ticks(15))),
)

export default out
