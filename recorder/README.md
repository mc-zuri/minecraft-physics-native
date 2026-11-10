# Vanilla recorder

The recorder captures vanilla Minecraft's client physics tick by tick. Recordings are taken from a real Fabric client and its integrated server, which tick in lockstep, and are used to check this engine (and mineflayer) against vanilla.

Scenarios are written once in TypeScript and compiled for each release. Each client tick of a recording holds:

- the server packets the client handled before the tick, with the player's state after each one;
- the state at the start of the tick;
- the input (keys, yaw, pitch);
- a snapshot at every phase inside the tick (`schema/phases.ts`);
- the packets the client sent, in order, with their bytes and the phase that sent them;
- the state after the tick;
- the server's own view of the player and of the entities in the area.

## Layout

```
schema/      the shared contract: phases.ts, fields.ts (every recorded field, and how each NativeSimulationState
             field maps to one), scenario.ts (compiled scenarios), recording.ts (the recording format), json.ts,
             gen-java.ts (writes the mod's FieldIds/Phases constants)
scenarios/   the TypeScript DSL (dsl/), the scenarios (cases/*.ts), build.ts -> out/scenarios/<version>/
mod/         Gradle (Unimined, mojmap, Fabric loader, no Fabric API): common/ (version-neutral: Lockstep,
             Recorder, ScenarioRunner, RecordingWriter) and mc/<version>/ (BridgeImpl, ServerOpsImpl,
             PlayerSnap, mixins)
runner/      record.ts (the command line, --verify), session.ts (a run: sharded clients, watchdog, index),
             outcomes.ts (what the clients said against the selection), provenance.ts (the build's identity),
             compare-runs.ts (determinism)
replay/      load.ts, world.ts, seed.ts, compare.ts, engine.ts (native layer), verdict.ts, cli.ts, test/
```

## Use

```
node recorder/scenarios/gen-types.ts                     # once, or after a minecraft-data update
node recorder/scenarios/build.ts --versions 1.20.4       # compile the scenarios
node recorder/runner/record.ts --version 1.20.4 --shards 4 [--filter "walk/*"] [--verify]
node recorder/runner/record.ts --version 26.3 --features minecart_improvements --filter "physrec/mx_*"
node recorder/replay/cli.ts --version 1.20.4 [--case "jump/*"] [--all-ticks]
node recorder/replay/cli.ts --projectiles --version 26.3 --case "physrec/pj_*"   # arrows and tridents from srv.entities: path and hits
node recorder/replay/cli.ts --bot-carts --version 26.3 --case "physrec/mc_ride*"   # a ridden cart from the recorded packets, through MinecartTracker
pnpm recorder:test                                       # typecheck, schema coverage, DSL, replay
```

`runner/record.ts` builds the scenarios, runs `gradlew :mc:<v>:recorderLaunch` and starts the clients. Each client gets its own game directory under `runs/`. To run a single client from Gradle instead:

```
cd recorder/mod && ./gradlew :mc:1.20.4:runClient -Precorder.filter=walk/forward_stone
```

Recordings are written to `out/recordings/<version>/<id>.jsonl.gz`. A checked-in `recordings/` directory, or `REPLAY_RECORDINGS`, takes precedence for the replay.

## Writing scenarios

```ts
import { at, cond, expect, floorArea, hold, matrix, press, releaseAll, scenario, server, srv, stopped, ticks, until, DIRS8 } from '../dsl/index.ts';

export default [
    scenario('walk/forward_stone', {
        area: floorArea('stone', 12), start: at(0, 0, -8),
        body: [press('forward', 40), stopped(3)],
        expect: [expect.on('stone'), expect.noCorrections()],
    }),
    ...matrix({ dir: DIRS8, sprint: [false, true] }, ({ dir, sprint }) => scenario(`jump/stone_${dir.name}${sprint ? '_sprint' : ''}`, {
        area: floorArea('stone', 12), start: at(0, 0, 0),
        body: [hold(...dir.keys, ...(sprint ? ['sprint' as const] : [])), press('jump'), until(cond.onGround(), 40), releaseAll(), stopped(3)],
    })),
    scenario('server/velocity_up', {
        area: floorArea('stone', 12), start: at(0, 0, 0),
        body: [ticks(3), server(srv.velocity([0.4, 0.5, 0])), until(cond.onGround(), 60)],
    }),
];
```

Blocks, block properties, effects, attributes, entities and items are typed: the names come from minecraft-data across every release. The build resolves each name for each release, renames (`short_grass` is `grass` before 1.20.3, attributes take `generic.` before 1.20.5), and skips a scenario on any release that lacks something it uses, with the reason. A spec can also depend on the release: `scenario(id, v => ({ ... v.atLeast('1.21.2') ... }))`.

Coordinates are relative to the area's origin. Floors sit at y = -1, so `at(0, 0, 0)` stands on the middle block. A server action runs between the client's tick and the server's, so its packets show up in the next row's `s2c`.

## How a case runs

The states are `PREPARE → SYNC → SETTLE → SETUP → WAIT_START → BODY`:

1. Reset the player and rebuild the area at the fixed origin `(0, 100, 0)`. Placed blocks don't react while the area is built.
2. Wait until the client holds every block of the area.
3. Wait for the player to rest.
4. Align what would otherwise carry over from the cases run before: the server tick counter, the game time, the player's tracked-entity counter, the client's tick count, the move-packet reminder, the teleport id, the tab-list countdown, how far pistons have moved the player this game time (Entity.pistonDeltas, from 1.11); reseed the level and player randoms and seed every server entity the case makes (its random and UUID), revoke advancements. The area's block entities are made anew and its scheduled block and fluid ticks cleared, and every chunk in view is loaded before the first case (the client reports a fixed chunk rate). Two runs of the catalog, in any shard order, then record the same rows.
5. Apply the setup and teleport to the start.
6. Record the body.

The integrated server checks the player the way a dedicated server does, so a too-fast move gets corrected, and keep-alives are off.

## The view distance

A client runs one view distance for all its cases: `renderDistance:4` in the `options.txt` `runner/record.ts` writes, over `CompatOptions.configure`'s `recorder.renderDistance` (4 when unset), which `runner/record.ts` never passes. The header's `server.viewDistance` is the distance the case really ran with, the release's own reading of that option: 3 before 1.15, 4 from it. An area does not choose one (`area()` refuses a `viewDistance`), so one case's distance cannot reach the next, and repeated captures run at the same distance.

What a case can count on, whatever its size:

- The server keeps the box and `viewDistance + 1` chunks around it loaded (`ServerOpsImpl.loadChunks`). The header's `world.blocks` come from the server, so they hold the whole box.
- The client must hold the chunks in view of the start, and a case does not start until every tracked block it holds matches the server (`BridgeImpl.chunksHeld`, `clientMismatch`). Otherwise it ends `error`, with the chunk or block that never came.
- Past the view, chunks reach the client as the player moves. A tick whose chunk had not arrived is `playerTicked: false` in its row, and the replay leaves it out of the ticks compared.

## Lockstep

Ported from physics-data-generator. A client tick and a server tick alternate. Each side waits until every packet the other sent in its tick has arrived (connection packet counters), so a server packet is always handled before the next client tick. Nothing is drawn in the world.

- One client sustains 430–470 ticks a second (about 22× real time); a round costs about 0.45 ms of client wait and 1.7 ms of server wait.
- The server runs nothing while the client handles the packets of its tick, and the client ticks once the server has handled what it answered there: what the server says to an answer goes with the next round, and a server task of the tick comes after the answers. Before, each of those went by which thread got there first.
- With `--shards N`, N clients run at once.

## The native replay

`replay/engine.ts` seeds `simulateVersionedTick` from vanilla's state at the start of each tick (`tickStart`), plus the decisions vanilla's `LocalPlayer.aiStep` made before `LivingEntity.aiStep` (sprint, sneak, swim, fly, item use; the adapter makes these in TypeScript). It compares the result with vanilla's state at `afterAiStep`. The world is the one the header recorded when the body started, plus the rows' block changes; the synced region covers the tick's swept path.

What the comparison covers, so that it cannot hide an engine difference:

- Every native field the registry maps from one recorded field (`NATIVE_SIM` `from`) is compared, decisions included (if vanilla changes one during the tick and the engine does not, that shows). Vanilla's value goes through the same `toNative` as the seed, and every comparison is exact (`Object.is`: -0 is not 0; vanilla's floats are exact floats, so no rounding of either side). A field the engine does not give back is a divergence.
- Where an engine field means vanilla's value at another point, the registry says so (`comparedAt`): `climbing` is the climbability the move used, vanilla's `onClimbable` at `beforeMove`. From 1.17 the engine keeps no box of its own; its box is made from its position and dimensions as vanilla does and compared.
- The native tick is the whole scene: pushes and rocket boosts of the entities that tick before the player, its tick, those after it. With entities around, the velocity is seeded from before any entity ticked (`pre`) and expected after all of them (`post`); `tickCount` is seeded before the level's increment.
- A ridden vehicle goes through `simulateVersionedBoatTick` / `simulateVersionedHorseTick`, every field of `BOAT_SIM` / `HORSE_SIM` compared against the vehicle right after its own tick (the rider's `tickStart`), except the rider's inputs and fields marked `input`. A vehicle the rider does not control (a llama, a pig without a carrot on a stick, a 1.20.4 minecart) follows the server: such a recording is reported as not compared, never as a match.
- A recording that did not finish ok, has no rows, or has a ticked row without its phases fails; so does a replay that selects no recording.
- Each recording comes to one verdict (`replay/verdict.ts`), and the summary gives them apart: matching, known (differs just as listed), unsupported (only ticks the engine has no model for), untested (no tick to compare), unexpected. Only matching says the engine agrees. A selection in which nothing was compared fails.
- `replay/test/detects.test.ts` checks the comparison itself: a recorded position changed by one ulp, or a flag flipped, is reported at its tick and field.

`replay/test/native.test.ts` runs every recording. Known engine differences go in `known-failures.json` with the evidence, pinned to where they first show and to their whole signature (how many ticks diverge in each field), so a further regression in the same recording fails the test, as does a known failure that passes:

```json
{ "native": { "1.20.4/<id>": { "tick": 39, "field": "vel", "fields": { "vel": 1 }, "reason": "..." } } }
```

## Continuous replay, phases and the strict gate

`cli.ts --continuous` seeds a recording once and carries the engine's output forward: only a packet's recorded delta changes a
carried field (`replay/continuous.ts` gives every field its owner), and a tick the engine does not run ends the prediction and
is counted as a seed. The decisions stay vanilla's in this mode too, which each result states. `cli.ts --phases` compares the
engine's trace (`simulateVersionedTickTraced`, `native/src/phase.rs`) with vanilla's phases, by name and occurrence
(`replay/phases.ts`), so errors that cancel by the end of a tick still fail.

```
node recorder/replay/conformance-cli.ts pin --version 26.3              # recorder/corpus/26.3.json, from the recordings as they stand
node recorder/replay/conformance-cli.ts check --version 26.3 --continuous --phases --json report.json
node recorder/replay/differential.ts                                    # each version gate, on two vanilla recordings
node recorder/replay/matrix.ts --version 26.3                           # the coverage matrix, release by release
node recorder/replay/random-run.ts --version 26.3 --seed 7 --count 20 --work <dir>
node recorder/replay/profile.ts --version 26.3 --case "physrec/j_*" --repeat 3 --budget recorder/replay/profile-budget.json --set small
node recorder/replay/cli.ts --version 26.3 --case "physrec/j_*" --bot    # a mineflayer bot on the packets, to the byte (bot.ts)
node recorder/replay/capabilities.ts > docs/capability-table.md         # which release has which mechanic, and its cases
node recorder/replay/evidence.ts                                        # recorder/evidence/*.json, replayed on this build
```

A release is `complete` only on the whole of its manifest, with every scenario compiled for it pinned, every required field
compared, the stepwise, continuous and phase layers clean, and nothing uncompared that the manifest does not declare with a
reason. A `--case` selection comes to `clean-subset` at best, which certifies nothing. `CONFORMANCE=strict` makes the
recording tests fail with no corpus; without it a developer's run skips them. Rust and adapter suites are reported in their own
categories (`--regression`) and never stand in for vanilla.

`docs/field-coverage.md` is generated from the field registry, `docs/parity-dispositions.json` holds what became of D-161 to D-229.

## Checks on the recordings

- A run fails when a client exits non-zero, a scenario errs or fails its own checks (invalid), or a selected scenario never reports; a filtered run removes its scenarios' old recordings first and merges into the index. `runner/outcomes.ts` holds the clients to the selection: a result for a scenario not selected, twice, with an unknown status, another hash or from another shard, a `done` whose counts are not its results, or a success without its finished recording, fails the run. A client that dies (a lockstep timeout, the watchdog) fails the scenario it was in, and a new client takes the ones after it, up to five times; the run still fails. The lockstep's budget is for a side that stops moving: a long server task (a first use of a wide area generates and lights its chunks in the one task, 69 s on an idle 1.15.2) starts it again each time it gets further, and a timeout says where the other thread stands.
- The index (`<out>/<version>/index.json`) says each scenario's status, hash and build. A filtered run keeps earlier entries only of scenarios as they are compiled now; one that cannot be read is a failure, not an empty start.
- `--verify` records the catalog twice and compares the rows (`runner/compare-runs.ts`). Left out of the comparison: packets that cannot move the player and do not repeat (sounds and their seeds, particles, light, advancements, the tab list's latency); a player's attributes are compared by name and effects that change together as a set (the server sends both in hash order). Every scenario must match: a repeat must record identical rows (the mouse does not turn the player between ticks, and mob brains shuffle with a seeded random). `docs/recorder-coverage.md` says which pass ran what. A scenario may still be marked `serverTimed` with its reason, to be reported apart; none is.
- `replay/test/recordings.test.ts`: every recording finished ok and has every field of `fields.ts` in every snapshot, the phases, the player's identity and the world; every packet decodes with minecraft-protocol (mineflayer's codec, `replay/packets.ts`); an explosion pushes the player and a velocity reaches it (a scenario whose action misses the player tests nothing).

## What a recording was built from

`runner/provenance.ts` makes an identity from what a build is, not where it is: the JDK, every classpath entry by name and bytes (the game, loader, mappings, libraries and the mod's own classes), the mod's sources through the release's whole adapter chain, the launch with its install paths taken out, the schema, the compiled index, the scenario sources, the codec and data. The same content gives the same `id` on any path; two clean builds of 1.20.4 gave the same id and the same 80 classpath digests. `commit` and `dirty` say which checkout it was and stay out of the id: a commit alone cannot describe changed files, and two commits can build the same thing.

- A build states it: `mod/mc/<v>/build/recorder-identity.json`, then `<out>/<version>/builds/<id>.json`, which the index's `build` points at.
- Every header carries it as `provenance`, without the per-file list. A run holds each recording to its build: a recording of another build is an error.
- `--no-build` reuses a build only if the identity worked out again is the stored one, and names what moved (`mod changed since the build`). So a changed class, schema or scenario, a replaced jar, or another JDK stops the run before any client starts, and reuse that really is reuse goes ahead.
- `replay/cli.ts --json` writes `{ replay, results }`: `replay` is the replay's own build (the native artifact, the codec, the checkout) and each result's `recording` is the recording's provenance as it was. A replay never rewrites it.

Recordings from before `provenance` stay valid schema 1 and read `unrecorded`.

Unimined is the one input a publisher could change under its version, as it comes from a snapshot repository: `buildSrc` names one timestamped build and `gradle/verification-metadata.xml` its SHA-256, so other bytes stop the build. The wrapper's distribution has its checksum too. Loader and mappings are fixed in `settings.gradle` and each adapter's `build.gradle`.

## Use from mineflayer

A recording holds what a bot replay needs: the world (`header.world.blocks`: every block of the area as it was when the body started, palette and runs, plus `row.blocks` for every block the server changed after; the declared fills are kept too), the start state, the player's entity id and UUID, and per tick the S2C packets as bytes in arrival order (with the state after each), the inputs, and the C2S packets as bytes in send order with the phase that sent them. `replay/packets.ts` decodes both directions with the minecraft-protocol mineflayer loads (`REPLAY_MINEFLAYER_DIR` picks a local fork).

minecraft-data has two 1.20.4 codec bugs these recordings show (both on packets that cannot move the player): the explosion's sound is declared a registry holder but 1.20.3–1.20.4 write a SoundEvent (fixed on mc-zuri/minecraft-data `fix/pc`, 310e6f2b), and the protocol's particle-id mapping is shifted by 1.20.5's gust ids (id 23 decodes as `gust`, not `explosion`; 43 as `instant_effect`, not `vibration`). Both decode without error but do not re-encode to the same bytes.

## Status

| Part | State |
|---|---|
| Schema, field registry and coverage test | done |
| TypeScript DSL | done |
| 1.20.4 mod: lockstep, runner, full player snapshot, all 12 phase points, S2C and C2S packets with bytes and phases, server view, corrections | done |
| Native replay (stepwise) | done |
| Sharded runner, `--verify` (1.20.4: every scenario identical across two runs) | done |
| Vehicle layer of the native replay (boats, horses, camels, pigs, striders) | done |
| Opt-in phase tracing inside the Rust engine (`phase.rs`, `simulateVersionedTickTraced`), compared with vanilla's phases (`replay/phases.ts`) | done |
| Continuous replay (`replay/continuous.ts`), with the decisions still vanilla's | done |
| The strict gate over a pinned corpus (`replay/conformance.ts`) | done; no `recorder/corpus` is pinned here, and the 23 cell pins of `generated/conformance-evidence.json` are stale |
| Adapter layer (`replay/adapter.ts`, `--adapter --motion`: its own decisions, tick by tick; no phase sink) | done in part |
| Bot layer (`replay/bot.ts`: mineflayer with a fake client, C2S name, order and bytes; movement, the keys of the hands and the clicks on a container's screen driven through the fork; chat, signs, books and commands not driven) | done in part |
| Vehicle phases (a row's `vph`: the ridden vehicle at the head and tail of its own move, held to the engine's move with `--phases`) | captured; the engine has no trace inside a vehicle's tick |
| Catalog: the physics-data-generator catalog ported to the DSL, with what was added since (3,322 scenarios compiled for 1.20.4 and 407 outside it, at commit `0eaaa0d`) | done |
| Minecarts in the native replay (`replay/minecart.ts`: the server's carts from `srv.entities`, their side effects, a blast's power against its packet, the client's interpolation apart) | done |
| A bot's cart from the recorded packets (`replay/bot-carts.ts`: `MinecartTracker` against the client's ridden cart) | done |
| Feeding moving pistons to the engine (`replay/moving.ts`) | done |
| More versions | adapters for all 50 releases. The 2026-11-06 pass recorded them all, and is not current (`docs/recorder-coverage.md`). The final pass is running |
