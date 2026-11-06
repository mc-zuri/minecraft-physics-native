# Numbers

What the engine promises of its arithmetic, and how each promise is checked.

## Comparison target

The target is HotSpot 25.0.3 running the real jars, on x86-64 Windows. `native/fixtures/java-oracle-*.txt` are that
output. Comparisons are by bits, so signed zeros count. No test takes a tolerance.

| operation | promise | evidence |
|---|---|---|
| `+ - * /`, float and double, `sqrt` | bit equal: IEEE and Java agree | every fixture |
| `Mth.sin`, `Mth.cos` (table) | bit equal | `sintable` and `sin`, `cos` |
| `Math.sin`, `Math.cos`, `Math.atan2` | bit equal on the fixtures, documented JVM-specific | `jsin`, `jcos`, `atan2`. `trig.rs` is correctly rounded and HotSpot's intrinsics are not always, so this is a measured result on those inputs and no claim for every JVM |
| floor, ceil, round, clamp, frac, wrap | bit equal, by release | `floor`, `ceil`, `lfloor`, `round`, `clamp`, `clampf` at integers, half ties, extrema, -0.0, NaN |
| a whole trajectory | bit equal | `walk` lines, recordings |

## Targets

`scripts/java-oracle/wasm` has two programs, each built for the host and for `wasm32-wasip1`, and both targets must give the
same digest. `oracle-wasm` is the math vectors. `oracle-engine` links the real crate, built without its `bindings` feature
so that no emnapi is needed, and runs every `walk` line through `versioned::dispatch`: 8 releases, 512 walks and 26228 ticks,
none differing from Java, with digest `55bc5299d48e37b1` on both. The N-API layer itself does not run under WASM here, and
`wasm32-wasip1-threads`, Linux and macOS did not run. Building for WASM takes the rustup toolchain's binaries directly: the
`rustc` on `PATH` has no wasm std.

## Types of the high-impact paths

Order of operations is preserved as written: do not replace an expression with an equal-looking one.

| path | Java | Rust |
|---|---|---|
| friction speed, 1.14+ | `speed * (0.21600002F / (f * f * f))`, all float | `speed as f32 * (0.21600002_f32 / (f * f * f))`, widened at the end |
| friction test, 26.2+ | `(double)f > 0.6`: 0.6F is above 0.6 | `f64::from(friction) <= 0.6` returns the speed |
| jump power | `(float)strength * factor + boost` in float, double boost on 1.17.1-1.19.4 and before 1.14 | `jump_power` |
| sprint jump before 1.20.5 | `-sin * 0.2F`, float, then added to a double | `sprint_jump_push` |
| sprint jump from 1.20.5 | `(double)-sin * 0.2`, double | `sprint_jump_push` |
| jump floor from 1.20.5 | `jumpPower <= 1.0E-5F` is no jump | `power as f32 <= 1.0e-5` |
| yaw | float degrees `* 0.017453292F`, then widened | `yaw_radians`, `yaw` holds the widened value |
| fall distance | see `accumulated_fall_distance` for each release's cast | float before 1.21.5, double from it |
| dimensions | `width * scale`, float, `/ 2.0F`, then `x - (double)half` | `half_width` holds the float widened |
| input | `xxa *= 0.98F`, float, then widened | `scale_input` |

Rust does not fuse or reorder floating-point operations without an explicit flag, and the crate sets none. An
equal-looking change that moves a rounding point fails `a_living_entity_matches_the_jar`.

1.17.1 and 1.18.2 numeric boundaries come from the jars for the paths above where a fixture is listed. `E:/pr/mc-decompiled` has
no tree of these releases. Their source record is their own client jar through vineflower (`docs/source-records.md`), and a path
with no fixture stays unverified there.

## Fixtures

`scripts/java-oracle/living/OracleLiving.java` runs a real LivingEntity on 1.18.2, 1.20.4, 1.20.5, 1.21.5, 1.21.11, 26.2 and
26.3: friction around 0.6F, jumps, the 1.0E-5F jump rejection by the JUMP_STRENGTH attribute, scaled dimensions, pose sizes, and 54 walks of 60 ticks on stone, ice and blue ice at the origin,
at -1024 and at 29999000, with float speeds and turning yaws. A difference names its tick and field. See
`native/src/oracle_living_tests.rs`. Older releases are covered by the recordings, as static tags are unbound there.

## The 1.0E-5F tolerances

`Mth.equal` and `BlockGetter`'s two squares are compared with the jars at their call sites, and each is shown to hold by
breaking it. Exact-length travels, found by a seeded search in `OracleEpsilon.java`, are what make the strictness visible:
ulps of the root never land on the square. Those lines also found the 1.21.4 walk, which alone starts from the box's corner
with no 1.0E-7 at its ends.

| threshold | spelled as a double instead | `<=` for `<` |
|---|---|---|
| `Mth.square(1.0E-5F)`, from 1.21.9 | 304 lines differ | 24 lines differ |
| `Mth.square(0.99999F)`, to 1.21.8 | 346 lines differ | 44 lines differ |
| `Mth.equal`, `Math.abs(b - a) < 1.0E-5F` | 624 of 1872 walls on 1.18.2, and its own lines | the same |

## Exceptional values

| where | behaviour | failure leaves |
|---|---|---|
| a public position, size, box or config not finite or out of range | refused with the field's name | the state as it was |
| a motion not finite, from 1.21.11 | `setDeltaMovement` refuses it, as vanilla: the entity keeps its motion | no error |
| a NaN motion, before 1.21.11 | as vanilla: the move drops it, a NaN x or z ends at 0.0 by its collision, a NaN y stays NaN and does not move the entity | no error |
| an infinite motion, before 1.21.11 | refused as "the tick's move". This departs from vanilla: 1.21.10 walks it to the border or to an infinite position, and on 1.18.2 the jar's collision walk does not end | the state as it was |
| a finite motion too large to walk (`MAX_WALKED_CELLS`) | refused by name: "the tick's move" | the state as it was, through `NativePlayer` too |
| a motion past what one adapter sync reads (`MAX_SYNCED_CELLS`), which from 1.21.9 a velocity packet can carry (26.3 LpVec3.java:17, 70: 1.7179869183E10 blocks a tick) | `NativePhysics.simulate`, the boat's and ridden mob's ticks and piston pushes, `NativeMinecartPhysics` (a cart of a scene sits its tick out in its place; `hurt` lands on the cart at rest), `NativeMovingEntityPhysics` and `NativeProjectilePhysics` skip the tick and say `moveRefused`: on the state a tick moves in place, else on the state or result returned. This departs from vanilla, which walks it; on jars around 1.18.2 such a walk does not end, so no recording stands for it | the state as it was, but for a velocity of zero and `age`: no error |
| a value that overflows to infinity inside a tick | follows the Java arithmetic and the row of its release | no error |
| `NaN` at a floor or ceil | 0 and the int extremes of the release, as `Mth` does | no error |
| a counter | a Java int: `tickCount` wraps, by `wrapping_add` | no error |
| a double to int | saturating, as a Java cast | no error |
| a fractional or out-of-range cell at a world write | refused: N-API would truncate it | the world as it was |

Validation runs before the tick mutates anything. `validate_tick_state` covers the object path and `validate_input` the
packed one, and a packed tick that fails restores what it took. A failure names its phase in its message: the operation
and the field, or "the tick's move". The object and packed paths reach the same refusal, which
`test/numeric-limits.test.cjs` shows.

Modern rejection of non-finite motion is not applied to older releases.
