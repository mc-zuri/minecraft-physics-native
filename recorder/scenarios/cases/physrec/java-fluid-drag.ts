// What water, lava, ice and powder snow do with what else the player has: Depth Strider with Dolphin's Grace and the
// other effects, the attributes (dg_, B141); lava with the same (ld_, B142); the block that gives friction under partial
// blocks and across ice (ic_, B155); powder snow's immunity, its modifier among the others, and fire (pz_, B159).
import './_areas/index.ts'
import {
  F, JUMP, SNEAK, SPRINT, hold, item, kase, press, releaseAll, server, setBlock, stable, ticks,
} from '../../dsl/physrec.ts'
import { CLIMB_CURRENTS, ICE_LANES, WATER_HOLDERS, laneZ } from './_areas/java-areas.ts'
import type { KaseSpec, PhysrecSetup } from '../../dsl/physrec.ts'
import type { Scenario } from '../../dsl/core.ts'

const out: Scenario[] = []
const strider = (level: number) => ({ feet: item('diamond_boots', { depth_strider: level }) })
const effect = (id: string, amplifier = 0): { id: string; amplifier: number } => ({ id, amplifier })

// ---- Water drag and input (B141) --------------------------------------------------------------------------------------
// Proof: vel at every phase of the move. The pool's bottom is 3 blocks down.
const pool = (at: [number, number, number], setup: PhysrecSetup, extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area: 'water', at, rest: [-8.5, 0, 0.5], yaw: 270, tier: 2, tags: ['water', 'drag'], setup, ...extra,
})
const both = { equipment: strider(3), effects: [effect('dolphins_grace')] }
const dolphin = { since: '1.13', requires: [] }
out.push(
  kase('dg_strider_dolphin_bottom', pool([0.5, -3, 0.5], both, dolphin), press(F, 40), stable(5)),
  kase('dg_strider_dolphin_surface', pool([0.5, -0.5, 0.5], both, dolphin), press(F, 40), stable(5)),
  kase('dg_strider_dolphin_sprint', pool([0.5, -2, 0.5], both, dolphin), press([F, SPRINT], 40), stable(5)),
  kase('dg_strider_dolphin_jump', pool([0.5, -3, 0.5], both, dolphin), press([F, JUMP], 40), stable(5)),
  kase('dg_strider_jump_bottom', pool([0.5, -3, 0.5], { equipment: strider(2) }), press([F, JUMP], 40), stable(5)),
  kase('dg_strider_speed', pool([0.5, -3, 0.5], { equipment: strider(3), effects: [effect('speed', 2)] }), press(F, 40), stable(5)),
  kase('dg_strider_slowness', pool([0.5, -3, 0.5], { equipment: strider(1), effects: [effect('slowness', 1)] }), press(F, 40), stable(5)),
  kase('dg_strider_slow_falling', pool([0.5, -0.5, 0.5], { equipment: strider(3), effects: [effect('slow_falling')] }, { since: '1.13' }), press(F, 40), ticks(60)),
  kase('dg_strider_levitation', pool([0.5, -3, 0.5], { equipment: strider(3), effects: [effect('levitation', 1)] }, { since: '1.9' }), press(F, 30), ticks(20)),
  kase('dg_dolphin_levitation', pool([0.5, -3, 0.5], { effects: [effect('dolphins_grace'), effect('levitation')] }, dolphin), press(F, 30), ticks(20)),
  kase('dg_dolphin_slow_falling', pool([0.5, -0.5, 0.5], { effects: [effect('dolphins_grace'), effect('slow_falling')] }, dolphin), press(F, 30), ticks(40)),
  // the attribute itself, at its legal ends
  kase('dg_efficiency_zero', pool([0.5, -3, 0.5], { attributes: { water_movement_efficiency: 0 } }, { since: '1.21' }), press(F, 40), stable(5)),
  kase('dg_efficiency_half', pool([0.5, -3, 0.5], { attributes: { water_movement_efficiency: 0.5 } }, { since: '1.21' }), press(F, 40), stable(5)),
  kase('dg_efficiency_full', pool([0.5, -3, 0.5], { attributes: { water_movement_efficiency: 1 } }, { since: '1.21' }), press(F, 40), stable(5)),
  kase('dg_efficiency_jump', pool([0.5, -3, 0.5], { attributes: { water_movement_efficiency: 0.5 } }, { since: '1.21' }), press([F, JUMP], 40), stable(5)),
  kase('dg_efficiency_over_strider', pool([0.5, -3, 0.5], { equipment: strider(3), attributes: { water_movement_efficiency: 0 } }, { since: '1.21' }), press(F, 40), stable(5)),
  kase('dg_gravity_zero', pool([0.5, -2, 0.5], { attributes: { gravity: 0 } }, { since: '1.20.5' }), press(F, 30), ticks(30)),
  kase('dg_gravity_double_sink', pool([0.5, -0.5, 0.5], { attributes: { gravity: 0.16 } }, { since: '1.20.5' }), ticks(50)),
)

// ---- Lava drag and input (B142) ---------------------------------------------------------------------------------------
// Proof: vel. Neither Depth Strider nor Dolphin's Grace reach lava's travel.
const lava = (at: [number, number, number], setup: PhysrecSetup, extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area: 'lava', at, rest: [-8.5, 0, 0.5], yaw: 270, tier: 2, tags: ['lava', 'drag'], expect: 'in:lava', setup, ...extra,
})
out.push(
  kase('ld_strider', lava([0.5, -2, 0.5], { equipment: strider(3) }), press(F, 40), stable(5)),
  kase('ld_dolphin', lava([0.5, -2, 0.5], { effects: [effect('dolphins_grace')] }, dolphin), press(F, 40), stable(5)),
  kase('ld_speed', lava([0.5, -2, 0.5], { effects: [effect('speed', 2)] }), press(F, 40), stable(5)),
  kase('ld_slowness', lava([0.5, -2, 0.5], { effects: [effect('slowness', 1)] }), press(F, 40), stable(5)),
  kase('ld_slow_falling', lava([0.5, -0.5, 0.5], { effects: [effect('slow_falling')] }, { since: '1.13' }), ticks(80)),
  kase('ld_slow_falling_rise', lava([0.5, -3, 0.5], { effects: [effect('slow_falling')] }, { since: '1.13' }), press(JUMP, 50), ticks(30)),
  kase('ld_levitation', lava([0.5, -3, 0.5], { effects: [effect('levitation', 1)] }, { since: '1.9' }), press(F, 30), ticks(30)),
  kase('ld_sprint', lava([0.5, -2, 0.5], {}), press([F, SPRINT], 40), stable(5)),
  kase('ld_sneak_sink', lava([0.5, -0.5, 0.5], {}), press(SNEAK, 40), ticks(10)),
  kase('ld_efficiency', lava([0.5, -2, 0.5], { attributes: { water_movement_efficiency: 1 } }, { since: '1.21' }), press(F, 40), stable(5)),
  kase('ld_gravity_zero', lava([0.5, -2, 0.5], { attributes: { gravity: 0 } }, { since: '1.20.5' }), press(F, 30), ticks(30)),
  kase('ld_gravity_double_sink', lava([0.5, -0.5, 0.5], { attributes: { gravity: 0.16 } }, { since: '1.20.5' }), ticks(60)),
  kase('ld_gravity_negative', lava([0.5, -3, 0.5], { attributes: { gravity: -0.04 } }, { since: '1.20.5' }), ticks(50)),
)

// ---- Ice under other blocks and across kinds (B155) -----------------------------------------------------------------------
// Proof: vel at post, which the friction of the block the tick found gives; each lane starts on stone and sprints along it.
const ice = (lane: string, extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area: 'iceLanes', at: [-8.5, 0, laneZ(ICE_LANES.indexOf(lane)) + 0.5], rest: [-11.5, 0, 0.5], yaw: 270, tier: 2, tags: ['ice', 'friction'], ...extra,
})
for (const lane of ICE_LANES) {
  const since = lane.includes('blue') ? { since: '1.13' } : {}
  out.push(
    kase(`ic_${lane}_sprint`, ice(lane, since), press([F, SPRINT], 70), ticks(40)),
    kase(`ic_${lane}_jump`, ice(lane, since), press([F, SPRINT, JUMP], 30), ticks(40)),
  )
}

// ---- Powder snow: who it freezes and what freezing does to the speed (B159) --------------------------------------------------
// Proof: ticksFrozen as the server sends it, movementSpeed with the modifier among the others, and stuck movement.
const snow = (extra: Partial<KaseSpec>): KaseSpec => ({
  area: 'powderSnowField', at: [0.5, 0, -6.5], rest: [0.5, 0, -7.5], yaw: 0, tier: 2, since: '1.17', requires: ['powder_snow'], tags: ['powder_snow'], expect: 'in:powder_snow', ...extra,
})
const wearing = (slot: string, id: string): PhysrecSetup => ({ equipment: { [slot]: item(id) } })
const inSnow = [press(F, 12), ticks(50)]
out.push(
  kase('pz_leather_helmet', snow({ setup: wearing('head', 'leather_helmet') }), inSnow),
  kase('pz_leather_chestplate', snow({ setup: wearing('chest', 'leather_chestplate') }), inSnow),
  kase('pz_leather_leggings', snow({ setup: wearing('legs', 'leather_leggings') }), inSnow),
  kase('pz_iron_boots', snow({ setup: wearing('feet', 'iron_boots') }), inSnow),
  kase('pz_speed', snow({ setup: { effects: [effect('speed', 1)] } }), inSnow),
  kase('pz_slowness', snow({ setup: { effects: [effect('slowness', 1)] } }), inSnow),
  kase('pz_sprint_speed', snow({ setup: { effects: [effect('speed', 1)] } }), press([F, SPRINT], 30), ticks(20)),
  kase('pz_sprint_slowness_speed', snow({ setup: { effects: [effect('speed', 1), effect('slowness', 0)] } }), press([F, SPRINT], 30), ticks(20)),
  kase('pz_jump_in', snow({}), press([F, JUMP], 20), ticks(30)),
  // on fire: the block goes and the fire with it, for a player as for the griefing mobs
  kase('pz_on_fire', snow({ mortal: true, difficulty: 'easy', serverMoves: true, setup: { food: 10 } }), server(setBlock([0, 1, -7], 'fire')), ticks(30), press(F, 15), ticks(30)),
)

// ---- Water by level, under water, falling and near the build limit (B137) ---------------------------------------------------
// As lf_ for lava. Proof: fluidHeightWater and vel.
const water = (area: string, at: [number, number, number], extra: Partial<KaseSpec> = {}): KaseSpec => ({
  area, at, rest: [14.5, 0, -6.5], tier: 2, tags: ['water', 'flow'], expect: 'in:water', ...extra,
})
for (const [tag, area] of [['', 'waterStack'], ['high_', 'waterStackHigh']] as const) {
  for (let i = 1; i <= 7; i += 1) out.push(kase(`wa_${tag}level_${i}`, water(area, [-3.5 + i * 2, 0, 0.5]), ticks(50)))
  for (const i of [2, 4, 6]) out.push(kase(`wa_${tag}level_${i}_under_water`, water(area, [-3.5 + i * 2, 0, 4.5]), ticks(50)))
  out.push(
    kase(`wa_${tag}falling_beside_stone`, water(area, [0.5, 8, 8.5]), ticks(50)),
    kase(`wa_${tag}falling_alone`, water(area, [6.5, 8, 8.5]), ticks(50)),
    kase(`wa_${tag}falling_swim_up`, water(area, [6.5, 0, 8.5]), press(JUMP, 70), ticks(10)),
    kase(`wa_${tag}falling_walk_through`, water(area, [4.5, 0, 8.5], { yaw: 270 }), press(F, 30), ticks(20)),
    kase(`wa_${tag}walk_against`, water(area, [9.5, 0, 0.5], { yaw: 90 }), press(F, 50), ticks(20)),
    kase(`wa_${tag}walk_with`, water(area, [-1.5, 0, 0.5], { yaw: 270 }), press(F, 40), ticks(20)),
  )
}

// ---- What holds water, walked and swum through (B139) ------------------------------------------------------------------------
// Proof: isInWater, fluidHeightWater and isUnderWater along a row of the block; swimming and vel, collision where it has one.
WATER_HOLDERS.forEach((b, i) => {
  const z = laneZ(i)
  const bare = b.replace(/\[.*/, '')
  const base: KaseSpec = {
    area: 'waterHolders', at: [-1.5, 0, z + 0.5], rest: [-6.5, 0, z + 0.5], yaw: 270, tier: 2, tags: ['water', 'waterlogged'], expect: 'in:water',
    since: '1.13', requires: [bare],
  }
  const id = bare.replace(/_waterlogged.*/, '')
  out.push(
    kase(`wh_${id}_walk`, base, press(F, 60), ticks(15)),
    kase(`wh_${id}_jump`, base, press([F, JUMP], 60), ticks(15)),
    kase(`wh_${id}_swim`, { ...base, at: [-1.5, 1, z + 0.5] }, press([F, SPRINT], 50), ticks(15)),
  )
})

// ---- Climbables a current reaches (B145) -----------------------------------------------------------------------------------------
// Proof: onClimbable beside isInWater / isInLava, and the push of the current along the way in.
const CURRENT_STEPS: Readonly<Record<string, readonly unknown[]>> = {
  idle: [ticks(50)],
  walk: [press(F, 50), ticks(20)],
  jump: [press([F, JUMP], 50), ticks(20)],
  sneak: [hold(F), ticks(30), hold(SNEAK), ticks(30), releaseAll(), ticks(20)],
}
for (const lane of CLIMB_CURRENTS) {
  const z = laneZ(CLIMB_CURRENTS.indexOf(lane))
  const needs = lane === 'twisting_side' ? { since: '1.16' } : lane === 'ladder_wet' || lane === 'trapdoor_over_ladder' ? { since: '1.13' } : {}
  for (const [id, steps] of Object.entries(CURRENT_STEPS)) {
    out.push(kase(`cc_${lane}_${id}`, {
      area: 'climbCurrents', at: [3.5, 0, z + 0.5], rest: [-3.5, 0, z + 0.5], yaw: 270, tier: 2, tags: ['climb', 'fluid', 'flow'], requires: ['lava'],
      ...(lane === 'weeping_side' ? { since: '1.16' } : needs),
    }, steps as never))
  }
}

export default out
