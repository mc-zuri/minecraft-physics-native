# Vanilla random consumers near movement

The audit behind `docs/determinism.md`, from the 26.3 source: every draw in `Entity`, `LivingEntity`, `Player`,
`ServerPlayer`, `LocalPlayer`, the vehicles, projectiles and item entities, and every `entityInside`, `stepOn`, `fallOn` and
`updateEntityMovementAfterFallOn` of a block. A draw that reaches no motion or represented state is cosmetic: particles and
sounds. Older releases are not audited by this table: each row names a family, and a release's own draws can differ.

| consumer | side | draw | reaches | in the engine |
|---|---|---|---|---|
| `BaseFireBlock.fireIgnite`, a ServerPlayer | server | `nextInt(1, 3)` | fire ticks | `serverFireIncrements`, ordered |
| `LivingEntity.knockback` with no direction, `LivingEntity.java:1594-1595` | server | `nextDouble` pairs, until not tiny | motion | excluded: knockback is the server's and reaches a client as motion. No entry point takes it |
| `Entity.moveTowardsClosestSpace`, `Entity.java:3059`, items and orbs | both | `nextFloat() * 0.2F + 0.1F` | motion | `moving_entity.rs` takes the caller's draw where it models this; a player uses LocalPlayer's own push, which has no draw |
| `PowderSnowBlock.entityInside`, `random.nextBoolean()` | client | particles only | nothing moved | excluded: cosmetic |
| `FarmlandBlock.fallOn` | server | `nextFloat() < fallDistance - 0.5` | the block turns to dirt | excluded: changes the world, which the caller owns |
| `FallingBlockEntity.causeFallDamage` | server | `nextFloat` | an anvil's damage to itself | excluded: no motion |
| `Projectile.getMovementToShoot`, `FishingHook`, `FireworkRocketEntity`, `ThrownExperienceBottle`, `EyeOfEnder.signalTo` | server | gaussian or triangle | the first motion | the caller hands the motion in |
| `AbstractArrow.startFalling` | server | `nextFloat() * 0.2F` | the arrow's drop | the caller's, by the arrow's state |
| `ItemEntity`, `PrimedTnt` construction | server | `nextDouble`, `nextFloat` | the first motion and yaw | the caller hands the motion in |
| `LivingEntity` construction, `LivingEntity.java:283` | both | `nextFloat() * 2 * PI` | body yaw | no movement field |
| `LivingEntity.java:568`, oxygen bonus | server | `nextDouble` | air supply | no field |

No draw reaches a LocalPlayer's own tick. So a client state needs none, and a server state needs the fire draws only.
The table comes from a pattern search of those files, then reading each hit. Draws through a helper were searched too:
`Util.getRandom` in `Player` picks an orb to touch, in `LivingEntity` a slot and a particle, and `itemActivation` is the
totem's animation. None moves anything.

## Across releases

The same search over all 31 source trees from 1.7 to 26.3, each entity class and block callback against the release before.
A row is every release a consumer near movement came or went. Mappings change at 1.21.5, where the trees change from yarn
to Mojang names, so that release's own row is a rename and not a change.

| from | came or went | reaches movement |
|---|---|---|
| 1.8.9 | `LivingEntity.nextInt` of 1.7's drowning goes | no |
| 1.13.2 | `SkullBlock.nextDouble` goes | no |
| 1.14 | `ItemEntity`, `ExperienceOrbEntity` construction; `BubbleColumnBlock`, `ComposterBlock`, `PumpkinBlock`, `TurtleEggBlock` | a first motion, the caller's; the blocks are sound, particles or world changes |
| 1.15 | `TntEntity` construction; `HoneyBlock.nextInt`, the slide's particles and sound | a first motion, the caller's |
| 1.16 | `BubbleColumnBlock` moves from sound to particles | no |
| 1.17 | `ExperienceOrbEntity.nextFloat`, its construction | a first motion, the caller's |
| 1.19 | `SculkSensorBlock` | no: vibrations |
| 1.19.4 | `DoorBlock`, `TrapdoorBlock`, `ComposterBlock` | no: sound and particles |
| 1.20 | `Entity.nextDouble`, the swim splash's particles, moved in | no |
| 1.21.2 | `BaseFireBlock.fireIgnite`, a ServerPlayer's `nextInt(1, 3)` | yes: `serverFireIncrements`. No tree of 1.21.2 is here: 1.21 has no draw and 1.21.3 has it, and the jars of 1.21.1 and 1.21.2 show the class gaining its reference to ServerPlayer at 1.21.2 |
| 1.21.4 | `CreakingHeartBlock` | no |
| 1.21.5 | `LivingEntity.makeDrownParticles` takes `triangle` | no: particles |
| 1.21.11 | `LivingEntity.knockback`'s fallback direction, `Math.random` until then, draws from the entity's random | server only, excluded |

The tree misses 1.8.8, 1.9 to 1.9.3 and other releases without a directory of their own, so a consumer that came and went
between two trees would not show. No draw in any tree reaches a LocalPlayer's own tick.
