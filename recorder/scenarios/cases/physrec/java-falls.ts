// Landing damage against the server's health (fd_*), the jump's noJumpDelay at its edges (jd_*), scale with the poses the
// scale cases of java-effects leave out (ps_*), NoGravity and the gravity attribute on every travel path (ng_*, gr_*),
// the world border as a case moves it (bw_*), and chunks leaving and coming back (cu_*).
import './_areas/index.ts'
import {
  F, JUMP, SNEAK, SPRINT, USE, command, commandBy, hold, impulse, kase, look, press, releaseAll, respawn, respawnPoint, screen, server,
  setAttribute, setNoGravity, stopped, summon, teleport, ticks, until, untilOr, wake,
} from '../../dsl/physrec.ts'
import { CEILINGS, CLIMBS, FEATURE_LANES as L, FENCE_TOPS, LANDINGS, laneZ } from './_areas/java-areas.ts'
import type { KaseSpec } from '../../dsl/physrec.ts'

const name = (b: string): string => b.replace(/\[.*/, '').replace(/[^\w]/g, '_')
const out = []

// ---- Landing damage -----------------------------------------------------------------------------------------------
// Health moves by the landing alone: easy, and a food level below 18 (FoodData.tick) that no regeneration follows and no
// starving (replay/engine.ts compares fallDamage with srv.health for fd_* on this condition). mortal: `invulnerable`
// is what keeps every other case's health at 20.
const mortal = { mortal: true, difficulty: 'easy', tier: 2 }
const food = { food: 10 }
const fall = [until('onGround', 200), ticks(6)]
const fromHigh = (h: number, extra: Partial<KaseSpec> = {}): KaseSpec => ({
  ...mortal, area: 'flat', at: [0.5, h, 0.5], rest: [0.5, 0, 0.5], tags: ['fall_damage'], setup: food, ...extra,
})

// 3.2 and 3.5 sit around the last move that still leaves 3 uncounted before 1.21.5 (the landing's own move does not
// count there); 3.99, 4 and 4.01 around the modern epsilon's first point.
for (const h of [3, 3.2, 3.5, 3.99, 4, 4.01, 4.5, 5, 7]) out.push(kase(`fd_height_${h}`, fromHigh(h), fall))

// The attributes (1.20.5): the threshold, the multiplier, and what ceil and floor make of a half point.
const attributes = (safe?: number, multiplier?: number): KaseSpec['setup'] => ({
  ...food,
  attributes: { ...(safe !== undefined ? { safe_fall_distance: safe } : {}), ...(multiplier !== undefined ? { fall_damage_multiplier: multiplier } : {}) },
})
for (const [safe, h] of [[0, 0.5], [0, 1], [0, 1.01], [1.5, 3], [10, 9], [10, 11]]) {
  out.push(kase(`fd_safe_${safe}_h${h}`, fromHigh(h, { since: '1.20.5', setup: attributes(safe) }), fall))
}
for (const [multiplier, h] of [[0, 6], [0.5, 6], [0.5, 4], [2, 6], [0.25, 5]]) {
  out.push(kase(`fd_multiplier_${multiplier}_h${h}`, fromHigh(h, { since: '1.20.5', setup: attributes(undefined, multiplier) }), fall))
}
out.push(
  kase('fd_safe_1_multiplier_3_h5', fromHigh(5, { since: '1.20.5', setup: attributes(1, 3) }), fall),
  // the value of the landing tick counts, not the one the fall began with
  kase('fd_safe_raised_in_the_air_h6', fromHigh(6, { since: '1.20.5' }), ticks(3), server(setAttribute('safe_fall_distance', 8)), fall),
  // Jump Boost: subtracted from the distance before 1.20.5, a SAFE_FALL_DISTANCE modifier after
  kase('fd_jump_boost_0_h4', fromHigh(4, { setup: { ...food, effects: [{ id: 'jump_boost', amplifier: 0 }] } }), fall),
  kase('fd_jump_boost_1_h6', fromHigh(6, { setup: { ...food, effects: [{ id: 'jump_boost', amplifier: 1 }] } }), fall),
  // Player.causeFallDamage: mayfly deals nothing, whatever the distance
  kase('fd_creative_h8', fromHigh(8, { gamemode: 'creative' }), fall),
  kase('fd_adventure_h8', fromHigh(8, { gamemode: 'adventure' }), fall),
  // A ceiling ends the rise: only what comes after it counts
  kase('fd_ceiling_bump_h9', {
    ...mortal, area: 'flight', at: [0.5, 9, 12.5], rest: [0.5, 0, 0.5], tags: ['fall_damage', 'ceiling'], setup: food,
  }, server(impulse(0, 1.2, 0)), fall),
  kase('fd_sneak_landing_h6', fromHigh(6), hold(SNEAK), fall, releaseAll()),
)

// Block.fallOn's own: landing pads of java-areas.
const pad = (block: string, h: number, extra: Partial<KaseSpec> = {}): KaseSpec => {
  const z = laneZ(LANDINGS.indexOf(block)) + 0.5
  return { ...mortal, area: 'landing', at: [4.5, h, z], rest: [-4.5, 0, z], tags: ['fall_damage', 'landing', name(block)], requires: [block], setup: food, ...extra }
}
for (const [block, h] of [
  ['white_bed[part=foot,facing=east]', 10], ['hay_block', 10], ['honey_block', 10], ['slime_block', 10], ['pointed_dripstone', 6],
  ['water', 10], ['powder_snow', 6], ['cobweb', 10], ['stone', 10],
] as const) {
  // (1.21.4's client and server disagree on powder snow: see java-blocks)
  out.push(kase(`fd_on_${name(block)}_h${h}`, pad(block, h, block === 'powder_snow' ? { serverMovesIn: ['1.21.4'] } : {}), untilOr('onGround || isInWater', 200), ticks(30)))
}
// Landing on a fence, wall or gate under a block the player misses: its plain fall from 1.20 (getOnPos stops at the
// support), and before, in the player's own column, the air over nothing.
FENCE_TOPS.forEach((block, i) => {
  const z = laneZ(i) + 0.5
  out.push(kase(`fd_on_${name(block)}_under_a_tip_h5`, {
    ...mortal, area: 'fenceTops', at: [3.85, 6.5, z], rest: [-4.5, 0, z], tags: ['fall_damage', 'landing', 'fence'], requires: ['pointed_dripstone'], setup: food,
  }, until('onGround', 200), ticks(6)))
})
out.push(kase('fd_on_slime_sneaking_h10', pad('slime_block', 10), hold(SNEAK), until('onGround', 200), ticks(6), releaseAll()))

// ---- The jump's delay -----------------------------------------------------------------------------------------------
const flat = { area: 'flat', at: [0.5, 0, 0.5], tier: 2, tags: ['jump', 'jump_delay'] }
// (off the shelf and teleported in, as java-blocks' fluid cases)
const inPool = { rest: [-8.5, 0, 0.5] }
const standing = laneZ(CEILINGS.findIndex(c => c.name === 'gap2')) + 0.5
out.push(
  // Held under a ceiling: each launch clips in its first ticks; the delay and the landing decide the next
  kase('jd_ceiling_held', { ...flat, area: 'ceilings', at: [8.5, 0, standing], tags: ['jump', 'jump_delay', 'ceiling'] }, press(JUMP, 50), stopped(3)),
  // Up and down within the delay, and the key let go at each point of it
  kase('jd_tap_every_other_tick', flat, press(JUMP, 1), ticks(1), press(JUMP, 1), ticks(1), press(JUMP, 1), until('onGround', 40), ticks(3)),
  kase('jd_release_at_delay_5', flat, press(JUMP, 5), until('onGround', 40), press(JUMP, 1), until('onGround', 40), ticks(3)),
  kase('jd_release_on_landing', flat, press(JUMP, 1), until('onGround', 40), ticks(1), press(JUMP, 14), until('onGround', 40), ticks(3)),
  // An impulse already rising when the jump goes: kept from 1.21.2, replaced before
  kase('jd_jump_over_impulse', flat, server(impulse(0, 0.6, 0)), press(JUMP, 1), until('onGround', 80), ticks(3)),
  kase('jd_jump_under_impulse', flat, server(impulse(0, 0.2, 0)), press(JUMP, 1), until('onGround', 80), ticks(3)),
  // Swimming up never arms it, and only the key's release clears it
  kase('jd_water_surface_held', { ...flat, ...inPool, area: 'water', at: [4.5, 0, 0.5], tags: ['jump', 'jump_delay', 'water'] }, press(JUMP, 40), ticks(5)),
  kase('jd_water_shelf_held', { ...flat, ...inPool, area: 'water', at: [-8.5, -1, 0.5], tags: ['jump', 'jump_delay', 'water'] }, press(JUMP, 40), ticks(5)),
)
// jumpFromGround gives up at 1.0E-5F or less, and noJumpDelay is 10 all the same (1.20.5)
for (const v of [0, 0.00001, 0.00002]) {
  out.push(kase(`jd_power_${v}_held`, { ...flat, since: '1.20.5', setup: { attributes: { jump_strength: v } } }, press(JUMP, 25), ticks(5)))
}

// ---- Scale and pose --------------------------------------------------------------------------------------------------
const crawl = { area: 'tunnels', at: [2.5, 0, -2.5], yaw: 270, tier: 2, since: '1.20.5', tags: ['pose', 'crawl', 'scale'] }
// 1 high: 0.5 fits standing, 0.8 and 1.2 crawl (0.48 and 0.72 high), 2 does not fit either way
for (const v of [0.5, 0.8, 1.2, 2]) {
  out.push(kase(`ps_crawl_scale_${v}`, { ...crawl, setup: { attributes: { scale: v } } }, ticks(5), press(F, 80), stopped(3), ticks(5)))
}
const under = laneZ(CEILINGS.findIndex(c => c.name === 'gap1_5')) + 0.5
out.push(
  // A scale change under a 1.5 ceiling: the pose refreshes, then the next move has the new box
  kase('ps_scale_grows_under_ceiling', { ...flat, area: 'ceilings', at: [8.5, 0, under], yaw: 270, since: '1.20.5', tags: ['pose', 'scale', 'ceiling'] },
    ticks(5), server(setAttribute('scale', 1.5)), ticks(5), press(F, 10), server(setAttribute('scale', 0.5)), ticks(5), press(F, 10), ticks(3)),
  kase('ps_crawl_scale_changes', { ...crawl }, ticks(5), server(setAttribute('scale', 0.5)), ticks(5), server(setAttribute('scale', 1)), press(F, 20), ticks(5)),
  // Sleeping keeps 0.2 by 0.2 at any scale, eyes 0.2 (as m_bed). Twice the eyes need a steeper look to the bed's top than m_bed's
  // 35, which goes over it; only the bed lifts the player off the floor.
  kase('ps_sleep_scale_2', {
    area: 'features', at: [0.5, 0, L.bed + 0.5], yaw: 270, pitch: 50, features: true, serverMoves: true, tier: 3, since: '1.20.5',
    tags: ['pose', 'scale', 'bed'], expect: 'on:white_bed', checks: 'highest > 0.5', setup: { attributes: { scale: 2 } },
  }, server(command('time set 18000')), ticks(5), press(USE, 1), screen('bed', 60), ticks(20), wake(), screen('none', 40), ticks(10)),
)
// A death: the blast takes the health to 0 and lifts the player, and the death screen must open. The pose stays what it was: a
// player never has pose DYING. ServerPlayer.die does not call LivingEntity.die, the one place that sets it, and the client
// goes there on event 3 only for what is not a player (from 1.15; 1.14's server sends no event 3 for a player). 26.3 the same.
for (const v of [1, 2]) {
  out.push(kase(`ps_death_tnt_scale_${v}`, {
    serverTimed: 'the explosion: its knockback and the tick it lands differ from run to run',
    area: 'features', at: [0.5, 0, L.open + 0.5], yaw: 270, features: true, serverMoves: true, tier: 3, mortal: true, difficulty: 'normal',
    since: v === 1 ? '1.14' : '1.20.5', tags: ['pose', 'scale', 'death'], checks: 'highest > 0.5', ...(v === 1 ? {} : { setup: { attributes: { scale: v } } }),
  }, server(respawnPoint([0, 1, L.open]), summon('tnt', [0.5, 0, L.open + 0.5], { nbt: '{Fuse:3s,fuse:3s}' })), screen('death', 60), ticks(20), respawn(), screen('none', 900), ticks(20)))
}

// ---- NoGravity ------------------------------------------------------------------------------------------------------
// (no such flag before 1.10)
const on = server(setNoGravity(true))
const off = server(setNoGravity(false))
const noGravity = (extra: Partial<KaseSpec>): KaseSpec => ({ area: 'flat', at: [0.5, 0, 0.5], tier: 2, since: '1.10', tags: ['gravity', 'no_gravity'], ...extra })
const ladder = laneZ(CLIMBS.indexOf('ladder[facing=west]')) + 0.5
const launch = [press(F, 4), ticks(3), press(JUMP, 1)]
const elytra = { equipment: { chest: { id: 'elytra', enchantments: {} } } }
const tower = { area: 'sky', at: [0.5, 30, 2.8], yaw: 0, setup: elytra }
out.push(
  kase('ng_jump_floats', noGravity({}), on, ticks(2), press(JUMP, 1), ticks(40), off, until('onGround', 80), ticks(3)),
  kase('ng_walk_on_ground', noGravity({ yaw: 270 }), on, ticks(2), press(F, 20), stopped(3), off, ticks(3)),
  kase('ng_walk_off_ledge', noGravity({ area: 'ledges', at: [0.5, 1, 0.5], yaw: 270 }), on, ticks(2), press(F, 25), ticks(5), off, until('onGround', 60), ticks(3)),
  kase('ng_stops_in_the_air', noGravity({ at: [0.5, 10, 0.5], rest: [0.5, 0, 0.5] }), ticks(8), on, ticks(25), off, until('onGround', 60), ticks(3)),
  kase('ng_ladder', noGravity({ area: 'climbs', at: [2.5, 0, ladder], yaw: 270, requires: ['ladder'] }), on, ticks(2), press(F, 30), ticks(10), off, ticks(40)),
  kase('ng_water_sink_and_swim', noGravity({ ...inPool, area: 'water', at: [4.5, -1, 0.5] }), on, ticks(15), press(JUMP, 15), ticks(15), off, ticks(30)),
  kase('ng_water_sneak', noGravity({ ...inPool, area: 'water', at: [4.5, -1, 0.5] }), on, ticks(2), press(SNEAK, 15), ticks(15), off, ticks(10)),
  kase('ng_lava', noGravity({ ...inPool, area: 'lava', at: [0.5, -1, 0.5] }), on, ticks(15), press(JUMP, 10), ticks(15), off, ticks(20)),
  kase('ng_levitation', noGravity({ at: [0.5, 5, 0.5], rest: [0.5, 0, 0.5], since: '1.10', setup: { effects: [{ id: 'levitation', amplifier: 1 }] } }), on, ticks(30), off, ticks(10)),
  kase('ng_slow_falling', noGravity({ at: [0.5, 8, 0.5], rest: [0.5, 0, 0.5], since: '1.13', setup: { effects: [{ id: 'slow_falling', amplifier: 0 }] } }), ticks(8), on, ticks(20), off, until('onGround', 200), ticks(3)),
  // The glide's own gravity: 0 with NoGravity from 1.20.5, the fixed 0.08 before (1.16.5 LivingEntity.java:1963)
  kase('ng_elytra_glide', noGravity({ ...tower, tier: 3, tags: ['gravity', 'no_gravity', 'elytra'] }), launch, look(0, 10), ticks(10), on, ticks(40), off, ticks(40)),
)

// ---- The gravity attribute (1.20.5) ---------------------------------------------------------------------------------
// 2 and -2 are past the attribute's range of -1 to 1: `attributes` keeps the base, the value is the clamped one
const gravity = (id: string, v: number, extra: Partial<KaseSpec>, ...steps: Parameters<typeof kase>[2][]) =>
  kase(`gr_${v}_${id}`, { area: 'flat', at: [0.5, 12, 0.5], rest: [0.5, 0, 0.5], tier: 2, since: '1.20.5', tags: ['gravity', 'attribute'], ...extra }, server(setAttribute('gravity', v)), ...steps)
for (const v of [0, -0.08, 0.5, 1, 2, -2]) {
  const n = Math.abs(v) >= 0.5 ? 8 : 40
  out.push(
    gravity('air', v, {}, ticks(n)),
    gravity('slow_falling', v, { setup: { effects: [{ id: 'slow_falling', amplifier: 0 }] } }, ticks(n)),
    gravity('levitation', v, { setup: { effects: [{ id: 'levitation', amplifier: 0 }] } }, ticks(n)),
    gravity('both_effects', v, { setup: { effects: [{ id: 'slow_falling', amplifier: 0 }, { id: 'levitation', amplifier: 0 }] } }, ticks(n)),
    gravity('water', v, { ...inPool, area: 'water', at: [4.5, -1, 0.5] }, ticks(n)),
    gravity('lava', v, { ...inPool, area: 'lava', at: [0.5, -1, 0.5] }, ticks(n)),
    kase(`gr_${v}_elytra`, { ...tower, tier: 3, since: '1.20.5', tags: ['gravity', 'attribute', 'elytra'] }, launch, look(0, 10), server(setAttribute('gravity', v)), ticks(n)),
  )
}
// The tick an impulse turns the motion: Slow Falling chooses by the sign the delta has when it is read
out.push(
  kase('gr_slow_falling_impulse_turns_up', {
    area: 'flat', at: [0.5, 10, 0.5], rest: [0.5, 0, 0.5], tier: 2, since: '1.13', tags: ['gravity', 'slow_falling'],
    setup: { effects: [{ id: 'slow_falling', amplifier: 0 }] },
  }, ticks(6), server(impulse(0, 0.02, 0)), ticks(6), server(impulse(0, -0.02, 0)), ticks(6), server(impulse(0, 0.3, 0)), ticks(20)),
)

// ---- The world border -----------------------------------------------------------------------------------------------
// Relative to the player, as m_click2_border_use; reset to the default after, so plain ticks (no until that can fail) up
// to the reset. A border stays set across cases.
const centered = (dx: number) => commandBy({ '1.13': `execute as @p at @s run worldborder center ~${dx} ~`, '1.8': `execute @p ~ ~ ~ worldborder center ~${dx} ~` })
const reset = server(command('worldborder set 59999968'), command('worldborder center 0 0'))
const border = (extra: Partial<KaseSpec> = {}): KaseSpec => ({ area: 'flat', at: [0.5, 0, 0.5], yaw: 270, tier: 2, tags: ['world_border'], ...extra })
out.push(
  // set to 10 around x -3.5: edges at -8.5 and 1.5, the shape at -9 and 2
  kase('bw_static_walk', border(), server(centered(-4), command('worldborder set 10')), ticks(2), press(F, 30), ticks(3), reset, ticks(3)),
  kase('bw_static_sprint_jump', border(), server(centered(-4), command('worldborder set 10')), ticks(2), press([F, SPRINT, JUMP], 30), ticks(3), reset, ticks(3)),
  // In from outside (the edges at -12.5 and -2.5), and back at it from inside
  kase('bw_outside_walks_in', border({ yaw: 90 }), server(centered(-8), command('worldborder set 10')), ticks(2), press(F, 40), look(270, 0), press(F, 40), ticks(3), reset, ticks(3)),
  // The size changes under a walking player: each tick the edge is a snapshot (a shrink passes the player, a growth leads it)
  kase('bw_static_shrinks_past', border(), server(centered(-4), command('worldborder set 20')), ticks(2), hold(F), ticks(10), server(command('worldborder set 2')), ticks(20), releaseAll(), reset, ticks(3)),
  // Moving: on ticks only from 1.21.11; before, the extent runs on the wall clock (1.21.10 WorldBorder.java:311, 337) and
  // the recording, 20 times faster than it, could not repeat
  kase('bw_moving_shrink', border({ since: '1.21.11' }), server(centered(-4), command('worldborder set 20')), ticks(2), server(command('worldborder set 6 20t')), press(F, 40), ticks(3), reset, ticks(3)),
  kase('bw_moving_grow', border({ since: '1.21.11' }), server(centered(-4), command('worldborder set 8')), ticks(2), server(command('worldborder set 24 40t')), press(F, 40), ticks(3), reset, ticks(3)),
)

// ---- Chunks leaving and coming back ---------------------------------------------------------------------------------
// Far enough for every chunk of the area to leave the client, high over nothing: the world there is flat and low, and a
// recording has only the area's blocks. Forced beforehand from 1.13.1, so that the server has them ready (as the nether case
// of mineflayer-features does); which tick each chunk arrives on is still the server's, so the case is reported apart by --verify.
const far = { from: 1536, to: 1664 }
const forceload = (verb: string) => commandBy({ '1.13.1': `forceload ${verb} ${far.from} -128 ${far.to} 128` })
out.push(
  kase('cu_tp_away_and_back', {
    area: 'flat', at: [0.5, 0, 0.5], tier: 3, serverMoves: true, tags: ['chunks'],
    serverTimed: 'the tick each chunk reaches the client',
    setup: { commands: [{ '1.13.1': `forceload add ${far.from} -128 ${far.to} 128` }] },
  },
    ticks(3),
    server(teleport(1600.5, 150, 0.5)),
    ticks(30),
    server(teleport(0.5, 5, 0.5)),
    ticks(40),
    untilOr('onGround', 80),
    ticks(3),
    server(forceload('remove')),
    ticks(2),
  ),
)

export default out
