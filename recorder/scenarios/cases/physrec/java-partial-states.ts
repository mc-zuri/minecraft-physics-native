// Partial blocks and what each asks of the player apart from its collision: the states the rings and steps leave out, walked
// into, slid along and jumped over (pa_, B161); more blocks in the way of a flow (fp_, B148, B164); falling water beside each
// height of snow and more faces (fs_, B148, B153); pushed out of what collides and what suffocates (su_, B164).
import './_areas/index.ts'
import { F, JUMP, SPRINT, hold, kase, press, releaseAll, stopped, ticks } from '../../dsl/physrec.ts'
import { ANVILS, FALLING_FACES_MORE, GRATE_NEIGHBOURS, FLOW_BLOCKERS_MORE, PARTIALS, SUFFOCATORS, laneZ } from './_areas/java-areas.ts'
import type { KaseSpec } from '../../dsl/physrec.ts'
import type { Scenario } from '../../dsl/core.ts'

const name = (b: string): string => b.replace(/\[(.*?)\]/, (_: string, p: string) => '_' + p.replace(/[=,]/g, '_')).replace(/[^\w]/g, '_')
// (waterlogging, and a lever's face, came with 1.13)
const wet = (b: string): Partial<KaseSpec> => (/waterlogged=true|^lever/.test(b) ? { since: '1.13' } : {})
const out: Scenario[] = []

// Proof: pos and vel at every phase; the head-on walk stops where the shape does, the 30 degree one slides along it.
PARTIALS.forEach(([lower], i) => {
  const z = laneZ(i)
  const base: KaseSpec = { area: 'partials', at: [0.5, 0, z + 0.5], yaw: 270, tier: 2, tags: ['collision', 'partial'], requires: [lower] }
  const n = name(lower)
  out.push(
    kase(`pa_walk_${n}`, base, press(F, 25), stopped(3)),
    kase(`pa_slide_${n}`, { ...base, yaw: 300 }, press([F, SPRINT], 20), ticks(8)),
    kase(`pa_jump_${n}`, base, hold(F, SPRINT), ticks(4), press(JUMP, 1), ticks(18), releaseAll(), stopped(3)),
  )
})

// Proof: pos where the walk stops, on each axis of each facing: 1.125 or 0 of the cell's edge, by which box the release takes.
ANVILS.forEach((b, i) => {
  const z = laneZ(i)
  const base: Omit<KaseSpec, 'at'> = { area: 'anvils', tier: 2, tags: ['collision', 'partial', 'anvil'], requires: [b] }
  out.push(
    kase(`pa_anvil_x_${name(b)}`, { ...base, at: [1.5, 0, z + 0.5], yaw: 270 }, press(F, 20), stopped(3)),
    kase(`pa_anvil_z_${name(b)}`, { ...base, at: [3.5, 0, z - 0.5], yaw: 0 }, press(F, 20), stopped(3)),
  )
})

// Proof: vel.x at afterTravel, away from zero only where the flow goes past the block.
FLOW_BLOCKERS_MORE.forEach((b, i) => {
  const z = laneZ(i)
  out.push(kase(`fp_idle_${name(b)}`, {
    area: 'flowBlockersMore', at: [2.5, 1, z + 0.5], rest: [-3.5, 0, z + 0.5], yaw: 270, tier: 2, tags: ['water', 'flow', 'blockers'],
    expect: 'in:water', requires: [b], ...wet(b),
  }, ticks(60)))
})

// Proof: vel.y against the same fall beside air (ff_air).
FALLING_FACES_MORE.forEach((b, i) => {
  const z = laneZ(i)
  out.push(kase(`fs_${name(b)}`, {
    area: 'fallingFacesMore', at: [5.5, 10, z + 0.5], rest: [0.5, 0, z + 0.5], tier: 2, tags: ['water', 'falling'], expect: 'in:water', requires: [b], ...wet(b),
  }, ticks(50)))
})

// Proof: vel.y while the box overlaps the grate, against the same grate with nothing sturdy beside it.
GRATE_NEIGHBOURS.forEach((b, i) => {
  const z = laneZ(i)
  const base: Omit<KaseSpec, 'at'> = { area: 'grates', rest: [-4.5, 0, z + 0.5], tier: 2, tags: ['water', 'falling', 'grate'], requires: ['copper_grate[waterlogged=true]'], since: '1.20.3' }
  out.push(
    kase(`fg_${name(b)}`, { ...base, at: [-0.2, 1, z + 0.5] }, ticks(30)),
    // (off the cell below, so the turn reaches the motion before the top of it stops the fall)
    kase(`fg_fall_${name(b)}`, { ...base, at: [-0.2, 1.6, z + 0.5] }, ticks(30)),
  )
})

// Proof: vel of moveTowardsClosestSpace, 0.1 toward the open side only where the column suffocates.
SUFFOCATORS.forEach((b, i) => {
  const z = laneZ(i)
  out.push(kase(`su_${name(b)}`, {
    area: 'suffocators', at: [-0.2, 0, z + 0.5], rest: [4.5, 0, z + 0.5], tier: 2, tags: ['collision', 'pushout'], requires: [b],
  }, ticks(30)))
})

export default out
