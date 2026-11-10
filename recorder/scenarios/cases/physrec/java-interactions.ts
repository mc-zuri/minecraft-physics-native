// What two systems do where they meet, by the block or the entity: currents over chunk edges at negative coordinates (cw_),
// flowing and falling lava (lf_), waterlogged blocks and their toggle (wl_), the fluid jump around an eye height of 0.4 (fj_),
// climbables and webs in fluids (fc_), flow past partial blocks and falling water's faces (fb_, ff_), Weaving and pistons in
// webs (wv_, pw_), contact damage (hz_), piston retraction, reversal and steps (pm_), entity teams, order and steps (et_, eo_,
// es_), the world border from outside and at its absolute limit (bo_), glides ending on something other than stone (gl_).
//
// A wait that may not be met is soft, or plain ticks: a case that does not reach its point should record what happened, and
// a case that changes the world for the next ones (a team, the border) has to reach its reset.
import './_areas/index.ts'
import {
  B, F, JUMP, SNEAK, SPRINT, clearEffects, command, commandBy, giveEffect, hold, kase, look, press, releaseAll, respawn, respawnPoint, screen, server,
  setBlock, summon, ticks, untilOr,
} from '../../dsl/physrec.ts'
import {
  BUBBLE_LANES, FALLING_FACES, FEATURE_LANES, FLOW_BLOCKERS, FLUID_CLIMBS, HAZARDS, HOT_FLOORS, LEDGE_LANES, LOW_CEILINGS, PISTON_LANES, PISTON_SURFACES,
  SHALLOW_CELLS, WATERLOGGED, laneZ,
} from './_areas/java-areas.ts'
import type { KaseSpec, PhysrecAction, PhysrecSteps, PhysrecStep, Pos } from '../../dsl/physrec.ts'
import type { Scenario } from '../../dsl/core.ts'

const name = (b: string): string => b.replace(/\[(.*?)\]/, (_: string, p: string) => '_' + p.replace(/[=,]/g, '_')).replace(/[^\w]/g, '_')
const out: Scenario[] = []

// ---- Currents at negative coordinates and over chunk edges (B137) -----------------------------------------------------
// Proof: vel, pos and the water fields at afterMove. Near the origin, at -2000000 and near the build limit past -8000, the same channels.
for (const [area, tag] of [['currents', 'near'], ['currentsNeg', 'neg'], ['currentsHigh', 'high']] as const) {
  const current = (id: string, at: Pos, extra: Partial<KaseSpec>, ...steps: PhysrecSteps[]) => out.push(kase(`cw_${tag}_${id}`, {
    area, at, rest: [-12.5, 0, -12.5], tier: 2, tags: ['water', 'flow', 'chunk_edge'], expect: 'in:water', ...extra,
  }, ...steps))
  current('drift_x', [-1.5, 0, -4.5], {}, ticks(120))
  current('drift_reverse', [0.5, 0, 5.5], {}, ticks(120))
  current('drift_z', [12.5, 0, -1.5], {}, ticks(120))
  current('astride_x0', [0, 0, -4.5], {}, ticks(80))
  // the box in all four chunks, and in the one that drifts into the others
  current('corner_astride', [0, 0, 0], {}, ticks(80))
  current('corner_drift', [-0.5, 0, -0.5], {}, ticks(100))
  current('walk_against', [3.5, 0, -4.5], { yaw: 90 }, press(F, 50), ticks(30))
}

// ---- Flowing and falling lava (B138) ------------------------------------------------------------------------------------
// Proof: fluidHeightLava (each level's own depth) and vel. Lava pushes at a third of water's rate here, so the ticks are long.
// (No ultra-warm case: a recording has the overworld's blocks only, header.world.dimension is fixed, and the replay leaves
// ticks in the nether out, so one could not be compared without a change to the mod.)
const flowing = (extra: Partial<KaseSpec>): KaseSpec => ({ area: 'lavaFlow', at: [0.5, 0, 0.5], rest: [14.5, 0, -6.5], tier: 2, tags: ['lava', 'flow'], ...extra })
// (each level's first block: the one before it is higher, so that level 7 too has a current, the wall ends the second)
for (let i = 1; i <= 7; i += 1) out.push(kase(`lf_level_${i}`, flowing({ at: [-3.5 + i * 2, 0, 0.5], expect: 'in:lava' }), ticks(160)))
for (const i of [2, 4, 6]) out.push(kase(`lf_level_${i}_under_lava`, flowing({ at: [-3.5 + i * 2, 0, 4.5], expect: 'in:lava' }), ticks(160)))
out.push(
  kase('lf_walk_against', flowing({ at: [9.5, 0, 0.5], yaw: 90, expect: 'in:lava' }), press(F, 80), ticks(20)),
  kase('lf_walk_with', flowing({ at: [-1.5, 0, 0.5], yaw: 270, expect: 'in:lava' }), press(F, 60), ticks(20)),
  kase('lf_jump_in_channel', flowing({ at: [3.5, 0, 0.5], expect: 'in:lava' }), press(JUMP, 40), ticks(20)),
  // a falling state beside a solid face turns down (-6) and with nothing beside it does not
  kase('lf_falling_solid_faces', flowing({ at: [0.5, 8, 8.5], expect: 'in:lava' }), ticks(120)),
  kase('lf_falling_free', flowing({ at: [6.5, 8, 8.5], expect: 'in:lava' }), ticks(120)),
  kase('lf_falling_swim_up', flowing({ at: [0.5, 2, 8.5], expect: 'in:lava' }), press(JUMP, 80), ticks(20)),
  kase('lf_falling_walk_in', flowing({ at: [-2.5, 0, 8.5], yaw: 270, rest: undefined }), press(F, 20), ticks(60)),
)

// ---- Waterlogged blocks and their toggle (B139, from 1.13) --------------------------------------------------------------
// Proof: isInWater and fluidHeightWater, which change on the tick the block does; the new state is in the row's blocks.
WATERLOGGED.forEach((v, i) => {
  const z = laneZ(i)
  const dry = v.state.replace('waterlogged=true', 'waterlogged=false')
  const cells = v.row ? [8, 9, 10, 11, 12] : [10]
  const all = (state: string): PhysrecAction[] => cells.map(x => setBlock([x, 1, z], state))
  // on the row, or at x=8.5 on the floor of the room, with the block ahead
  const base: KaseSpec = {
    area: 'waterlogged', at: [v.row ? 9.5 : 8.5, v.y, z + 0.5], rest: [0.5, 0, z + 0.5], yaw: 270, tier: 2, since: '1.13',
    tags: ['water', 'waterlogged', v.id], requires: [v.state],
  }
  const reach = v.row ? [] : [press(F, 15)]
  out.push(
    kase(`wl_walk_${v.id}`, base, press(F, 40), ticks(15)),
    kase(`wl_jump_${v.id}`, base, reach, press(JUMP, 1), ticks(25)),
    kase(`wl_toggle_${v.id}`, base, reach, ticks(10), server(all(dry)), ticks(20), server(all(v.state)), ticks(30)),
    // dry first, so that the wet state is the one that arrives with the player in place
    kase(`wl_soak_${v.id}`, base, server(all(dry)), ticks(5), reach, server(all(v.state)), ticks(30)),
  )
})

// ---- The fluid jump around an eye height of 0.4 (B143, from 1.20.5, the scale attribute) ---------------------------------
// getFluidJumpThreshold: 0 below 0.4, else 0.4. Depth 1/3 (level 5) is under the one and over the other: grounded, the eye
// decides between a jump from the ground and the swim's 0.04. Standing 1.62 * scale: 0.3888, 0.39998, 0.40014, 0.405; crouched
// 1.27 * scale: 0.3937, 0.39992, 0.40005, 0.4064; the full-depth cells, deeper than either, swim both ways.
// Proof: eyeHeight (the row of tick 0) and vel, whose y on the first jump tick is 0.42-ish or 0.04-ish.
const cell = (block: string, scale: number, extra: Partial<KaseSpec> = {}): KaseSpec => {
  const z = laneZ(SHALLOW_CELLS.indexOf(block))
  return {
    area: 'shallowCells', at: [4.5, 0, z + 0.5], rest: [0.5, 0, z + 0.5], tier: 2, since: '1.20.5', tags: ['fluid_jump', 'scale'],
    requires: [block], setup: { attributes: { scale } }, expect: block.startsWith('lava') ? 'in:lava' : 'in:water', ...extra,
  }
}
for (const fluid of ['water', 'lava']) {
  const block = `${fluid}[level=5]`
  for (const scale of [0.24, 0.2469, 0.247, 0.25, 1]) {
    out.push(
      kase(`fj_${fluid}_s${scale}_held`, cell(block, scale), press(JUMP, 30), ticks(20)),
      kase(`fj_${fluid}_s${scale}_tap`, cell(block, scale), press(JUMP, 1), ticks(25)),
    )
  }
  for (const scale of [0.31, 0.3149, 0.315, 0.32]) {
    out.push(kase(`fj_${fluid}_crouched_s${scale}`, cell(block, scale), hold(SNEAK), ticks(4), press(JUMP, 30), ticks(20), releaseAll(), ticks(5)))
  }
  for (const scale of [0.24, 0.25]) out.push(kase(`fj_${fluid}_deep_s${scale}_held`, cell(fluid, scale), press(JUMP, 30), ticks(20)))
}

// ---- Climbing in fluids, webs in water (B145) -----------------------------------------------------------------------
// Proof: onClimbable beside isInLava / isInWater on the same ticks, vel; stuckSpeedMultiplier beside isInWater for the web.
const climbing = (lane: string, x: number, zOff: number, extra: Partial<KaseSpec>): KaseSpec => {
  const z = laneZ(FLUID_CLIMBS.indexOf(lane))
  return { area: 'fluidClimb', at: [x, 0, z + zOff], rest: [0.5, 0, z + 0.5], yaw: 270, tier: 2, tags: ['climb', 'fluid'], requires: ['lava'], ...extra }
}
const climbSteps: Readonly<Record<string, PhysrecStep[]>> = {
  idle: [ticks(50)],
  walk: [press(F, 50), ticks(20)],
  jump: [press([F, JUMP], 50), ticks(20)],
  sneak: [hold(F), ticks(10), hold(SNEAK), ticks(30), releaseAll(), ticks(20)],
}
for (const [id, steps] of Object.entries(climbSteps)) {
  // against the wall at z+0.8: the feet in the climbable's block, the box in the lava of the next one
  out.push(
    kase(`fc_lava_ladder_${id}`, climbing('ladder_lava_side', 5.5, 0.8, { expect: 'in:lava' }), steps),
    kase(`fc_lava_vine_${id}`, climbing('vine_lava_side', 5.5, 0.8, { expect: 'in:lava' }), steps),
    kase(`fc_ladder_wet_${id}`, climbing('ladder_wet', 4.5, 0.5, { requires: ['ladder[waterlogged=true]'], since: '1.13', expect: 'in:water' }), steps),
  )
}
out.push(kase('fc_ladder_over_lava_climb_out', climbing('ladder_over_lava', 3.5, 0.5, { expect: 'in:lava' }), press([F, JUMP], 60), ticks(20)))
for (const [state, lane, needs] of [
  ['wet', 'scaffolding_wet', 'scaffolding[waterlogged=true]'], ['dry', 'scaffolding_dry', 'scaffolding'],
] as const) {
  const scaffold = (x: number, y: number): KaseSpec => ({ ...climbing(lane, x, 0.5, { requires: [needs] }), at: [x, y, laneZ(FLUID_CLIMBS.indexOf(lane)) + 0.5] })
  out.push(
    kase(`fc_scaffolding_${state}_walk_in`, scaffold(3.5, 0), press(F, 30), ticks(15)),
    kase(`fc_scaffolding_${state}_jump`, scaffold(5.5, 0), press(JUMP, 40), ticks(20)),
    kase(`fc_scaffolding_${state}_sink`, scaffold(5.5, 6), ticks(50)),
    kase(`fc_scaffolding_${state}_sneak_top`, scaffold(5.5, 8), hold(SNEAK), ticks(40), releaseAll(), ticks(10)),
  )
}
const pool = (at: Pos, extra: Partial<KaseSpec> = {}): KaseSpec => ({ area: 'webPool', at, rest: [-12.5, 0, -8.5], yaw: 270, tier: 2, tags: ['water', 'cobweb'], expect: 'in:water', ...extra })
out.push(
  kase('fc_web_water_swim_in', pool([-1.5, -2, 0.5]), press(F, 70), ticks(20)),
  kase('fc_web_water_sprint_swim_in', pool([-1.5, -2, 0.5]), press([F, SPRINT], 50), ticks(20)),
  // Astride the web's face at x=2: a web holds no water, so a box wholly in the web is not in water at all.
  // the first ticks after the contact: the multiplier installed and read on the next move
  // (the sink is below Entity.move's old 1.0E-7, which held such a move back until `|| delta - movement < 1.0E-7`: 1.21 stays, 1.21.3 sinks)
  kase('fc_web_water_sink', pool([2, -0.5, 0.5], { expect: 'in:cobweb in:water', checks: ['isInWater', 'y < -0.505@>=1.21.3'] }), ticks(50)),
  kase('fc_web_water_float_up', pool([2, -2, 0.5], { expect: 'in:cobweb in:water', checks: 'isInWater && y > -1.95' }), press(JUMP, 80), ticks(20)),
  kase('fc_web_water_back_out', pool([1.9, -1, 0.5]), press(B, 40), ticks(20)),
)

// ---- Flow past partial blocks, falling water's faces (B148) --------------------------------------------------------------
// Proof: vel.x at afterTravel, away from zero only where the flow goes past the block; for ff_, vel.y against the same fall
// beside air. `requires` is never empty: the other lanes' blocks are left out where a release lacks them (1.13.2 no oak_sign).
FLOW_BLOCKERS.forEach((b, i) => {
  const z = laneZ(i)
  const base: KaseSpec = {
    area: 'flowBlockers', at: [2.5, 1, z + 0.5], rest: [-3.5, 0, z + 0.5], yaw: 270, tier: 2, tags: ['water', 'flow', 'blockers'],
    expect: 'in:water', requires: [b === 'air' ? 'water' : b], ...(/waterlogged=true/.test(b) ? { since: '1.13' } : {}),
  }
  out.push(
    kase(`fb_idle_${name(b)}`, base, ticks(60)),
    kase(`fb_walk_${name(b)}`, base, press(F, 30), ticks(25)),
  )
})
const blockerLane = (b: string): number => laneZ(FLOW_BLOCKERS.indexOf(b))
const zSlab = blockerLane('stone_slab[type=bottom]')
const zAir = blockerLane('air')
const blocker = (z: number, b: string): KaseSpec => ({
  area: 'flowBlockers', at: [2.5, 1, z + 0.5], rest: [-3.5, 0, z + 0.5], tier: 2, tags: ['water', 'flow', 'blockers'], expect: 'in:water', requires: [b],
})
out.push(
  // The neighbour changes under a player in the current: no flow or shape of the old block may stay
  kase('fb_slab_removed', blocker(zSlab, 'stone_slab[type=bottom]'), ticks(15), server(setBlock([3, 2, zSlab], 'air')), ticks(50)),
  // (early: a move the client sends before it knows of the slab must not enter it, or the server refuses that move)
  kase('fb_slab_placed', { ...blocker(zAir, 'stone_slab[type=bottom]'), checks: 'x > 2.55 && x < 2.7 && vx == 0' }, ticks(1), server(setBlock([3, 2, zAir], 'stone_slab[type=bottom]')), ticks(50)),
)
FALLING_FACES.forEach((b, i) => {
  const z = laneZ(i)
  const requires = b === 'air' || b === 'stone_single' ? 'water' : b
  out.push(kase(`ff_${name(b)}`, {
    area: 'fallingFaces', at: [5.5, 10, z + 0.5], rest: [0.5, 0, z + 0.5], tier: 2, tags: ['water', 'falling'], expect: 'in:water', requires: [requires],
    ...(/waterlogged=true/.test(b) ? { since: '1.13' } : {}),
  }, ticks(50)))
})

// ---- Weaving (B158, from 1.21: in 1.20.5 the effect is behind the update_1_21 flag) -------------------------------------
// Proof: stuckSpeedMultiplier, [0.5, 0.25, 0.5] with the effect and [0.25, 0.05, 0.25] without.
const weaving = { effects: [{ id: 'weaving', amplifier: 0 }] }
const web: KaseSpec = { area: 'cobwebField', at: [0.5, 0, 0.5], rest: [0.5, 0, -7.5], tier: 2, since: '1.21', tags: ['slowdown', 'cobweb', 'weaving'], expect: 'in:cobweb', requires: ['cobweb'] }
const woven: KaseSpec = { ...web, setup: weaving }
out.push(
  kase('wv_sprint_in', { ...woven, at: [0.5, 0, -7.5], rest: undefined }, press([F, SPRINT], 40), ticks(20)),
  kase('wv_walk_in_diagonal', { ...woven, at: [-2.5, 0, -7.5], rest: undefined, yaw: -45 }, press(F, 60), ticks(20)),
  kase('wv_jump_inside', woven, press(JUMP, 1), ticks(50)),
  kase('wv_sneak_inside', woven, press([F, SNEAK], 40), ticks(20)),
  kase('wv_fall_in', { ...woven, at: [0.5, 8, 0.5] }, ticks(120)),
  kase('wv_walk_out', { ...woven, at: [0.5, 0, -4.5], yaw: 180 }, press(F, 40), ticks(20)),
  // the multiplier of the next contact, on the tick the effect comes and goes
  kase('wv_given_inside', web, press(F, 12), server(giveEffect('weaving')), press(F, 25), ticks(10)),
  kase('wv_cleared_inside', woven, press(F, 12), server(clearEffects()), press(F, 25), ticks(10)),
)

// ---- Pistons (B158 webs, B162 retraction, blocks, several at once, B169 reversal and steps) --------------------------------
// Proof: movingPistons (progress, extending) in post, pos at post and afterMove; stuckSpeedMultiplier for the webs. serverMoves:
// the server moves the player too, as n_piston_push.
const lane = (p: string): number => laneZ(PISTON_LANES.indexOf(p))
const pistons = (p: string, x: number, extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area: 'pistonCourse', at: [x, 0, lane(p) + 0.5], yaw: 270, tier: 3, tags: ['piston', p], serverMoves: true, ...extra,
})
const power = (at: Pos): PhysrecAction => setBlock(at, 'redstone_block')
const cut = (at: Pos): PhysrecAction => setBlock(at, 'air')
const behind = (p: string): Pos => [-2, 1, lane(p)]
const under = (p: string, x: number): Pos => [x, -1, lane(p)]
const cycle = (at: Pos, up: number, after: number): PhysrecSteps[] => [server(power(at)), ticks(up), server(cut(at)), ticks(after)]
out.push(
  // a fence pushed from under a player on its post: until the push ends the moving fence in the cell west of the player's, on
  // the edge of the walk on two axes, still holds it up (1.14.4 Shapes.java:239, 1.17.1 :268), then it drops on the head (B290)
  kase('pm_fence_pushed_from_under', { area: 'pistonFence', at: [1.35, 1.5, 0.5], yaw: 270, tier: 3, tags: ['piston', 'fence'], serverMoves: true },
    ticks(10), server(power([3, 1, 0])), ticks(25)),
  // retraction: from a head that went out, with the player beside it, following it and walking into it
  kase('pm_retract_standing', pistons('plain', 0.5), cycle(behind('plain'), 10, 25)),
  kase('pm_retract_follow', pistons('plain', 0.5), server(power(behind('plain'))), ticks(10), server(cut(behind('plain'))), press(B, 25), ticks(15)),
  kase('pm_retract_walk_into_head', pistons('plain', 3.5, { yaw: 90 }), hold(F), ticks(6), server(power(behind('plain'))), ticks(6), server(cut(behind('plain'))), ticks(20), releaseAll(), ticks(10)),
  kase('pm_sticky_pull', pistons('sticky', 1.5), cycle(behind('sticky'), 10, 25)),
  kase('pm_sticky_stand_on_block', pistons('sticky', 0.5, { at: [0.5, 1, lane('sticky') + 0.5] }), cycle(behind('sticky'), 10, 25)),
  kase('pm_vertical_lift_drop', pistons('vertical', 2.5), cycle(under('vertical', 2), 10, 30)),
  kase('pm_vertical_sticky', pistons('vertical_sticky', 2.5, { at: [2.5, 1, lane('vertical_sticky') + 0.5] }), cycle(under('vertical_sticky', 2), 10, 30)),
  // blocked: 12 blocks go and carry the player beyond them, 13 and obsidian do not, movingPistons stays empty
  kase('pm_limit_12', pistons('limit12', 12.5), cycle(behind('limit12'), 10, 15)),
  kase('pm_limit_13', pistons('limit13', 13.5), cycle(behind('limit13'), 10, 15)),
  kase('pm_blocked_obsidian', pistons('obsidian', 1.5), cycle(behind('obsidian'), 10, 15)),
  kase('pm_blocked_obsidian_stand_on', pistons('obsidian', 0.5, { at: [0.5, 1, lane('obsidian') + 0.5] }), cycle(behind('obsidian'), 10, 15)),
  // several: both powered in one server step, one after the other
  kase('pm_twin_same_tick', pistons('twin', 0.9), server(power(behind('twin')), power([1, 1, lane('twin') - 2])), ticks(25)),
  kase('pm_twin_one_then_other', pistons('twin', 0.9), server(power(behind('twin'))), ticks(1), server(power([1, 1, lane('twin') - 2])), ticks(25)),
  kase('pm_opposed_same_tick', pistons('opposed', 0.9), server(power(behind('opposed')), power([3, 1, lane('opposed')])), ticks(25)),
  kase('pm_opposed_one_then_other', pistons('opposed', 0.9), server(power(behind('opposed'))), ticks(5), server(power([3, 1, lane('opposed')])), ticks(25)),
)
// Power cut while the head is still moving (extension takes 2 server ticks), so that the piston finishes and goes back
for (const delay of [1, 2, 3]) {
  out.push(
    kase(`pm_reverse_${delay}`, pistons('plain', 0.5), cycle(behind('plain'), delay, 25)),
    kase(`pm_reverse_sticky_${delay}`, pistons('sticky', 1.5), cycle(behind('sticky'), delay, 25)),
  )
}
// A step into a block on its way: when the slab moves decides what the player steps on, so a spread of delays
for (const delay of [2, 3, 4, 5, 6]) {
  out.push(kase(`pm_step_moving_slab_d${delay}`, pistons('step_slab', 3, { yaw: 90 }), hold(F), ticks(delay), server(power(behind('step_slab'))), ticks(25), releaseAll(), ticks(10)))
}
for (const delay of [7, 9, 11, 13]) {
  out.push(kase(`pm_step_rising_slab_d${delay}`, pistons('step_rise', 0.5), hold(F), ticks(delay), server(power(under('step_rise', 3))), ticks(25), releaseAll(), ticks(10)))
}
out.push(
  // pushed into a web, the head in the player's cell; a web in the head's way is destroyed under the player
  kase('pw_pushed_into_web', pistons('web_ahead', 0.9, { tags: ['piston', 'cobweb'] }), server(power(behind('web_ahead'))), ticks(30)),
  kase('pw_walk_after_push', pistons('web_ahead', 0.9, { tags: ['piston', 'cobweb'] }), server(power(behind('web_ahead'))), ticks(5), press(F, 20), ticks(10)),
  kase('pw_retract_out_of_web', pistons('web_ahead', 0.9, { tags: ['piston', 'cobweb'] }), cycle(behind('web_ahead'), 10, 25)),
  kase('pw_web_destroyed', pistons('web_cell', 0.5, { tags: ['piston', 'cobweb'] }), server(power(behind('web_cell'))), ticks(30)),
)

// ---- Contact damage (B160) ----------------------------------------------------------------------------------------------
// Proof: srv.health on every tick (the client's health only when the server sends it), at easy with a food level that
// neither heals nor starves, as the fd_ cases. A hit marks the player for a velocity packet: serverMoves.
const mortal = { mortal: true, difficulty: 'easy', serverMoves: true, tier: 2 }
const hurtBy = (h: string, extra: Partial<KaseSpec> = {}): KaseSpec => {
  const z = laneZ(HAZARDS.indexOf(h))
  return {
    ...mortal, area: 'hazards', at: [2.5, 0, z + 0.5], yaw: 270, tags: ['damage', h], setup: { food: 10 },
    requires: [h.startsWith('soul') ? 'soul_campfire' : h.startsWith('campfire') ? 'campfire' : 'cactus'], ...extra,
  }
}
const overCactus = laneZ(HAZARDS.indexOf('cactus')) + 0.5
out.push(
  kase('hz_cactus_walk_into', hurtBy('cactus'), press(F, 40), ticks(25)),
  kase('hz_cactus_sprint_into', hurtBy('cactus'), press([F, SPRINT], 30), ticks(25)),
  kase('hz_cactus_sneak_into', hurtBy('cactus'), press([F, SNEAK], 60), ticks(25)),
  // past it at z+1.29: the box crosses the block's cell and not its collision shape, 1/16 inside the cell
  kase('hz_cactus_brush_past', hurtBy('cactus', { at: [2.5, 0, overCactus + 0.79] }), press(F, 30), ticks(10)),
  // its shape ends 1/16 under the cell's top
  kase('hz_cactus_stand_on', hurtBy('cactus', { at: [5.5, 0.9375, overCactus], rest: [2.5, 0, overCactus] }), ticks(50)),
  kase('hz_cactus_fall_on', hurtBy('cactus', { at: [5.5, 4, overCactus], rest: [2.5, 0, overCactus] }), ticks(70)),
  kase('hz_cactus_invulnerable', { ...hurtBy('cactus'), mortal: false }, press(F, 40), ticks(15)),
)
const onFire = laneZ(HAZARDS.indexOf('campfire')) + 0.5
out.push(
  kase('hz_campfire_walk_on', hurtBy('campfire'), press(F, 40), ticks(40)),
  kase('hz_campfire_sneak_on', hurtBy('campfire'), press([F, SNEAK], 70), ticks(40)),
  kase('hz_campfire_stand_on', hurtBy('campfire', { at: [6.5, 0.4375, onFire], rest: [2.5, 0, onFire] }), ticks(60)),
  kase('hz_campfire_fire_resistance', hurtBy('campfire', { setup: { food: 10, effects: [{ id: 'fire_resistance', amplifier: 0 }] } }), press(F, 40), ticks(40)),
  kase('hz_campfire_frost_walker', hurtBy('campfire', { setup: { food: 10, equipment: { feet: { id: 'leather_boots', enchantments: { frost_walker: 1 } } } } }), press(F, 40), ticks(40)),
  kase('hz_campfire_unlit_walk_on', hurtBy('campfire_unlit'), press(F, 40), ticks(30)),
  kase('hz_soul_campfire_walk_on', hurtBy('soul_campfire'), press(F, 40), ticks(40)),
  kase('hz_campfire_wet_walk_on', hurtBy('campfire_wet'), press(F, 40), ticks(30)),
  kase('hz_campfire_put_out_underfoot', hurtBy('campfire', { at: [6.5, 0.4375, onFire], rest: [2.5, 0, onFire] }), ticks(25), server(setBlock([6, 1, onFire - 0.5], 'campfire[lit=false]')), ticks(40)),
)
// Fully frozen after 140 ticks in powder snow, then a hit every 40 ticks of tickCount: srv.health, as the rest. The freeze
// rule is off but for a mortal case. The player sinks to the field's floor and stays in the snow.
out.push(
  kase('hz_freeze_powder_snow', {
    ...mortal, area: 'powderSnowField', at: [0.5, 0, 0.5], rest: [0.5, 0, -7.5], since: '1.17', tags: ['damage', 'powder_snow'], setup: { food: 10 },
    requires: ['powder_snow'], expect: 'in:powder_snow', checks: 'health < 20',
  }, ticks(260)),
)

// ---- Entities: team rules, tick order, steps (B168) ----------------------------------------------------------------------
// As n_pushed_by_cow, whose push the rules allow or stop. Proof: vel at post, and the cow's in nearbyEntities (no push: both 0).
// collisionRule came with 1.9. The team is removed before the case ends: it would stay for the next one.
const team = (text: string, older: string): Record<string, string> => ({ '1.13': `team ${text}`, '1.9': `scoreboard teams ${older}` })
const members = { player: team('join push @p', 'join push @p') }
const cowJoins = { '1.13': 'team join push @e[type=cow]', '1.11': 'scoreboard teams join push @e[type=cow]', '1.9': 'scoreboard teams join push @e[type=Cow]' }
const pushing = (rule: string, joins: readonly Readonly<Record<string, string>>[]): KaseSpec => ({
  area: 'flat', at: [0.5, 0, 0.5], rest: [4.5, 0, 4.5], yaw: 270, tier: 3, since: '1.9', tags: ['entity', 'team'],
  setup: {
    summon: [{ entity: 'cow', at: [0.9, 0, 0.5], noAi: true }],
    commands: [team('add push', 'add push'), team(`modify push collisionRule ${rule}`, `option push collisionRule ${rule}`), ...joins],
  },
})
const leave = server(commandBy(team('remove push', 'remove push')))
for (const rule of ['never', 'pushOwnTeam', 'pushOtherTeams', 'always']) {
  out.push(
    kase(`et_${rule}_same_team`, pushing(rule, [members.player, cowJoins]), ticks(40), leave, ticks(3)),
    kase(`et_${rule}_player_only`, pushing(rule, [members.player]), ticks(40), leave, ticks(3)),
    kase(`et_${rule}_cow_only`, pushing(rule, [cowJoins]), ticks(40), leave, ticks(3)),
  )
}

// Order. Proof: nearbyEntities, tickedBeforePlayer and order: what is added after the player ticks after it. A new LocalPlayer
// goes to the end of the list, so after a respawn the cow that was already there ticks before it (true only in the last case).
const herd = { area: 'flat', at: [0.5, 0, 0.5], rest: [4.5, 0, 4.5], yaw: 270, tier: 3, tags: ['entity', 'order'] }
const cowAt = (x: number) => ({ entity: 'cow', at: [x, 0, 0.5], noAi: true })
const respawnZ = FEATURE_LANES.open
out.push(
  kase('eo_two_cows_after_player', { ...herd, setup: { summon: [cowAt(0.9), cowAt(0.1)] } }, ticks(40)),
  kase('eo_three_cows_walk_between', { ...herd, setup: { summon: [cowAt(1.5), cowAt(2.5), cowAt(3.5)] } }, press(F, 30), ticks(20)),
  kase('eo_cow_summoned_mid_case', herd, ticks(5), server(summon('cow', [0.9, 0, 0.5])), ticks(40)),
  kase('eo_cow_before_player_after_respawn', {
    area: 'features', at: [0.5, 0, respawnZ + 0.5], yaw: 270, features: true, serverMoves: true, tier: 3, mortal: true, tags: ['entity', 'order', 'death'],
    setup: { summon: [{ entity: 'cow', at: [0.9, 0, respawnZ + 0.5], noAi: true }] },
  }, server(respawnPoint([0, 1, respawnZ])), server(command('kill @p')), screen('death', 60), ticks(20), respawn(), screen('none', 900), ticks(40)),
)

// 26.3 asks for entity colliders over the step height as well (Entity.collide): the step up the slab meets the shulker there
// and is refused; 26.2 asks over the move alone, sees no collider, and steps. Proof: pos.y and horizontalCollision at afterMove.
// (A release without shulkers, 1.8, skips these.)
const stepping = (z: number, summoned: string): KaseSpec => ({
  area: 'entitySteps', at: [0.5, 0, z + 0.5], yaw: 270, tier: 3, since: '1.9', tags: ['entity', 'step'],
  setup: { summon: [{ entity: summoned, at: [3.5, summoned === 'shulker' ? 2 : 0, z + 0.5], noAi: true }] },
})
out.push(
  kase('es_slab_under_shulker', { ...stepping(0, 'shulker'), serverMoves: true }, press(F, 30), ticks(15)),
  kase('es_slab_under_shulker_sprint', { ...stepping(0, 'shulker'), serverMoves: true }, press([F, SPRINT], 25), ticks(15)),
  kase('es_slab_under_shulker_jump', { ...stepping(0, 'shulker'), serverMoves: true }, hold(F), ticks(8), press(JUMP, 1), ticks(25), releaseAll(), ticks(5)),
  // the same collider with no step to take: the walk goes under it on every release
  kase('es_floor_under_shulker', stepping(6, 'shulker'), press(F, 30), ticks(15)),
  // a collider that is the step: 0.5625 high
  kase('es_step_onto_boat', stepping(-6, 'oak_boat'), press(F, 30), ticks(20)),
)

// ---- The world border from outside, and at its absolute limit (B170) -------------------------------------------------------
// Moved and set relative to the player, as the bw_ cases, plain ticks up to the reset: a border stays set across cases. An
// entity outside has no border in its collisions (isInsideCloseToBorder). Proof: pos and horizontalCollision at afterMove.
const offset = (d: number): string => (d === 0 ? '~' : `~${d}`)
const centered = (dx: number, dz = 0) => commandBy({
  '1.13': `execute as @p at @s run worldborder center ${offset(dx)} ${offset(dz)}`, '1.8': `execute @p ~ ~ ~ worldborder center ${offset(dx)} ${offset(dz)}`,
})
const reset = server(command('worldborder set 59999968'), command('worldborder center 0 0'))
const border = (extra: Partial<KaseSpec> = {}): KaseSpec => ({ area: 'flat', at: [0.5, 0, 0.5], yaw: 270, tier: 2, tags: ['world_border'], serverMoves: true, ...extra })
const set10 = (dx: number, dz = 0): PhysrecStep[] => [server(centered(dx, dz), command('worldborder set 10')), ticks(2)]
const walkThenReset = (n = 40): PhysrecStep[] => [press(F, n), ticks(10), reset, ticks(3)]
out.push(
  // the edges at -12.5 and -2.5, the player past the second
  kase('bo_outside_still', border(), set10(-8), ticks(30), reset, ticks(3)),
  kase('bo_outside_jump', border(), set10(-8), press(JUMP, 1), ticks(20), reset, ticks(3)),
  kase('bo_outside_walk_away', border(), set10(-8), walkThenReset(30)),
  kase('bo_outside_walk_along', border({ yaw: 0 }), set10(-8), walkThenReset(30)),
  // in over each edge (the east one is bw_outside_walks_in)
  kase('bo_outside_in_from_west', border(), set10(8), walkThenReset()),
  kase('bo_outside_in_from_north', border({ yaw: 0 }), set10(0, 8), walkThenReset()),
  kase('bo_outside_in_from_south', border({ yaw: 180 }), set10(0, -8), walkThenReset()),
  kase('bo_outside_in_over_corner', border({ yaw: 315 }), set10(8, 8), walkThenReset()),
  // The edge in the player's block: the shape is at its ceiling, x=1 for both, but the position is past the edge at 0.25
  // (no shape for it) and short of it at 0.75
  kase('bo_edge_0.25_position_past', border(), set10(-5.25), walkThenReset(30)),
  kase('bo_edge_0.75_position_short', border(), set10(-4.75), walkThenReset(30)),
)
// At the absolute limit: 29999984 either way, wherever the center says the edge is
const absolute = (area: string, extra: Partial<KaseSpec> = {}): KaseSpec => ({ area, at: [0.5, 0, 0.5], tier: 4, tags: ['world_border', 'far'], serverMoves: true, ...extra })
const moved = (x: number) => server(command(`worldborder center ${x} 0`))
out.push(
  kase('bo_abs_center_clamped', absolute('border', { yaw: 270 }), moved(29999976), ticks(2), walkThenReset(50)),
  kase('bo_abs_outside_still', absolute('border', { at: [10.5, 0, 0.5], rest: [0.5, 0, 0.5] }), ticks(30)),
  kase('bo_abs_outside_walk_in', absolute('border', { at: [10.5, 0, 0.5], rest: [0.5, 0, 0.5], yaw: 90 }), press(F, 50), ticks(10)),
  kase('bo_abs_outside_walk_on', absolute('border', { at: [10.5, 0, 0.5], rest: [0.5, 0, 0.5], yaw: 270 }), press(F, 12), ticks(10)),
  kase('bo_abs_neg_walk', absolute('borderNeg', { yaw: 90 }), press(F, 50), ticks(10)),
  kase('bo_abs_neg_center_clamped', absolute('borderNeg', { yaw: 90 }), moved(-29999976), ticks(2), walkThenReset(50)),
  kase('bo_abs_neg_outside_walk_in', absolute('borderNeg', { at: [-10.5, 0, 0.5], rest: [0.5, 0, 0.5], yaw: 270 }), press(F, 50), ticks(10)),
)
// The pose fit meets the border (noCollision). Flush against the edge, then with the box over it, then with the position past it.
// Proof: pose and bbHeight while sneak is held, and movingSlowly. No pose before 1.14.
const sneaking = (n = 20): PhysrecStep[] => [press(SNEAK, n), ticks(5), reset, ticks(3)]
out.push(
  kase('bo_pose_flush_sneak', border({ since: '1.14' }), set10(-2), press(F, 25), press([F, SNEAK], 20), ticks(5), reset, ticks(3)),
  kase('bo_pose_over_edge_sneak', border({ since: '1.14', at: [0.9, 0, 0.5] }), set10(-4.9), sneaking()),
  kase('bo_pose_past_edge_sneak', border({ since: '1.14' }), set10(-5.5), sneaking()),
)

// ---- Glides ending in water, on slime, at a climbable (B176) ---------------------------------------------------------------
// From the tower as f_elytra, jump pressed in the air. Proof: bbHeight 0.6 for the glide and its change at the end (water can
// keep it: the swimming pose is 0.6 too, so pose from 1.14), with fallDistance and vel; onClimbable for the walls: a vine is
// #can_glide_through from 1.21.11.
const launch = [press(F, 4), ticks(3), press(JUMP, 1)]
const glider = (area: string, extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area, at: [0.5, 30, 2.8], yaw: 0, tier: 3, since: '1.9', tags: ['elytra', 'landing'], setup: { equipment: { chest: { id: 'elytra', enchantments: {} } } }, ...extra,
})
const ends = (cond: string): PhysrecStep[] => [untilOr(cond, 200), ticks(40)]
for (const pitch of [45, 60]) {
  out.push(
    kase(`gl_into_water_${pitch}`, glider('skyWater'), launch, look(0, pitch), ends('isInWater || onGround')),
    kase(`gl_into_shallow_water_${pitch}`, glider('skyShallow'), launch, look(0, pitch), ends('isInWater || onGround')),
    kase(`gl_onto_slime_${pitch}`, glider('skySlime'), launch, look(0, pitch), ends('onGround')),
  )
}
out.push(
  // The server's own tick of the glide lands a tick before the client's packet says so, with the feet still in the air
  // (0.074 over the slime on 1.11.2, 0.614 from 1.20.5). The sneak's ledge check on the next packet then looks for a floor
  // under the move, and with none it holds the player back: "moved wrongly!", a correction, and a second landing. It looks
  // 1 down before 1.11 (Entity.move), then the server player's step height: 0 on 1.11 (as x_knockback_off_edge_sneaking
  // shows), 1 from 1.12 (ServerPlayer's constructor), the attribute's 0.6 from 1.20.5. So vanilla corrects it on those two.
  kase('gl_onto_slime_sneaking', glider('skySlime', { serverMovesIn: ['1.11.2', '>=1.20.5'], checks: 'onGround' }), launch, look(0, 45), hold(SNEAK), ends('onGround'), releaseAll()),
  kase('gl_into_water_keep_jump', glider('skyWater'), launch, look(0, 45), hold(JUMP), ends('isInWater || onGround'), releaseAll()),
)
for (const pitch of [30, 45]) {
  out.push(
    kase(`gl_into_ladder_${pitch}`, glider('skyLadder'), launch, look(0, pitch), ends('isCollidedHorizontally || onGround')),
    kase(`gl_into_vine_${pitch}`, glider('skyVine'), launch, look(0, pitch), ends('isCollidedHorizontally || onGround')),
    kase(`gl_into_scaffolding_${pitch}`, glider('skyScaffolding', { requires: ['scaffolding'] }), launch, look(0, pitch), ends('isCollidedHorizontally || onGround')),
  )
}

// ---- A fall past a honey block's side (B156) --------------------------------------------------------------------------------
// HoneyBlock.isSlidingDown asks for the feet under 0.9375 of the block and the box's edge within 1E-7 of the shape's or past it.
// Proof: vel and fallDistance at afterMove. From high up: fast enough for the branch that scales the horizontal motion.
const post: KaseSpec = { area: 'honeyPost', at: [5.5, 20, 0.5], rest: [-4.5, 0, 0.5], yaw: 90, tier: 3, tags: ['honey', 'wall_slide'], requires: ['honey_block'] }
out.push(
  kase('hw_fast_fall_pressed', post, press(F, 60), ticks(10)),
  kase('hw_fast_fall_gap', { ...post, at: [5.24, 20, 0.5] }, ticks(50)),
  kase('hw_fast_fall_corner', { ...post, at: [5.24, 20, 1.24] }, ticks(50)),
  kase('hw_fast_fall_cell_edge', { ...post, at: [5.3, 20, 0.5] }, ticks(50)),
  kase('hw_walk_off_top', { ...post, at: [4.5, 8, 0.5], rest: undefined, yaw: 270 }, press(F, 12), ticks(50)),
  kase('hw_sneak_pressed', { ...post, at: [5.5, 14, 0.5] }, press([F, SNEAK], 50), ticks(10)),
  kase('hw_scale_2', { ...post, at: [5.9, 20, 0.5], since: '1.20.5', setup: { attributes: { scale: 2 } } }, press(F, 60), ticks(10)),
  kase('hw_scale_half', { ...post, at: [5.4, 20, 0.5], since: '1.20.5', setup: { attributes: { scale: 0.5 } } }, press(F, 60), ticks(10)),
)

// ---- A jump stopped by the ceiling, on what bounces (B157) --------------------------------------------------------------------
// The floor's updateEntityAfterFallOn runs for any vertical collision: the slime block keeps an upward motion that every other
// block ends. Proof: vel at afterMove while the head is against the trapdoor.
LOW_CEILINGS.forEach((block, i) => {
  const base: KaseSpec = { area: 'lowCeilings', at: [4.5, 0, laneZ(i) + 0.5], yaw: 270, tier: 3, tags: ['landing', 'ceiling', block], requires: [block] }
  out.push(
    kase(`sj_${block}_jump`, base, press(JUMP, 1), ticks(20)),
    kase(`sj_${block}_jump_held`, base, press(JUMP, 20), ticks(10)),
    kase(`sj_${block}_jump_sneak`, base, press([JUMP, SNEAK], 20), ticks(10)),
    kase(`sj_${block}_jump_walk`, base, press([F, JUMP], 20), ticks(10)),
  )
})

// ---- Flying through what a player on foot is stuck in (B158, B159, B145, B144) ---------------------------------------------------
// Player.makeStuckInBlock does nothing while flying; 1.21.2 flying players leave bubble columns alone, and 1.21.4 the climbables.
// Proof: stuckSpeedMultiplier, vel and onClimbable at afterMove.
const flyThrough = (area: string, at: Pos, block: string, extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area, at, gamemode: 'creative', setup: { flying: true }, yaw: 0, tier: 3, tags: ['flight', block], requires: [block], ...extra,
})
out.push(
  kase('fy_cobweb', flyThrough('cobwebField', [0.5, 0.5, -7.5], 'cobweb'), press(F, 30), ticks(10)),
  kase('fy_cobweb_sprint', flyThrough('cobwebField', [0.5, 0.5, -7.5], 'cobweb'), press([F, SPRINT], 30), ticks(10)),
  kase('fy_powder_snow', flyThrough('powderSnowField', [0.5, 0.5, -7.5], 'powder_snow'), press(F, 30), ticks(10)),
  kase('fy_berry', flyThrough('berryBushField', [0.5, 0.5, -7.5], 'sweet_berry_bush'), press(F, 30), ticks(10)),
  kase('fy_bubble_up', flyThrough('bubbleUpColumn', [5.5, -3, 0.5], 'bubble_column[drag=false]', { rest: [-4.5, 0, 0.5] }), ticks(30)),
  kase('fy_bubble_down_surface', flyThrough('bubbleDownColumn', [5.5, 0, 0.5], 'bubble_column[drag=true]', { rest: [-4.5, 0, 0.5] }), ticks(30)),
  kase('fy_ladder_wet', flyThrough('fluidClimb', [4.5, 1, laneZ(FLUID_CLIMBS.indexOf('ladder_wet')) + 0.5], 'ladder[waterlogged=true]', { yaw: 270 }), press(F, 20), ticks(10)),
  kase('fy_scaffolding_wet', flyThrough('fluidClimb', [4.5, 1, laneZ(FLUID_CLIMBS.indexOf('scaffolding_wet')) + 0.5], 'scaffolding', { yaw: 270 }), press(F, 20), ticks(10)),
)

// ---- Bubble columns under other blocks, and crossed in one tick (B144) --------------------------------------------------------
// 1.21.5 asks the block over the column for no collision and no fluid; before, for air. The sign, the torch and the cobweb are the
// difference: nothing to collide with, not air. Proof: vel and fallDistance at afterMove.
const shaft = (i: number, y: number): KaseSpec => ({
  area: 'bubbleTops', at: [5.5, y, laneZ(i) + 0.5], rest: [-4.5, 0, 0.5], tier: 3, tags: ['bubble_column'], requires: ['bubble_column'],
})
BUBBLE_LANES.forEach((top, i) => {
  const kind = `${name(top)}_${i % 2 === 0 ? 'up' : 'down'}`
  out.push(
    kase(`bt_${kind}_inside`, shaft(i, 1), ticks(40)),
    kase(`bt_${kind}_top`, shaft(i, 3.4), ticks(40)),
    kase(`bt_${kind}_fall_in`, shaft(i, 12), ticks(50)),
  )
})
for (const [id, z] of [['up', 0.5], ['down', 2.5]] as const) {
  const crossing: KaseSpec = { area: 'bubbleTops', at: [-1.5, 44, z], rest: [-4.5, 0, 0.5], tier: 3, tags: ['bubble_column', 'fall'], requires: ['bubble_column'] }
  out.push(kase(`bt_cross_${id}_fast`, crossing, ticks(60)), kase(`bt_cross_${id}_slow`, { ...crossing, at: [-1.5, 9.5, z] }, ticks(30)))
}

// ---- Out of a pool over what stands on the bank (B143) --------------------------------------------------------------------------
// Proof: vel and pos at afterMove; the hop is 0.3 where LivingEntity's free test passes, else the climb stays the swim's.
LEDGE_LANES.forEach(({ fluid, ledge }, i) => {
  const base: KaseSpec = { area: 'ledgePools', at: [3.5, -0.3, laneZ(i) + 0.5], rest: [-4.5, 0, laneZ(i) + 0.5], yaw: 270, tier: 3, tags: ['fluid_jump', fluid] }
  const id = `${fluid}_${name(ledge)}`
  out.push(
    kase(`jo_${id}_jump`, base, press([F, JUMP], 40), ticks(10)),
    kase(`jo_${id}_walk`, base, press(F, 30), ticks(10)),
  )
})

// ---- Water and lava in one box (B138) -------------------------------------------------------------------------------------------
// One block deep at z=-1.5, two deep at z=1.5, the border at x=5. Proof: fluidHeight, fluidHeightLava, isInWater, isInLava, vel.
const mixed = (x: number, z: number): KaseSpec => ({ area: 'mixedFluids', at: [x, 1, z], rest: [-4.5, 0, 0.5], tier: 3, tags: ['water', 'lava'] })
out.push(
  kase('mf_shallow_idle', mixed(5, -1.5), ticks(20)),
  kase('mf_shallow_water_to_lava', { ...mixed(3.5, -1.5), yaw: 270 }, press(F, 25), ticks(10)),
  kase('mf_shallow_lava_to_water', { ...mixed(6.5, -1.5), yaw: 90 }, press(F, 25), ticks(10)),
  kase('mf_shallow_jump', mixed(5, -1.5), press(JUMP, 20), ticks(10)),
  kase('mf_deep_idle', mixed(5, 1.5), ticks(30)),
  kase('mf_deep_jump', mixed(5, 1.5), press(JUMP, 30), ticks(10)),
  kase('mf_deep_sneak', mixed(5, 1.5), press(SNEAK, 30), ticks(10)),
  kase('mf_deep_water_to_lava', { ...mixed(3.5, 1.5), yaw: 270 }, press(F, 25), ticks(10)),
)

// ---- Honey and slime on a piston (B163) -----------------------------------------------------------------------------------------
// Moved slime throws what it pushes along the axis it moves; honey carries what stands on it, and only that. Proof: pos and vel at
// post and afterMove, movingPistons, stuckSpeedMultiplier for the web. serverMoves: the server moves the player too.
const carried = (p: string): number => laneZ(PISTON_SURFACES.indexOf(p))
const sprung = (p: string, at: Pos, extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area: 'pistonSurfaces', at, yaw: 270, tier: 3, tags: ['piston', p], serverMoves: true, requires: [p.startsWith('honey') ? 'honey_block' : 'slime_block'], ...extra,
})
const slot = (p: string, x: number, y = 0, dz = 0.5): Pos => [x, y, carried(p) + dz]
const pushAt = (p: string): Pos => (p.endsWith('_up') ? [2, -1, carried(p)] : p === 'slime_south' ? [2, 1, carried(p) - 2] : p === 'slime_north' ? [2, 1, carried(p) + 2]
  : p === 'slime_west' ? [5, 1, carried(p)] : p === 'slime_down' ? [2, 6, carried(p)] : [-2, 1, carried(p)])
out.push(
  // pushed along the axis
  kase('ph_slime_east_front', sprung('slime_east', slot('slime_east', 1.5)), cycle(pushAt('slime_east'), 12, 20)),
  kase('ph_slime_east_front_gap', sprung('slime_east', slot('slime_east', 1.95)), cycle(pushAt('slime_east'), 12, 20)),
  kase('ph_slime_east_front_sneak', sprung('slime_east', slot('slime_east', 1.5)), hold(SNEAK), cycle(pushAt('slime_east'), 12, 20)),
  kase('ph_slime_west_front', sprung('slime_west', slot('slime_west', 1.5)), cycle(pushAt('slime_west'), 12, 20)),
  kase('ph_slime_south_front', sprung('slime_south', slot('slime_south', 2.5, 0, 1.5)), cycle(pushAt('slime_south'), 12, 20)),
  kase('ph_slime_north_front', sprung('slime_north', slot('slime_north', 2.5, 0, -0.5)), cycle(pushAt('slime_north'), 12, 20)),
  kase('ph_honey_east_front', sprung('honey_east', slot('honey_east', 1.5)), cycle(pushAt('honey_east'), 12, 20)),
  // on top of a block going sideways, and just past its edge
  kase('ph_slime_east_on_top', sprung('slime_east', slot('slime_east', 0.5, 1)), cycle(pushAt('slime_east'), 12, 30)),
  kase('ph_honey_east_on_top', sprung('honey_east', slot('honey_east', 0.5, 1)), cycle(pushAt('honey_east'), 12, 30)),
  kase('ph_honey_east_on_edge', sprung('honey_east', slot('honey_east', 0.5, 1, 1.25)), cycle(pushAt('honey_east'), 12, 30)),
  kase('ph_honey_east_past_edge', sprung('honey_east', slot('honey_east', 0.5, 1, 1.35)), cycle(pushAt('honey_east'), 12, 30)),
  kase('ph_honey_row_on_top', sprung('honey_row', slot('honey_row', 1, 1)), cycle(pushAt('honey_row'), 12, 30)),
  // beside a moving block, in its row
  kase('ph_slime_east_beside', sprung('slime_east', slot('slime_east', 0.5, 0, 1.3)), cycle(pushAt('slime_east'), 12, 20)),
  kase('ph_honey_east_beside', sprung('honey_east', slot('honey_east', 0.5, 0, 1.3)), cycle(pushAt('honey_east'), 12, 20)),
  // up and down
  kase('ph_slime_up_on_top', sprung('slime_up', slot('slime_up', 2.5, 1)), cycle(pushAt('slime_up'), 12, 40)),
  kase('ph_slime_up_on_top_sneak', sprung('slime_up', slot('slime_up', 2.5, 1)), hold(SNEAK), cycle(pushAt('slime_up'), 12, 40)),
  kase('ph_slime_up_jump', sprung('slime_up', slot('slime_up', 2.5, 1)), server(power(pushAt('slime_up'))), press(JUMP, 2), ticks(40)),
  kase('ph_slime_up_edge', sprung('slime_up', slot('slime_up', 3.25, 1)), cycle(pushAt('slime_up'), 12, 40)),
  kase('ph_honey_up_on_top', sprung('honey_up', slot('honey_up', 2.5, 1)), cycle(pushAt('honey_up'), 12, 40)),
  kase('ph_honey_up_edge', sprung('honey_up', slot('honey_up', 3.25, 1)), cycle(pushAt('honey_up'), 12, 40)),
  kase('ph_slime_down_on_head', sprung('slime_down', slot('slime_down', 2.5, 1)), cycle(pushAt('slime_down'), 12, 30)),
  // pulled
  kase('ph_slime_sticky_on_top', sprung('slime_sticky', slot('slime_sticky', 0.5, 1)), cycle(pushAt('slime_sticky'), 12, 30)),
  kase('ph_honey_sticky_on_top', sprung('honey_sticky', slot('honey_sticky', 0.5, 1)), cycle(pushAt('honey_sticky'), 12, 30)),
  kase('ph_slime_sticky_follow', sprung('slime_sticky', slot('slime_sticky', 1.5)), cycle(pushAt('slime_sticky'), 12, 30)),
  // carried out of a web
  kase('ph_honey_web', sprung('honey_web', slot('honey_web', 0.5, 1)), cycle(pushAt('honey_web'), 12, 30)),
)

// ---- What a floor or a bush deals (B160) ------------------------------------------------------------------------------------------
// As the hz_cactus cases. The fire ones need fireDamage back on (from 1.15, the rule the recorder turns off): a hot floor is fire.
// Proof: srv.health against contactDamage.
const burning = { commands: [{ '1.21.11': 'gamerule minecraft:fire_damage true', '1.15': 'gamerule fireDamage true' }] }
const fireOff = server(commandBy({ '1.21.11': 'gamerule minecraft:fire_damage false', '1.15': 'gamerule fireDamage false', '1.8': null }))
const onFloor = (b: string, extra: Partial<KaseSpec> = {}): KaseSpec => {
  const z = laneZ(HOT_FLOORS.indexOf(b))
  return { ...mortal, area: 'hotFloors', at: [2.5, 0, z + 0.5], yaw: 270, tags: ['damage', b], setup: { food: 10 }, requires: [b], ...extra }
}
const magma = 'magma_block'
const hot = (extra: Record<string, unknown> = {}): Partial<KaseSpec> => ({ setup: { food: 10, ...burning, ...extra } })
const onMagma = laneZ(HOT_FLOORS.indexOf(magma)) + 0.5
const bush = laneZ(HOT_FLOORS.indexOf('sweet_berry_bush[age=2]')) + 0.5
const fire = 'campfire[lit=true]'
out.push(
  kase('hz_magma_walk_on', onFloor(magma, hot()), press(F, 40), ticks(20), fireOff),
  kase('hz_magma_sneak_on', onFloor(magma, hot()), press([F, SNEAK], 70), ticks(20), fireOff),
  kase('hz_magma_stand_on', onFloor(magma, { ...hot(), at: [6.5, 0, onMagma], rest: [2.5, 0, onMagma] }), ticks(50), fireOff),
  kase('hz_magma_jump_on', onFloor(magma, hot()), press([F, JUMP], 40), ticks(10), fireOff),
  kase('hz_magma_fire_resistance', onFloor(magma, hot({ effects: [{ id: 'fire_resistance', amplifier: 0 }] })), press(F, 40), ticks(20), fireOff),
  kase('hz_magma_frost_walker', onFloor(magma, hot({ equipment: { feet: { id: 'leather_boots', enchantments: { frost_walker: 1 } } } })), press(F, 40), ticks(20), fireOff),
  kase('hz_burn_campfire_walk_on', onFloor(fire, hot()), press(F, 40), ticks(20), fireOff),
  kase('hz_burn_campfire_fire_resistance', onFloor(fire, hot({ effects: [{ id: 'fire_resistance', amplifier: 0 }] })), press(F, 40), ticks(20), fireOff),
  kase('hz_berry_walk_in', onFloor('sweet_berry_bush[age=2]'), press(F, 40), ticks(20)),
  kase('hz_berry_sprint_in', onFloor('sweet_berry_bush[age=2]'), press([F, SPRINT], 30), ticks(20)),
  // (a short wait: before 1.21.5 the server hurts by what the position packets moved it, and the last unsent move comes up to 20 ticks late)
  kase('hz_berry_sneak_in', onFloor('sweet_berry_bush[age=2]'), press([F, SNEAK], 60), ticks(10)),
  kase('hz_berry_still_inside', onFloor('sweet_berry_bush[age=2]', { at: [6.5, 0, bush], rest: [2.5, 0, bush] }), ticks(40)),
  kase('hz_berry_young_walk_in', onFloor('sweet_berry_bush[age=0]'), press(F, 40), ticks(20)),
)

// ---- Several pistons on honey and slime (B163), and a piston against a ridden vehicle (D-108) ------------------------------
// The row beside the lane is doubled by hand: the player stands across both. Proof: pos and vel at post and afterMove,
// movingPistons. serverMoves: the server moves the player too.
const doubled = (p: string, block: string): PhysrecAction[] => {
  const z = carried(p) + 1
  return [setBlock([0, 0, z], 'obsidian'), setBlock([1, 0, z], 'obsidian'), setBlock([-1, 1, z], 'piston[facing=east]'), setBlock([0, 1, z], block)]
}
const secondPower = (p: string): Pos => [-2, 1, carried(p) + 1]
const across = (p: string, block: string, ...steps: PhysrecSteps[]): PhysrecSteps[] => [server(...doubled(p, block)), ticks(3), ...steps]
out.push(
  kase('ph_slime_twin_same_tick', sprung('slime_east', slot('slime_east', 1.5, 0, 1)), across('slime_east', 'slime_block', server(power(pushAt('slime_east')), power(secondPower('slime_east'))), ticks(20))),
  kase('ph_slime_twin_one_then_other', sprung('slime_east', slot('slime_east', 1.5, 0, 1)), across('slime_east', 'slime_block', server(power(pushAt('slime_east'))), ticks(1), server(power(secondPower('slime_east'))), ticks(20))),
  kase('ph_honey_twin_same_tick', sprung('honey_east', slot('honey_east', 0.5, 1, 1)), across('honey_east', 'honey_block', server(power(pushAt('honey_east')), power(secondPower('honey_east'))), ticks(30))),
  kase('ph_honey_twin_one_then_other', sprung('honey_east', slot('honey_east', 0.5, 1, 1)), across('honey_east', 'honey_block', server(power(pushAt('honey_east'))), ticks(1), server(power(secondPower('honey_east'))), ticks(30))),
  kase('ph_honey_beside_slime_same_tick', sprung('honey_east', slot('honey_east', 0.5, 1, 1), { requires: ['honey_block', 'slime_block'] }), across('honey_east', 'slime_block', server(power(pushAt('honey_east')), power(secondPower('honey_east'))), ticks(30))),
  kase('ph_honey_powder_snow', sprung('honey_east', slot('honey_east', 0.5, 1), { since: '1.17' }), server(setBlock([0, 2, carried('honey_east')], 'powder_snow')), ticks(3), cycle(pushAt('honey_east'), 12, 30)),
)
const ridden = (p: string, x: number, mount: Record<string, unknown>, extra: Partial<KaseSpec> = {}): KaseSpec =>
  pistons(p, x, { setup: { mount: { yaw: 270, ...mount } as never }, tags: ['piston', 'vehicle', p], ...extra })
const horseStats = { movement_speed: 0.2, jump_strength: 0.6, step_height: 1.0 }
for (const [id, mount, extra] of [
  ['boat', { entity: 'oak_boat' }, {}],
  ['horse', { entity: 'horse', noAi: true, attributes: horseStats }, {}],
  ['pig', { entity: 'pig', noAi: true }, {}],
  ['minecart', { entity: 'minecart' }, {}],
  ['camel', { entity: 'camel', noAi: true }, { since: '1.20' }],
] as const) {
  out.push(
    kase(`pm_ride_${id}_pushed`, ridden('plain', 1.5, mount, extra), cycle(behind('plain'), 10, 15)),
    kase(`pm_ride_${id}_lifted`, ridden('vertical', 2.5, mount, extra), cycle(under('vertical', 2), 10, 20)),
  )
}

// ---- Team rules and shared vehicles, what cannot push, what has no physics (B168) -------------------------------------------
// The boat's own push goes by its team, which its rider's does not change; a cow in the player's boat pushes no one.
const teamBoat = (rule: string, joins: readonly Readonly<Record<string, string>>[], x = 2.5): KaseSpec => ({
  area: 'boats', at: [0.5, 0, 0.5], yaw: 270, tier: 3, since: '1.9', tags: ['entity', 'team', 'vehicle'],
  setup: {
    mount: { entity: 'oak_boat', yaw: 270 },
    summon: [{ entity: 'cow', at: [x, 0, 0.5], noAi: true, noGravity: true }],
    commands: [team('add push', 'add push'), team(`modify push collisionRule ${rule}`, `option push collisionRule ${rule}`), ...joins],
  },
})
for (const rule of ['never', 'always']) {
  out.push(
    kase(`et_${rule}_boat_same_team`, teamBoat(rule, [members.player, cowJoins]), press(F, 30), leave, ticks(3)),
    kase(`et_${rule}_boat_cow_only`, teamBoat(rule, [cowJoins]), press(F, 30), leave, ticks(3)),
  )
}
const onFlat = (extra: Partial<KaseSpec> = {}): KaseSpec => ({ area: 'flat', at: [0.5, 0, 0.5], rest: [4.5, 0, 4.5], yaw: 270, tier: 3, tags: ['entity'], ...extra })
out.push(
  // a cow sent to the player's boat by command (a boat a player steers takes up no one: 26.3 AbstractBoat.java), pushing no one
  kase('et_cow_shares_boat', {
    area: 'flat', at: [0.5, 0, 0.5], yaw: 270, tier: 3, since: '1.21.2', tags: ['entity', 'vehicle'],
    setup: { mount: { entity: 'oak_boat', yaw: 270 }, summon: [{ entity: 'cow', at: [2.5, 0, 0.5], noAi: true }] },
  }, ticks(3), server(commandBy({ '1.21.2': 'ride @e[type=minecraft:cow,limit=1] mount @e[type=minecraft:oak_boat,limit=1]' })), ticks(25)),
  // no physics: a marker stand neither collides nor pushes
  kase('et_walk_into_marker_stand', { ...onFlat(), setup: { summon: [{ entity: 'armor_stand', at: [2.5, 0, 0.5], nbt: '{Marker:1b}' }] } }, press(F, 30), ticks(5)),
  kase('et_walk_into_small_stand', { ...onFlat(), setup: { summon: [{ entity: 'armor_stand', at: [2.5, 0, 0.5], nbt: '{Small:1b}' }] } }, press(F, 30), ticks(5)),
)

// ---- Fire and freezing in one tick, and what ends them (B092). A mortal player, or the counters stay at rest. Blocks across the way east. ---
// Proof: remainingFireTicks and ticksFrozen in post and srv, health, vel.
const aflame = (extra: Partial<KaseSpec> = {}): KaseSpec => ({ area: 'flat', at: [0.5, 0, 0.5], yaw: 270, tier: 3, tags: ['hazard', 'fire'], mortal: true, serverMoves: true, setup: burning, ...extra })
const lay = (...blocks: readonly (readonly [number, string])[]) => [server(...blocks.map(([x, state]) => setBlock([x, 1, 0], state))), ticks(2)]
const flames = (id: string, spec: KaseSpec, ...steps: PhysrecSteps[]) => kase(id, spec, ...steps, fireOff, ticks(1))
out.push(
  flames('hz_fire_walk_through', aflame(), lay([3, 'fire']), press(F, 15), ticks(40)),
  flames('hz_fire_into_water', aflame(), lay([3, 'fire'], [5, 'water']), press(F, 25), ticks(20)),
  // (the rain level passes 0.2 some 20 ticks after the command, and the burning player stands in it)
  flames('hz_fire_in_rain', aflame({ since: '1.13' }), server(commandBy({ '1.13': 'weather rain' })), lay([3, 'fire']), press(F, 15), ticks(30), server(commandBy({ '1.13': 'weather clear' })), ticks(60)),
  flames('hz_fire_resistance', aflame(), server(giveEffect('fire_resistance')), lay([3, 'fire']), press(F, 15), ticks(20)),
  flames('hz_fire_invulnerable', { ...aflame(), mortal: false }, lay([3, 'fire']), press(F, 15), ticks(20)),
  flames('hz_lava_step_in_and_out', aflame(), lay([3, 'lava']), press(F, 12), press(B, 12), ticks(30)),
  flames('hz_powder_snow_then_fire', aflame({ since: '1.17' }), lay([3, 'powder_snow'], [4, 'fire']), press(F, 25), ticks(20)),
  flames('hz_fire_then_powder_snow', aflame({ since: '1.17' }), lay([3, 'fire'], [4, 'powder_snow']), press(F, 25), ticks(20)),
)

export default out
