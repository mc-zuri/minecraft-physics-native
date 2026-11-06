# Randomness and food

## Random draws

The engine holds no generator. Each draw that changes represented motion or state comes from the caller, in order,
which is why cosmetic events cannot shift it: particles and sounds never reach the engine.

| consumer | authority | distribution | place in the tick | how it reaches the engine |
|---|---|---|---|---|
| `BaseFireBlock.fireIgnite`, a ServerPlayer's ignition, 1.21.2+ (26.3 `BaseFireBlock.java`) | server | `nextInt(1, 3)`: 1 or 2 | inside-block effects, one per ignition that reaches it | `serverFireIncrements`, ordered; or `serverFireIncrement`, one fixed value, an approximation |
| a projectile's spread at `shoot` | server | the level's gaussian | before its first tick | the motion the caller hands in |

`docs/random-consumers.md` is the audit from the 26.3 source. No other draw reaches the player's movement: `Entity.push`,
friction, jumps and the fall have none. A LocalPlayer's ignition has no draw, and consumes none (`test/lifecycle.test.cjs`).

## Exact server randomness is excluded

The engine does not reproduce the level's generator or its draw order against other consumers. Given the recorded draws
a run replays exactly. Without them `serverFireIncrement` is an approximation and no vanilla parity is claimed.

| case | result |
|---|---|
| same draws | the same run, through repeated calls, a clone and a checkpoint |
| clone or restore | the unread draws go with the state |
| a draw the stream lacks | refused, or with the state marked so the result is known to be no exact replay |
| a value other than 1 or 2 | refused |
| a release before 1.21.2 | the stream stays unread: the release has no such draw |

## Food and exhaustion

Client prediction does not own hunger. `foodLevel`, saturation, exhaustion and the food timer are the server's:
`Player.causeFoodExhaustion` does nothing on a client (26.3 `Player.java:1471-1477`), and `FoodData.tick` runs from
`ServerPlayer` (`ServerPlayer.java:688`). The movement statistics that feed exhaustion, `checkMovementStatistics`, are in
`ServerPlayer` too (`ServerPlayer.java:1458`, `:1563`).

So in the engine and adapter:

- `state.food` is a synced input. The adapter reads it for sprint eligibility, `food > 6 || mayFly`, and a passenger needs
  none from 1.19.3.
- A tick never changes it, and movement adds no exhaustion. `test/mineflayer.test.cjs` proves that over 40 sprinting ticks.
- A `set_health` packet between ticks counts on the next tick, and a fork keeps the value it was made with.
- There is no server-replay hunger mode. A server state (`clientSide: false`) does not model exhaustion, saturation or
  starvation either.

Why it is not modelled: `checkMovementStatistics` runs from `ServerGamePacketListenerImpl.handleMovePlayer`
(`:1199`), on the delta of the client's position packets and not on a tick of the entity, and from `:520` for a vehicle.
The engine ticks an entity and sees no packets, so it has no input to give the formula. `FoodData.tick` also reads the
difficulty, a game rule and the health, none of which is movement state, and its only movement result is `foodLevel`,
which the server then syncs. The per-class formulas could be ported as a pure function, but nothing would call it, and a
number nothing consumes is what `docs/attributes.md` refuses to carry.

## Across targets

`scripts/determinism/` replays one corpus on each build. `corpus.cjs` serializes the worlds, `replay.cjs` needs only those
bytes and an addon, and `compare.cjs` says where two builds part, with the command that prints both at that tick. Inputs come
from an integer generator and IEEE 754 arithmetic, so no target's libm enters them. Every state of every tick is hashed by
the bits of its numbers.

The corpus is 50 releases, three worlds each (`empty`, `dense`, `fluid`), and 12 runs a release: walking, gliding, an ordered
crowd, a boat, arrows and snowballs, 5000 ticks each. That is 600 runs and 3,000,000 ticks. The result is
`docs/benchmarks/determinism.json`.

| target | build | runtime | differences from Windows |
| --- | --- | --- | --- |
| x86_64-pc-windows-msvc | rustc 1.95.0 | Node 24.15 | reference |
| x86_64-unknown-linux-gnu | rustc 1.95.0 | Node 24.21 | 0 |
| wasm32-wasip1 | rustc 1.99.1 | Node 24.15 WASI | 0 |
| wasm32-wasip1-threads | rustc 1.99.1 | Node 24.15 WASI | 0 |

No run ended in a refusal. Corrupting one mark makes `compare.cjs` report that run and exit 1.

Not covered: macOS and any ARM target (no such machine here), and a browser runtime, whose WASM has not executed the corpus.
This is reproducibility across targets, and says nothing of equality with the JVM: a result wrong the same way everywhere passes.
Worlds of 26.1.1 and 26.1.2 use 26.1's blocks, since minecraft-data has no table of theirs.
