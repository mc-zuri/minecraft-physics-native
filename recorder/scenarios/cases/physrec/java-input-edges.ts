// The edges of LocalPlayer.aiStep's inputs, which the ordinary cases cross only by chance: the last tick of a double tap's
// window for the sprint (sprintTriggerTime) and for flight (jumpTriggerTime), what clears a window on the way, abilities
// taken away in the air, and the item in use under keys the normalization of 1.21.5 treats apart. `replay --adapter` asks
// each tick's decisions and move of the adapter.
import './_areas/index.ts'
import { type KaseSpec, B, F, JUMP, L, SNEAK, SPRINT, USE, command, hold, kase, press, releaseAll, server, stopped, ticks, until } from '../../dsl/physrec.ts'

const flat = { area: 'flat', at: [0.5, 0, 0.5], tier: 2, tags: ['input'] }
const creative = { area: 'flight', at: [0.5, 0, 0.5], gamemode: 'creative', tier: 3, tags: ['flight', 'input'], setup: {}, yaw: 270 }
const flying = { ...creative, at: [0.5, 4, 0.5], setup: { flying: true } }
const using = (id: string, extra = {}): KaseSpec => ({ ...flat, tags: ['input', 'item_use'], setup: { equipment: { mainhand: { id, enchantments: {} } }, food: 10, ...extra } })
const out = []

// The window is 7 ticks: the press that opens it, then 6 ticks down to the last that still sprints.
for (const gap of [5, 6, 7, 8]) {
  out.push(
    kase(`ie_sprint_tap_gap_${gap}`, { ...flat, tags: ['input', 'sprint'] }, press(F, 1), ticks(gap), press(F, 15), stopped(3)),
    kase(`ie_fly_tap_gap_${gap}`, creative, press(JUMP, 1), ticks(gap), press(JUMP, 1), ticks(12)),
  )
}
out.push(
  // What clears the window before the second tap: the sneak of the tick before, the back key (from 1.21.5), the item in use.
  kase('ie_sprint_tap_sneak_between', { ...flat, tags: ['input', 'sprint'] }, press(F, 1), press(SNEAK, 1), ticks(1), press(F, 15), stopped(3)),
  kase('ie_sprint_tap_back_between', { ...flat, tags: ['input', 'sprint'] }, press(F, 1), press(B, 1), ticks(1), press(F, 15), stopped(3)),
  kase('ie_sprint_tap_use_between', using('bread'), press(F, 1), press(USE, 2), ticks(1), press(F, 15), stopped(3)),
  // The sprint key held through a release of forward: the sprint ends, and the press starts it again.
  kase('ie_sprint_release_repress', { ...flat, tags: ['input', 'sprint'] }, hold(SPRINT), press(F, 10), ticks(2), press(F, 10), releaseAll(), stopped(3)),
  // Both of flight's vertical keys: nothing, and each in turn.
  kase('ie_fly_jump_and_sneak', flying, press([JUMP, SNEAK], 8), press(JUMP, 4), press([JUMP, SNEAK], 4), press(SNEAK, 4), ticks(5)),
  // Abilities taken away in the air: flying and mayfly go with the packet, the fall starts, and a double tap does nothing.
  kase('ie_fly_revoked_in_air', { ...flying, serverMoves: true }, hold(F), ticks(5), server(command('gamemode survival @p')), ticks(3), releaseAll(), press(JUMP, 1), ticks(2), press(JUMP, 1), until('onGround', 60), ticks(3)),
  // The item in use under diagonal keys, with and without the sneak (from 1.21.5 normalized first).
  kase('ie_eat_diagonal', using('bread'), hold(USE), ticks(5), press([F, L], 20), releaseAll(), stopped(3)),
  kase('ie_eat_sneak_diagonal', using('bread'), hold(USE), ticks(5), press([F, L, SNEAK], 20), releaseAll(), stopped(3)),
  kase('ie_shield_sneak_diagonal', using('shield', { equipment: { offhand: { id: 'shield', enchantments: {} } } }), hold(USE), press([F, L, SNEAK], 20), releaseAll(), stopped(3)),
)

export default out
