// B311: a player in a suffocating block at the world border. Up to 1.17.1 getBlockCollisions offers the border's own shape
// first, whatever its predicate says, so from 1.16.2, where suffocatesAt walks it, each column suffocates, no side is open
// and nothing pushes. It is offered only to a box less than 1.0E-7 past the border: see the last case. The others stop on
// the line, are not offered it and are pushed, on every release. 1.16.1 reads cells, and 1.18 asks canCollide.
// The world's own border is at x 29999984, local x=8 of the area.
import './_areas/index.ts'
import { F, command, commandBy, kase, press, registerAreas, server, stopped, ticks } from '../../dsl/physrec.ts'
import { area } from './coverage/_lib.ts'
import type { Scenario } from '../../dsl/core.ts'

const stone = (x: number): string[] => [100, 101].map(y => `setblock ${x} ${y} 0 stone`)
// A border near the origin of the area, as a command sets it: 2 blocks ahead of a player at x. The stones go on where it stopped.
const near = [
  commandBy({ '1.13': 'execute as @p at @s run worldborder center ~-3 ~', '1.8': 'execute @p ~ ~ ~ worldborder center ~-3 ~' }),
  command('worldborder set 10'),
]
const onPlayer = [
  commandBy({ '1.13': 'execute as @p at @s run setblock ~ ~ ~ stone', '1.8': 'execute @p ~ ~ ~ setblock ~ ~ ~ stone' }),
  commandBy({ '1.13': 'execute as @p at @s run setblock ~ ~1 ~ stone', '1.8': 'execute @p ~ ~ ~ setblock ~ ~1 ~ stone' }),
]
const unset = [command('worldborder set 59999968'), command('worldborder center 0 0')]

export const areas = [area('bs_open', [-10, 10, -6, 6])]

const cases: Scenario[] = [
  // the world's own edge, at 29999984
  kase('bs_at_the_border', { area: 'border', at: [7.2, 0, 0.5], yaw: 270, tier: 4, serverMoves: true, tags: ['world_border'] },
    press(F, 14),
    stopped(3),
    server(...stone(29999983).map(line => command(line))),
    ticks(14),
  ),
  kase('bs_away_from_the_border', { area: 'border', at: [2.5, 0, 0.5], yaw: 270, tier: 4, serverMoves: true, tags: ['world_border'] },
    ticks(5),
    server(...stone(29999978).map(line => command(line))),
    ticks(14),
  ),
  // a border a command set, away from any large coordinate
  kase('bs_at_a_set_border', { area: 'bs_open', at: [0.5, 0, 0.5], yaw: 270, tier: 4, serverMoves: true, tags: ['world_border'] },
    server(...near),
    ticks(2),
    press(F, 20),
    stopped(3),
    server(...onPlayer),
    ticks(14),
    server(...unset),
    ticks(2),
  ),
  // The border's shape is offered only to a box past it by less than 1.0E-7: grown by that, a box exactly on the border
  // ends on the same line after the merger's own 1.0E-7 and meets nothing (IndirectMerger), which is why the cases above
  // push. Only a teleport puts a player there: a walk is clamped to the line.
  kase('bs_just_past_a_set_border', { area: 'bs_open', at: [0.5, 0, 0.5], yaw: 270, tier: 4, serverMoves: true, tags: ['world_border'] },
    server(...near),
    ticks(2),
    press(F, 20),
    stopped(3),
    server(commandBy({ '1.13': 'execute as @p at @s run tp @s ~0.00000005 ~ ~', '1.8': 'tp @p ~0.00000005 ~ ~' })),
    ticks(2),
    server(...onPlayer),
    ticks(14),
    server(...unset),
    ticks(2),
  ),
]

export default cases
registerAreas(areas)
