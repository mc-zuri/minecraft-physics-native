# Finding ledger

The 32 findings of the 2026-11-04 physics and data review, each kept separate. A finding is **fixed** when its
ticket closed with its regression evidence. That does not extend to behaviour the ticket did not scope, and it
certifies no release: `docs/parity-contract.md` does that.

`audit/physics-version-review-20261104/` is the review's own output. It was never committed and is no longer on
this machine, so titles and scopes come from the backlog's `FINDINGS-INDEX.md`, which quotes it. Line-level
before and after counts from that audit cannot be reproduced here.

`test/finding-ledger.test.cjs` keeps every finding listed, once, and every named test on disk.

## Physics and state: M01 to M25

| Finding | Ticket | Audited title | Scope | State | Regression evidence |
| --- | --- | --- | --- | --- | --- |
| M01 | B180 | Slowdown state disappears between mount ticks | 1.9.4-26.3 | fixed | `a1e3f84`, `test/mineflayer.test.cjs` |
| M02 | B181 | Explicit zero attributes become normal defaults | Locally simulated mount releases; reproduced 1.20.4,1.21.9,26.3 | fixed | `d6c781f`, `test/mineflayer.test.cjs` |
| M03 | B182 | Effective collision dimensions are ignored | API all mount releases; vanilla SCALE feature 1.20.5+ | fixed | `585a2ee`, `test/mineflayer.test.cjs` |
| M04 | B183 | Movement effects and modern attributes are absent | Levitation1.9.4+; Slow Falling1.13.2+; modern attributes at documented releases | fixed | `b62e9c7`, `test/mineflayer.test.cjs` |
| M05 | B190 | Tridents do not remain embedded after a block hit | 1.13.2-26.3 | fixed | `bbdc88e`, `test/mineflayer.test.cjs` |
| M06 | B191 | Generic arrow/trident names use thrown-item integration | Recognized families throughout supported versions; air difference especially1.21.2+ | fixed | `00533d8`, `test/mineflayer.test.cjs` |
| M07 | B192 | World-border hits are omitted | 1.21.2-26.3 | fixed | `311c593`, `native/src/projectile.rs` |
| M08 | B193 | Batch simulation freezes the initial water flag | Supported projectile families consuming inWater | fixed | `47dbec2`, `test/mineflayer.test.cjs` |
| M09 | B194 | Arrow preflight containment test is missing | Confirmed1.14.4-26.3; earlier trigger differs | fixed | `110ead3`, `native/src/projectile.rs` |
| M10 | B100 | Dead and sleeping players still walk and jump | Common path across50 registered releases; representative source checkpoints | fixed | `9ba5f7b`, `native/src/simulation_tests.rs`, `test/mineflayer.test.cjs` |
| M11 | B101 | Rain-only Riptide launches are refused | 1.13.2-26.3 | fixed | `07d16b1`, `test/mineflayer.test.cjs` |
| M12 | B173 | Raw firework impulse reaches gravity selection too late | Riptide/Slow-Falling-era probes1.13.2-26.3 | fixed | `77ce8c3`, `native/src/simulation_tests.rs` |
| M13 | B133 | Flow blocking is inferred from collision boxes | Flattened versions; sampled1.13.2-1.21.11 and26.3 source | fixed | `929b2a0`, `test/mineflayer.test.cjs` |
| M14 | B134 | Contracted legacy lava bounds are not reordered | 1.9.4-1.13.2 elytra-sized player; legacy helper more generally | fixed | `6d2bd2c`, `native/src/simulation_tests.rs` |
| M15 | B135 | Native eye-fluid height misses the new camera surface | 26.3 | fixed | `a020535`, `native/src/simulation_tests.rs` |
| M16 | B203 | Requested native version and TypeScript gates can disagree | Any explicit version override paired with a different registry | fixed | `c18514d`, `test/mineflayer.test.cjs`, `test/registry-release.test.cjs` |
| M17 | B122 | Compact states lose Speed and Slowness | Probed1.8.8,1.20.4,1.21.11 | fixed | `e7c1d0a`, `test/mineflayer.test.cjs` |
| M18 | B204 | Passenger state does not reach native predicates | Probed1.20.4,1.21.11; shared bridge | fixed | `a76913e`, `native/src/simulation_tests.rs`, `test/mineflayer.test.cjs` |
| M19 | B150 | Traversal allocates the entire path before its16-step cap | 1.21.9-26.3 | fixed | `5a71d85`, `native/src/simulation_tests.rs` |
| M20 | B165 | Partial-shape filtering uses the wrong overlap tolerance | Modern collision paths; checked1.18-26.3, related1.14.4-1.17.1 filter | fixed | `edf236e`, `native/src/simulation_tests.rs` |
| M21 | B151 | Slime bounce misses canSimulateMovement eligibility | 26.3 | fixed | `9aea0cc`, `test/mineflayer.test.cjs`, `test/piston-authority.test.cjs` |
| M22 | B093 | Periodic freeze damage still runs on clients | 1.17+ support; verified current1.21.11/26.3 source | fixed | `dc4f918`, `native/src/simulation_tests.rs`, `test/native-freeze.test.cjs` |
| M23 | B094 | Modern fire reset still runs on clients | 1.21.6-26.3 | fixed | `f47cb30`, `native/src/simulation_tests.rs` |
| M24 | B095 | Ignition conflates LocalPlayer and ServerPlayer and fixes RNG | 1.21.2+ modern fire branch | fixed | `95218bb`, `native/src/simulation_tests.rs`, `test/native-fire-draws.test.cjs` |
| M25 | B096 | Generic fire-immunity reset default remains1 instead of0 | 1.21.6-26.3; exact local1.21.5/1.21.6 comparison | fixed | `f47cb30`, `native/src/simulation_tests.rs` |

Every one of the 25 is fixed in its own ticket. Open tickets that cite a fixed finding (B104, B138, B140, B187,
B244 and others) are related follow-ups, and each carries its own scope.

### Traces of the findings

A fix above is what the ticket closed on, which for most of these was a unit test. This is what a vanilla trace adds:
each finding's own scenarios, replayed on the merged engine, with `--phases` where the replay has it. These are selections,
not proof that a recording reaches the branch the finding was about.

| Finding | Release | Scenarios | Matching |
| --- | --- | --- | --- |
| M01 | 26.3 | `v_horse*`, `v_camel*`, `v_strider*` | 24 of 24 |
| M02 | 26.3 | `v_pig*`, `v_donkey*` | 4 of 4 |
| M05 | 26.3 | `pj_trident*` | 4 of 4 |
| M06 | 26.3 | `pj_arrow*`, `pj_bow*`, `pj_pierce*` | 23 of 23, in the pin of `projectile.arrow` |
| M08 | 26.3 | `pj_snowball*`, `pj_egg*` | 11 of 11 |
| M10 | 26.3, 1.21.5 | `ps_*` | 9 of 9 on each |
| M11 | 26.3 | `q_riptide*`, `q_rain*` | 10 of 10 |
| M12 | 26.3 | `pj_firework*` | 3 of 3 |
| M13 | 26.3 | `b_flow*`, `m_flow*` | 15 of 15 |
| M15 | 26.3, 26.2 | `wh_*` | 33 of 33 on each |
| M17 | 26.3 | `e_speed*`, `e_slowness*` | 25 of 25 |
| M19 | 1.21.9 | `b_cobweb*`, `b_berry*` | 8 of 8 |
| M20 | 26.3 | `rg_*` | 112 of 112 |
| M21 | 26.3, 26.2 | `ph_slime*` | 15 of 15 on each |
| M22 | 26.3 | `hz_freeze*` | 1 of 1 |
| M23 | 1.21.6, 1.21.5 | `hz_burn*`, `hz_campfire*` | 10 of 10 on each |

No trace is named for M03, M04, M07, M09, M16, M18, M24 and M25, whose evidence stays the ticket's tests. M14 is confined
to 1.9.4 to 1.13.2. Those releases were recorded in the 2026-11-06 pass, and no trace of M14's own cases is listed here. All but M06 ran before the last merge of `recorder`, which changed the engine.

## Data and provenance: M26 to M32

| Finding | Ticket | Audited title | Scope | State | Regression evidence |
| --- | --- | --- | --- | --- | --- |
| M26 | B031 | Collection-registered block families are omitted | 26.2 and26.3 | fixed | `802268a`, `test/block-registries.test.cjs` |
| M27 | B032 | Symbolic block identifier names become incorrect resource IDs | 26.2 and26.3 | fixed | `802268a`, `test/block-registries.test.cjs` |
| M28 | B033 | Inherited state properties disappear | At least1.14.4,1.20.4,1.21.11,26.1 examples | fixed | `802268a`, `test/block-friction.test.cjs`, `test/block-registries.test.cjs` |
| M29 | B034 | Tags are incomplete or differ from release resources | Concrete1.20.4 and1.21.6-1.21.11 differences; see sidecars | fixed | `25545fb`, `test/block-tags.test.cjs` |
| M30 | B035 | Method fingerprints can hash a call-site block | 44-release source manifest | fixed | `f5a7c42`, `test/generator-paths.test.cjs`, `test/java-declarations.test.cjs` |
| M31 | B036 | LocalPlayer is absent from the source manifest | All44 nonlegacy manifest releases | fixed | `912278f`, `test/version-registry.test.cjs` |
| M32 | B037 | A snapshot branch is certified as release1.16.4 | 1.16.4 horse source audit entry | fixed | `083f3d4`, `test/release-manifest.test.cjs` |

### M29

B034 closed it. `generated/block-tags.json` keeps default and experimental memberships apart, with memberships read from
each release's jar. All 808 audit entries are dispositioned: 642 missing data, 148 configuration, 18 wrong identifier, 0
unresolved. So they were not 808 independent defects. The before and after discrepancy counts of the audit itself cannot be
reproduced, as its directory is gone: the disposition stands for them.

### Focused regressions

| Case | Test |
| --- | --- |
| Carrots, potatoes, wheat and melon resource ids | `test/block-registries.test.cjs` |
| Helper and collection families | `test/block-registries.test.cjs` |
| Positive and negative tag membership | `native/src/versioned/mod.rs` tests, `test/block-registries.test.cjs` |
| Overload and call-site fingerprints | `test/version-registry.test.cjs`, `test/java-declarations.test.cjs` |
| `LocalPlayer` path | `test/version-registry.test.cjs` |
| Wrong embedded identity | `test/source-admission.test.cjs`, `test/release-manifest.test.cjs` |

Missing or wrong-release evidence cannot reach a completed status: `docs/source-records.md` and
`scripts/source-admission.cjs` fail it, and admission needs that dimension to pass.
