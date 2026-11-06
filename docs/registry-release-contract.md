# Registry and physics release selection

Adapter constructors require `registry.version.minecraftVersion` to name the
same exact supported release selected by `options.version` or a fixed engine
class. With no explicit selection, the declaration selects the release. Missing,
unsupported or mismatched declarations fail before the native binding is loaded
or a native world is allocated. Errors name the conflicting releases.

This applies to generic, fixed and factory player engines, boat and ridden-mob
engines, standalone `NativeWorldSync` and `BlockMapper`. Low-level mapper callers
must also supply an exact declaration on the source registry and selected version.
Numeric release checks are derived from the selected ID. When a registry supplies
`version['==']`, it must agree with its own declaration; a false result or failure
to evaluate that ID is rejected as inconsistent metadata.

Use matching data, for example:

```js
const registry = require('prismarine-registry')('1.20.4');
const engine = createNativePhysics(registry, { version: '1.20.4' });
```

Previously accepted same-era overrides now fail. To migrate, provide a coherent
registry for the selected release or select the registry's coherent release.
Matching protocol IDs or being on the same side of the 1.13 flattening does not
establish compatibility: the verified aliases below do, and only they.
Do not relabel old data to bypass the check. Callers deliberately supplying fully
normalized world/state data can use the raw native API, which has no prismarine
registry input.

## Installed data aliases

In the inspected local minecraft-data 3.117.0 checkout, the following requests
return a different declared release. They also retain comparison/feature behavior
from the request, so selecting their older declaration by default is inconsistent,
and a registry made by the requested name stays refused.

| Requested release | Declared registry release | Data accepted |
| --- | --- | --- |
| 1.19.1 | 1.19 | 1.19.2 |
| 1.21.2 | 1.21 | 1.21.3 |
| 1.21.7 | 1.21 | 1.21.8 |
| 1.21.10 | 1.21.9 | 1.21.9 |
| 26.1.1 | 26.1 | 26.1 |
| 26.1.2 | 26.1 | 26.1 |

## Verified data aliases

The third column is a verified compatibility mechanism, `src/mineflayer/data-aliases.json`,
written by `scripts/generate-data-aliases.cjs`. Each pair has one protocol number, and
for each the vanilla data generator of both real server jars gives the same bytes
for every report and data file (4473 to 6319 files: blocks and states, items,
registries, packets, commands, tags, recipes, biomes, dimensions), and each client
class that differs, in intermediary or as 26.x ships it, has a reviewed reason. For 26.1.1 and 26.1.2 that is 8594
identical files, and 3 and 9 differing classes of 10682, read in a bytecode diff: version constants, GUI, and on 26.1.2
`handleAttack` refusing a spectator, which is an attack packet and not data or movement. Neither one's jars
differ in a registry or in a block's shape. 1.19 and 1.21 are not these releases'
data, so a registry declaring them stays refused, as does any release not listed.

An alias covers registry data, never physics, which each release takes from its
own sources: select the exact release and give the registry of its data:

```js
const { dataReleaseOf, createNativePhysics } = require('...');
const registry = require('prismarine-registry')(dataReleaseOf('1.21.2') ?? '1.21.2');
const engine = createNativePhysics(registry, { version: '1.21.2' });
```

Without `version` such a registry selects its own release, 1.21.3. A live bot needs
the same data for its own packets, as mineflayer looks up `bot.version` itself: give
it the registry of the data release before `createBotPhysics(bot)`, which then takes
the release from `bot.version`.

The local minecraft-data checkout itself is unchanged; exact entries for these
there would make the alias unnecessary.

## Why the check matters

The adapter already used the selected release for its numeric behavior gates.
Registry resources, ranges, effect IDs, feature answers and supplied block geometry
could still come from another release. A 1.20.4 registry with 1.20.5 rules loses
the `minecraft:` attribute namespace expected by the supplied player state;
1.15.2 data with 1.16.5 rules produces a hybrid camel-case attribute key. Older
data also lacks 26.3 bounciness and drag attributes. Name-based block mapping does
not establish that supplied collision shapes belong to the selected release.

The declaration is a metadata trust boundary, not a deep fingerprint of arbitrary
custom registry contents. The check cannot detect all caller-supplied mislabeled
tables, nor prove that a duck-typed world uses the same registry. Matching release
identities do not certify complete vanilla parity.

## The physics-util feature catalog

`NativeEngine.supportFeature` answers two catalogs and keeps them apart.
mineflayer-physics-utils' eight names (`src/mineflayer/physics-features.ts`) are
answered from the engine's selected release; minecraft-data has none of them. Every
other name goes to `registry.supportFeature` as a yes or no, so a feature with a
value (`metadataIxOfItem`) is read from the registry. A release outside the fifty
builds no engine, so it has no answer. The dependency's own `makeSupportFeature`
stays its own: its engines, and the effect names `PlayerState` derives from it, do
not come through here. Those lists stop at 1.21 and leave out 1.16.

| Name | True for | Source of the breakpoint |
| --- | --- | --- |
| `independentLiquidGravity` | up to 1.12.2 | `velocityY -= 0.02` (1.12.2 `LivingEntity.java:1572,1603`) |
| `proportionalLiquidGravity` | 1.13.2 on, 26.3 included | `d / 16.0`, `d / 4.0` (1.13.2 `:1639,1677`, 26.3 `:2474,2614`) |
| `velocityBlocksOnCollision` | up to 1.14.4 | `SoulsandBlock.entityInside` (1.14.4 `:26`) |
| `velocityBlocksOnTop` | 1.15 on | `Entity.getBlockSpeedFactor` (1.15 `Entity.java:634,681`) |
| `climbUsingJump` | 1.14 on | `horizontalCollision` alone (1.13.2 `:1605`), then `|| jumping` (1.14 `:1868`) |
| `itemUsageMetadata6` | 1.10.2 to 1.13.2 | the count of Entity's tracked fields, below |
| `effectNamesAreRegistryNames` | none | minecraft-data's names are `JumpBoost` in every release; the dependency's two branches are the same |
| `attributesPrefixedByMinecraft` | 1.16 to 1.20.4 | `writeUtf` (1.15.2 `ClientboundUpdateAttributesPacket.java:62`), `writeResourceLocation` (1.16 `:66`, 1.20.4 `:50`), a holder from 1.20.5 |

`attributesPrefixedByMinecraft` asks whether the dependency must add `minecraft:`
to minecraft-data's `resource`. From 1.20.5 that resource is already the wire key,
and a `true` would double the namespace on 1.21.1 and later.

`DATA_LIVING_ENTITY_FLAGS` is at no slot in 1.8, 5 in 1.9, 6 from 1.10, 7 from 1.14
and 8 from 1.17. The dependency can only read 6 or 8, so on 1.8, 1.9 and 1.14 to
1.16.5 neither answer is true. Those releases answer no, and the dependency reads
slot 8, which is health on 1.14 to 1.16.5: `PlayerState.isUsingOffHand` is true for
a main-hand use, and `EntityState.isUsingItem` is true for any living entity with
more than 1 health. The adapter therefore reads the player's hand from the tracked
flags itself (`usingOffHand`). A caller who ticks an `EntityState` on those releases
must set `isUsingItem` itself; that is a dependency limit the facade cannot reach.

Liquid gravity in the native engine does not read `EPhysicsCtx.waterGravity` or
`lavaGravity`, so these answers change the dependency's settings only.
`test/physics-features.test.cjs` overwrites both and gets the same tick, and reads
each breakpoint from every registered release's tree where the machine has them.

## References and limits

Implementation: `src/mineflayer/base.ts`, `versions.ts`, `world.ts` and `blocks.ts`.
Dependency evidence: `E:/mc-physics-demo/minecraft-data/index.js:38`, `:60` and
`lib/supportsFeature.js:11`; local indexed attributes, effects and collision tables
were inspected. The detailed reproduction/migration plan is retained in the main
checkout at `audit/physics-backlog-20261104-dc4f918/b203-plan.md`.

`E:/pr/mc-decompiled` and `E:/pr/mc-source` remain the authoritative algorithm
references for individual mechanics; `D:/minecraft/java/physics-data-generator`
supplies capture tooling; pinned branches in
`D:/projects/mc-zuri/mc-data/extracted_minecraft_data` supply exact-release source.
Those sources do not establish equivalence between arbitrary dependency registry
payloads. This change validates local adapter/data consistency and makes no new
Minecraft recording or full release-conformance claim.
