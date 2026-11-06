// Ported from physics-data-generator catalog/src/cases/java-edge.mjs; maintained here now.
// Edge cases that are about numbers and boundaries more than blocks: positions near a million and near the world
// border (float/double precision, negative rounding), walking into the world border, server velocity (knockback)
// in every situation, auto-jump, and the smallest speeds the game still keeps.
import './_areas/index.ts'
import { type KaseSpec, F, JUMP, SNEAK, SPRINT, hold, impulse, kase, press, releaseAll, server, stable, stopped, ticks, until } from '../../dsl/physrec.ts'
import { STEPS, laneZ } from './_areas/java-areas.ts'

const out = []
for (const area of ['far1m', 'farNeg', 'far29m']) {
  const base = { area, at: [0.5, 0, 0.5], yaw: 270, tier: 4, tags: ['far', 'precision'] }
  out.push(
    kase(`x_${area}_walk`, base,
      press(F, 30),
      stopped(3),
    ),
    kase(`x_${area}_sprint_jump`, base,
      hold(F, SPRINT),
      ticks(5),
      press(JUMP, 1),
      until('onGround', 40),
      releaseAll(),
      stopped(3),
    ),
    kase(`x_${area}_diagonal_into_wall`, { ...base, yaw: 250 },
      press([F, SPRINT], 30),
      stopped(3),
    ),
    kase(`x_${area}_sneak_negative_edge`, { ...base, at: [-11.5, 0, -11.5], yaw: 135 },
      press([F, SNEAK], 40),
      ticks(5),
    )
  )
}
out.push(
  kase('x_world_border_walk', {
    area: 'border',
    at: [0.5, 0, 0.5],
    yaw: 270,
    tier: 4,
    tags: ['world_border'],
  },
    press(F, 40),
    stopped(3),
  ),
  kase('x_world_border_sprint_diagonal', {
    area: 'border',
    at: [0.5, 0, 0.5],
    yaw: 240,
    tier: 4,
    tags: ['world_border'],
  },
    press([F, SPRINT], 40),
    stopped(3),
  ),
  kase('x_world_border_jump', {
    area: 'border',
    at: [6.5, 0, 0.5],
    yaw: 270,
    tier: 4,
    tags: ['world_border'],
  },
    hold(F),
    press(JUMP, 1),
    until('onGround', 40),
    releaseAll(),
    stopped(3),
  )
)

// Server velocity: set while standing, walking, sprinting, jumping, sneaking at an edge, into a wall, and too small to
// count. The recording marks the tick it reaches the client.
const flat = { area: 'flat', at: [0.5, 0, 0.5], tier: 4, tags: ['knockback'] }
out.push(
  kase('x_knockback_standing', flat,
    server(impulse(0.4, 0.36, 0)),
    ticks(40),
  ),
  kase('x_knockback_walking', flat,
    hold(F),
    ticks(10),
    server(impulse(0, 0.36, -0.4)),
    ticks(30),
    releaseAll(),
    stopped(3),
  ),
  kase('x_knockback_sprinting', flat,
    hold(F, SPRINT),
    ticks(10),
    server(impulse(-0.5, 0.4, 0)),
    ticks(30),
    releaseAll(),
    stopped(3),
  ),
  kase('x_knockback_mid_jump', flat,
    press(JUMP, 1),
    ticks(4),
    server(impulse(0.3, 0, 0.3)),
    until('onGround', 40),
    ticks(10),
  ),
  kase('x_launch_straight_up', flat,
    server(impulse(0, 1.5, 0)),
    until('onGround', 200),
    ticks(10),
  ),
  kase('x_impulse_tiny', flat,
    server(impulse(0.002, 0, 0.002)),
    ticks(20),
  ),
  kase('x_impulse_downward', { ...flat, at: [0.5, 5, 0.5], rest: [0.5, 0, 0.5] },
    server(impulse(0, -2, 0)),
    until('onGround', 40),
    ticks(10),
  ),
  kase('x_knockback_into_wall', {
    area: 'walls',
    at: [13.5, 0, 0.5],
    tier: 4,
    tags: ['knockback', 'collision'],
  },
    server(impulse(1.2, 0.2, 0)),
    ticks(30),
  ),
  kase('x_knockback_off_edge_sneaking', {
    area: 'ledges',
    at: [0.5, 1, 0.5],
    tier: 4,
    tags: ['knockback', 'edge'],
    serverMovesIn: ['1.11.2'],
  },
    hold(SNEAK),
    ticks(5),
    server(impulse(0.6, 0.1, 0)),
    ticks(40),
    releaseAll(),
  )
)

// Auto-jump (client option): walking into a full block jumps; a slab is stepped; sneaking suppresses it.
const lane = (block: string): KaseSpec => ({ area: 'steps', at: [0.5, 0, laneZ(STEPS.indexOf(block)) + 0.5], yaw: 270, tier: 4, tags: ['auto_jump'], since: '1.10', requires: [block], setup: { autoJump: true } })
out.push(
  kase('x_autojump_block', lane('stone'),
    press(F, 40),
    stopped(3),
  ),
  kase('x_autojump_block_sprint', lane('stone'),
    press([F, SPRINT], 30),
    stopped(3),
  ),
  kase('x_autojump_slab', lane('stone_slab[type=bottom]'),
    press(F, 40),
    stopped(3),
  ),
  kase('x_autojump_chest', lane('chest[facing=west]'),
    press(F, 40),
    stopped(3),
  ),
  kase('x_autojump_sneaking', lane('stone'),
    press([F, SNEAK], 60),
    stopped(3),
  ),
  kase('x_autojump_fence', lane('oak_fence'),
    press(F, 40),
    stopped(3),
  )
)

// Coasting to a stop: the last ticks before the speed is dropped as negligible, on stone, ice and in the air.
out.push(
  kase('x_coast_stone', { area: 'flat', at: [0.5, 0, 0.5], tier: 4, tags: ['coast'] },
    press(F, 1),
    ticks(40),
  ),
  kase('x_coast_ice', { area: 'iceSurface', at: [0.5, 0, 0.5], tier: 4, tags: ['coast'] },
    press(F, 1),
    ticks(120),
  ),
  kase('x_coast_air', { area: 'flat', at: [0.5, 0, 0.5], tier: 4, tags: ['coast'] },
    press([F, JUMP], 1),
    until('onGround', 40),
    ticks(40),
  ),
  kase('x_coast_water', {
    area: 'waterPool',
    at: [0.5, -2, 0.5],
    rest: [0.5, 0, -11.5],
    tier: 4,
    tags: ['coast', 'water'],
  },
    press(F, 2),
    stable(5, 200),
  )
)

// 1.11.2's own server rejects the third airborne move of the sneaking knockback off the ledge: its movement check
// (ServerPlayNetworkHandler.onPlayerMove: the move replayed with player.move(MovementType.PLAYER, ...) lands more than
// 0.0625 from where the client says, "Dev moved wrongly!", requestTeleport) puts the player back at the tick-7
// position, in every run (three of three, on a loaded and an idle server). The client's path up to there is the same
// as on 1.10.2 and 1.12.2, whose servers accept it, and the recorder's part (the hold, the impulse) is the same code
// on all three: the correction is the native case on 1.11.2, recorded as server input there.
// (x_knockback_off_edge_sneaking takes serverMovesIn: ['1.11.2'] for this, in its spec above)

export default out
