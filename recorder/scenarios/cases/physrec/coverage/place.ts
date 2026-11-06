// Ported from physics-data-generator catalog/src/coverage/place.mjs; maintained here now.
// Placing blocks the way players do: a held use places every 4 ticks (rightClickDelay) on whatever the crosshair hits
// that tick, so moving while holding it builds as you go. Pillaring (jump + use looking down), sneak-bridging
// backwards over an edge, walking/sprinting/strafing with use held, placing while falling, half slabs and stairs by
// where the crosshair hits, torches on walls, a miss (out of reach: use_item instead), replaceable blocks (grass is
// replaced in place), and places the block cannot go (inside the player, under a mob: the server reverts it).
// The placed blocks reach the recording as block changes, so the bot's collision with them is checked too.
import '../_areas/index.ts'
import { registerAreas, B, F, JUMP, L, SNEAK, SPRINT, USE, crosshair, hold, kase, look, releaseAll, ticks } from '../../../dsl/physrec.ts'
import { aim, area, at1, fill, feature, hands, item, start } from './_lib.ts'
import type { KaseSpec, PhysrecStep, PhysrecSteps } from '../../../dsl/physrec.ts'

const LANES = ['open', 'pillar', 'walk', 'sprint', 'strafe', 'station', 'slab', 'stairs', 'grass', 'mob', 'self', 'far']
const Z = Object.fromEntries(LANES.map((n, i) => [n, -24 + i * 4]))

export const areas = [
  area('cov_place', [-6, 24, -28, 24],
    at1(2, 1, Z.station, 'stone'),
    at1(2, 1, Z.slab, 'stone'),
    at1(2, 1, Z.grass, 'short_grass', { since: '1.20.3' })),
  // A 3-high platform (x 0..12) to bridge off backwards and to fall from.
  area('cov_bridge', [-20, 16, -8, 8], fill([0, 1, -8], [12, 3, 8], 'stone'))
]

const out = []
const DIRT = item('dirt', 64)
const place = (name: string, lane: string, view: Pick<KaseSpec, 'yaw' | 'pitch'>, steps: PhysrecSteps, extra: Partial<KaseSpec> = {}): void => {
  const at = extra.at ?? [0.5, 0, Z[lane] + 0.5]
  out.push(kase(`m_c_place_${name}`, {
    ...feature(),
    area: 'cov_place',
    at,
    ...view,
    tags: ['coverage', 'place'],
    setup: hands({ 0: DIRT }),
    ...extra,
  },
    start(),
    crosshair(),
    steps,
  ))
}
const holdUse = (n: number, ...keys: string[]): PhysrecStep[] => [hold(USE, ...keys), ticks(n), releaseAll(), ticks(15)]

// Jump and use held, looking straight down: a block under the feet at the top of each jump.
place('pillar', 'pillar', { yaw: 270, pitch: 90 }, holdUse(80, JUMP))
// Use held while standing, looking down: the block under the feet is the player's own place (refused).
place('into_self', 'self', { yaw: 270, pitch: 90 }, holdUse(12))
// Walking, sprinting and strafing with use held, the crosshair on the floor ahead: blocks appear in the path.
place('walk_hold', 'walk', { yaw: 270, pitch: 55 }, holdUse(40, F))
place('sprint_hold', 'sprint', { yaw: 270, pitch: 55 }, holdUse(40, F, SPRINT))
place('strafe_hold', 'strafe', { yaw: 270, pitch: 65 }, holdUse(40, L))
// Half slabs: the upper or the lower half of the face decides top or bottom.
const slabAt = (y: number): { yaw: number; pitch: number } => aim([0.5, 0, Z.slab + 0.5], [2.001, 1 + y, Z.slab + 0.5])
place('slab_top', 'slab', slabAt(0.8), holdUse(2), { setup: hands({ 0: item('stone_slab', 8) }) })
place('slab_bottom', 'slab', slabAt(0.2), holdUse(2), { setup: hands({ 0: item('stone_slab', 8) }) })
// Stairs on the floor face away from the player; on a wall's upper half they are upside down.
place('stairs_floor', 'stairs', aim([0.5, 0, Z.stairs + 0.5], [2.5, 1, Z.stairs + 0.5]), holdUse(2), { setup: hands({ 0: item('oak_stairs', 8) }) })
place('stairs_on_wall_top', 'station', aim([0.5, 0, Z.station + 0.5], [2.001, 1.8, Z.station + 0.5]), holdUse(2), { setup: hands({ 0: item('oak_stairs', 8) }) })
// A torch on a wall (wall_torch facing the player) and on the floor.
place('torch_wall', 'station', aim([0.5, 0, Z.station + 0.5], [2.001, 1.5, Z.station + 0.5]), holdUse(2), { setup: hands({ 0: item('torch', 8) }) })
place('torch_floor', 'open', aim([0.5, 0, Z.open + 0.5], [2.5, 1, Z.open + 0.5]), holdUse(2), { setup: hands({ 0: item('torch', 8) }) })
// Nothing in reach: use_item, no use_item_on.
place('out_of_reach', 'far', { yaw: 270, pitch: 2 }, holdUse(2))
// Short grass is replaced by the block itself (placed in its place, not next to it).
place('replace_short_grass', 'grass', aim([0.5, 0, Z.grass + 0.5], [2.5, 1.3, Z.grass + 0.5]), holdUse(2), { since: '1.20.3', requires: ['short_grass'] })
// A mob stands where the block would go: the client predicts it, the server refuses and sends the block back.
place('blocked_by_mob', 'mob', aim([0.5, 0, Z.mob + 0.5], [2.5, 1, Z.mob + 0.5]), holdUse(2),
  { setup: { ...hands({ 0: DIRT }), summon: [{ entity: 'cow', at: [2.5, 0, Z.mob + 0.5], yaw: 90 }] } })

// Sneak-bridging: facing +x on the platform's west edge, walking back over the edge with sneak (the edge holds the
// player) and use held at a steep pitch: the crosshair finds the side of the block underfoot, the next block goes
// there, the player backs onto it, and so on.
out.push(kase('m_c_place_sneak_bridge_back', {
  ...feature(),
  area: 'cov_bridge',
  at: [0.5, 3, 0.5],
  yaw: 270,
  pitch: 78,
  tags: ['coverage', 'place', 'sneak'],
  setup: hands({ 0: DIRT }),
},
  start(),
  hold(SNEAK),
  ticks(5),
  crosshair(),
  hold(B, USE),
  ticks(100),
  releaseAll(),
  ticks(15),
))
// Off the edge looking down with use held: the block goes on the floor below once it is in reach, under the player.
out.push(kase('m_c_place_while_falling', {
  ...feature(),
  area: 'cov_bridge',
  at: [0.5, 3, 0.5],
  yaw: 270,
  pitch: 90,
  tags: ['coverage', 'place', 'falling'],
  setup: hands({ 0: DIRT }),
},
  start(),
  hold(B),
  ticks(4),
  hold(USE),
  ticks(40),
  releaseAll(),
  ticks(15),
))
// Walking off the edge forwards while placing in front at the edge (look back down at the edge face).
out.push(kase('m_c_place_bridge_forward_sneak', {
  ...feature(),
  area: 'cov_bridge',
  at: [2.5, 3, 0.5],
  yaw: 90,
  pitch: 80,
  tags: ['coverage', 'place', 'sneak'],
  setup: hands({ 0: DIRT }),
},
  start(),
  hold(SNEAK, F),
  ticks(20),
  hold(USE),
  ticks(60),
  releaseAll(),
  ticks(15),
))

export default out

registerAreas(areas)
