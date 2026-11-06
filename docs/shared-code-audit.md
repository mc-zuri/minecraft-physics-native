# Shared code audit

Every release has its own `Engine` and `Profile`, and every profile runs shared simulation, collision, vehicle and
projectile code. A release sharing that code is a claim that vanilla's behaviour is the same there, or that a gate
tells the releases apart. This records what has been checked.

## Coverage

`scripts/shared-gates.cjs` reads every `release.at_least(...)` in `native/src` outside tests and writes
`generated/shared-gates.json`: one entry per gated function, with its boundaries and a computed status.

| Status | Meaning |
| --- | --- |
| `source-compared` | The source audit (`generated/physics-breakpoints.json`) finds a source change at each boundary. |
| `unverified` | At least one boundary has no such finding. This is the incomplete marker: it claims nothing. |

A boundary below a registered release, such as a gate at 1.14, is read at the first release it affects, 1.14.4.

`source-compared` means the audit saw *a* change at that release in the classes and methods it covers. It does not
show the gate is the right one, or that the change is the one gated. A status of `unverified` can be correct behaviour
at a boundary the audit does not cover: the audit compares a fixed list of methods and classes.

`test/shared-gates.test.cjs` fails when the list differs from the code, so a gate cannot be added, moved or removed
without the list changing in the same commit. That is the review point: an interval cannot widen unnoticed.

At this writing the list has 295 functions: 193 `source-compared`, 102 `unverified`. (It first read 221, because test code
was cut from the first `#[cfg(test)]` in a file, which in `simulation.rs` sits on one item at line 1287.)

## Ungated functions and callers

`scripts/shared-functions.cjs` covers every native function outside the tests, gated or not: 1292 at this writing. For each
it gives its callers, the contract families that reach it from their entry points, its interval (`every release` when it
has no gate) and a status. `node scripts/shared-functions.cjs <function>` prints one. Every function has the `unverified`
marker unless it is an exported entry or is `source-compared`.

It is computed when asked and not checked in, because it changes with nearly every native commit. Callers are matched by
name, so a name two functions share counts for both and a call through a pointer can be missed: it over-reports. Most
of the tick is reached by every family through the shared simulation, so family reach says where a change can land, not
that the family exercises that line. 258 functions are not reached from a contract entry point by this name match; why each is not has not been
classified, and some will be calls this match misses.

## Policy checks

The per-release policies are checked against each release's own source, and against a deliberately wrong profile:

| Policy | Check | Wrong-policy test |
| --- | --- | --- |
| Fall-damage rounding and formula | `scripts/verify-landing-policy.cjs` | `test/landing-policy.test.cjs`: a profile that rounds otherwise is rejected |
| Fluid gravity divisors | `scripts/verify-fluid-gravity-divisors.cjs` | `test/fluid-gravity-divisors.test.cjs`: a changed divisor is rejected |
| Block friction | `scripts/generate-block-friction.cjs` | `test/block-friction.test.cjs` |
| A gate moved in the engine | replay of its boundary | `docs/validation-records.md`: the 1.21.5 gate moved to 1.21.6 |

Identical hand-written profiles are not evidence: `verify-version-coverage.cjs` reads each module against its own
release, not against a neighbour.

## Generic dispatch

A named family that has its own integrator cannot reach another: arrow and trident names in the generic projectile
path are rejected or routed (B191), and `entityTravelSupport` reports `unsupported` for a kind the game has and the
engine does not move, instead of running it as something else (`recorder/replay/verdict.ts` then calls such a tick
`unsupported`, not a match). `unknown` is a kind outside the inventory.

## Not covered

- An ungated function has no source comparison of its own: which vanilla method each mirrors is not recorded, so
  `every release` is what the code does, not a checked claim.
- A gate spelled without `at_least` (a profile rule, or a `VersionPhysicsRules` field) is not in the list. The rules
  have their own checks above where those exist; the others are unverified.
- Only 21 of 50 releases have recordings, so trace evidence cannot reach gates below 1.20.3.
