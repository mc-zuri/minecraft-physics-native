// The player's edges no other family reaches (pl_*): a glide into water with the swim, which 1.21.5 turned round; poses a
// spectator or a passenger keeps under a ceiling, a tunnel entered by dismounting, a ceiling that comes and goes, a pool that
// ends in a tunnel; water at the eyes without the feet; the eyes at a fluid's surface, a double either way; modifier mixtures
// whose result depends on the order they fold in; impulses on a sleeper and on the dead; a hit that lands and one that does
// not, from what the client's Player.attack sees.
import './_areas/index.ts'
import {
  ATTACK, F, JUMP, SNEAK, SPRINT, USE, command, crosshair, hold, impulse, item, kase, look, press, releaseAll, respawn,
  respawnPoint, screen, server, setBlock, stopped, summon, teleport, ticks, until, untilOr, wake,
} from '../../dsl/physrec.ts'
import { ANVILS, FEATURE_LANES, INSIDE_LANES, NEIGHBOUR_LANES, PLAYER_LANES, laneZ } from './_areas/java-areas.ts'
import type { KaseSpec } from '../../dsl/physrec.ts'
import type { ModifierSpec } from '../../dsl/core.ts'

const out = []
const lane = (name: (typeof PLAYER_LANES)[number]) => laneZ(PLAYER_LANES.indexOf(name)) + 0.5
const pose = (extra: Partial<KaseSpec>): KaseSpec => ({ area: 'flat', at: [0.5, 0, 0.5], yaw: 270, tier: 2, tags: ['pose'], since: '1.14', ...extra })

// ---- A glide into water -------------------------------------------------------------------------------------------
// Sprinting and under water with the glide still on: Player.getDesiredPose asks the swim first from 1.21.5, updatePlayerPose
// the glide first to 1.21.4 (1.21.4 PlayerEntity.java:437-450, 1.21.5 Player.java:465-477). The sprint is on before the glide.
const launch = [ticks(7), press(JUMP, 1)]
const glide = { area: 'skyWater', at: [0.5, 30, 2.8], yaw: 0, tier: 3, tags: ['elytra', 'pose', 'swimming'], since: '1.13', serverMoves: true,
  setup: { equipment: { chest: { id: 'elytra', enchantments: {} } } } }
for (const pitch of [60, 80]) {
  out.push(kase(`pl_glide_into_water_sprint_${pitch}`, glide, hold(F, SPRINT), launch, look(0, pitch), untilOr('onGround', 200), ticks(5), releaseAll(), ticks(3)))
}

// ---- A pose a spectator or a passenger keeps ----------------------------------------------------------------------
const tunnel = { area: 'tunnels', at: [2.5, 0, -2.5], yaw: 270, tier: 2, since: '1.14', tags: ['pose', 'crawl'] }
out.push(
  // the swim's room is there, standing's is not: a spectator stands all the same, and on leaving spectator the crawl comes back
  kase('pl_crawl_spectator_entry', { ...tunnel, serverMoves: true }, ticks(5), server(command('gamemode spectator @p')), ticks(10), server(command('gamemode survival @p')), ticks(10), press(F, 10), ticks(5)),
  kase('pl_crawl_creative_flight', { ...tunnel, serverMoves: true, gamemode: 'creative' }, ticks(5), press(JUMP, 1), ticks(2), press(JUMP, 1), ticks(10), press(F, 10), ticks(5)),
  // a boat in the tunnel: the seat fits the swim's box, not standing's. Sneak dismounts, and vanilla's dismount looks for the crawl
  kase('pl_passenger_tunnel_dismount_boat', { ...tunnel, tier: 3, serverMoves: true, tags: ['pose', 'crawl', 'vehicle'], setup: { mount: { entity: 'oak_boat', yaw: 270 } } },
    ticks(10), press(SNEAK, 2), ticks(15), press(F, 8), ticks(5)),
  // a pig's seat fits neither: nothing changes (Player.updatePlayerPose's first test)
  kase('pl_passenger_tunnel_dismount_pig', { ...tunnel, tier: 3, serverMoves: true, tags: ['pose', 'crawl', 'vehicle'], setup: { mount: { entity: 'pig', noAi: true, yaw: 270 } } },
    ticks(10), press(SNEAK, 2), ticks(15), press(F, 8), ticks(5)),
)

// ---- A ceiling that comes and goes --------------------------------------------------------------------------------
const overHead = [[0, 2, 0], [1, 2, 0], [0, 2, 1], [1, 2, 1]]
const ceiling = (state: string) => overHead.map(at => setBlock(at, state))
out.push(
  kase('pl_ceiling_stone_comes_and_goes', pose({}), ticks(3), server(...ceiling('stone')), ticks(6), press(F, 2), ticks(4), server(...ceiling('air')), ticks(6), press(F, 4), ticks(4)),
  // a closed trapdoor takes the crouch's room as well, an open one gives it back: the shape changes, the block does not
  kase('pl_ceiling_trapdoor_opens', pose({}), ticks(3), server(...ceiling('oak_trapdoor[half=bottom,open=false]')), ticks(6), server(...ceiling('oak_trapdoor[half=bottom,open=true]')), ticks(6), press(F, 6), ticks(4)),
  // room for the crouch, not for standing
  kase('pl_ceiling_slab_forces_crouch', pose({}), ticks(3), server(...ceiling('stone_slab[type=top]')), ticks(6), server(...ceiling('air')), ticks(6)),
)

// ---- Water at the eyes, water at the feet -------------------------------------------------------------------------
// updateSwimming starts on the eyes alone to 1.17 and wants the feet's block from 1.17.1 (1.16.5 Entity.java updateSwimming,
// 1.18 Entity.java:1187-1190): the sprint walks under hanging water, and then into water to the knees.
out.push(
  kase('pl_swim_eyes_only_sprint', { area: 'playerEdges', at: [1.5, 0, lane('eyes')], yaw: 270, tier: 2, since: '1.13', tags: ['swimming', 'eyes'] }, hold(F, SPRINT), ticks(30), releaseAll(), ticks(10)),
  kase('pl_swim_eyes_only_walk', { area: 'playerEdges', at: [1.5, 0, lane('eyes')], yaw: 270, tier: 2, since: '1.13', tags: ['swimming', 'eyes'] }, press(F, 30), ticks(10)),
  // out of a pool into a dry crawl: the swim ends at the water's edge, the pose does not
  kase('pl_water_exit_into_tunnel', { area: 'playerEdges', at: [3.5, 0, lane('exit')], yaw: 270, tier: 2, since: '1.14', tags: ['swimming', 'pose', 'crawl'] }, ticks(6), hold(F, SPRINT), ticks(40), releaseAll(), ticks(10)),
  kase('pl_water_exit_into_tunnel_walk', { area: 'playerEdges', at: [3.5, 0, lane('exit')], yaw: 270, tier: 2, since: '1.14', tags: ['swimming', 'pose', 'crawl'] }, ticks(6), press(F, 50), ticks(10)),
)

// ---- The eyes at the surface --------------------------------------------------------------------------------------
// Entity.updateFluidOnEyes: the eyes are under while the fluid's top is above them, strictly, the top the block's y plus the
// float height 8/9. To 1.20.4 it asks at the eyes less 0.11111111F (1.20.4 Entity.java:1711-1730), from 1.20.5 at the eyes.
// A flying player holds still at a position set by the teleport, so each offset is one double: the surface is world y 102
// plus the height, the top of the pool's three layers from world y 100, as an area's y 0 is 100 (java-areas.ts).
const f = Math.fround
const up = (x: number, n: number): number => {
  const bits = new BigInt64Array(new Float64Array([x]).buffer)
  bits[0] = bits[0]! + BigInt(n)
  return new Float64Array(bits.buffer)[0]!
}
const SURFACE = 102 + f(8 / 9)
const EYE = f(1.62)
const LOW = f(0.11111111)
const flying = { area: 'playerEdges', yaw: 270, tier: 2, gamemode: 'creative', tags: ['fluid', 'eyes', 'surface'] }
for (const [name, eyes] of [['eye', SURFACE], ['low', SURFACE + LOW]] as const) {
  for (const [offset, ulps] of [['at', 0], ['above', 1], ['below', -1]] as const) {
    const y = up(eyes - EYE, ulps)
    out.push(kase(`pl_surface_${name}_${offset}`, { ...flying, at: [2.5, 4, lane('surface')], setup: { flying: true } }, ticks(2), server(teleport(2.5, y - 100, lane('surface'))), ticks(6)))
  }
}

// ---- Modifier mixtures --------------------------------------------------------------------------------------------
// The fold rounds at each step, so an order shows in the last bit of the double; getSpeed casts to a float, so a base is
// chosen for each mixture with the result a hair from a float's rounding boundary, where the order decides which float it
// is. AttributeInstance folds each operation's set in its container's order, which a release's map decides.
const ADD: readonly ModifierSpec[] = [{ name: 'add_a', amount: 0.013, operation: 'add_value' }, { name: 'add_b', amount: 0.0271, operation: 'add_value' }]
const BASE: readonly ModifierSpec[] = [{ name: 'base_a', amount: 0.15, operation: 'add_multiplied_base' }, { name: 'base_b', amount: 0.0711, operation: 'add_multiplied_base' }]
const TOTAL: readonly ModifierSpec[] = [
  { name: 'total_a', amount: 0.1137, operation: 'add_multiplied_total' }, { name: 'total_b', amount: 0.2309, operation: 'add_multiplied_total' },
  { name: 'total_c', amount: -0.1743, operation: 'add_multiplied_total' },
]
const permutations = <T>(list: readonly T[]): T[][] => (list.length < 2 ? [[...list]] : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map(rest => [x, ...rest])))
/** AttributeInstance.calculateValue, one order of each operation's modifiers. */
const fold = (base: number, adds: readonly number[], bases: readonly number[], totals: readonly number[]): number => {
  let start = base
  for (const a of adds) start += a
  let value = start
  for (const b of bases) value += start * b
  for (const t of totals) value *= 1 + t
  return value
}
/** The floats the orders of the mixture give for a base. */
const orderOutcomes = (base: number, extraTotals: readonly number[] = []): number[] => {
  const seen = new Set<number>()
  for (const adds of permutations(ADD.map(m => m.amount))) {
    for (const bases of permutations(BASE.map(m => m.amount))) {
      for (const totals of permutations([...TOTAL.map(m => m.amount), ...extraTotals])) seen.add(f(fold(base, adds, bases, totals)))
    }
  }
  return [...seen].sort((a, b) => a - b)
}
/** A base near `near` whose result the order decides: the nearest one at which two floats come out. */
const orderSensitiveBase = (near: number, extraTotals: readonly number[] = []): number => {
  const middle = fold(near, ADD.map(m => m.amount), BASE.map(m => m.amount), [...TOTAL.map(m => m.amount), ...extraTotals])
  const low = f(middle)
  const next = f(up(low, 0) + 2 ** (Math.floor(Math.log2(low)) - 23))
  const boundary = (low + next) / 2
  const scale = (fold(near + 1e-9, ADD.map(m => m.amount), BASE.map(m => m.amount), [...TOTAL.map(m => m.amount), ...extraTotals]) - middle) / 1e-9
  const guess = near + (boundary - middle) / scale
  for (let ulps = 0; ulps < 4096; ulps += 1) {
    for (const sign of [1, -1]) {
      const base = up(guess, sign * ulps)
      if (orderOutcomes(base, extraTotals).length > 1) return base
    }
  }
  throw new Error(`no base near ${near} shows an order`)
}
const SPRINT_TOTAL = 0.30000001192092896
const mixture = (near: number, sprint: boolean, ...extra: Partial<KaseSpec>[]): KaseSpec => ({
  area: 'flat', at: [0.5, 0, 0.5], yaw: 270, tier: 2, tags: ['attribute', 'movement_speed', 'modifiers'],
  setup: { attributes: { movement_speed: orderSensitiveBase(near, sprint ? [SPRINT_TOTAL] : []) }, modifiers: { movement_speed: [...TOTAL, ...ADD, ...BASE] } },
  ...Object.assign({}, ...extra),
})
out.push(
  kase('pl_mod_mix_walk_a', mixture(0.1, false), press(F, 20), stopped(3)),
  kase('pl_mod_mix_walk_b', mixture(0.07, false), press(F, 20), stopped(3)),
  kase('pl_mod_mix_sprint_a', mixture(0.1, true), press([F, SPRINT], 20), stopped(3)),
  kase('pl_mod_mix_sprint_toggle', mixture(0.13, true), press([F, SPRINT], 10), ticks(5), press(F, 10), press([F, SPRINT], 10), stopped(3)),
)

// ---- Impulses on a sleeper and on the dead ------------------------------------------------------------------------
const bed = { area: 'features', at: [0.5, 0, FEATURE_LANES.bed + 0.5], yaw: 270, pitch: 35, features: true, serverMoves: true, tier: 3, since: '1.9', tags: ['impulse', 'bed'] }
out.push(
  // isImmobile takes the input, not the delta movement: a velocity packet moves a sleeper (B100)
  kase('pl_impulse_sleeping', bed, server(command('time set 18000')), ticks(5), press(USE, 1), screen('bed', 60), ticks(10), server(impulse(0.2, 0.3, 0)), ticks(10), wake(), screen('none', 40), ticks(10)),
  kase('pl_impulse_dead', { area: 'features', at: [0.5, 0, FEATURE_LANES.open + 0.5], yaw: 270, features: true, serverMoves: true, tier: 3, mortal: true, difficulty: 'normal', since: '1.14', tags: ['impulse', 'death'] },
    server(respawnPoint([0, 1, FEATURE_LANES.open]), command('kill @p')), screen('death', 60), ticks(3), server(impulse(0.2, 0.3, 0)), ticks(10), respawn(), screen('none', 900), ticks(10)),
)
// A velocity packet against walls and ceilings is the fourth wall's cases; here two in one tick, and opposites (Entity.lerpMotion).
out.push(
  kase('pl_impulse_opposite_same_tick', { area: 'flat', at: [0.5, 0, 0.5], tier: 2, tags: ['impulse'] }, ticks(3), server(impulse(0.3, 0, 0), impulse(-0.3, 0.2, 0)), ticks(15)),
  kase('pl_impulse_repeated', { area: 'flat', at: [0.5, 0, 0.5], tier: 2, tags: ['impulse'] }, ticks(3), server(impulse(0.2, 0, 0)), ticks(1), server(impulse(0.2, 0, 0)), ticks(1), server(impulse(0.2, 0, 0)), ticks(15)),
  kase('pl_impulse_flying_vertical', { area: 'flat', at: [0.5, 3, 0.5], rest: [0.5, 0, 0.5], tier: 2, gamemode: 'creative', tags: ['impulse', 'flight'], setup: { flying: true } }, ticks(3), server(impulse(0, 0.5, 0)), ticks(10), press([JUMP, SNEAK], 10), ticks(10)),
)

// Knockback from an arrow's hit (LivingEntity.hurt, from the direction it came), with the resistance the attribute says.
for (const resistance of [0, 0.5, 1]) {
  out.push(kase(`pl_knockback_arrow_resistance_${resistance}`, {
    area: 'flat', at: [0.5, 0, 0.5], yaw: 90, tier: 3, mortal: true, difficulty: 'normal', serverMoves: true, tags: ['impulse', 'knockback'],
    setup: { attributes: { knockback_resistance: resistance }, food: 20 },
  }, ticks(3), server(summon('arrow', [3.5, 1.2, 0.5], { vel: [-1.6, 0.03, 0] })), ticks(25)))
}

// ---- A hit, from the client's side --------------------------------------------------------------------------------
// Player.attack runs on the client as well, and what it does to the attacker depends on hurt's answer there: a vehicle says
// true (VehicleEntity.hurtClient, 26.3 :29; 1.20.4 VehicleEntity.java:26-29), so a hit on a boat takes 0.6 of the motion and
// ends the sprint at the client (26.3 Player.java:1052-1053), no remote player needed; a cow says false, and no packet
// tells the client otherwise. The boat stands in the way at x 4.5, pitch 30 looks at it.
const hit = (extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area: 'flat', at: [0.5, 0, 0.5], yaw: 270, pitch: 30, tier: 3, tags: ['attack'], serverMoves: true,
  ...extra, setup: { summon: [{ entity: 'oak_boat', at: [4.5, 0, 0.5], yaw: 90 }], ...extra.setup },
})
const onCow = { summon: [{ entity: 'cow', at: [4.5, 0, 0.5], yaw: 90, noAi: true }] }
const atPlayer = { summon: [{ entity: 'player', at: [4.5, 0, 0.5], yaw: 90 }] }
const swing = [crosshair(), press(ATTACK, 1)]
out.push(
  kase('pl_attack_sprint_boat', hit(), hold(F, SPRINT), ticks(9), swing, ticks(10), releaseAll(), stopped(3)),
  kase('pl_attack_walk_boat', hit(), hold(F), ticks(9), swing, ticks(10), releaseAll(), stopped(3)),
  kase('pl_attack_walk_boat_knockback', hit({ setup: { equipment: { mainhand: item('wooden_sword', { knockback: 2 }) } } }), hold(F), ticks(9), swing, ticks(10), releaseAll(), stopped(3)),
  kase('pl_attack_sprint_cow', hit({ setup: onCow }), hold(F, SPRINT), ticks(9), swing, ticks(10), releaseAll(), stopped(3)),
  // from 1.9 a sprint's knockback wants full strength: a swing at the air two ticks before leaves the hit weak
  kase('pl_attack_sprint_boat_weak', hit({ since: '1.9' }), hold(F, SPRINT), ticks(6), look(270, -60), crosshair(), press(ATTACK, 1), ticks(1), look(270, 30), swing, ticks(10), releaseAll(), stopped(3)),
  kase('pl_attack_sprint_air', hit(), look(270, -60), hold(F, SPRINT), ticks(9), crosshair(), press(ATTACK, 1), ticks(6), releaseAll(), stopped(3)),
  // a remote player says true to a hit on the client (RemotePlayer.hurtClient, 26.3 :31; 1.8.9
  // OtherClientPlayerEntity.damage): a living target's own knockback, and the attacker's 0.6 and the sprint's end with it.
  // The second player is the mod's (FakeTarget): no client of its own, it stands where it was put
  kase('pl_attack_sprint_player', hit({ setup: atPlayer }), hold(F, SPRINT), ticks(9), swing, ticks(10), releaseAll(), stopped(3)),
  kase('pl_attack_walk_player', hit({ setup: atPlayer }), hold(F), ticks(9), swing, ticks(10), releaseAll(), stopped(3)),
  kase('pl_attack_walk_player_knockback', hit({ setup: { ...atPlayer, equipment: { mainhand: item('wooden_sword', { knockback: 2 }) } } }), hold(F), ticks(9), swing, ticks(10), releaseAll(), stopped(3)),
  kase('pl_attack_use_diagonal_shield', { area: 'flat', at: [0.5, 0, 0.5], yaw: 270, tier: 2, since: '1.9', tags: ['item_use'], setup: { equipment: { offhand: item('shield') } } }, hold(F, 'left'), ticks(4), press(USE, 8), ticks(4), hold(SNEAK), press(USE, 8), releaseAll(), stopped(3)),
)

// ---- Shapes from the neighbours --------------------------------------------------------------------------------------
// Head on, sliding at 30 degrees, and jumped at, past the corners of each run (B161).
NEIGHBOUR_LANES.forEach((name, i) => {
  const z = laneZ(i) + 0.5
  const base: KaseSpec = { area: 'neighbours', at: [0.5, 0, z], yaw: 270, tier: 2, tags: ['collision', 'partial', 'neighbours'] }
  out.push(
    kase(`pl_nb_${name}_walk`, base, press(F, 25), stopped(3)),
    kase(`pl_nb_${name}_slide`, { ...base, yaw: 300 }, press([F, SPRINT], 20), ticks(8)),
    kase(`pl_nb_${name}_slide_back`, { ...base, yaw: 240 }, press([F, SPRINT], 20), ticks(8)),
    kase(`pl_nb_${name}_jump`, base, hold(F, SPRINT), ticks(4), press(JUMP, 1), ticks(18), releaseAll(), stopped(3)),
  )
})
// A neighbour placed mid-case: arms between two fences close a gap neither post stood in. Before 1.13 no state of the first
// fence changes, so the arm is only there if the placed block's neighbours are read again.
const gapFences = (setups: readonly (readonly [readonly number[], string])[]) => setups.map(([at, state]) => setBlock(at, state))
out.push(
  kase('pl_nb_fence_arm_closes_gap', { area: 'flat', at: [1.5, 0, 0.0], yaw: 270, tier: 2, tags: ['collision', 'partial', 'neighbours'], requires: ['oak_fence'] },
    server(...gapFences([[[3, 1, 0], 'oak_fence']])), ticks(3), server(...gapFences([[[3, 1, -1], 'oak_fence']])), ticks(3), press(F, 16), stopped(3)),
  kase('pl_nb_fence_arm_opens_gap', { area: 'flat', at: [1.5, 0, 0.0], yaw: 270, tier: 2, tags: ['collision', 'partial', 'neighbours'], requires: ['oak_fence'] },
    server(...gapFences([[[3, 1, 0], 'oak_fence'], [[3, 1, -1], 'oak_fence']])), ticks(3), server(...gapFences([[[3, 1, -1], 'air']])), ticks(3), press(F, 16), stopped(3)),
)
// Standing in an offset block: a move out of what the player is inside (VoxelShape.collide over the block's own grid).
INSIDE_LANES.forEach((block, i) => {
  const z = laneZ(i) + 0.5
  const base: KaseSpec = { area: 'insideOffset', at: [3.5, 0, z], yaw: 270, tier: 2, tags: ['collision', 'partial', 'offset'], since: block === 'bamboo' ? '1.14' : '1.17' }
  out.push(
    kase(`pl_inside_${block}_walk_out`, base, press(F, 12), stopped(3)),
    kase(`pl_inside_${block}_back_out`, { ...base, yaw: 90 }, press(F, 12), stopped(3)),
    kase(`pl_inside_${block}_diagonal`, { ...base, yaw: 315 }, press([F, SPRINT], 12), stopped(3)),
  )
})
// The 1.21 step asks each candidate height in the shape's own Y lines, which a rotated anvil's grid holds (Entity.collectCandidateStepUpHeights).
ANVILS.forEach((block, i) => {
  out.push(kase(`pl_step_anvil_${i}`, { area: 'anvils', at: [1.5, 0, laneZ(i) + 0.5], yaw: 270, tier: 2, tags: ['collision', 'partial', 'anvil'], since: '1.20.5', requires: [block], setup: { attributes: { step_height: 1.5 } } },
    press(F, 20), stopped(3)))
})

// The flag changes under the player: a revoked flight in a low tunnel and a flight that lands in a crouch.
out.push(
  kase('pl_fly_revoked_over_water', { area: 'playerEdges', at: [2.5, 5, lane('surface')], yaw: 270, tier: 2, gamemode: 'creative', serverMoves: true, tags: ['flight'], setup: { flying: true } },
    hold(F), ticks(5), server(command('gamemode survival @p')), until('isInWater', 60), ticks(5), releaseAll(), ticks(5)),
  kase('pl_fly_jump_sneak_landing', { area: 'flat', at: [0.5, 2, 0.5], rest: [0.5, 0, 0.5], yaw: 270, tier: 2, gamemode: 'creative', tags: ['flight'], setup: { flying: true } },
    hold(SNEAK), until('onGround', 60), ticks(4), releaseAll(), hold(JUMP), ticks(3), releaseAll(), ticks(3), press(JUMP, 1), ticks(1), press(JUMP, 1), ticks(5)),
)

export default out
