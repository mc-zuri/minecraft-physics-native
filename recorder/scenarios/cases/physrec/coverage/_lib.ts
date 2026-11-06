// Ported from physics-data-generator catalog/src/coverage/_lib.mjs; maintained here now.
// Shared helpers of the coverage cases (catalog/src/coverage): courses, aiming and hands. No cases here.
//
// The coverage cases look for what mineflayer and mineflayer-physics-utils may not implement yet, from the vanilla
// 26.3 client's code: every rideable, digging and placing while moving, the right-click matrix (each interactive block
// by hand and sneak), containers of blocks and entities, and items used in the air. Names: c_<group>_* (physics,
// replayed by the engine and the bot), m_c_<group>_* (feature cases: the bot only, packet for packet).
// Record on their own: --filter "c_*" and --filter "m_c_*".
import {
  HOTBAR, USE, closeScreen, look, press, screen, ticks,
  type KaseSpec, type PhysrecArea, type PhysrecFill, type PhysrecItem, type PhysrecSetup, type PhysrecStep, type Pos,
} from '../../../dsl/physrec.ts'

type FillExtra = Omit<PhysrecFill, 'from' | 'to' | 'block'>

/** A fill, local to the area; block y=0 is the floor layer (a case's `at` y=0 stands on it). */
export const fill = (from: Pos, to: Pos, block: string, extra: FillExtra = {}): PhysrecFill => ({ from, to, block, ...extra })
export const at1 = (x: number, y: number, z: number, block: string, extra?: FillExtra): PhysrecFill => fill([x, y, z], [x, y, z], block, extra)
export const area = (name: string, extent: readonly number[], ...blocks: (PhysrecFill | readonly PhysrecFill[])[]): PhysrecArea =>
  ({ name, extent, blocks: [fill([extent[0], 0, extent[2]], [extent[1], 0, extent[3]], 'stone'), ...blocks.flat() as PhysrecFill[]] })

export const item = (id: string, count = 1): PhysrecItem => ({ id, count, enchantments: {} })

// Eye height above the feet: standing and crouching (1.14+; the recordings start after the pose has changed).
export const EYE = 1.62
export const EYE_CROUCH = 1.27
const deg = (r: number): number => Math.round(r * 180 / Math.PI * 1000) / 1000

/**
 * yaw and pitch from the feet at `from` (area-local, y=0 on the floor) to the point `to` in block coordinates
 * (block y=0 is the floor layer, so feet at local y=0 are at block y=1).
 */
export function aim (from: Pos, to: Pos, eye = EYE): { yaw: number; pitch: number } {
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  const dy = to[1] - (from[1] + 1 + eye)
  return { yaw: deg((Math.atan2(-dx, dz) + 2 * Math.PI) % (2 * Math.PI)), pitch: deg(-Math.atan2(dy, Math.hypot(dx, dz))) }
}
export const lookAt = (from: Pos, to: Pos, eye?: number): PhysrecStep => { const a = aim(from, to, eye); return look(a.yaw, a.pitch) }

/** A feature case waits first: from 26.3 the client ignores keys until it reports the area loaded. */
export const start = (): PhysrecStep => ticks(40)

/** Select hotbar slot n (0-8) with its key, as a player does. */
export const slot = (n: number): PhysrecStep => press(HOTBAR(n + 1), 1)

/** One right click, then close whatever screen it opened. */
export const useOnce = (after = 8): PhysrecStep[] => [press(USE, 1), ticks(after), closeScreen(), screen('none', 20), ticks(3)]

/** Inventory index (0-8 hotbar, 9-35 main, 36-39 armor, 40 off hand) to item, the main hand on slot 0. */
export const hands = (slots: Readonly<Record<number, PhysrecItem | null | undefined | false>>, selected = 0): Pick<PhysrecSetup, 'inventory' | 'selected'> =>
  ({ inventory: Object.fromEntries(Object.entries(slots).filter(([, v]) => v)) as Record<string, PhysrecItem>, selected })

/** Feature-case defaults: the server moves the player (teleports, dismounts), one run (worlds are reset). */
export const feature = <T extends Partial<KaseSpec>>(extra: T = {} as T) => ({ features: true, serverMoves: true, tier: 3, verify: 1, ...extra })
