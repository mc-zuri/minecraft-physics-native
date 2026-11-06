# Limitations

What the engine does not do, does differently from vanilla, or has not shown. A release or a method being available implies
none of it: `docs/release-status.md` says what each release has shown. Read this page by your release, your entry point and
your scenario.

Dated 2026-11-06, commit `0eaaa0d`. The final pass is still running, so nothing here counts its result.

## The four kinds

| Kind | Meaning | Reads in a replay as |
| --- | --- | --- |
| not implemented | The engine has no path for it, on purpose or not yet | `unsupported`, or refused by name |
| differs | The code departs from vanilla. The source says so, or a test does | `known` if listed, otherwise `unexpected` |
| untested | Code exists, with no current trace against vanilla | `untested`, or no pin |
| no source evidence | The release's source cannot be cited, so a match has nothing to be held to | `blocked` in `src/release-status.json` |

## Is my case verified?

1. Find your release in `docs/release-status.md`. No release is admitted, so the answer for parity is no.
2. Run `node scripts/release-admission.cjs <release>` to see which cells have a current pin. At this commit none has.
3. Find your entry point below. `docs/parity-contract.md` says what each interaction covers.
4. Find your scenario in `docs/capability-table.md`, and the recordings for it in `docs/recorder-coverage.md`.
5. Pass `requireParity: true` to have an engine refuse any release that is not admitted.

## Every release

| Limitation | Kind | Consequence | Evidence |
| --- | --- | --- | --- |
| No release is admitted | untested | `requireParity: true` refuses all 50 | `src/release-status.json`, B288 |
| Every pin is stale | untested | 23 pins on record, none on the current engine | `node scripts/release-admission.cjs 26.3`, `generated/conformance-evidence.json` |
| The recordings on hand predate the mod changes and the scenarios added since | untested | A clean pass is still to come | `docs/recorder-coverage.md`, B219, B235 |
| A pin does not show a branch was reached | untested | Three of nine moved gates had no check until a fixture was written | `docs/validation-records.md` |
| 102 of 295 gated functions are `unverified` against the source audit | untested | The list claims nothing for them | `generated/shared-gates.json`, `docs/shared-code-audit.md` |
| Random impulses other than the fire draws are not inputs | not implemented | Knockback spread, fishing and potion scatter are not predicted | `docs/boundary-inputs.md`, B058 |
| AI, pathfinding, targets and mob jumps | not implemented | The caller gives their result as input | `docs/mob-travel.md` |
| Hunger and exhaustion | not implemented | A tick never changes them | `docs/determinism.md` |
| A `ServerPlayer`'s move validation | not implemented | The engine does not model it | `docs/authority.md` |
| Remote entities, air supply, health, inventory, general `Entity` state | not implemented | Local-player parity says nothing of them | `docs/state-contract.md` |
| An infinite motion before 1.21.11, or a finite one past `MAX_WALKED_CELLS` | differs | Refused as "the tick's move", where vanilla walks it | `docs/numeric-contract.md`, `test/numeric-limits.test.cjs` |
| A motion past `MAX_SYNCED_CELLS` in the adapter | differs | The tick is skipped and `state.moveRefused` is set | `docs/numeric-contract.md`, B313 |
| `Math.sin`, `Math.cos`, `Math.atan2` | untested | Bit equal on the fixtures, which is no claim for every JVM | `docs/numeric-contract.md` |
| Equal results across targets | untested | macOS, ARM and a browser did not run the corpus. It says nothing of equality with the JVM | `docs/determinism.md` |

## By release

| Releases | Limitation | Kind | Evidence |
| --- | --- | --- | --- |
| 1.8.8 | Source is an alias of 1.8.9, for the scope in its record. No exact source | no source evidence | `generated/release-aliases.json`, `docs/source-records.md` |
| 1.8.x | `EmptyChunk` keeps what is set in it. That is not modelled | differs | `native/src/world.rs` `set_block` |
| 1.9.4 to 1.13.2 | Source blocked: the decompiled trees cannot be reproduced | no source evidence | `docs/source-records.md`, B276 |
| 1.9.4, 1.10.2, 1.11.2, 1.12.2 | The 2026-11-06 pass left scenarios `invalid` or in `error` | untested | `docs/recorder-coverage.md` |
| 1.13.2 | `me_mob_phantom_circles` is intermittently not deterministic | untested | B314 |
| 1.13.x | The empty chunk gives back the fluid set in it. That is not modelled | differs | `native/src/world.rs` `set_block` |
| 1.19.1, 1.21.2, 1.21.7, 1.21.10 | minecraft-data has no table of their own. The adapter takes a neighbour's data by a proved alias | untested | `src/mineflayer/data-aliases.json`, B302 |
| 26.1.1, 26.1.2 | The adapter takes 26.1's data | untested | `src/mineflayer/data-aliases.json`, `docs/registry-release-contract.md` |
| 26.2, 26.3 | The published `minecraft-data` has no table. The adapter needs a build that does | not implemented | `README.md` |
| 1.19.3, 1.19.4 | `v_camel_dash`, `v_camel_sprint` and `v_camel_walk` were skipped in the last pass | untested | `docs/recorder-coverage.md` |
| 1.20 | `x_far29m_sprint_jump` ended in an error in the last pass | untested | `docs/recorder-coverage.md` |
| 1.20.5, 1.20.6 | Three chested-mount scenarios ended in an error, and `pj_arrow_breeze_deflects` was skipped in the last pass | untested | `docs/recorder-coverage.md` |

## By entry point

| Entry point | Limitation | Kind | Evidence |
| --- | --- | --- | --- |
| `simulateTick`, `simulateTicks` | Refused: a concrete version is required | not implemented | `native/src/napi_api.rs` |
| `simulateBoatTick`, `simulateHorseTick`, `simulateProjectileTick`, `simulateArrowTick`, `simulateTridentTick` | Run at the default release, with no version argument | differs | `docs/engine-architecture.md` |
| `simulateVersionedTick` | Leaves out the scene the next tick reads. Use `simulateVersionedTickOutcome` to carry a state | not implemented | `docs/state-contract.md` |
| `simulateVersionedProjectileTicks` | A name outside the family table runs as `Generic`, the thrown item's tick, on the unchecked entry points | differs | `docs/projectile-capabilities.md` |
| `simulateVersionedMobTravel` | `entityTravelSupport` says `unknown` for a kind with no override: it travels as `living`. The family says nothing of a match | untested | `docs/mob-travel.md`, `native/src/entity_travel.rs` |
| Vehicle phases | A vehicle has no trace inside its tick. Captured, not compared | not implemented | `recorder/README.md` |
| Minecarts | Rail and subtype physics are not complete. The experiment needs `minecart_improvements` | not implemented | B189, `docs/parity-contract.md` |
| A live bot through mineflayer's plugin | The plugin does not yet call `MinecartTracker`, `pushByMovingPiston` for a vehicle, or fill `nearbyEntities` for vehicles | not implemented | B312 |
| Adapter and bot replay layers | Done in part: movement only, hands not driven | untested | `recorder/README.md`, B221 |
| `state-bridge` equivalence | Checked on listed fixtures, not over the state space. Vehicles are not classified there | untested | `docs/state-bridge.md` |
| World sync | A chunk the caller never wrote reads as air, not as an error | differs | `docs/synchronization.md` |
| `NativeWorldSync.refused` | A block the engine refuses stays a gap. The caller must read this map | differs | `src/mineflayer/world.ts`, `test/chunk-lifecycle.test.cjs` |

## By platform

| Target | Limitation | Evidence |
| --- | --- | --- |
| macOS, Linux musl, Linux arm64 | Not built, not supported. The loader's branches are no support | `README.md`, `docs/release-build.md`, B264 |
| One combined tarball | None exists: each tarball holds its host's targets | `docs/release-build.md` |
| Browser | The determinism corpus did not run in a browser | `docs/determinism.md` |

## Findings of the source audits

`docs/parity-dispositions.json` holds what became of D-161 to D-229 in `parity-deviations.md`. Its status counts are
not an active defect census. Each row below is a source argument: read from vanilla's code, with no trace or regression
that shows the difference. They were dispositioned once, under B233, and were not each re-read for this page.
`recorder/replay/test/evidence.test.ts` holds that file's counts. An entry leaves this table when its disposition changes.

D-212 is listed as active in that file, but `todo.md` records its fix as B311 with `bs_just_past_a_set_border`. The file has
not caught up, so read that row with this note.

### Active: the code differs by the source

| Finding | Releases | Scope | Title | Tickets |
| --- | --- | --- | --- | --- |
| D-165 | 1.8.8-1.14.4 | client/player/Entity.move stepOn (slime, magma) | Pre-1.15 stepOn runs for a flying player | B083 |
| D-166 | 26.3 | client/player and ridden mob/fluid hop free-space test | 26.3 containsAnyLiquid scans inclusive cells | B140 |
| D-172 | 1.21.2-26.3 | client/player/piston push | Piston move limited to zero skips block effects | B088, B162 |
| D-173 | 1.13.2 | client/boat/floatBoat | 1.13 getWaterLevelAbove adds y inside the max | B186 |
| D-174 | 1.13.2 | client/boat/status scans | 1.13 boat scans use the water-above height | B186 |
| D-175 | 1.17-1.19.3 (camel 1.19.3 only) | client/horse family and 1.19.3 camel/ridden travel | Ridden horses and camel skip the extra inside-block pass | B187 |
| D-177 | arrows and tridents 1.13.2-26.3; hurting projectiles 1.16.2-26.3 | client/arrow, trident, fireball family, shulker bullet | Bubble columns never push arrows or hurting projectiles | B144, B198 |
| D-179 | 1.14.4-1.16.1 | client/thrown items and llama spit/block_hit via adapter world sync | 1.14-1.16.1 throwables clip outlines | B200 |
| D-180 | 1.8.8-1.13.2 | client/arrows, thrown items, fireballs, llama spit/block clip | Pre-1.14 projectiles clip the wrong block shape | B198, B200 |
| D-183 | 1.8.8-26.3 (powder snow shape 1.17-26.3) | client/boat (ridden mobs now covered)/vehicle move | Boats and ridden mobs never add fallDistance | B184, B186 |
| D-184 | 1.21.2-26.1.2 | client/remote entity/N-API controlled_by_local_instance=false | Non-local entity still gets landing velocity update | M21, B151, B083 |
| D-187 | 1.8.8-26.1.2 | client/player/check_fall_damage | Ceiling hit over slime resets fall distance | B097 |
| D-189 | 1.21.5-26.3 | client/player/riptide launch block effects | Riptide lift missing from movementThisTick | B057 |
| D-190 | 1.21.4 | client/player and entities/inside-block traversal | 1.21.4 traversal keeps the 1e-7 nudge | B083 |
| D-191 | 1.13.2 | client/player/water travel | 1.13.2 water snap uses pre-move falling flag | B141 |
| D-192 | 1.14.4 | client/spectator player/adapter input | 1.14 spectator sneak input slowed then undone | B113 |
| D-194 | all, direct N-API callers omitting movement speed | client/player/N-API default PhysicsConfig | Default movement speed is double 0.1 | B105 |
| D-195 | 1.10.2-1.12.2 | client/LocalPlayer/updateAutoJump | 1.10-1.12 auto-jump obstacle order | B104 |
| D-196 | 1.10.2-1.12.2 | client/LocalPlayer/updateAutoJump | 1.10-1.12 auto-jump probes full collision shape | B104 |
| D-197 | 1.13.2-26.3 | client/player/check_auto_spin_attack, adapter entity kinds | Spectator in the sweep keeps the riptide spin | B168 |
| D-200 | 1.13.2-26.3 | client/projectiles/clip_block | Projectile inside test uses world coordinates | B200 |
| D-202 | 1.13.2 | client/player, boats/block collision shape data | 1.13.2 bed and cauldron shapes are 1.14's | B073, B152 |
| D-204 | 1.9.4-26.3 (shulker); 1.21.6-26.3 (happy ghast) | client/player/entity colliders | Dying shulker or happy ghast still collides | B052, B168 |
| D-206 | 1.9.4-26.3 | client/player/entity push | Player carrying passengers still pushed | B168 |
| D-207 | 1.8.8 | client/player/piston push before 1.9 | 1.8 pushed-block area not normalised | B162 |
| D-208 | 1.21.5-26.3 | client/boat/block effects | 1.21.5+ boat effect pass starts before the snap | B186 |
| D-209 | 1.20-26.3 | client/camel/ridden tick | Sitting camel in water does not stand | B187 |
| D-210 | 26.3 | client/fishing hook/Entity.move restitution | 26.3 fishing hook gravity and restitution | B198 |
| D-211 | 1.13.2-26.1.2 | client/player/riptide launch | Riptide lift ignores slime or bed on ceiling hit | B083 |
| D-212 | 1.16.2-1.17.1 | client/LocalPlayer/moveTowardsClosestSpace | 1.16.2-1.17.1 suffocatesAt ignores the border offer | B087 |
| D-214 | 1.13.2-26.3 | client/player/tick order | Riptide launch runs after pre-player boosts and pushes | B057 |
| D-215 | 1.19.1-26.3 | client/LocalPlayer/removal tick | Removed player skips the base tick | B057 |
| D-216 | 1.8.8 | client/player/N-API simulateVersionedTick family | Generic state has no yaw in degrees | B051 |
| D-218 | 1.9.4-1.12.2 | client/player/adapter EYE_HEIGHT | 1.9-1.12 eye height ignores the glide case | B120 |
| D-219 | 1.13.2 | client/player/adapter updateFluids | 1.13 fluid probe uses a pose-sized box | B120, B140 |
| D-220 | 1.13.2-1.21.11 (26.1+ now uses ceil) | client/player/adapter updateFluids | In-water scan includes floor(max) cell | B140 |
| D-221 | 1.19-1.20.4 | client/player/maybeBackOffFromEdge | 1.19-1.20.4 rising guard with NaN | B056 |
| D-222 | 1.11.2 | client/player/attached rocket boost | 1.11 rocket before player boosts along head yaw | B178 |
| D-225 | 1.21.9-26.3 | client/player and entities/inside-block traversal | 1.21.9+ corner walk step vector | B083 |
| D-227 | 1.19.3 | client/camel/ridden travel | 1.19.3 refusing camel uses own input branch | B187 |
| D-228 | 1.17-1.21.1 | client/player/riptide launch | 1.17-1.21.1 riptide lift skips fire part of move | B092, B177 |

### Fixed, not validated

The code was changed. Nothing yet shows the change against vanilla.

| Finding | Releases | Title | Tickets |
| --- | --- | --- | --- |
| D-161 | 1.21-1.21.11, 26.1 (audit scope; 26.2 and 26.3 read the same way) | Synced attribute keys missed on 1.21+ | B124, B125 |
| D-167 | 1.20.5-1.20.6 | 1.20.5 attributes unresolved on 1.20.5-1.20.6 | B124, B125 |
| D-186 | 1.20.5-26.3 | Landing computed damage at fall_distance 0 | B098 |
| D-226 | 1.13.2-1.16.5 | Boat waterLevel start value | B186 |
| D-229 | 26.3 | 26.3 elytra start read a stale lava flag | B136, B174 |

## Keeping this page

- A limitation leaves this page only with a current trace or test. `test/limitations.test.cjs` holds the two tables above to
  `docs/parity-dispositions.json`, and the first tables to the repository's own files.
- The older report `parity-deviations.md` stays as history. Its counts are of that audit, not of today.
- The audit folder `audit/physics-version-review-20261104/` is gone from this machine (`docs/finding-ledger.md`). M01 to
  M32 are each fixed in their tickets, and that does not extend past what each ticket covered.
