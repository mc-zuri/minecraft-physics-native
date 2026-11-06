// Portals, as far as a recording can follow: one holds the overworld only, so a case must not change dimension.
//
// A nether portal (np_): in it for less than the 80 ticks of Player.getPortalWaitTime. Mortal for that: an invulnerable player
// waits 1 tick (abilities.invulnerable picks the creative delay), and the recorder's players are invulnerable otherwise. Left
// out: staying in, which ends in the nether. The client's own effect (the confusion, a screen closed) needs no dimension.
//
// An end portal (ep_): its block sends a player to the end on the tick its box meets the shape, so no case touches one: a jump
// over it, and the frame around it, which is plain collision. Left out: the contact, and everything after it (the end, its
// credits, the way back). An end gateway needs an exit written into its block entity, and is left out too.
import './_areas/index.ts'
import { F, INVENTORY, JUMP, SNEAK, SPRINT, hold, kase, press, releaseAll, screen, server, teleport, ticks, untilOr } from '../../dsl/physrec.ts'
import type { KaseSpec } from '../../dsl/physrec.ts'

const out = []

const nether: KaseSpec = {
  area: 'portals', at: [3.5, 0, 0], yaw: 270, tier: 3, mortal: true, difficulty: 'easy', serverMoves: true, tags: ['portal', 'nether_portal'],
  setup: { food: 10 }, requires: ['nether_portal'], expect: 'in:nether_portal',
}
// the plane at x=6.5, reached in 15 ticks of walking
const inside = [hold(F), untilOr('x > 6.4', 30), releaseAll()]
// Every case leaves the portal: the next case's reset makes the player invulnerable, and one tick in the portal then ends in the
// nether. Out of it the wait falls by 4 a tick, so 25 ticks leave nothing of it for the next case.
const leaves = [hold(F), untilOr('x > 8.5', 30), releaseAll(), ticks(25)]
out.push(
  kase('np_walk_through', { ...nether, checks: 'x > 8.5' }, press(F, 40), ticks(25)),
  kase('np_sprint_through', { ...nether, checks: 'x > 8.5' }, press([F, SPRINT], 30), ticks(25)),
  kase('np_sneak_through', { ...nether, checks: 'x > 7.5' }, press([F, SNEAK], 70), ticks(25)),
  kase('np_stand_inside', { ...nether, checks: 'x > 8.5' }, inside, ticks(50), leaves),
  kase('np_jump_inside', { ...nether, checks: 'x > 8.5 && highest > 1' }, inside, press(JUMP, 1), ticks(15), leaves),
  // down inside it: the box just fits under the frame's top
  kase('np_fall_through', { ...nether, at: [6.5, 1.1, 0], rest: [3.5, 0, 0], checks: 'x > 8.5' }, untilOr('onGround', 30), ticks(5), leaves),
  // A screen does not stay open in a portal: opened before it, the server moves the player in.
  kase('np_screen_closes', { ...nether, features: true, at: [4.5, 0, 0], checks: 'x > 8.5' },
    press(INVENTORY, 1), screen('inventory', 5), server(teleport(6.5, 0, 0)), screen('none', 30), ticks(5), leaves),
)

const end: KaseSpec = { area: 'portals', yaw: 270, at: [4.5, 0, 9.5], tier: 3, tags: ['portal', 'end_portal_frame'], requires: ['end_portal_frame'] }
out.push(
  // A running jump from just before the strip lands past it: the box stays above the block for the whole way over. (Timed from x,
  // not from a tick count: landing in the strip would send the player to the end, and with it the rest of the run.)
  kase('ep_jump_over_end_portal', {
    ...end, at: [14.5, 0, -6], tags: ['portal', 'end_portal'], requires: ['end_portal'], checks: 'x > 21.3 && lowest > -0.1',
  }, hold(F, SPRINT), untilOr('x > 19', 30), press(JUMP, 1), untilOr('onGround', 30), releaseAll(), ticks(10)),
  // 13/16 high: over the step height, and the eye's own shape takes it to a full block.
  kase('ep_frame_walk_against', { ...end, checks: 'x < 7.8' }, press(F, 40), ticks(5)),
  kase('ep_frame_jump_on', { ...end, expect: 'on:end_portal_frame', checks: 'highest > 0.8' }, hold(F), ticks(25), press(JUMP, 1), ticks(12), releaseAll(), ticks(10)),
  kase('ep_frame_eye_walk_against', { ...end, at: [4.5, 0, 13.5], checks: 'x < 7.8' }, press(F, 40), ticks(5)),
  kase('ep_frame_eye_jump_on', { ...end, at: [4.5, 0, 13.5], expect: 'on:end_portal_frame', checks: 'highest > 0.8' }, hold(F), ticks(25), press(JUMP, 1), ticks(12), releaseAll(), ticks(10)),
)

export default out
