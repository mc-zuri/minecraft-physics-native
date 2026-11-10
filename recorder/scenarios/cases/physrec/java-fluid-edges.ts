// Where fluids meet what the other families leave out: a holder of water that dries beside a current (wn_, B139, B148), the eyes
// under a ceiling (ec_, B148), a column the client forgets (ul_, B120), striders over lava by lava's own rules (sl_, B147), boats over ice and under water (bf_, B155, B146),
// boats at the top of a bubble column (bc_, B144), a web in lava (fw_, B145), shallow lava by gravity (ls_, B142), water drag off
// the bottom (we_, B141), small bodies in lava (lg_, B138), powder snow's two ticks and cauldrons (pc_, B159), and effects that
// arrive or leave across two systems (ex_, B132).
import './_areas/index.ts'
import {
  B, F, JUMP, L, R, SNEAK, SPRINT, clearEffects, command, effect, forgetChunk, giveEffect, hold, item, kase, look, press, releaseAll, server, setBlock, stable, summon, teleport, ticks, untilOr,
} from '../../dsl/physrec.ts'
import {
  BOAT_COLUMN_LANES, BOAT_FLOORS, CAMERA_CEILINGS, CAULDRONS, CRAWL_LANES, FLUID_CLIMBS, FLUID_WEBS, SHALLOW_CELLS, STRIDER_LANES, ULTRA_EDGE, ULTRA_EDGE_ORIGIN, ULTRA_LAVA, WET_NEIGHBOURS, laneZ,
} from './_areas/java-areas.ts'
import type { KaseSpec, PhysrecAction, PhysrecSetup, PhysrecSteps, Pos } from '../../dsl/physrec.ts'
import type { Scenario } from '../../dsl/core.ts'

const out: Scenario[] = []
const slug = (state: string): string => state.replace(/\[|=/g, '_').replace(/\]/g, '').replace(/,/g, '_')

// ---- A holder of water that dries, goes and comes back beside a current (B139, B148) ----------------------------------------
// Proof: isInWater, fluidHeightWater and vel on the ticks after each change: the row's own blocks say what the block is, so a
// stale flow or a stale water would show on that tick. The player stands in the row's level 1 at x=7, beside the holder at x=8.
WET_NEIGHBOURS.forEach((n, i) => {
  const z = laneZ(i)
  const dry = n.state.replace('waterlogged=true', 'waterlogged=false')
  const base: KaseSpec = { area: 'wetNeighbours', at: [7.5, 0, z + 0.5], rest: [0.5, 0, z + 0.5], yaw: 270, tier: 2, since: '1.13', tags: ['water', 'waterlogged', 'flow'], requires: [n.state] }
  out.push(
    kase(`wn_${n.id}_dries`, base, ticks(8), server(setBlock([8, 1, z], dry)), ticks(15), server(setBlock([8, 1, z], n.state)), ticks(20)),
    kase(`wn_${n.id}_replaced`, base, ticks(8), server(setBlock([8, 1, z], 'stone')), ticks(15), server(setBlock([8, 1, z], 'air')), ticks(15), server(setBlock([8, 1, z], n.state)), ticks(20)),
    kase(`wn_${n.id}_walk_into`, base, ticks(5), server(setBlock([8, 1, z], dry)), press(F, 25), ticks(10)),
  )
})

// ---- The eyes under a ceiling (B148, 26.3 FluidState.getHeightForCamera) ------------------------------------------------------
// Standing in a source 8/9 deep at scale 0.55 the eyes are at 0.891 of the block, between the fluid's height and a sturdy ceiling's
// 1; at 0.6, at 0.972; at 0.5, at 0.81, under both. Proof: isEyeInWater and fluidHeightWater, which stays 8/9.
const CAMERA_SCALES = [0.5, 0.55, 0.6]
CAMERA_CEILINGS.forEach((ceiling, i) => {
  for (const scale of CAMERA_SCALES) {
    const spec: KaseSpec = {
      area: 'cameraCeilings', at: [4.5, 0, laneZ(i) + 0.5], rest: [0.5, 0, laneZ(i) + 0.5], yaw: 270, tier: 2, since: '1.20.5',
      tags: ['water', 'eye', 'scale'], expect: 'in:water', requires: [ceiling], setup: { attributes: { scale } },
    }
    out.push(kase(`ec_${slug(ceiling)}_s${scale}`, spec, ticks(20), press(JUMP, 4), ticks(20)))
  }
})

// ---- A column the client does not hold (B120) ------------------------------------------------------------------------------
// The box reaches into chunk x<0, whose water the client has until the server's forget packet. Proof: isInWater and
// fluidHeightWater over the forget, then eyeInWater and the fall on the walk across: the eyes pass through water only the server
// has. Before 1.14 LivingEntity.travel sinks the player in the column it lacks (1.12.2 LivingEntity.java:1548-1553); from 1.14
// ClientLevel.hasChunk is true (26.3 :490) and the column is plain air.
out.push(kase('ul_water_across_the_column', { area: 'unloadedColumn', at: [0.2, 0, 8.5], yaw: 90, tier: 2, tags: ['water', 'eye', 'chunk'] },
  ticks(6), server(forgetChunk([-1, 1, 8])), ticks(6), press(F, 25), ticks(10)))

// ---- A strider's feet over lava (B147) ------------------------------------------------------------------------------------
// LiquidBlock.getCollisionShape: the top half of a source under no lava, for a body above it that canStandOnFluid. Proof: pos,
// vel and onGround of the ridden strider, and the flowing lane, which holds nothing up.
const stick = { mainhand: { id: 'warped_fungus_on_a_stick', enchantments: {} } }
const strider = (lane: string, at: [number, number], extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area: 'striderLanes', at: [at[0], at[1], laneZ(STRIDER_LANES.indexOf(lane)) + 0.5], yaw: 270, tier: 3, since: '1.16', settle: false, tags: ['vehicle', 'strider', 'lava'],
  setup: { mount: { entity: 'strider', yaw: 270 }, equipment: stick }, ...extra,
})
const scaled = (scale: number): PhysrecSetup => ({
  mount: { entity: 'strider', yaw: 270 },
  equipment: stick,
  commands: [{ '1.21.2': `attribute @e[type=strider,limit=1] minecraft:scale base set ${scale}`, '1.20.5': `attribute @e[type=strider,limit=1] minecraft:generic.scale base set ${scale}` }],
})
out.push(
  kase('sl_still_walks_on', strider('still', [0.5, 0]), ticks(80)),
  kase('sl_flowing_walks_in', strider('flowing', [0.5, 0]), ticks(80)),
  kase('sl_covered_goes_under', strider('covered', [0.5, 0]), ticks(80)),
  kase('sl_deep_rises', strider('deep', [8.5, -2]), ticks(60)),
  kase('sl_still_drops_on', strider('still', [8.5, 2]), ticks(40)),
  kase('sl_still_small', strider('still', [0.5, 0], { since: '1.20.5', setup: scaled(0.5) }), ticks(60)),
  kase('sl_still_large', strider('still', [0.5, 0], { since: '1.20.5', setup: scaled(1.5) }), ticks(60)),
)

// ---- Boats over ice and held under water (B155, B146) --------------------------------------------------------------------
// Proof: vel, and the friction averaged over the blocks under the boat, lily pads left out; the water levels' status.
const boatIn = (lane: string, at: [number, number], extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area: 'boatFloors', at: [at[0], at[1], laneZ(BOAT_FLOORS.indexOf(lane)) + 0.5], yaw: 270, tier: 3, tags: ['vehicle', 'boat', lane],
  setup: { mount: { entity: 'oak_boat', yaw: 270 } }, ...extra,
})
out.push(
  kase('bf_frosted_ice', boatIn('frosted_ice', [-4.5, 0], { requires: ['frosted_ice'] }), press(F, 60), ticks(40)),
  kase('bf_ice_half', boatIn('ice_half', [-4.5, 0]), press(F, 60), ticks(40)),
  kase('bf_lily_on_ice', boatIn('lily_on_ice', [-4.5, 0], { requires: ['lily_pad'], since: '1.15' }), press(F, 60), ticks(40)),
  kase('bf_ice_then_stone', boatIn('ice_then_stone', [-4.5, 0]), press(F, 40), ticks(50)),
  kase('bf_blue_then_ice', boatIn('blue_then_ice', [-4.5, 0], { requires: ['blue_ice'] }), press(F, 40), ticks(60)),
  // (the water goes up to a roof: the boat starts under it, rises and stays under water until it throws the player)
  kase('bf_under_stone', boatIn('under_stone', [6.5, -2], { serverMoves: true, settle: false }), press(F, 30), ticks(90)),
  kase('bf_under_falling', boatIn('under_falling', [-3.5, 0], { serverMoves: true }), hold(F), untilOr('x > 6', 120), releaseAll(), ticks(90)),
)

// ---- The top of a column under a boat (B144) -------------------------------------------------------------------------------
// BubbleColumnBlock.entityInside: a boat's server-side handling, and onAboveBubbleColumn / onInsideBubbleColumn as the block over
// the column says. A boat drives in from plain water. Proof: vel and pos on the client's own moves, and the server's after.
BOAT_COLUMN_LANES.forEach((lane, i) => {
  // (a block in the way keeps a boat off the surface there: it starts inside, under it)
  const start: Pos = lane.top === 'stone' ? [2.5, -2, laneZ(i) + 0.5] : [-2.5, 0, laneZ(i) + 0.5]
  const spec: KaseSpec = {
    area: 'boatColumns', at: start, ...(lane.top === 'stone' ? { settle: false } : {}), yaw: 270, tier: 3, since: '1.13', requires: ['bubble_column'], tags: ['vehicle', 'boat', 'bubble_column'], serverMoves: true,
    setup: { mount: { entity: 'oak_boat', yaw: 270 } },
  }
  // (long enough for the 60 ticks of AbstractBoat.tickBubbleColumn, whose end pops the boat or pulls it down and throws the player)
  out.push(kase(`bc_${lane.drag ? 'down' : 'up'}_${slug(lane.top)}`, spec, hold(F), untilOr('x > 2', 100), releaseAll(), ticks(100)))
})

// An empty boat is the server's own: its timer, the push at its end and what a block over the column changes. The moving replay
// compares it from the server's view. Proof: pos and vel of the boat each server tick.
BOAT_COLUMN_LANES.forEach((lane, i) => {
  const z = laneZ(i) + 0.5
  const place: Pos = lane.top === 'stone' ? [2.5, -1.5, z] : [2.5, 0.5, z]
  out.push(kase(`me_boat_${lane.drag ? 'down' : 'up'}_${slug(lane.top)}`, {
    area: 'boatColumns', at: [-7.5, 0, z], yaw: 0, tier: 3, since: '1.13', requires: ['bubble_column'], tags: ['moving_entity', 'boat', 'bubble_column'],
  }, ticks(1), server(summon('oak_boat', place, { noAi: false })), ticks(110)))
})

// ---- A web in lava (B145) -------------------------------------------------------------------------------------------------
// Proof: stuckSpeedMultiplier beside isInLava on the same ticks, vel: the callback installs it, the next move spends it.
FLUID_WEBS.forEach((lane, i) => {
  const base: KaseSpec = { area: 'fluidWebs', at: [3.5, 0, laneZ(i) + 0.5], rest: [-3.5, 0, laneZ(i) + 0.5], yaw: 270, tier: 2, tags: ['lava', 'cobweb'], expect: 'in:lava' }
  out.push(
    kase(`fw_${lane}_walk`, base, press(F, 60), ticks(20)),
    kase(`fw_${lane}_sprint`, base, press([F, SPRINT], 60), ticks(20)),
    kase(`fw_${lane}_jump`, base, press([F, JUMP], 60), ticks(20)),
  )
})

// ---- Getting off beside a climbable in a fluid (B145) -------------------------------------------------------------------
// Proof: the dismount's position, onClimbable beside the fluid's flags on the ticks after it, the pose and vel.
const besideClimbable = (lane: string, mount: string, extra: Partial<KaseSpec>): KaseSpec => ({
  area: 'fluidClimb', at: [3.5, 1, laneZ(FLUID_CLIMBS.indexOf(lane)) + 0.5], yaw: 270, tier: 3, serverMoves: true, settle: false, tags: ['climb', 'fluid', 'dismount'],
  setup: { mount: { entity: mount, yaw: 270 } }, ...extra,
})
out.push(
  kase('fc_dismount_boat_ladder_wet', besideClimbable('ladder_wet', 'oak_boat', { since: '1.13', requires: ['ladder[waterlogged=true]'] }), press(F, 10), press(SNEAK, 2), ticks(40)),
  kase('fc_dismount_boat_ladder_wet_jump', besideClimbable('ladder_wet', 'oak_boat', { since: '1.13', requires: ['ladder[waterlogged=true]'] }), press(F, 10), press(SNEAK, 2), press([F, JUMP], 30), ticks(10)),
  kase('fc_dismount_strider_ladder_over_lava', besideClimbable('ladder_over_lava', 'strider', { since: '1.16' }), press(SNEAK, 2), press([F, JUMP], 30), ticks(10)),
)

// ---- Ultra-warm lava (B138) --------------------------------------------------------------------------------------------
// DimensionType.ultraWarm: lava pushes at 0.007 where it pushes at 0.0023 here. A recording has the overworld's blocks only, so the
// case builds the same blocks at the same coordinates in the nether and goes there with no move of its own, to absolute coordinates as
// `execute in` scales relative ones by the dimension's 8 (ExecuteCommand.positionWithDimension):
// the replay (engine.ts) keeps the area for a case of this family, with ultraWarm on while it is away. Everything the player reaches
// is in the box. The channel's slope is the one nether lava keeps, so nothing in it flows on. Proof: fluidHeightLava, isInLava and vel.
const tpIn = (dimension: string, [x = 0, y = 0, z = 0]: Pos, feet: number): PhysrecAction => command(`execute as @p in minecraft:${dimension} run tp @s ${x} ${y + feet} ${z}`)
const inNether = (text: string): Readonly<Record<string, string>> => ({ '1.16': `execute in minecraft:the_nether run ${text}` })
const worldCell = ([x, y, z]: Pos): string => `${x} ${(y ?? 0) + 99} ${z}`
const mirrored = [
  inNether('forceload add -48 -48 48 48'),
  inNether(`fill ${worldCell([-10, -4, -10])} ${worldCell([18, 6, 10])} air`),
  inNether(`fill ${worldCell([-10, -4, -10])} ${worldCell([18, 0, 10])} stone`),
  ...ULTRA_LAVA.map(([from, to, block]) => inNether(`fill ${worldCell(from)} ${worldCell(to)} ${block}`)),
]
const ultra = (at: Pos, extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area: 'ultraLava', at, rest: [-5.5, 0, 0.5], tier: 2, since: '1.16', tags: ['lava', 'ultra_warm'], expect: 'in:lava', serverMoves: true, setup: { commands: mirrored }, ...extra,
})
const bothDimensions = (id: string, spec: KaseSpec, at: Pos, feet: number, ...steps: PhysrecSteps[]) => out.push(
  kase(`uw_${id}`, spec, ticks(10), server(tpIn('the_nether', at, feet)), ticks(20), steps, server(tpIn('overworld', at, feet)), ticks(20)),
)
const inUltra = (id: string, at: Pos, extra: Partial<KaseSpec>, ...steps: PhysrecSteps[]) => bothDimensions(id, ultra(at, extra), at, 100, ...steps)
for (const level of [1, 3, 5, 7]) inUltra(`level_${level}`, [level + 0.5, 0, 0.5], {}, ticks(60))
inUltra('source', [0.5, 0, 0.5], {}, ticks(60))
inUltra('walk_with', [0.5, 0, 0.5], { yaw: 270 }, press(F, 40), ticks(10))
inUltra('walk_against', [6.5, 0, 0.5], { yaw: 90 }, press(F, 40), ticks(10))
inUltra('deep', [3.5, -2, 6.5], {}, ticks(60))
inUltra('deep_jump', [3.5, -2, 6.5], { yaw: 270 }, press([F, JUMP], 40), ticks(10))
inUltra('shallow_jump', [5.5, 0, 0.5], {}, press(JUMP, 20), ticks(20))

// A column not loaded beside the box (B140, EntityFluidInteraction.hasFluidAndLoaded): from 26.1 no fluid is touched while a chunk under
// the box widened by one is missing. The server can only be made to leave a client without its neighbours by not having them: this
// one chunk is forced in the nether, its neighbour to the west has never been made, so the player arrives in lava with the chunk it
// stands in and that neighbour comes when it is generated. Proof: isInLava against the columns the row's packets brought.
const [edgeX = 0, edgeY = 0, edgeZ = 0] = ULTRA_EDGE_ORIGIN
const edgeCell = ([x = 0, y = 0, z = 0]: Pos): string => `${edgeX + x} ${edgeY + y - 1} ${edgeZ + z}`
kaseEdge()
function kaseEdge (): void {
  const commands = [
    inNether(`forceload add ${edgeX} ${edgeZ}`),
    ...ULTRA_EDGE.map(([from, to, block]) => inNether(`fill ${edgeCell(from)} ${edgeCell(to)} ${block}`)),
  ]
  const at: Pos = [0.5, 0, 4.5]
  bothDimensions('chunk_edge', {
    ...ultra(at), area: 'ultraEdge', rest: [2.5, 2, 4.5], setup: { commands }, serverTimed: 'the tick each chunk reaches the client',
  }, [edgeX + 0.5, 0, edgeZ + 4.5], edgeY, ticks(80))
}

// ---- Shallow lava, by gravity (B142) -----------------------------------------------------------------------------------------
// The one-block cell of level 5, 1/3 deep, under the jump threshold of 0.4 from the eyes' height: LivingEntity.travelInLava's
// shallow branch (0.5 horizontal, 0.8 vertical on a body at or under the threshold). Proof: vel at afterMove, with a fixed input.
const shallow = (setup: PhysrecSetup, extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area: 'shallowCells', at: [4.5, 0, laneZ(SHALLOW_CELLS.indexOf('lava[level=5]')) + 0.5], rest: [0.5, 0, 0.5], tier: 2, tags: ['lava', 'drag', 'shallow'], expect: 'in:lava', setup, ...extra,
})
for (const [id, setup, since] of [
  ['plain', {}, '1.8'], ['gravity_zero', { attributes: { gravity: 0 } }, '1.20.5'], ['gravity_double', { attributes: { gravity: 0.16 } }, '1.20.5'],
  ['slow_falling', { effects: [effect('slow_falling')] }, '1.13'], ['levitation', { effects: [effect('levitation')] }, '1.9'],
] as const) {
  out.push(
    kase(`ls_${id}_idle`, shallow(setup, { since }), ticks(30)),
    kase(`ls_${id}_walk`, shallow(setup, { since }), press(F, 15), ticks(15)),
    kase(`ls_${id}_jump`, shallow(setup, { since }), press(JUMP, 15), ticks(25)),
  )
}

// ---- Water drag away from the bottom (B141) ----------------------------------------------------------------------------------
// The efficiency's attenuation off the ground (LivingEntity.travelInWater, 1.21: 0.5 of it in the air, unless on the ground), each
// direction of the input. Proof: vel. The pool is 3 deep (area water).
const pool = (at: Pos, setup: PhysrecSetup, extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area: 'water', at, rest: [-8.5, 0, 0.5], yaw: 270, tier: 2, tags: ['water', 'drag'], setup, ...extra,
})
const efficient = (level: number): PhysrecSetup => ({ attributes: { water_movement_efficiency: level } })
for (const level of [0, 0.5, 1]) {
  out.push(
    kase(`we_e${level}_afloat_walk`, pool([0.5, -1.5, 0.5], efficient(level), { since: '1.21' }), press(F, 30), ticks(10)),
    kase(`we_e${level}_afloat_sprint`, pool([0.5, -1.5, 0.5], efficient(level), { since: '1.21' }), press([F, SPRINT], 30), ticks(10)),
    kase(`we_e${level}_bottom_back_left`, pool([0.5, -3, 0.5], efficient(level), { since: '1.21' }), press([B, L], 30), ticks(10)),
    kase(`we_e${level}_still_bottom`, pool([0.5, -3, 0.5], efficient(level), { since: '1.21' }), ticks(20)),
  )
}
out.push(
  kase('we_strider_afloat_right', pool([0.5, -1.5, 0.5], { equipment: { feet: item('diamond_boots', { depth_strider: 2 }) } }), press([F, R], 30), ticks(10)),
  kase('we_slow_falling_wall', pool([-5.5, -2.5, 0.5], { effects: [effect('slow_falling')] }, { since: '1.13', yaw: 90 }), press([F, JUMP], 50), ticks(20)),
  kase('we_gravity_zero_wall', pool([-5.5, -2.5, 0.5], { attributes: { gravity: 0 } }, { since: '1.20.5', yaw: 90 }), press([F, JUMP], 50), ticks(20)),
)

// ---- Bodies with a small box in lava (B138) ------------------------------------------------------------------------------------
// A glide into lava: the box 0.6 high as it enters. Proof: fluidHeightLava and vel, and the pose, tick by tick.
const glide = { chest: item('elytra') }
out.push(
  kase('lg_glide_in', {
    area: 'mountCourse', at: [0.5, 8, -7.5], rest: [-3.5, 3, -7.5], yaw: 270, tier: 3, since: '1.9', settle: false, tags: ['lava', 'elytra'], setup: { equipment: glide },
  }, look(270, 45), ticks(4), press(JUMP, 1), ticks(1), press(JUMP, 1), ticks(40)),
  kase('lg_mixed_small', {
    area: 'mixedFluids', at: [5, 0, -1.5], rest: [-5.5, 0, 0.5], tier: 2, since: '1.20.5', tags: ['lava', 'water', 'scale'], setup: { attributes: { scale: 0.4 } },
  }, ticks(20), press(JUMP, 10), ticks(10)),
)

// ---- Powder snow, tick by tick, and the cauldrons (B159) -----------------------------------------------------------------------
// Proof: stuckSpeedMultiplier against vel on consecutive ticks; ticksFrozen; the cauldron's level in the row's blocks.
const snow = (at: Pos, extra: Partial<KaseSpec>): KaseSpec => ({
  area: 'powderSnowField', at, rest: [0.5, 0, -7.5], yaw: 0, tier: 2, since: '1.17', requires: ['powder_snow'], tags: ['powder_snow'], ...extra,
})
const leather = { feet: item('leather_boots') }
out.push(
  kase('pc_in_one_step', snow([0.5, 0, -6.5], {}), press(F, 2), ticks(4), press(F, 2), ticks(4), press(F, 2), ticks(8)),
  kase('pc_leather_in_one_step', snow([0.5, 0, -6.5], { setup: { equipment: leather } }), press(F, 2), ticks(4), press(F, 2), ticks(4), press(F, 2), ticks(8)),
  kase('pc_leather_stands_on', snow([0.5, 5, -3.5], { setup: { equipment: leather } }), ticks(15), press(F, 15), ticks(10)),
  kase('pc_leather_sneaks_through', snow([0.5, 5, -3.5], { setup: { equipment: leather } }), ticks(8), press(SNEAK, 20), ticks(10)),
  kase('pc_falls_through', snow([0.5, 11, -3.5], { settle: false }), ticks(40)),
  kase('pc_leather_falls_on', snow([0.5, 11, -3.5], { settle: false, serverMoves: true, setup: { equipment: leather } }), ticks(40)),
  kase('pc_sweeps_across', snow([0.5, 0, -6.5], { setup: { effects: [effect('speed', 4)] } }), press([F, SPRINT], 25), ticks(10)),
)
// (fire under the feet lights the player, as pz_on_fire's does; it is put in, and the cauldron puts it out and loses a level)
CAULDRONS.forEach(({ id, state }, i) => {
  const z = laneZ(i)
  const spec: KaseSpec = {
    area: 'cauldrons', at: [2.5, 0, z + 0.5], yaw: 270, tier: 2, since: '1.17', mortal: true, difficulty: 'easy', serverMoves: true, tags: ['powder_snow', 'cauldron'], requires: ['powder_snow'], setup: { food: 20 },
  }
  const jumpIn = [server(teleport(4.5, 0.4, z + 0.5)), ticks(40), press(JUMP, 3), ticks(10)]
  out.push(
    kase(`pc_cauldron_${id}_plain`, spec, ticks(5), jumpIn),
    kase(`pc_cauldron_${id}_burning`, spec, server(setBlock([2, 1, z], 'fire')), ticks(25), server(setBlock([2, 1, z], 'air')), ticks(2), jumpIn),
  )
})

// ---- Effects across two systems (B132) ---------------------------------------------------------------------------------------
// One arrives or leaves as the player leaves a fluid, jumps, or sits on a mount. Proof: vel, attributes and fall distance on the
// tick of the change and after it.
const ledge = (extra: Partial<KaseSpec> = {}): KaseSpec => ({ area: 'water', at: [0.5, -1, 0.5], rest: [-8.5, 0, 0.5], yaw: 270, tier: 3, tags: ['effect', 'water'], ...extra })
const flat = { area: 'flat', at: [0.5, 0, 0.5] as Pos, yaw: 270, tier: 3, tags: ['effect'] } as KaseSpec
out.push(
  kase('ex_slow_falling_leaving_water', ledge({ since: '1.13' }), hold(F, JUMP), untilOr('!in:water', 60), server(giveEffect('slow_falling')), ticks(30), releaseAll(), ticks(20)),
  kase('ex_levitation_leaving_water', ledge({ since: '1.9' }), hold(F, JUMP), untilOr('!in:water', 60), server(giveEffect('levitation')), ticks(20), releaseAll(), server(clearEffects()), ticks(30)),
  kase('ex_jump_boost_gone_in_the_jump', flat, server(giveEffect('jump_boost', 2)), ticks(3), press(JUMP, 1), ticks(3), server(clearEffects()), stable(5)),
  kase('ex_speed_gone_in_the_jump', flat, server(giveEffect('speed', 2)), ticks(3), hold(F, SPRINT, JUMP), ticks(6), server(clearEffects()), ticks(30), releaseAll(), ticks(10)),
  kase('ex_dolphin_arrives_swimming', ledge({ since: '1.13', at: [0.5, -2, 0.5] }), hold(F, SPRINT), ticks(10), server(giveEffect('dolphins_grace')), ticks(20), server(clearEffects()), ticks(15), releaseAll(), ticks(5)),
  kase('ex_mount_levitation', { area: 'mountCourse', at: [-3.5, 3, 8.5], yaw: 270, tier: 3, tags: ['effect', 'vehicle'], since: '1.9', settle: false, setup: { mount: { entity: 'horse', yaw: 270, attributes: { movement_speed: 0.225, jump_strength: 0.7, step_height: 1.0 } }, effects: [effect('levitation')] } }, press(F, 12), ticks(40)),
  kase('ex_boat_slow_falling', { area: 'boats', at: [-4.5, 4, 6.5], yaw: 270, tier: 3, tags: ['effect', 'vehicle', 'boat'], since: '1.13', setup: { mount: { entity: 'oak_boat', yaw: 270 }, effects: [effect('slow_falling')] } }, press(F, 60), ticks(40)),
)
CRAWL_LANES.forEach((block, i) => {
  const spec = (setup: PhysrecSetup, since?: string): KaseSpec => ({
    area: 'crawlFields', at: [2.5, 0, laneZ(i) + 0.5], yaw: 270, tier: 3, tags: ['effect', 'pose', 'crawl'], requires: [block], setup, ...(since ? { since } : {}),
  })
  const crawl = [ticks(5), press(F, 70), ticks(10)]
  out.push(kase(`ex_crawl_${block}`, spec({}, '1.14'), crawl))
  out.push(kase(`ex_crawl_${block}_speed`, spec({ effects: [effect('speed', 1)] }, '1.14'), crawl))
  if (block === 'cobweb') out.push(kase('ex_crawl_cobweb_weaving', spec({ effects: [effect('weaving')] }, '1.20.5'), crawl))
})

export default out
