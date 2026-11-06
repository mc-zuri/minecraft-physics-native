// Ported from physics-data-generator catalog/src/coverage/mounts.mjs; maintained here now.
// Every rideable the 26.3 client steers or sits on, from the start of the case (setup.mount): walking, turning,
// jump charges, dashes, flying, swimming and getting off. The vehicle is simulated by the client when the player
// controls it (horses, camels, the happy ghast with a harness, the nautilus, boats), interpolated otherwise (llamas,
// minecarts). Dismounting is the server's: it places the player (serverMoves).
// Mount physics in mineflayer-physics-utils / mineflayer (physics.js has paths for the happy ghast, chested donkeys
// and mules) had no recording before these.
import '../_areas/index.ts'
import { registerAreas, B, F, JUMP, L, R, SNEAK, SPRINT, USE, hold, kase, look, press, releaseAll, ticks, turn, untilOr } from '../../../dsl/physrec.ts'
import { area, fill } from './_lib.ts'
import type { KaseSpec, PhysrecMount, PhysrecSteps } from '../../../dsl/physrec.ts'

export const areas = [
  // Open flat ground with a 1-block step at x=24 and a 2-high wall at x=40; room for a 4-block ghast.
  area('cov_ride', [-12, 56, -16, 16],
    fill([24, 1, -16], [24, 1, 16], 'stone'),
    fill([40, 1, -16], [40, 2, 16], 'stone')),
  // A pool 7 deep (surface at block y=0, so a case at y=0 floats on it) with a shore at x=20.
  area('cov_pool', [-16, 32, -16, 16],
    fill([-16, -7, -16], [-16, 0, 16], 'stone'), fill([20, -7, -16], [32, 0, 16], 'stone'),
    fill([-16, -7, -16], [32, -7, 16], 'stone'),
    fill([-15, -6, -15], [19, 0, 15], 'water'))
]

const out = []
const ride = (name: string, mount: PhysrecMount, steps: PhysrecSteps, extra: Partial<KaseSpec> = {}) => out.push(kase(`c_ride_${name}`, {
  area: 'cov_ride',
  at: [0.5, 0, 0.5],
  yaw: 270,
  tier: 3,
  tags: ['coverage', 'vehicle', mount.entity],
  setup: { mount: { yaw: 270, ...mount } },
  ...extra,
},
  steps,
))

// Horses with fixed stats (a spawned one rolls its speed and jump strength); step height 1 as vanilla horses have.
const HORSE_STATS = { movement_speed: 0.2, jump_strength: 0.6, step_height: 1.0 }
const horses = [
  { name: 'donkey', mount: { entity: 'donkey', attributes: HORSE_STATS } },
  { name: 'donkey_chested', mount: { entity: 'donkey', chested: true, attributes: HORSE_STATS } },
  { name: 'mule_chested', mount: { entity: 'mule', chested: true, attributes: HORSE_STATS } },
  { name: 'skeleton_horse', mount: { entity: 'skeleton_horse', attributes: HORSE_STATS } },
  // horse armour keeps a zombie horse from burning in daylight (sunProtectionSlot), which would hurt it at random
  { name: 'zombie_horse', mount: { entity: 'zombie_horse', equipment: { body: 'iron_horse_armor' }, attributes: HORSE_STATS } }
]
for (const { name, mount } of horses) {
  ride(`${name}_walk`, mount, [press(F, 40), ticks(30)])
  ride(`${name}_sprint_turn`, mount, [hold(F, SPRINT), turn(4, 0, 30), releaseAll(), ticks(30)])
  ride(`${name}_jump_charge_3`, mount, [press(JUMP, 3), ticks(40)])
  ride(`${name}_jump_charge_full`, mount, [hold(F), ticks(10), press(JUMP, 11), ticks(30), releaseAll(), ticks(20)])
  ride(`${name}_step_up`, { ...mount, at: [18.5, 0, 0.5] }, [press(F, 40), ticks(20)], { at: [18.5, 0, 0.5] })
  ride(`${name}_dismount`, mount, [press(F, 20), press(SNEAK, 2), ticks(10)], { serverMoves: true, verify: 1 })
}

// Llamas take riders but nobody steers them: the keys do nothing. Their AI off: on its own a llama walks off at random
// (a start mid-walk, toward a server position the client was still interpolating to, every run another), and that walk
// is not what these cases record: a rider the llama carries, keys that do nothing, the server's dismount.
ride('llama_idle', { entity: 'llama', noAi: true }, [ticks(40)])
ride('llama_keys_ignored', { entity: 'llama', noAi: true }, [press([F, JUMP], 30), ticks(10)])
ride('llama_dismount', { entity: 'llama', noAi: true }, [ticks(10), press(SNEAK, 2), ticks(10)], { serverMoves: true })

// Camels: walking, a dash (jump charge) and its cooldown, sprinting; the camel husk (26.x) the same.
for (const entity of ['camel', 'camel_husk']) {
  const extra = entity === 'camel_husk' ? { since: '1.21.11' } : { since: '1.20' }
  ride(`${entity}_walk_turn`, { entity }, [hold(F), turn(3, 0, 40), releaseAll(), ticks(30)], extra)
  ride(`${entity}_dash_twice`, { entity }, [hold(F), ticks(10), press(JUMP, 10), ticks(20), press(JUMP, 10), ticks(60), releaseAll(), ticks(20)], extra)
  // (as the horses' dismount: off the camel the player stands against it, and whether the server's camel and player
  // push each other apart, and when that reaches the client, varies run to run)
  ride(`${entity}_dismount`, { entity }, [press(F, 20), press(SNEAK, 2), ticks(10)], { ...extra, serverMoves: true, verify: 1 })
}

// Happy ghast with a harness (body slot): flies where the player looks while forward is held, jump climbs, back
// is half speed; sneaking gets off on its top.
const ghast = { entity: 'happy_ghast', equipment: { body: 'white_harness' }, at: [0.5, 0, 0.5] }
const flies = { since: '1.21.6', settle: false, at: [0.5, 0, 0.5] }
ride('happy_ghast_idle', ghast, [ticks(40)], flies)
ride('happy_ghast_forward', ghast, [press(F, 60), ticks(40)], flies)
ride('happy_ghast_climb_look', ghast, [look(270, -35), ticks(2), press(F, 50), ticks(30)], flies)
ride('happy_ghast_dive_look', { ...ghast }, [look(270, 0), press(JUMP, 40), look(270, 40), ticks(2), press(F, 40), ticks(30)], flies)
ride('happy_ghast_jump_climb', ghast, [press(JUMP, 40), ticks(40)], flies)
ride('happy_ghast_back_strafe', ghast, [press([B, L], 40), press([R], 20), ticks(30)], flies)
ride('happy_ghast_turn', ghast, [hold(F), turn(5, 0, 36), releaseAll(), ticks(30)], flies)
ride('happy_ghast_into_wall', { ...ghast, at: [34.5, 0, 0.5] }, [press(F, 60), ticks(20)], { ...flies, at: [34.5, 0, 0.5] })
// the server's dismount lands on a tick of its own: one run
ride('happy_ghast_dismount', ghast, [press(JUMP, 20), ticks(10), press(SNEAK, 2), ticks(30)], { ...flies, serverMoves: true, verify: 1 })
// Without a harness nobody steers it: the keys do nothing. Its AI off, as it would float around on its own
// (RandomFloatAroundGoal) from wherever it was when the case started: it stays where it is, steered or not.
ride('happy_ghast_no_harness', { entity: 'happy_ghast', at: [0.5, 0, 0.5], noAi: true }, [press(F, 40), ticks(10)], flies)
// Standing on an idle ghast (no AI): its top is a floor the client collides with.
out.push(kase('c_ride_happy_ghast_walk_on_top', {
  area: 'cov_ride',
  at: [-1.5, 4, 0.5],
  rest: [-1.5, 4, 0.5],
  yaw: 270,
  tier: 3,
  since: '1.21.6',
  tags: ['coverage', 'vehicle', 'happy_ghast'],
  setup: { summon: [{ entity: 'happy_ghast', at: [0.5, 0, 0.5], yaw: 270, ready: true, equipment: { body: 'white_harness' } }] },
},
  press(F, 12),
  ticks(10),
  press(JUMP, 1),
  ticks(30),
))

// Nautilus and zombie nautilus (1.21.11): ridden under water, steered by looking (like the ghast), jump dashes.
for (const entity of ['nautilus', 'zombie_nautilus']) {
  const swim = (name: string, steps: PhysrecSteps, extra: Partial<KaseSpec> = {}) => out.push(kase(`c_ride_${entity}_${name}`, {
    area: 'cov_pool',
    at: [0.5, -4, 0.5],
    yaw: 270,
    tier: 3,
    since: '1.21.11',
    settle: false,
    tags: ['coverage', 'vehicle', entity, 'water'],
    setup: { mount: { entity, yaw: 270 } },
    ...extra,
  },
    steps,
  ))
  swim('idle', [ticks(40)])
  swim('forward', [press(F, 60), ticks(30)])
  swim('up_look', [look(270, -40), ticks(2), press(F, 40), ticks(30)])
  swim('down_look', [look(270, 40), ticks(2), press(F, 30), ticks(30)])
  swim('dash', [hold(F), ticks(10), press(JUMP, 1), ticks(30), releaseAll(), ticks(20)])
  swim('dash_cooldown', [hold(F), press(JUMP, 1), ticks(10), press(JUMP, 1), ticks(40), releaseAll(), ticks(10)])
  swim('to_surface_and_shore', [look(270, -20), ticks(2), press(F, 120), ticks(20)])
  swim('dismount', [press(F, 20), press(SNEAK, 2), ticks(20)], { serverMoves: true, verify: 1 })
}

// Pig and strider: steered by the item on a stick, which boosts them on use.
out.push(
  kase('c_ride_pig_boost', {
    area: 'cov_ride',
    at: [0.5, 0, 0.5],
    yaw: 270,
    tier: 3,
    settle: false,
    verify: 1,
    tags: ['coverage', 'vehicle', 'pig'],
    setup: { mount: { entity: 'pig', yaw: 270 }, equipment: { mainhand: { id: 'carrot_on_a_stick', enchantments: {} } } },
  },
    ticks(20),
    press(USE, 1),
    ticks(60),
  ),
  kase('c_ride_strider_boost', {
    area: 'lava',
    at: [0.5, 0, 0.5],
    // (the rest on the stone: a player resting in lava flickers on fire, invulnerable, and the last packet of that lands on either side of the first tick)
    rest: [-8.5, 0, 0.5],
    yaw: 270,
    tier: 3,
    settle: false,
    verify: 1,
    tags: ['coverage', 'vehicle', 'strider'],
    setup: { mount: { entity: 'strider', yaw: 270, at: [0.5, 0, 0.5] }, equipment: { mainhand: { id: 'warped_fungus_on_a_stick', enchantments: {} } } },
  },
    ticks(20),
    press(USE, 1),
    ticks(60),
  ),
  // Its AI off: a pig its rider does not steer (no carrot on a stick) wanders off on its own, so neither its start nor
  // where the server sets the rider down came out the same twice. The dismount is the server's either way.
  kase('c_ride_pig_dismount', {
    area: 'cov_ride',
    at: [0.5, 0, 0.5],
    yaw: 270,
    tier: 3,
    serverMoves: true,
    tags: ['coverage', 'vehicle', 'pig'],
    setup: { mount: { entity: 'pig', yaw: 270, noAi: true } },
  },
    ticks(10),
    press(SNEAK, 2),
    ticks(10),
  )
)

// Chest boats and the chest raft (one seat), a boat with the sprint key, minecart dismount.
const boat = (entity: string, name: string, steps: PhysrecSteps, extra: Partial<KaseSpec> = {}) => out.push(kase(`c_ride_${name}`, {
  area: 'cov_pool',
  at: [0.5, 0, 0.5],
  yaw: 270,
  tier: 3,
  tags: ['coverage', 'vehicle', 'boat'],
  setup: { mount: { entity, yaw: 270 } },
  ...extra,
},
  steps,
))
boat('oak_chest_boat', 'oak_chest_boat_forward', [press(F, 60), ticks(40)], { since: '1.19' })
boat('oak_chest_boat', 'oak_chest_boat_turn', [press([F, L], 40), press([F, R], 40), ticks(30)], { since: '1.19' })
// a boat spawned in open water settles to within 1e-15 differently from run to run: one run
// (up the carpet of boatShore, as v_boat_onto_land: cov_pool's stone shore is a wall to a boat)
boat('oak_chest_boat', 'oak_chest_boat_onto_shore', [hold(F), untilOr('x > 18', 160), releaseAll(), ticks(30)],
  { since: '1.19', area: 'boatShore', at: [10.5, 0, 0.5], verify: 1, expect: 'in:water', checks: 'x > 16.5 && y < -1.1' })
boat('bamboo_chest_raft', 'bamboo_chest_raft_forward', [press(F, 60), ticks(40)], { since: '1.20' })
boat('oak_chest_boat', 'oak_chest_boat_dismount', [press(F, 20), press(SNEAK, 2), ticks(20)], { since: '1.19', serverMoves: true })
out.push(kase('c_ride_minecart_dismount', {
  area: 'rails',
  at: [2.5, 0, 0.5],
  yaw: 270,
  tier: 3,
  serverMoves: true,
  tags: ['coverage', 'vehicle', 'minecart'],
  setup: { mount: { entity: 'minecart', yaw: 270 } },
},
  press(F, 40),
  press(SNEAK, 2),
  ticks(20),
))

// The cushion (26.3): a seat on a block; sneaking gets up.
out.push(kase('c_ride_cushion_sit_get_up', {
  area: 'cov_ride',
  at: [0.5, 0, 0.5],
  yaw: 270,
  tier: 3,
  since: '26.3',
  serverMoves: true,
  tags: ['coverage', 'vehicle', 'cushion'],
  setup: { mount: { entity: 'cushion', yaw: 270 } },
},
  press(F, 10),
  ticks(10),
  press(SNEAK, 2),
  ticks(20),
))

export default out

registerAreas(areas)
