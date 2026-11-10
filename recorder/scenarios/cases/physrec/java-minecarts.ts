// The minecart engine's cases, on the server's rail movement (the recording keeps the server's view of each cart per
// server tick): carts nobody rides, set going by the server, on the `minecarts` area's tracks, each of its variants, the
// rails that power and halt, curves and slopes, what ends a track, and carts meeting carts and mobs. The rider's start is
// v_minecart_push_forward's (java-vehicles.ts) with the rest of the ridden cases.
//
// The mx_ cases run the same tracks under the minecart_improvements experiment: `record.ts --features
// minecart_improvements`. A world has it for every case, so those run apart and no other run has them.
import './_areas/index.ts'
import { type KaseSpec, type Pos, ATTACK, F, cartVelocity, commandBy, crosshair, hold, kase, press, releaseAll, server, setBlock, ticks } from '../../dsl/physrec.ts'

const out = []

/** The player stands aside on the floor and watches a cart: the summons are `summon0` and on. */
const watch = (summon: NonNullable<NonNullable<KaseSpec['setup']>['summon']>, extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area: 'minecarts', at: [-5.5, 0, 0.5], yaw: 270, tier: 3, tags: ['minecart'],
  ...extra,
  setup: { ...extra.setup, summon },
})
const cart = (at: Pos, entity = 'minecart', extra: Partial<NonNullable<NonNullable<KaseSpec['setup']>['summon']>[number]> = {}) => ({ entity, at, yaw: 90, ...extra })
const go = (x: number, z = 0, ref = 'summon0') => server(cartVelocity(ref, [x, 0, z]))

/** Whether release `a` is `b` or later. */
const atLeast = (a: string, b: string) => {
  const [x, y] = [a, b].map(v => v.split('.').map(Number))
  for (let i = 0; i < Math.max(x!.length, y!.length); i++) {
    if ((x![i] ?? 0) !== (y![i] ?? 0)) return (x![i] ?? 0) > (y![i] ?? 0)
  }
  return true
}

/** Each case on both paths: the old from `since`, the improved from 1.21.2 (or a later `since`) in a world with the experiment. */
const both = (name: string, spec: KaseSpec, ...steps: Parameters<typeof kase>[2][]) => [
  kase(`mc_${name}`, spec, ...steps),
  kase(`mx_${name}`, {
    ...spec, since: spec.since && atLeast(spec.since, '1.21.2') ? spec.since : '1.21.2', tags: [...(spec.tags ?? []), 'feature:minecart_improvements'],
    setup: { ...spec.setup, commands: [...(spec.setup?.commands ?? []), { '1.21.2': 'gamerule minecartMaxSpeed 8', '26.1': 'gamerule max_minecart_speed 8' }] },
  }, ...steps),
]

const coasting = (name: string, entity: string, nbt?: string) => both(name, watch([cart([2.5, 0, 0.5], entity, nbt ? { nbt } : {})]), go(0.3), ticks(100))

out.push(
  // a track without power to the stone at its end, which stops the cart
  ...both('straight', watch([cart([28.5, 0, 0.5])]), go(0.4), ticks(60)),
  ...both('slow_coast', watch([cart([2.5, 0, 0.5])]), go(0.05), ticks(120)),
  ...both('backward', watch([cart([20.5, 0, 0.5])]), go(-0.3), ticks(80)),
  // what the variants' drag does to the same start
  ...coasting('chest', 'chest_minecart'),
  ...coasting('hopper', 'hopper_minecart'),
  ...coasting('tnt', 'tnt_minecart'),
  ...coasting('spawner', 'spawner_minecart'),
  ...coasting('command', 'command_block_minecart'),
  ...coasting('furnace_cold', 'furnace_minecart'),
  ...both('furnace_lit', watch([cart([2.5, 0, 0.5], 'furnace_minecart', { nbt: '{Fuel:300s,PushX:1.0d,PushZ:0.0d}' })]), go(0.1), ticks(160)),
  ...both('furnace_runs_out', watch([cart([2.5, 0, 0.5], 'furnace_minecart', { nbt: '{Fuel:20s,PushX:1.0d,PushZ:0.0d}' })]), go(0.1), ticks(80)),
  // the powered rail's boost, the unpowered one's brake, the rails after it
  ...both('powered_boost', watch([cart([6.5, 0, 3.5])]), go(0.1), ticks(120)),
  ...both('brake', watch([cart([15.5, 0, 3.5])]), go(0.4), ticks(40)),
  ...both('powered_start_off_block', watch([cart([2.5, 0, 6.5])]), ticks(120)),
  // the four corners in a run
  ...both('curves', watch([cart([2.5, 0, 9.5])]), go(0.4), ticks(160)),
  ...both('curve_slow', watch([cart([8.5, 0, 9.5])]), go(0.1), ticks(160)),
  // up a slope and back, over a hill and down, north to south, a valley it rests in
  ...both('slope_climb', watch([cart([2.5, 0, 18.5])]), go(0.4), ticks(140)),
  ...both('slope_stall', watch([cart([4.5, 0, 18.5])]), go(0.08), ticks(140)),
  ...both('slope_down', watch([cart([9.5, 2, 18.5])]), go(-0.05), ticks(100)),
  ...both('slope_south', watch([cart([35.5, 0, 20.5])]), go(0, 0.4), ticks(120)),
  ...both('valley', watch([cart([3.5, 1, -5.5])]), go(0.1), ticks(160)),
  // off the end of a rail onto the floor, and off a ledge
  ...both('off_the_end', watch([cart([26.5, 0, 3.5])]), go(0.4), ticks(80)),
  ...both('off_a_ledge', watch([cart([6.5, 2, 30.5])]), go(0.4), ticks(80)),
  // on the floor, no rail: pushed along, slowing by halves
  ...both('on_the_floor', watch([cart([2.5, 0, 12.5])]), go(0.3), ticks(40)),
  // the rails over a block that slows what stands on it, a web on the track
  ...both('soul_sand_under_rail', watch([cart([2.5, 0, -11.5])]), go(0.3), ticks(80)),
  ...both('web_on_track', watch([cart([2.5, 0, -14.5])]), go(0.3), ticks(60)),
  // an activator rail a rideable cart passes without a rider, a detector rail it switches
  ...both('activator', watch([cart([2.5, 0, -2.5])]), go(0.3), ticks(60)),
  // no gravity off the rail
  ...both('no_gravity', watch([cart([6.5, 2, 30.5], 'minecart', { noGravity: true })], { since: '1.10' }), go(0.2), ticks(40)),
  // a cart into another, head on, a furnace into a cart, and one standing against another
  ...both('into_a_cart', watch([cart([2.5, 0, 0.5]), cart([8.5, 0, 0.5])]), go(0.3), ticks(60)),
  ...both('head_on', watch([cart([2.5, 0, 0.5]), cart([12.5, 0, 0.5])]), go(0.2), go(-0.2, 0, 'summon1'), ticks(60)),
  ...both('furnace_into_a_cart', watch([cart([2.5, 0, 0.5], 'furnace_minecart', { nbt: '{Fuel:300s,PushX:1.0d,PushZ:0.0d}' }), cart([8.5, 0, 0.5])]), go(0.1), ticks(100)),
  // a cart that picks up a mob, then carries it
  ...both('picks_up_a_mob', watch([cart([2.5, 0, 0.5]), { entity: 'pig', at: [8.5, 0, 0.5], noAi: true }]), go(0.4), ticks(80)),
  // what stands on the track: the player the cart runs into, a mob beside a still cart that shoves it
  ...both('into_the_player', watch([cart([20.5, 0, 0.5])], { at: [28.5, 0, 0.5] }), go(0.3), ticks(80)),
  ...both('shoved_by_a_mob', watch([cart([8.5, 0, 0.5], 'chest_minecart'), { entity: 'pig', at: [9.1, 0, 0.5], noAi: true }]), ticks(40)),
  // what stops a cart in a way: a block set on the track as it runs
  ...both('block_on_track', watch([cart([2.5, 0, 0.5])]), go(0.3), server(setBlock([14, 1, 0], 'stone')), ticks(80)),
)

// What a chest or hopper cart holds is its drag (the comparator's signal): each release's item stack, its own way.
const full = (name: string, entity: string) => [
  ...both(`${name}_full`, watch([cart([2.5, 0, 0.5], entity, { nbt: '{Items:[{Slot:0b,id:"minecraft:stone",Count:64b,Damage:0s},{Slot:1b,id:"minecraft:stone",Count:64b,Damage:0s}]}' })], { until: '1.20.5' }), go(0.3), ticks(100)),
  ...both(`${name}_full_new`, watch([cart([2.5, 0, 0.5], entity, { nbt: '{Items:[{Slot:0b,id:"minecraft:stone",count:64},{Slot:1b,id:"minecraft:stone",count:64}]}' })], { since: '1.20.5' }), go(0.3), ticks(100)),
]
out.push(...full('chest', 'chest_minecart'), ...full('hopper', 'hopper_minecart'))

// In water: the speed and the drag from 1.17, the gravity on the way down, its current nowhere.
const wet = (summon: Parameters<typeof watch>[0]): KaseSpec => ({ ...watch(summon), area: 'minecartsWet', at: [-5.5, 0, 0.5], since: '1.13' })
out.push(
  ...both('water_rail', wet([cart([2.5, 0, 0.5])]), go(0.4), ticks(80)),
  ...both('water_slope', wet([cart([6.5, 0, 8.5])]), go(0.3), ticks(100)),
  ...both('water_pool', wet([cart([6.5, 2, 18.5])]), go(0.3), ticks(80)),
  ...both('water_furnace', wet([cart([2.5, 0, 0.5], 'furnace_minecart', { nbt: '{Fuel:300s,PushX:1.0d,PushZ:0.0d}' })]), go(0.1), ticks(80)),
  ...both('water_chest', wet([cart([2.5, 0, 0.5], 'chest_minecart')]), go(0.3), ticks(60)),
)

// A ridden cart, whose moves the rider's input starts and a rider's weight slows.
const ride = (at: Pos, extra: Partial<KaseSpec> = {}): KaseSpec => ({ area: 'minecarts', at, yaw: 270, tier: 3, tags: ['vehicle', 'minecart'], ...extra, setup: { ...extra.setup, mount: { entity: 'minecart', yaw: 90 } } })
out.push(
  ...both('ride_forward', ride([2.5, 0, 0.5]), press(F, 60), ticks(60)),
  ...both('ride_on_a_brake', ride([15.5, 0, 3.5]), press(F, 40), ticks(40)),
  // (the rail throws the rider off: the server puts it where it lands)
  ...both('ride_activator', ride([2.5, 0, -2.5], { serverMoves: true }), press(F, 80), ticks(30)),
  ...both('ride_turning', ride([2.5, 0, 0.5]), hold(F), ticks(40), releaseAll(), ticks(40)),
)

// the top speed the game rule sets, which only the experiment has
out.push(
  kase('mx_top_speed', {
    ...watch([cart([2.5, 0, 0.5])]), since: '1.21.2', tags: ['minecart', 'feature:minecart_improvements'],
    setup: { summon: [cart([2.5, 0, 0.5])], commands: [{ '1.21.2': 'gamerule minecartMaxSpeed 40', '1.21.11': 'gamerule max_minecart_speed 40' }] },
  }, go(2.0), ticks(30)),
)

// The side effects, on the `minecartHazards` area's runs: what a TNT cart does, by its fuse, a wall, a fall and fire; what a
// hopper cart takes; a command block cart on the rail that runs it; what breaks a cart. Each stands on the server's view: the
// damage, the fuse, the inventory and the cart gone. The fuse and the blast draw on the cart's random, which the recording
// keeps for the engine.
const hazard = (summon: Parameters<typeof watch>[0], extra: Partial<KaseSpec> = {}): KaseSpec => watch(summon, { area: 'minecartHazards', at: [-5.5, 0, 12.5], ...extra })
const FUSED = '{TNTFuse:20,fuse:20}'
out.push(
  // the rail primes it; it rolls on until the fuse is out
  ...both('tnt_activator', hazard([cart([6.5, 0, 0.5], 'tnt_minecart')]), go(0.3), ticks(120)),
  ...both('tnt_activator_off', hazard([cart([6.5, 0, 3.5], 'tnt_minecart')]), go(0.3), ticks(60)),
  // lit already: at rest and moving, the blast growing with its speed
  ...both('tnt_fused_rest', hazard([cart([2.5, 0, 3.5], 'tnt_minecart', { nbt: FUSED })]), ticks(40)),
  ...both('tnt_fused_moving', hazard([cart([12.5, 0, 3.5], 'tnt_minecart', { nbt: FUSED })]), go(0.4), ticks(40)),
  // the stone at the end of a run, into it at speed
  ...both('tnt_wall', hazard([cart([34.5, 0, 0.5], 'tnt_minecart')]), go(0.4), ticks(40)),
  // (the rail stops it dead, so nothing goes off above: along a wall it keeps the speed that sets it off)
  ...both('tnt_along_a_wall', hazard([cart([19.4, 0, 13.9], 'tnt_minecart')]), go(0.3, 0.3), ticks(30)),
  // falls: under three blocks nothing, over them the fall sets it off
  ...both('tnt_falls_short', hazard([cart([2.5, 2, 12.5], 'tnt_minecart')]), ticks(30)),
  ...both('tnt_falls', hazard([cart([2.5, 6, 12.5], 'tnt_minecart')]), ticks(40)),
  // fire and lava: at once or by a fuse of its random's, by the release
  ...both('tnt_in_fire', hazard([cart([8.5, 0, 6.5], 'tnt_minecart')]), server(setBlock([8, 1, 6], 'fire')), ticks(70)),
  ...both('tnt_in_lava', hazard([cart([14.5, 3, 9.5], 'tnt_minecart')]), ticks(70)),
  // what a hopper cart takes off the rail: all of a stack, a stack that only part fits, one that it misses on a rail it stopped at
  ...both('hopper_item', hazard([cart([2.5, 0, 3.5], 'hopper_minecart'), { entity: 'item', at: [12.5, 0.2, 3.5], nbt: '{Item:{id:"minecraft:stone",Count:3b,Damage:0s}}' }], { until: '1.20.5' }), go(0.2), ticks(90)),
  ...both('hopper_item_new', hazard([cart([2.5, 0, 3.5], 'hopper_minecart'), { entity: 'item', at: [12.5, 0.2, 3.5], nbt: '{Item:{id:"minecraft:stone",count:3}}' }], { since: '1.20.5' }), go(0.2), ticks(90)),
  ...both('hopper_item_stopped', hazard([cart([2.5, 0, 0.5], 'hopper_minecart'), { entity: 'item', at: [16.5, 0.2, 0.5], nbt: '{Item:{id:"minecraft:stone",Count:3b,Damage:0s}}' }], { until: '1.20.5' }), go(0.3), ticks(90)),
  ...both('hopper_item_stopped_new', hazard([cart([2.5, 0, 0.5], 'hopper_minecart'), { entity: 'item', at: [16.5, 0.2, 0.5], nbt: '{Item:{id:"minecraft:stone",count:3}}' }], { since: '1.20.5' }), go(0.3), ticks(90)),
  ...both('hopper_part_of_a_stack', hazard([cart([2.5, 0, 3.5], 'hopper_minecart', { nbt: '{Items:[{Slot:0b,id:"minecraft:stone",Count:62b,Damage:0s},{Slot:1b,id:"minecraft:dirt",Count:64b,Damage:0s},{Slot:2b,id:"minecraft:dirt",Count:64b,Damage:0s},{Slot:3b,id:"minecraft:dirt",Count:64b,Damage:0s},{Slot:4b,id:"minecraft:dirt",Count:64b,Damage:0s}]}' }), { entity: 'item', at: [8.5, 0.2, 3.5], nbt: '{Item:{id:"minecraft:stone",Count:5b,Damage:0s}}' }], { until: '1.20.5' }), go(0.2), ticks(90)),
  ...both('hopper_part_of_a_stack_new', hazard([cart([2.5, 0, 3.5], 'hopper_minecart', { nbt: '{Items:[{Slot:0b,id:"minecraft:stone",count:62},{Slot:1b,id:"minecraft:dirt",count:64},{Slot:2b,id:"minecraft:dirt",count:64},{Slot:3b,id:"minecraft:dirt",count:64},{Slot:4b,id:"minecraft:dirt",count:64}]}' }), { entity: 'item', at: [8.5, 0.2, 3.5], nbt: '{Item:{id:"minecraft:stone",count:5}}' }], { since: '1.20.5' }), go(0.2), ticks(90)),
  // the rail that runs a command block cart's command, and not again within its delay
  ...both('command_activator', hazard([cart([8.5, 0, 0.5], 'command_block_minecart', { nbt: '{Command:"say hi"}' })]), go(0.15), ticks(60)),
  ...both('command_on_the_rail', hazard([cart([10.5, 0, 0.5], 'command_block_minecart', { nbt: '{Command:"say hi"}' })]), ticks(20)),
  // a player's hits (VehicleEntity.hurtServer): the damage and the shake each adds, the cart gone past 40, at once from a creative player
  ...both('hurt_punched', hazard([cart([-3.5, 0, 12.5])], { yaw: 270, pitch: 30 }), crosshair(), press(ATTACK, 1), ticks(20)),
  ...both('hurt_punched_to_pieces', hazard([cart([-3.5, 0, 12.5])], { yaw: 270, pitch: 30 }), crosshair(),
    // (6 ticks apart: a fist's whole charge each, and the damage falls by 6 meanwhile, so it takes ten to pass 40)
    ...Array.from({ length: 10 }, () => [press(ATTACK, 1), ticks(5)]).flat(), ticks(10)),
  ...both('hurt_by_creative', hazard([cart([-3.5, 0, 12.5])], { yaw: 270, pitch: 30, gamemode: 'creative' }), crosshair(), press(ATTACK, 1), ticks(10)),
  // the hurt a powered rail gives a rideable cart, over and over while it stays on it
  ...both('activator_rests', hazard([cart([10.5, 0, 0.5])]), ticks(30)),
  // fire and lava on the plain cart, soul fire's double
  ...both('in_fire', hazard([cart([8.5, 0, 6.5])]), server(setBlock([8, 1, 6], 'fire')), ticks(30)),
  ...both('rolls_through_fire', hazard([cart([12.5, 0, 6.5])]), go(0.3), ticks(40)),
  ...both('in_soul_fire', hazard([cart([8.5, 0, 34.5])], { since: '1.16' }), server(setBlock([8, 1, 34], 'soul_fire')), ticks(30)),
  ...both('chest_in_fire', hazard([cart([8.5, 0, 6.5], 'chest_minecart')]), server(setBlock([8, 1, 6], 'fire')), ticks(30)),
  ...both('into_cactus', hazard([cart([9.25, 0, 13.5])]), go(0.3), ticks(40)),
  ...both('in_lava', hazard([cart([14.5, 3, 9.5])]), ticks(30)),
  ...both('rolls_into_lava', hazard([cart([4.5, 0, 9.5])]), go(0.3), ticks(60)),
  // off a height, for the fall distance and the landing
  ...both('falls', hazard([cart([2.5, 6, 12.5])]), ticks(40)),
  // honey and slime: a rail keeps either's speed factor off, bare they slow it; slime throws what lands on it; honey's side slows a fall
  ...both('rail_on_honey', hazard([cart([1.5, 0, 16.5])], { since: '1.15' }), go(0.3), ticks(60)),
  ...both('on_honey', hazard([cart([12.5, 0, 16.5])], { since: '1.15' }), go(0.3), ticks(40)),
  ...both('rail_on_slime', hazard([cart([1.5, 0, 19.5])]), go(0.3), ticks(60)),
  ...both('on_slime', hazard([cart([12.5, 0, 19.5])]), go(0.3), ticks(40)),
  ...both('falls_on_slime', hazard([cart([15.5, 6, 19.5])]), ticks(60)),
  ...both('falls_on_honey', hazard([cart([15.5, 6, 16.5])], { since: '1.15' }), ticks(40)),
  ...both('down_honey_wall', hazard([cart([9.5, 8, 22.5])], { since: '1.15' }), go(0.05), ticks(50)),
  // into a column of bubbles: up, and down
  ...both('bubbles_up', hazard([cart([9.5, 6, 26.5])], { since: '1.13' }), ticks(80)),
  ...both('bubbles_down', hazard([cart([11.5, 6, 26.5])], { since: '1.13' }), ticks(60)),
  // an iron golem: a cart picks up nothing of the kind, it stops it, and one beside a still cart shoves it
  ...both('into_a_golem', watch([cart([2.5, 0, 0.5]), { entity: 'iron_golem', at: [12.5, 0, 0.5], noAi: true }]), go(0.3), ticks(80)),
  ...both('shoved_by_a_golem', watch([cart([8.5, 0, 0.5], 'chest_minecart'), { entity: 'iron_golem', at: [9.2, 0, 0.5], noAi: true }]), ticks(40)),
)

// Out of the level: under the bottom, and through the portals (the cart goes, the recording stays in the overworld).
out.push(
  ...both('below_world', watch([cart([2.5, -160, 12.5])], { until: '1.18' }), ticks(30)),
  ...both('below_world_deep', watch([cart([2.5, -224, 12.5])], { since: '1.18' }), ticks(30)),
  ...both('nether_portal', watch([cart([5.25, 0, 0])], { area: 'portals', at: [-3.5, 0, -6], requires: ['nether_portal'] }), go(0.3), ticks(20)),
  ...both('end_portal', watch([cart([20.5, 2, -5.5])], { area: 'portals', at: [-3.5, 0, -6] }), ticks(30)),
)

// What only the server's block entities and its random know (B189): a hopper cart taking from the chest over it, a TNT
// cart's blast on the carts about it, a spawner cart's countdown, and an end gateway sending a cart down its own rails. The
// commands write NBT, so they name the world's blocks: the area's origin is (0, 100, 0) and its fills are a block lower
// (BridgeImpl.ORIGIN; physrec.ts shift), so the fill cell (x, y, z) is the world's (x, 99 + y, z).
const world = ([x, y, z]: Pos) => `${x} ${99 + (y ?? 0)} ${z}`
const stone = (count: number) => commandBy({
  '1.20.5': `setblock ${world([2, 2, 3])} chest{Items:[{Slot:0b,id:"minecraft:stone",count:${count}}]}`,
  '1.13': `setblock ${world([2, 2, 3])} chest{Items:[{Slot:0b,id:"minecraft:stone",Count:${count}b}]}`,
  '1.8': `setblock ${world([2, 2, 3])} chest 0 replace {Items:[{Slot:0b,id:"minecraft:stone",Count:${count}b,Damage:0s}]}`,
})
// (ExactTeleport sends it to the exit itself; exit_portal is an int array from 1.20.5)
const gateway = commandBy({
  '1.20.5': `setblock ${world([14, 1, 3])} end_gateway{exit_portal:[I;24,100,3],ExactTeleport:1b}`,
  '1.13': `setblock ${world([14, 1, 3])} end_gateway{ExitPortal:{X:24,Y:100,Z:3},ExactTeleport:1b}`,
  '1.9': `setblock ${world([14, 1, 3])} end_gateway 0 replace {ExitPortal:{X:24,Y:100,Z:3},ExactTeleport:1b}`,
})
// (no spawn count, so that the spawner only counts down: what comes of a spawn is the level's random)
const SPAWNER = '{Delay:30s,MinSpawnDelay:400s,MaxSpawnDelay:400s,SpawnCount:0s}'
out.push(
  // one item a tick until the chest is empty, then nothing; at rest, and rolling under it
  ...both('hopper_from_chest', hazard([cart([2.5, 0, 3.5], 'hopper_minecart')]), server(stone(3)), ticks(20)),
  ...both('hopper_under_chest_rolling', hazard([cart([0.5, 0, 3.5], 'hopper_minecart')]), server(stone(64)), go(0.1), ticks(40)),
  // a lit TNT cart at rest between a cart near enough to break and one far enough to be pushed
  ...both('tnt_blast_on_carts', hazard([cart([2.5, 0, 3.5], 'tnt_minecart', { nbt: FUSED }), cart([6.5, 0, 3.5]), cart([10.1, 0, 3.5], 'chest_minecart')]), ticks(40)),
  ...both('spawner_counts_down', hazard([cart([2.5, 0, 12.5], 'spawner_minecart', { nbt: SPAWNER })]), ticks(40)),
  ...both('spawner_out_of_range', hazard([cart([2.5, 0, 12.5], 'spawner_minecart', { nbt: '{Delay:30s,RequiredPlayerRange:4s,SpawnCount:0s}' })]), ticks(20)),
  ...both('end_gateway', hazard([cart([6.5, 0, 3.5])], { since: '1.9' }), server(gateway), go(0.3), ticks(60)),
)

// What pushes a cart and what a cart pushes by more than its box (B189): the scoreboard teams' collision rules from 1.9
// (EntitySelector.pushableBy), an armor stand, which pushes only a rideable cart at its own place and is not pushable, and a
// bat, which pushes nothing and is not pushable; and the order the level ticks them in, which is their summons' order: a boat
// and a mob ahead of the cart, another after it. Each entity a team takes is tagged (Tags from 1.9) for the join's selector.
const tagged = (tag: string) => ({ nbt: `{Tags:["${tag}"]}` })
// (in the setup, after the summons and ahead of the first tick, so that nothing pushes before the rules hold)
const teamUp = (...teams: (readonly [string, string])[]): Partial<KaseSpec> => ({
  since: '1.9',
  setup: {
    commands: teams.flatMap(([team, rule]) => [
      { '1.13': `team add ${team}`, '1.9': `scoreboard teams add ${team}` },
      { '1.13': `team modify ${team} collisionRule ${rule}`, '1.9': `scoreboard teams option ${team} collisionRule ${rule}` },
      { '1.13': `team join ${team} @e[tag=${team}]`, '1.9': `scoreboard teams join ${team} @e[tag=${team}]` },
    ]),
  },
})
// (a team stays for the next case: each goes before its case ends)
const teamDown = (team: string) => server(commandBy({ '1.13': `team remove ${team}`, '1.9': `scoreboard teams remove ${team}` }))
out.push(
  // a cow on a team that never collides shoves nothing; a cart on such a team is shoved by nothing
  ...both('team_cow_never', watch([cart([8.5, 0, 0.5], 'chest_minecart'), { entity: 'cow', at: [9.1, 0, 0.5], noAi: true, ...tagged('tn') }], teamUp(['tn', 'never'])), ticks(40), teamDown('tn'), ticks(2)),
  ...both('team_cart_never', watch([cart([8.5, 0, 0.5], 'chest_minecart', tagged('tn')), { entity: 'cow', at: [9.1, 0, 0.5], noAi: true }], teamUp(['tn', 'never'])), ticks(40), teamDown('tn'), ticks(2)),
  // a fast cart and a pig of one team that pushes only other teams: the pig is picked up; of two such teams it is not
  ...both('team_own_picks_up', watch([cart([2.5, 0, 0.5], 'minecart', tagged('to')), { entity: 'pig', at: [8.5, 0, 0.5], noAi: true, ...tagged('to') }], teamUp(['to', 'pushOtherTeams'])), go(0.4), ticks(60), teamDown('to'), ticks(2)),
  ...both('team_other_passes', watch([cart([2.5, 0, 0.5], 'minecart', tagged('ta')), { entity: 'pig', at: [8.5, 0, 0.5], noAi: true, ...tagged('tb') }], teamUp(['ta', 'pushOtherTeams'], ['tb', 'always'])), go(0.4), ticks(60), teamDown('ta'), teamDown('tb'), ticks(2)),
  // an armor stand at a still cart's place pushes it; a cart runs through one, which picks it up only before 1.10
  ...both('armor_stand_beside', watch([cart([8.5, 0, 0.5]), { entity: 'armor_stand', at: [8.75, 0, 0.5] }]), ticks(40)),
  ...both('into_an_armor_stand', watch([cart([2.5, 0, 0.5]), { entity: 'armor_stand', at: [8.5, 0, 0.5] }]), go(0.4), ticks(60)),
  // a bat in a cart's way, hanging still: not picked up, and it pushes nothing
  ...both('into_a_bat', watch([cart([2.5, 0, 0.5]), { entity: 'bat', at: [8.5, 0.2, 0.5], noAi: true, noGravity: true }]), go(0.4), ticks(60)),
  ...both('bat_beside', watch([cart([8.5, 0, 0.5], 'chest_minecart'), { entity: 'bat', at: [9.0, 0.2, 0.5], noAi: true, noGravity: true }]), ticks(30)),
  // the level's order: a boat summoned ahead of a moving cart pushes it before the cart's move; a cow ahead of a still cart
  // shoves it before its tick, a pig after it shoves it after
  ...both('boat_ahead', watch([{ entity: 'oak_boat', at: [9.4, 0, 0.5], noAi: true }, cart([8.5, 0, 0.5], 'chest_minecart')], { since: '1.9' }), go(0.05, 0, 'summon1'), ticks(30)),
  ...both('mobs_either_side', watch([{ entity: 'cow', at: [7.9, 0, 0.5], noAi: true }, cart([8.5, 0, 0.5], 'chest_minecart'), { entity: 'pig', at: [9.1, 0, 0.5], noAi: true }]), ticks(40)),
)

// What a TNT cart's blast does that no client sees but comes back in its packets and the server's view (B189): the blocks its
// rays break, which their resistance shortens (obsidian beside it stays, and keeps what is behind it), and the items about it,
// one near enough to burn up and one far enough off to keep.
const item = (at: Pos, flat: boolean) => ({ entity: 'item', at, nbt: flat ? '{Item:{id:"minecraft:stone",count:1}}' : '{Item:{id:"minecraft:stone",Count:1b,Damage:0s}}' })
const lit = cart([2.5, 0, 3.5], 'tnt_minecart', { nbt: FUSED })
out.push(
  ...both('tnt_blast_on_items', hazard([lit, item([4.5, 0.2, 3.5], false), item([9.9, 0.2, 3.5], false)], { until: '1.20.5' }), ticks(40)),
  ...both('tnt_blast_on_items_new', hazard([lit, item([4.5, 0.2, 3.5], true), item([9.9, 0.2, 3.5], true)], { since: '1.20.5' }), ticks(40)),
  ...both('tnt_blast_by_obsidian', hazard([lit]), server(setBlock([2, 0, 5], 'obsidian')), server(setBlock([2, 1, 5], 'obsidian')), server(setBlock([2, 0, 6], 'stone')), ticks(40)),
)

// What the B280 review found of the cart's server side (minecart.rs), each where a recording shows it: a creative player's
// hit takes an invulnerable cart away; a mob an activator rail threw off is not picked up again by the cart behind within
// its boarding cooldown (1.9); a blast of no power is nothing to a cart at its own place (the NaN of 1.21.9 and 1.21.10
// is left out: no recording holds it); a blast spares its cart's allies on a team without friendly fire (26.3); and a
// stack of up to 99 fills a hopper cart's slot by 99 for its comparator (1.20.5).
const POWERLESS = '{TNTFuse:20,fuse:20,explosion_power:0.0f}'
const friendlyFireOff = (team: string): Partial<KaseSpec> => ({
  setup: {
    commands: [
      { '1.13': `team add ${team}` },
      { '1.13': `team modify ${team} friendlyFire false` },
      { '1.13': `team join ${team} @e[tag=${team}]` },
    ],
  },
})
out.push(
  ...both('hurt_invulnerable_by_creative', hazard([cart([-3.5, 0, 12.5], 'minecart', { nbt: '{Invulnerable:1b}' })], { yaw: 270, pitch: 30, gamemode: 'creative' }), crosshair(), press(ATTACK, 1), ticks(10)),
  ...both('hurt_invulnerable_punched', hazard([cart([-3.5, 0, 12.5], 'minecart', { nbt: '{Invulnerable:1b}' })], { yaw: 270, pitch: 30 }), crosshair(), press(ATTACK, 1), ticks(10)),
  // (the front cart picks the pig up within its reach before it meets it, and the rail at x 10 throws it off beside the
  // track; the cart behind, set going later so that it never meets the front one, reaches it fast enough to pick it up
  // some fifteen ticks later)
  ...both('ejected_mob_left_alone', hazard([cart([3.0, 0, 0.5]), cart([6.0, 0, 0.5]), { entity: 'pig', at: [8.5, 0, 0.5], noAi: true }], { since: '1.9' }),
    go(0.3, 0, 'summon1'), ticks(8), go(0.5), ticks(40)),
  ...both('tnt_blast_powerless', hazard([cart([2.5, 0, 3.5], 'tnt_minecart', { nbt: POWERLESS }), cart([2.5, 0, 3.5])], { since: '1.21.2', until: '1.21.9' }), ticks(30)),
  ...both('tnt_blast_powerless_new', hazard([cart([2.5, 0, 3.5], 'tnt_minecart', { nbt: POWERLESS }), cart([2.5, 0, 3.5])], { since: '1.21.11' }), ticks(30)),
  ...both('tnt_blast_spares_allies', hazard([cart([2.5, 0, 3.5], 'tnt_minecart', { nbt: '{TNTFuse:20,fuse:20,Tags:["tf"]}' }), cart([6.5, 0, 3.5], 'minecart', tagged('tf'))], { since: '1.13', ...friendlyFireOff('tf') }),
    ticks(40), teamDown('tf'), ticks(2)),
  ...both('hopper_large_stack', hazard([
    cart([2.5, 0, 3.5], 'hopper_minecart', { nbt: '{Items:[{Slot:0b,id:"minecraft:stone",count:60,components:{"minecraft:max_stack_size":99}}]}' }),
    { entity: 'item', at: [8.5, 0.2, 3.5], nbt: '{Item:{id:"minecraft:dirt",count:1}}' },
  ], { since: '1.20.5' }), go(0.2), ticks(60)),
)

export default out
