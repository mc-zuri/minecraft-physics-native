// The randomized cases of a run: none in the catalog, so the corpus does not depend on them. RANDOM_CASES names a JSON list of
// specs (scenarios/random.ts) that record.ts and build.ts then compile as physrec/<id>.
import { readFileSync } from 'node:fs'
import './_areas/index.ts'
import { giveEffect, impulse, kase, press, server, setBlock, ticks, turn, type PhysrecSteps } from '../../dsl/physrec.ts'
import type { RandomSpec, RandomStep } from '../../random.ts'


const stepOf = (step: RandomStep): PhysrecSteps => {
  switch (step.kind) {
    case 'press': return press([...step.keys], step.ticks)
    case 'wait': return ticks(step.ticks)
    case 'turn': return turn(step.dyaw, 0, step.ticks)
    case 'impulse': return server(impulse(...step.vel))
    case 'effect': return server(giveEffect(step.id, step.amplifier))
    case 'block': return server(setBlock([...step.at], step.state))
  }
}

const file = process.env.RANDOM_CASES
const specs = file ? JSON.parse(readFileSync(file, 'utf8')) as RandomSpec[] : []

export default specs.map(spec => kase(spec.id, { area: spec.area, at: [0.5, 0, 0.5], yaw: spec.yaw, tier: 3, tags: ['random'] }, ...spec.steps.map(stepOf), ticks(10)))
