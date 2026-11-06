// Area builders for the area modules made from data (bedrock-observer's areas, manual recordings).
import type { PhysrecArea, PhysrecFill } from '../../../dsl/physrec.ts'
import type { BlockPos } from '../../../../schema/scenario.ts'

/** A fill, area-local: block y=0 is the floor layer (a case's `at` y=0 stands on it). */
export const fill = (from: BlockPos, to: BlockPos, block: string, extra: Omit<PhysrecFill, 'from' | 'to' | 'block'> = {}): PhysrecFill =>
  ({ from, to, block, ...extra })

/** An area: its extent [minX, maxX, minZ, maxZ], an optional fixed origin, its fills in order. */
export const area = (name: string, extent: readonly [number, number, number, number], ...rest: [{ origin: BlockPos }, PhysrecFill[]] | [PhysrecFill[]]): PhysrecArea => {
  const [options, blocks] = rest.length === 2 ? rest : [undefined, rest[0]]
  return { name, extent, blocks, ...(options?.origin ? { origin: options.origin } : {}) }
}
