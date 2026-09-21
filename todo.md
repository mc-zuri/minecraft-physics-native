# Mineflayer Physics Engine
## Definition of 1:1 parity

- [ ] Define the exact parity target for every supported entity and interaction.
- [ ] Define the authoritative vanilla source for each release and patch.
- [ ] Reproduce the same tick order, method order, branch conditions, constants,
      floating-point operations, clamping, rounding, and state mutations.
- [ ] Reproduce server-authoritative behavior where Mineflayer receives server
      state, and client-prediction behavior where the client predicts movement.
- [ ] Reproduce observable outputs: position, velocity, bounding box, pose,
      collision flags, fluid flags, fall distance, fall damage, passengers,
      vehicle state, effects, and emitted interaction events.
- [ ] Never use a nearest-version approximation for a requested version.
- [ ] Never use a generic implementation when the target version has a
      different vanilla implementation.
- [ ] Reject a version when its source, generated data, and conformance tests
      are not present.

## Current next work priorities

- [x] Model the modern `WATER_MOVEMENT_EFFICIENCY` attribute separately from
      legacy Depth Strider interpolation, including the native state bridge and
      adapter-side attribute extraction.
- [x] Add differential runtime fixtures proving legacy Depth Strider and modern
      water-efficiency behavior independently for every supported release.
- [x] Populate modern movement-efficiency, air-drag, and friction attributes
      at the PlayerState boundary using explicit normalized aliases, preserving
      modifier resolution rather than relying on suffix matches.
- [x] Apply the same explicit attribute forwarding to generic EntityState
      updates; do not let an initialized empty attribute map mask Mineflayer
      entity attributes.
- [x] Forward modern water-movement-efficiency attributes for generic living
      entities as well as players.
- [x] Accept compact Mineflayer attribute objects without an empty modifier
      array while retaining vanilla modifier operation ordering.
- [x] Add native regressions for modern air-drag interpolation and ground
      friction-modifier behavior.
- [x] Preserve explicit zero-valued modern drag/friction modifiers across the
      N-API boundary; missing values use the source default without conflating
      absence with a supplied zero.
- [x] Add an explicit per-version behavior contract registry so each concrete
      release must declare the exact source-owned fluid and water-efficiency
      breakpoint policy before dispatch is accepted.
- [ ] Continue source-specialized travel, collision, entity, vehicle, effect,
      and prediction conformance work.
- [x] Parallelize independent per-release source indexing and memoize resolved
      superclass/source chains so generated Rust data remains deterministic
      without repeatedly rescanning identical Java sources.
- [x] Bound generator worker concurrency to the host parallelism (maximum eight)
      with `GENERATOR_WORKERS` available for controlled CI tuning.
- [x] Distinguish directly overridden shape methods from inherited base methods
      while retaining inherited source traversal for literal/provenance analysis;
      absent overrides now return `null` at the native API boundary.
- [x] Rebuild and smoke-test the corrected direct/inherited shape dispatch for
      the generated 43-release data set; package declarations and native
      artifacts validate successfully.
- [x] Validate the regenerated native package and focused shape smoke suite
      after the optimized release rebuild; inherited methods return `null`
      instead of being exposed as direct overrides.
- [x] Expose atomic per-method shape provenance containing the source hash,
      override presence, state-dependence flag, property dependencies, and
      extracted candidate count.
- [x] Preserve N-API omission semantics for absent source hashes in the
      TypeScript provenance declaration instead of claiming a serialized null.
- [x] Add an exact-shape lookup that refuses state-dependent candidate unions;
      only source-proven unconditional methods return exact geometry.
- [x] Require an actual `VoxelShape` method declaration when marking a shape
      method as overridden; ordinary `getShape(...)` call sites no longer
      create false direct-method metadata.
- [x] Validate the exact-shape API against both unconditional (`air`) and
      state-dependent (`oak_door`) source methods, including rejection of
      incomplete state tuples.
- [x] Audit all 43 generated releases so every direct shape-method flag has a
      matching source fingerprint, while absent overrides have no fingerprint.
- [x] Require generated block-state validation before returning exact
      unconditional shape geometry through the native API.
- [x] Pool identical shape and dependency arrays within each release while
      preserving declaration-before-reference ordering and exact lookup values.
- [x] Require the generated exact-shape lookup and state-validated native
      entrypoint to be present in package and generated-data verification.
- [x] Generate source-derived shape branch predicates per method and expose
      them through split Rust release data and the native TypeScript boundary.
- [x] Validate generated shape predicates against complete block-state tuples,
      rejecting incomplete or invalid tuples before branch evaluation.
- [x] Reduce generator memory retention by caching parsed method bodies per
      source string and method name rather than materializing duplicate
      source-sized cache keys.
- [x] Keep the repo’s active runtime imports and path naming consistent with
      the actual on-disk files; remove retired simulator/engine artifacts and
      validate the native-only distribution.
- [ ] Re-run targeted validation after every substantive physics behavioral fix;
      do not claim parity completion while the behavior test matrix remains red.
- [x] Specialize the modern firework rocket tick path to the Java source
      ordering: skip the boost when `shotAtAngle` is set, use the 1.15/1.0
      horizontal scaling unless the entity is already horizontally colliding,
      and add the source `+0.04` upward acceleration before gravity/inertia.
- [x] Expand the explicit projectile family registry to cover the common
      source-derived thrown and fireball families used across the supported
      versions (`small_fireball`, `wither_skull`, `experience_bottle`,
      `llama_spit`, and aliases from modern decompiled names).
- [x] Ensure family-specific projectile defaults are resolved from the source
      registry before fallbacks, so `llama_spit`, `shulker_bullet`, and other
      modern families use their Java-backed gravity/drag values instead of the
      generic projectile defaults when the caller omits explicit overrides.
- [x] Correct source gravity defaults for thrown potions, experience bottles,
      and firework rockets from the authoritative projectile classes.
- [x] Correct source gravity defaults for fishing hooks and fireball-family
      projectiles, which inherit zero gravity or apply their own hook gravity.
- [x] Correct source inertia defaults for firework, fireball-family, and
      fishing-hook projectile classes.
- [x] Preserve `AbstractHurtingProjectile` power acceleration and apply it
      after movement using the source inertia ordering.
- [x] Normalize namespaced and alias-style modern projectile IDs before family
      dispatch, so `minecraft:small_fireball`, `minecraft:firework_rocket`,
      `fire_charge`, and `large_fireball` resolve to their intended Java
      projectile families without drifting to `Generic`.
- [x] Harden the projectile-family resolver for `entity:` prefixes, dotted IDs,
      and common legacy alias forms like `big_fireball`, `dragon_fireball`, and
      namespaced modern firework IDs before source fallback is considered.
- [x] Correct `Entity.push` to apply independent `pushthrough` scaling on each
      side instead of treating the pair as if only one entity had a source-owned
      pushthrough value. The native helper continues to preserve the zero-value
      compatibility wrapper while matching the version-owned per-entity impulse
      boundary.
- [x] Match the modern water travel climbable branch: horizontal collision
      raises the post-move vertical component before water drag/falling
      adjustment; lava retains its separate shallow/deep path.
- [x] Carry the source `FALL_DAMAGE_IMMUNE` entity boundary into the native
      state bridge and short-circuit fall-damage calculation before applying
      safe-distance or multiplier arithmetic.
- [x] Route the source modern safe-fall-distance/fall-power calculation through
      the dedicated 26.1, 26.1.1, 26.1.2, and 26.2 profiles; legacy releases
      retain their source-specific three-block and jump-boost formula.
- [x] Apply the legacy Jump Boost amplifier to pre-modern fall-damage power
      before the profile-owned rounding operation.
- [x] Wire the fall-damage-immunity boundary through `IEntityState`,
      `EntityState`, `PlayerState`, and the native TypeScript adapter so the
      source-derived native calculation is reachable from runtime state.
- [x] Refresh vertical collision flags on zero-Y local movement requests,
      matching the source `Entity.move` rest-state assignment instead of
      preserving stale collision/on-ground flags.
- [x] Replace shape-height enumeration in step-up resolution with the
      source-ordered two-candidate `Entity.collide` algorithm: raised motion,
      expanded-box lift, horizontal motion, and final vertical correction.
- [x] Match source fluid escape-jump gating with an explicit `is_free` world
      query, including collision and liquid occupancy checks, instead of
      treating every horizontal collision while climbing as a jump.
- [x] Add an explicit `controlled_by_local_instance` boundary instead of
      conflating player identity with Java local-control semantics.
- [x] Preserve the typed `controlledByLocalInstance` and `blockFallCallback`
      values across the native bridge rather than overwriting them with the
      player default or a static false value.
- [x] Preserve the full source-owned apply-back boundary set (`safeFallDistance`,
      `fallDamageImmune`, `fallDamageMultiplier`, `entityBounciness`,
      `blockBounciness`, and `controlledByLocalInstance`) when writing state
      back to bot/entity instances, rather than dropping those runtime fields.
- [x] Gate the block fall callback event on the explicit local-control
      boundary, matching `Entity.move` rather than emitting it for remote
      entities.
- [x] Add the source `Entity.move` fall-damage-resetting ray boundary:
      typed block state, deterministic world sweep, movement-length threshold,
      and reset-before-accumulation ordering.
- [x] Expose fall-damage-resetting membership on shape-based N-API world
      updates so the typed source boundary is reachable from runtime callers.
- [x] Apply the post-movement water guard from `Entity.checkFallDamage` before
      accumulating downward fall distance.
- [x] Replace center-cell support-effect lookup with a source-shaped underside
      support query over the entity footprint, including multi-shape blocks.
- [x] Add the player source `maybeBackOffFromEdge` collision branch for
      sneaking movement, including 0.05 stepping and max-down-step checks.
- [x] Extend `SimulationState` and the N-API bridge with typed entity/block
      bounciness inputs and route the dedicated 26.2 restitution path without
      defaults. `BlockState.bounce_restitution` is now carried by world
      updates and consumed by the 26.2 restitution path; the source
      bounce-suppression tag is also a typed boundary.
- [x] Expose the 26.2 downward-clipping block-fall callback as a typed state
      event through the native and TypeScript bridges without inventing block
      side effects.
- [x] Add explicit native and TypeScript support for the available 26.1,
      26.1.1, and 26.2 source-backed entries, with the modern floor-damage
      and split-fluid handling aligned to the current source evidence.
- [x] Add dedicated 26.1.2 native and TypeScript dispatch after confirming its
      core movement source is byte-identical to 26.1.1; retain the broader
      parity work as an open task.
- [x] Use direct manual validation instead of the removed Babysitter workflow
      while the version-specific behavior work continues.
- [x] Preserve the source-owned pose boundary when applying PlayerState back to
      the bot entity, instead of using a primitive `Object.assign` call that
      silently drops the runtime pose state.

## Version architecture

- [x] Give 1.14.4, 1.15.2, 1.16.5, 1.17.1, and 1.18.2 dedicated Rust
       profile types and engine modules instead of routing them through the
       generated shared profile table.
- [x] Migrate every remaining supported snapshot to a dedicated profile type
       and engine module.
- [x] Give each locally available 1.19 release (1.19 through 1.19.4) its own
      engine module and explicit dispatch arm; no 1.19 release uses the
      generated version wrapper.
- [x] Give locally available 1.20.1, 1.20.4, and 1.20.6 their own engine
      modules and explicit dispatch arms; no 1.20 release uses the generated
      version wrapper.
- [x] Add the complete locally available 1.20.2 and 1.20.3 snapshots as
      dedicated native and TypeScript versions.
- [x] Add the complete locally available 1.20 release as a dedicated native
      and TypeScript version.
- [x] Make landing-damage rounding an explicit version-policy operation with
      direct ceil/floor tests instead of embedding one universal rounding rule.
- [x] Give all currently registered 1.21 releases dedicated native modules;
      1.21.8, 1.21.10, and 1.21.11 explicitly select the source-observed
      floor landing-damage policy.
- [x] Remove the generated native version-wrapper dispatch path; every
      currently registered version now dispatches to an explicit module.
- [x] Remove the generated native rules table and package command; version
      behavior is now owned by concrete version modules.
- [x] Require every concrete profile to declare its landing-damage policy;
      no version profile inherits a rounding default.
- [x] Validate each registered profile's landing policy against the
      corresponding decompiled `LivingEntity` source before accepting coverage.
- [x] Validate that every registered source snapshot contains the concrete
      `Entity.move`, `LivingEntity.travel`, and `Player.travel` methods before
      treating the version as physics-covered.
- [x] Remove the TypeScript production-engine fallback to unversioned native
      simulation; wrapper-created physics engines and native wrapper helpers
      now dispatch through the bot's concrete Minecraft version. Low-level
      unversioned N-API functions remain compatibility/test APIs only.
- [x] Add dedicated modules for every local 1.15-1.18 snapshot
       (`1.15`, `1.15.1`, `1.16`, `1.16.1`, `1.16.2`, `1.16.3`, `1.16.4`,
       `1.17`, `1.18`, and `1.18.1`).
- [x] Record any behavior that cannot be observed from Mineflayer and define a
      deterministic, documented boundary representation for it.

## Version and source matrix

- [x] Enumerate every release from 1.15 through 1.21.x and 26.x from Mojang
      version metadata.
- [ ] Include release candidates and snapshots only when explicitly supported.
- [x] Identify physics-relevant patch breakpoints by diffing vanilla source,
      mappings, registries, data packs, and protocol behavior.
- [x] Add the missing source-backed 1.20.5 and 1.21 patch entries to the
      native runtime and TypeScript registry while keeping 26.x explicitly
      blocked until its required source artifacts are complete.
- [x] Maintain a machine-readable version manifest containing release ID,
      protocol version, mappings, source revision, data revision, and SHA-256
      fingerprints for all locally available source snapshots. Protocol,
      mapping, and data revisions remain pending until their authoritative
      metadata sources are integrated.
- [x] Maintain one public engine class per concrete supported version.
- [x] Maintain one Rust version module per currently source-backed concrete
      supported version, with explicit dispatch arms.
- [x] Verify every locally available 1.15-1.19 source release has required
      Entity/LivingEntity/Player sources, a dedicated native module, and a
      synchronized TypeScript registry entry.
- [ ] Maintain explicit aliases only when a verified source/data diff proves the
      behavior is identical.
- [ ] Generate the version registry and TypeScript exports from the manifest.
- [ ] Add 1.14.4, 1.15.2, and 1.16.5 as the first fully verified snapshots.
- [ ] Add every missing release between 1.15 and 1.21.11.
- [ ] Add 1.21.2 minecart/vehicle changes as a separate implementation when
      source behavior differs.
- [ ] Add 1.21.5, 1.21.6, 1.21.9, and 1.21.11 breakpoints independently when
      their source behavior differs.
- [ ] Add all requested 26.x releases with their actual source and data.
- [ ] Keep 1.8 through 1.14 outside this phase unless explicitly enabled.
- [x] Add a source-availability check that fails generation when required
      classes are missing.
- [x] Add a source-diff report identifying changed tracked physics methods per
      locally available version transition.
- [x] Add a reproducible script for fingerprinting locally available source
      artifacts and physics method bodies.
- [x] Expand the native versioned regression suite to check the explicit
      contract for every source-backed supported release, including the
      1.20.5 and 26.x entries, while rejecting unsupported or incomplete
      snapshots.
- [x] Generate source-backed movement rules for the newly available snapshots:
      1.17.1, 1.18.2, 1.19.4, 1.20.1, 1.20.4, 1.20.6, 1.21.1, 1.21.4,
      1.21.5, 1.21.8, 1.21.10, and 1.21.11.
- [x] Register each newly available snapshot in native and TypeScript version
      dispatch without falling back to an unrelated version.
- [x] Keep source-backed TypeScript version declarations and factory dispatch
      synchronized through an explicit, compile-time-checked registry.
- [x] Validate generated gravity, step-height, and air-drag constants and
      reject extraction results that match unrelated fallback values.
- [x] Extract the vanilla water fluid-falling gravity divisor from each
      snapshot instead of using a shared hardcoded divisor.
- [x] Validate extracted fluid gravity divisors before generating Rust rules.
- [x] Extract and validate version-specific water and lava input speeds from
      each snapshot's `LivingEntity.travel` implementation, including the
      split `travelInFluid` helper used by newer snapshots.
- [x] Preserve generated version air-drag rules when the runtime uses default
      configuration; explicit custom drag values remain supported overrides.
- [x] Apply Java binary32 conversion when generated fluid float constants enter
      native movement calculations.
- [x] Extract version-specific lava horizontal drag and consume it from native
      version rules.
- [x] Extract version-specific fluid vertical drag and consume it from native
      water and lava movement.
- [x] Add source-owned fluid-travel split handler flags for the 1.21.4+
      `travelInFluid` breakpoint and validate them against the source audit.
- [x] Route legacy fluid travel and `travelInFluid` through separate executable
      native handlers selected by each concrete version profile.
- [x] Preserve binary32 rounding at fluid vertical-drag boundaries where
      vanilla uses float literals.
- [x] Extract version-specific water and baseline lava fluid-current scales
      from `Entity` and consume them through native version rules.
- [x] Remove the non-vanilla fluid-current cutoff; nonzero source flow now
      contributes to movement.
- [x] Add explicit ultra-warm dimension state to the native snapshot and apply
      vanilla's `0.007` lava-current scale when enabled.
- [x] Own the ultra-warm lava-current scale in every concrete release profile;
      the shared simulation core no longer contains that behavior constant.
- [x] Regression-test fast lava currents in ultra-warm dimensions.
- [x] Preserve vanilla player-versus-nonplayer fluid-flow normalization through
      the native snapshot bridge.
- [x] Apply vanilla shallow-fluid height scaling before fluid-current
      normalization and player movement.
- [x] Scale the sampled fluid-current aggregate after averaging all intersecting
      blocks, matching the 1.21.11 `Entity` fluid-pushing order.
- [x] Sample and average fluid flow across all fluid blocks intersecting the
      entity bounding box instead of using only the body block.
- [x] Implement vanilla's minimum horizontal fluid-push clamp for all
      fluid-pushed entities.
- [x] Preserve the complete 3D direction when applying the player minimum
      fluid-push clamp.
- [x] Use maximum matching fluid height across the entity bounds for fluid
      presence and shallow-lava movement branches.
- [x] Derive the fluid-jump threshold from entity eye height (`0.0` below
      `0.4`, otherwise `0.4`) as vanilla does.
- [x] Keep decompiled source and proprietary artifacts out of the published
      package.

## Source extraction and code generation

- [x] Generate deterministic per-release source method inventories and hashes
      for the tracked movement methods in `generated/physics-methods.json`.
- [x] Generate a source breakpoint report for tracked method changes in
      `generated/physics-breakpoints.json`.
- [x] Validate that every registered release has audited `Entity.move`,
      `LivingEntity.travel`, and `Player.travel` methods.
- [x] Build a source inventory generator for `Entity` movement and collision
      methods.
- [x] Inventory `LivingEntity.travel`, fluid-travel, and tracked movement
      helper methods.
- [x] Inventory `Player` and `LocalPlayer` movement and prediction methods.
- [x] Inventory tracked vehicle movement overrides.
- [x] Extract the generic projectile tick slice from
      `ThrowableProjectile.tick`: gravity, air inertia, swept block hit, and
      move-vector position update are now source-backed in native Rust,
      including the source-specific water inertia branch.
- [x] Expose the generic projectile tick through the safe N-API/TypeScript
      boundary and cover hit detection and invalid input in the native smoke
      test.
- [ ] Extract projectile motion and collision methods.
- [ ] Extract entity dimensions, poses, eye heights, and passenger offsets.
  - [x] Add source-backed player crouching, swimming, fall-flying, spin attack,
        long-jumping, dying, and sleeping dimensions plus pose-specific eye
        heights.
  - [x] Match the source pose ordinal table, including spin attack, and reject
        out-of-range pose ordinals instead of assigning unsupported dimensions;
        preserve historical `DYING` ordinals through explicit version context
        (`6` in 1.14–1.15 and `7` from 1.16 onward).
- [ ] Extract block collision, outline, interaction, support, friction,
      slipperiness, fluid, and movement-effect behavior.
- [ ] Extract voxel-shape composition, axis clipping, and collision iteration.
- [ ] Extract attributes, modifiers, effects, enchantments, and equipment
      modifiers relevant to movement.
- [x] Preserve the `LivingEntity.travel`/`Player` movement-speed attribute
      operation order for speed, slowness, and sprinting modifiers in native
      movement.
- [x] Preserve modern movement attributes, sneaking edge state, and clone/merge
      serialization for `EntityState` and `PlayerState` without dropping
      explicitly supplied values.
- [x] Carry `blockFallCallback`, `entityBounciness`, and `blockBounciness`
      through the state bridge and source-owned entity copies so the 26.2
      restitution/callback boundary survives serialization and merge operations.
- [ ] Preserve source operation order in generated intermediate representations.
- [ ] Generate Rust constants and lookup tables from extracted source/data.
- [ ] Generate source provenance for every generated rule and table entry.
- [ ] Make generation deterministic and reproducible on Windows, Linux, and
      macOS.
- [ ] Fail generation on unresolved mappings, missing methods, unsupported
      bytecode, or ambiguous behavior.
- [ ] Add generated-data integrity checks to CI.

## Core simulation model

- [x] Define a complete immutable input snapshot for each tick.
- [x] Define a complete mutable output snapshot for each tick.
- [ ] Represent all vanilla entity flags and tracked state that affects motion.
- [x] Carry per-entity gravity and step-height attribute overrides through the
      native state bridge.
- [x] Preserve per-entity gravity, step-height, and no-gravity state across
      EntityState and PlayerState prediction clones and merges.
- [x] Import the Mineflayer entity no-gravity flag when constructing native
      entity state snapshots.
- [x] Reject non-finite or out-of-range per-entity gravity and step-height
      values at the native API boundary.
- [x] Apply runtime gravity, drag, and step-height configuration with explicit
      precedence below per-entity attribute overrides.
- [ ] Represent exact numeric types and conversion boundaries used by each
      version.
- [ ] Preserve Java float behavior where vanilla uses float.
- [ ] Preserve Java double behavior where vanilla uses double.
- [ ] Define NaN, infinity, overflow, and invalid-input handling explicitly.
- [ ] Implement exact tick ordering, including pre-tick, movement, collision,
      post-movement, effects, fall distance, and event phases.
- [ ] Implement deterministic random state where random values affect physics.
- [ ] Implement entity age, tick counters, and cooldowns that affect movement.
- [x] Implement source-backed passenger/vehicle update ordering and rotated
      passenger offsets for the native boat path (`Entity.positionRider` and
      the vehicle riding-position hook are applied after vehicle movement).
- [ ] Implement loaded/unloaded chunk behavior and client prediction behavior.
- [ ] Implement world-border and dimension boundary behavior.
- [ ] Implement portal and teleport state where it affects movement.
- [ ] Implement removal, riding, sleeping, death, and spectator state handling.

## Mathematics and geometry

- [ ] Implement Java-compatible vector arithmetic.
  - [x] Add vector subtraction alongside existing addition and scalar
        operations for exact AABB geometry composition.
  - [x] Add vanilla vector-to, reverse, component multiplication, horizontal,
        distance, interpolation, and axis-rotation operations.
  - [x] Add vanilla pitch/yaw direction-vector construction using the
        quantized trigonometric lookup path.
  - [x] Add vanilla clockwise quarter-turn, projection, and finite-value
        vector operations.
  - [x] Add vanilla scalar/component offsets, proximity checks, and vector
        rotation extraction.
- [ ] Implement Java-compatible trigonometric functions and angle conversion.
  - [x] Implement vanilla `Mth` sine/cosine lookup quantization and float
        degree-to-radian conversion, and consume the shared direction-vector
        implementation for player look vectors.
- [ ] Implement normalization, length, horizontal length, dot products, and
      cross products.
  - [x] Implement vector length, horizontal-length, dot, cross, and squared
        length primitives with regression coverage.
  - [x] Match vanilla normalization's `1.0E-5` zero-vector threshold.
- [ ] Implement exact floor, ceil, round, clamp, and epsilon semantics.
  - [x] Implement vanilla double floor/ceil, clamp, and degree wrapping
        helpers with negative and boundary regression coverage.
  - [x] Add long floor/ceil, integer and long clamps, positive modulo,
        fractional extraction, and degree-difference helpers.
  - [x] Implement vanilla clamped linear interpolation, epsilon equality,
        and half-up integer rounding helpers.
  - [x] Add vanilla linear interpolation, inverse interpolation, and
        absolute-maximum numeric helpers.
  - [x] Add vanilla angle approach/rotation and power-of-two/logarithm
        helpers used by movement and indexed geometry code.
  - [x] Add vanilla chessboard distance, floor division, divisibility, and
        packed-degree helpers for grid and network-facing calculations.
  - [x] Add vanilla square/cube, mapped interpolation, component length,
        positive ceiling division, round-toward, and quantization helpers.
  - [x] Add vanilla bilinear/trilinear interpolation, Catmull-Rom,
        smoothstep, sign, rotational interpolation, and triangle-wave helpers.
  - [x] Add vanilla integer/discrete interpolation, smallest-square sizing,
        absolute angle differences, and deterministic block seed helpers.
  - [x] Add vanilla binary-search and MurmurHash3 mixer utilities.
  - [x] Add vanilla bounded `outFromOrigin` traversal with explicit invalid
        range and step validation.
  - [x] Add fraction multiplication/truncation with Java integer overflow and
        division semantics.
  - [x] Add vanilla reciprocal-square-root and inverse-cube-root helpers,
        including the deprecated bit-level inverse-square-root approximation.
  - [x] Add vanilla lookup-table `atan2` with the same normalization,
        approximation correction, quadrant handling, and NaN behavior.
  - [x] Add vanilla HSV-to-RGB/ARGB conversion with truncation and channel
        clamping semantics.
  - [x] Add vanilla float overloads and integer/long angle wrapping, including
        binary32 fractional and NaN-preserving clamp behavior.
  - [x] Add source-backed absolute-maximum overloads for float and integer
        numeric paths.
  - [x] Add vanilla binary32 square-root, absolute-value, and 2D/3D length
        overloads.
- [ ] Implement axis-aligned bounding boxes with exact inclusive/exclusive
      boundary behavior.
- [ ] Implement box inflation, deflation, expansion, contraction, movement,
      intersection, containment, and ray clipping.
  - [x] Regression-test vanilla directional `AABB.expandTowards` behavior for
        positive, negative, and zero movement components.
- [x] Implement vanilla directional AABB contraction and vector inflation/
      deflation primitives with regression coverage.
- [x] Implement vanilla AABB intersection, min/max union, and half-open point
      containment semantics with regression coverage.
- [x] Implement vanilla AABB axis sizes, average size, and squared distance
      calculations with regression coverage.
- [x] Implement vanilla epsilon-aware AABB segment clipping for ray
      intersections with regression coverage.
- [x] Implement vanilla ray-versus-AABB broad-phase intersection tests with
      axis-separation and cross-product regression coverage.
- [x] Implement a source-aligned voxel-shape container as deterministic unions
      of indexed boxes without unauthorized simplification.
- [x] Add vanilla-style empty and aggregate-bounds queries for voxel shapes.
- [x] Add indexed-box `VoxelShape.collide` axis resolution with vanilla
      sub-`1.0E-7` handling and empty-shape passthrough.
- [x] Wire indexed voxel shapes into world block collision queries.
- [x] Preserve vanilla empty-shape semantics by removing collision geometry
      when an empty voxel shape is assigned.
- [x] Filter degenerate AABBs from lower-level multi-box collision queries so
      empty shape entries never become colliders.
- [x] Implement block-centered quarter-turn coordinate transformations around
      the X, Y, and Z axes for indexed voxel boxes.
- [ ] Implement shape simplification only when vanilla performs it.
- [x] Implement vanilla `Direction.axisStepOrder` for collision iteration.
- [x] Make native collision-shape query ordering deterministic across chunk
      hash-map iteration.
- [ ] Implement collision epsilon and contact behavior.
- [x] Apply vanilla `VoxelShape.collide` sub-`1.0E-7` motion cutoff in
      axis resolution, with positive and negative regression coverage.
- [x] Keep collision-state reporting exact after epsilon clipping, matching
      vanilla requested-vs-resolved component comparisons.
- [ ] Add exhaustive geometry tests for touching, overlapping, negative, and
      very large coordinates.

## World representation

- [x] Define and transport a version-qualified block-state identifier model,
      rejecting non-concrete versions and clearing identity on block removal.
- [x] Fail closed when a block-state identity names a release outside the
      source-backed version registry.
- [x] Expose validated multi-box block shapes through the native world and
      TypeScript boundary.
- [x] Transport typed block properties alongside state IDs, tags, collision
      shape, outline shape,
      fluid state, friction, slipperiness, and movement effects.
- [x] Expose validated direct block-property mutation while rejecting property
      writes for absent block states.
- [x] Reject empty or duplicate property names at both direct and batched
      native update boundaries.
- [x] Preserve a typed block-tag bitset through native block updates and
      expose it through `NativeBlockState`/`blockTagsAt`.
- [x] Distinguish absent blocks from explicitly represented air blocks at the
      native world boundary.
- [x] Preserve multiple collision boxes per block state through the native
      world snapshot and N-API block-update path.
- [x] Preserve separate single- and multi-box outline shapes through the native
      world snapshot and N-API `setBlockShapes`/block-update paths.
- [x] Preserve interaction geometry separately from collision and outline
      geometry through the native world and block-state boundary.
- [x] Preserve repeated batched updates for one block as independent
      collision, outline, and interaction geometry channels.
- [x] Add native smoke coverage for the TypeScript `setBlockShapes` multi-box
      world API.
- [ ] Store fluid height, level, falling/source status, tags, and flow vectors.
- [x] Preserve typed fluid tags alongside fluid level, source/falling status,
      and flow vectors through the native block-update boundary.
- [x] Add a complete validated direct fluid-state setter preserving tags,
      levels, source/falling flags, and flow vectors.
- [ ] Store block entities only where they affect collision or movement.
- [x] Preserve explicit block-entity kind metadata for present blocks, with
      validated direct/batched mutation and removal cleanup.
- [x] Make batched block-entity replacement/removal explicit so ordinary block
      updates do not silently erase existing entity metadata.
- [ ] Implement chunk sections, height limits, min build height, and world
      border per version.
- [x] Implement explicit loaded/unloaded chunk semantics and expose chunk
      loading state through the native world boundary.
- [x] Preserve explicit empty chunk-section presence and expose section
      membership/count readback through the native world boundary.
- [x] Store explicit world height limits and world-border geometry in the
      native world snapshot boundary.
- [x] Expose exact configured world-height and border state for snapshot
      readback and validation.
- [x] Expose source-shaped world-border containment and clamping operations
      through the native world boundary.
- [x] Preserve explicit absent-versus-air state through `NativeBlockState`
      instead of treating every missing block as a stored air block.
- [x] Implement incremental block updates and batch updates with deterministic
      grouping, repeated geometry preservation, and metadata-only merge semantics.
- [x] Batch versioned boat ticks inside Rust to avoid per-tick N-API conversion
      overhead.
- [x] Batch versioned horse ticks inside Rust to avoid per-tick N-API conversion
      overhead.
- [x] Batch versioned projectile ticks inside Rust to avoid per-tick N-API
      conversion overhead.
- [x] Batch versioned arrow and trident ticks inside Rust to avoid per-tick
      N-API conversion overhead.
- [x] Generate a source-hashed per-release block registry manifest from each
      authoritative `Blocks.java` snapshot.
- [x] Generate a source-fingerprinted per-release block-class/property manifest,
      including shared property definitions, explicit domains, defaults, and
      unresolved-domain audit entries.
- [x] Emit the validated block registry and block-property data as Rust-owned
      generated tables consumed by native version support; JSON remains an
      internal audit/generation input rather than a runtime data source.
- [x] Emit source-derived water and lava fluid identities and baseline
      tick/drop-off policies as Rust-owned generated tables for every release.
- [x] Generate source-proven fluid-state properties, cardinalities, and
      vanilla sorted-property state indices for source and flowing water/lava.
- [x] Expose generated fluid-state cardinality and state-index lookups through
      the native N-API boundary with invalid-tuple rejection.
- [x] Emit source-fingerprinted fluid tag keys, including legacy and modern
      tag declaration forms, as Rust-owned generated tables for every release.
- [x] Emit source-fingerprinted block tag keys, including legacy and modern
      declaration forms, as Rust-owned generated tables for every release.
- [x] Emit source-derived direct block members and nested tag references for
      every generated block tag.
- [x] Emit exact block-state cardinalities when all property domains are
      source-proven; preserve `None` for unresolved domains.
- [x] Resolve all supported-release block property domains, including shared
      direction restrictions, rotation-segment bounds, enum declarations, and
      aliased shared properties; no unresolved domains remain.
- [x] Fingerprint the tag-provider source used to derive each generated block
      tag membership table.
- [x] Generate per-block source-derived collision, outline, and interaction
      shape-method presence metadata without guessing inherited geometry.
- [x] Fingerprint directly declared collision, outline, and interaction shape
      method bodies for generated geometry provenance.
- [x] Keep generated Rust runtime data split into per-release modules under
      `native/data/releases`, with shared lookup code isolated in
      `native/data/mod.rs`.
- [x] Generate source-proven literal `Block.box` geometry candidates into
      per-release Rust data without merging release tables into one god file.
- [x] Expose generated source shape-box candidates through the native binding
      boundary for conformance tooling and version-specific adapters.
- [x] Preserve shape-method provenance separately for collision, outline, and
      interaction geometry instead of combining all source literals blindly.
- [x] Expose method-specific generated shape candidates through the native
      binding boundary with explicit geometry-kind selection.
- [x] Distinguish an absent shape method (`None`) from a present method whose
      geometry is dynamic or has no extractable literal boxes (`Some([])`).
- [x] Generate and expose the source property dependencies read by each
      shape implementation, preserving state-dependent geometry provenance.
- [x] Preserve method-specific shape property dependencies for collision,
      outline, and interaction dispatch instead of only a class-wide union.
- [x] Emit explicit state-dependent shape provenance flags so extracted
      candidate boxes are never mistaken for a complete unconditional shape.
- [x] Harden source shape extraction against nested Java braces, comments,
      string/character literals, and both `F`/`D` numeric suffixes.
- [x] Compute shape-method provenance fingerprints from balanced method bodies,
      avoiding truncation at nested control-flow braces.
- [x] Traverse source-declared superclass chains when extracting shape methods
      and static geometry constants, so inherited vanilla geometry is retained.
- [x] Preserve ambiguous simple-name source matches as unresolved instead of
      silently selecting an arbitrary class from another package.
- [x] Fingerprint source-derived fluid flow, height, and amount method bodies
      for every generated water/lava fluid entry.
- [x] Emit source-derived property default assignments into Rust-owned block
      property tables.
- [x] Preserve source-defined block-state property construction order in the
      generated Rust tables.
- [x] Add bounded native mixed-radix state indexing using vanilla
      `StateDefinition` sorted-property enumeration and proven source domains;
      reject incomplete or unknown tuples.
- [x] Implement negative coordinates and chunk-boundary indexing.
- [ ] Implement collision queries without lossy conversion through JavaScript.
- [x] Generate complete source-proven block-state and core water/lava fluid
      state tables for every supported version; preserve unresolved cases only
      where the decompiler does not provide the referenced enum declaration.
- [ ] Generate complete block tags used by movement and collision.
- [ ] Generate version-specific shape tables from vanilla registries.
  - [ ] Resolve state-dependent shape branches into exact per-state geometry;
        literal candidates alone are not accepted as final parity.
- [ ] Verify generated shape tables against every state in each version.

## Entity base behavior

- [ ] Port `Entity` construction, dimensions, position, rotation, and velocity.
- [ ] Port `Entity.move` exactly for every version.
- [ ] Port movement type semantics.
- [x] Add explicit no-physics movement state and bypass collision resolution
      while clearing movement collision flags.
- [x] Preserve vanilla vertical collision and on-ground state when requested
      vertical movement is zero.
- [x] Carry vanilla `verticalCollisionBelow` through native and TypeScript
      prediction snapshots.
- [x] Update depth-strider regressions for vanilla's preserved on-ground state
      when requested vertical movement is zero.
- [ ] Port collision flags and their reset/update rules.
- [ ] Port supporting-block and stepping detection.
- [x] Derive step-up candidates from voxel collision-shape top surfaces and
      evaluate them in ascending vanilla order.
- [ ] Port suffocation, inside-wall, and border checks where movement-visible.
  - [x] Expose source-shaped eye-box inside-wall detection, gated by
        no-physics and driven by collision-shape intersection.
- [ ] Port piston movement and entity displacement.
- [ ] Port entity push and collision with other entities.
  - [x] Expose a concrete-version N-API entity-push operation with explicit
        no-physics, vehicle, pushability, passenger, and pushthrough inputs.
  - [x] Select legacy `pushthrough` behavior from the audited concrete release;
        modern releases explicitly ignore the removed source field.
  - [x] Integrate pairwise entity push into a concrete versioned multi-entity
        tick pipeline, including same-vehicle passenger exclusion and explicit
        pushthrough ownership.
  - [x] Gate pairwise pushes on actual three-dimensional bounding-box overlap,
        matching the collision candidate boundary instead of pushing arbitrary
        nearby entities.
  - [x] Match `Entity.push(Entity)`'s double-precision normalization and
        float impulse constant without introducing extra binary32 rounding.
  - [x] Add source-backed horizontal `Entity.push(Entity)` impulse calculation
        with threshold, binary32 scaling, and physics/vehicle/pushability gates.
  - [x] Skip pushes between passengers of the same vehicle, matching the
        1.21.11 `Entity.push(Entity)` relationship guard.
- [ ] Port riding, passenger offsets, dismount checks, and vehicle attachment.
- [ ] Port teleport, interpolation, and synchronization state where exposed.
- [ ] Port fire, freezing, powder snow, and environmental movement effects.
- [ ] Port fall-distance accumulation and landing reset.
  - [x] Preserve vanilla `checkFallDistanceAccumulation`'s strict `>-0.5`
        and `>1.0` thresholds during fall-flying updates.
  - [x] Reset fall distance when Slow Falling or Levitation is active before
        movement, matching `LivingEntity.travel` ordering.
- [ ] Port safe-fall-distance and fall-damage calculations.
  - [x] Preserve safe-fall-distance through native simulation/N-API state and
        subtract it from landing damage thresholds.
  - [x] Round native landing damage upward with the source `ceil` behavior.
- [ ] Port entity dimensions and pose refresh transitions.
  - [x] Add a concrete versioned pose-refresh operation with source-ordered
        requested/sneaking/swimming fallback and collision-box validation.
  - [x] Preserve no-physics and spectator bypasses while rejecting unavailable
        poses for the selected source release.

## Living entities and players

- [ ] Port `LivingEntity.travel` for every version.
- [ ] Port `Player.travel` and client-local movement overrides.
- [ ] Port `LocalPlayer` input and prediction-specific movement.
- [ ] Port base movement speed and all attribute modifiers.
- [ ] Port sprinting requirements, sprint transitions, and sprint multiplier.
  - [x] Disable effective sprint acceleration while sneaking or using an item.
- [ ] Port sneaking movement and edge-safe movement.
- [ ] Port jumping, jump delay, jump cooldown, and jump cancellation.
  - [x] Implement water/lava jump impulse and climbable jump-up behavior.
  - [x] Preserve and enforce the ten-tick ground-jump cooldown through the
        native state bridge.
- [ ] Port jump boost and jump strength.
  - [x] Apply sprint-jump forward impulse using the entity yaw.
  - [x] Keep player base jump strength at `0.42` and apply Jump Boost as
        the separate source-derived amplifier bonus.
  - [x] Avoid narrowing/overflow when applying the N-API amplifier byte.
- [ ] Port air, ground, water, lava, and climbable movement.
  - [x] Apply the source `getFrictionInfluencedSpeed` ground-input formula
        before collision movement on high-slipperiness blocks.
  - [x] Apply vanilla climbable horizontal and downward velocity limits.
  - [x] Keep world-derived climbability scoped to the current tick.
- [x] Preserve Mineflayer's explicit swimming metadata through the native
      entity-state contract and use it for source-ordered swimming pose
      selection instead of inferring swimming from sprint input.
- [ ] Port swimming pose and swimming acceleration completely per source
      release.
  - [x] Encode the audited 1.21.1+ water-movement-efficiency interpolation
        divisor (`1.0`) separately from the 1.14-1.20.6 divisor (`3.0`) in
        every concrete version profile.
- [x] Port versioned pose transition collision checks and integrate the
      requested/fallback pose refresh into the native player tick path.
- [ ] Port crawling-specific pose selection and swimming acceleration.
  - [x] Match the modern `updatePlayerPose` swimming-fit guard and preserve
        the current pose when the reduced swimming box cannot fit.
  - [x] Allow passenger pose selection to bypass the requested-pose fit test,
        while retaining the initial swimming-fit guard.
  - [x] Preserve the source desired-pose priority for sleeping, swimming,
        fall-flying, spin attack, crouching, and standing.
- [ ] Port flying, creative flight, spectator flight, and ability flags.
  - [x] Add explicit flying state, vanilla vertical carry factor, and
        fall-distance reset to the native simulation/N-API snapshot.
  - [x] Use the dedicated flying movement speed for horizontal input.
  - [x] Apply client flying ascent/descent input using jump and sneak controls.
- [ ] Port no-gravity and custom-gravity behavior.
  - [x] Add native/N-API no-gravity state and preserve the explicit descriptor
        value through simulation.
  - [x] Source the optional Mineflayer entity-state flag without breaking
        existing state implementations.
- [ ] Port knockback, velocity impulses, and velocity damping.
  - [x] Zero sub-threshold velocity components before native movement using
        the configurable Mineflayer-compatible threshold.
  - [x] Reject non-finite velocity inputs at the native movement boundary,
        matching Entity.setDeltaMovement's finite-value guard.
  - [x] Preserve existing velocity when a non-finite delta impulse is supplied,
        matching Entity.addDeltaMovement's finite-value guard.
- [ ] Port movement input normalization and yaw/pitch transforms.
  - [x] Bound horizontal input magnitude before applying movement speed and
        preserve yaw rotation ordering.
- [ ] Port movement statistics only when they affect exhaustion or state.
  - [x] Preserve native fall-distance and computed fall-damage outputs in the
        Mineflayer-facing state bridge.
  - [x] Copy fall metrics through player and entity prediction clones.
- [ ] Port food/exhaustion movement effects where applicable.
- [ ] Port shield-use, item-use, and attack movement penalties.
  - [x] Preserve item-use state through N-API and apply the vanilla 0.2 input
        speed multiplier.
- [ ] Port eye height, camera height, and fluid-eye checks.
  - [x] Compute eye-in-water and eye-in-lava from fluid surface height and
        return the predicates through the native bridge.
- [ ] Port world-border collision and unloaded-world fallback behavior.

## Status effects and attributes

- [ ] Implement the complete movement-relevant attribute system.
- [ ] Implement base values, additive modifiers, multiplicative modifiers, and
      operation order.
  - [x] Resolve Mineflayer attribute objects using Java's operation order:
        additive base, additive-base multipliers, then multiplicative-total
        modifiers.
  - [x] Forward the server-provided movement-speed attribute instead of
        confusing the Speed effect amplifier with the base attribute.
- [ ] Implement version-specific attribute names and defaults.
- [ ] Implement movement speed, gravity, step height, safe fall distance, scale,
      jump strength, water movement efficiency, and attack-related movement
      attributes where present.
  - [x] Forward a finite player `jump_strength` attribute with the vanilla
        `0.42` fallback when the attribute is unavailable.
  - [x] Resolve a finite `step_height` attribute before using the state/config
        fallback for collision stepping.
  - [x] Forward `safe_fall_distance` when present and use the source `3.0`
        default for releases introducing the modern safe-fall attribute.
  - [x] Add the modern `movement_efficiency` attribute to the typed native
        boundary and apply its Soul Speed block-friction behavior from the
        1.21.4/26.x source breakpoint.
  - [x] Carry modern `air_drag_modifier` and `friction_modifier` attributes
        through the native boundary, including their source defaults and
        modified-friction formula.
- [ ] Implement speed, slowness, jump boost, levitation, slow falling, dolphins
      grace, conduit power, blindness, darkness, and movement-relevant effects.
  - [x] Keep the Speed/Slowness amplifier levels separate from the base
        movement-speed attribute at the TypeScript/native boundary.
  - [x] Apply source-derived Levitation amplifier targets and easing in native
        movement.
  - [x] Apply the source-derived Slow Falling gravity cap (`min(gravity, 0.01)`)
        rather than a default-gravity-only multiplier.
  - [x] Preserve the Levitation amplifier through the native N-API and
        Mineflayer adapter boundary.
- [ ] Implement effect amplifier and duration semantics.
- [ ] Implement effect tick ordering and expiration.
- [ ] Implement equipment and enchantment modifiers.
- [ ] Implement Depth Strider, Soul Speed, Swift Sneak, Frost Walker, and all
      movement-relevant enchantments per version.
  - [x] Preserve Soul Speed through the typed state boundary; retain the
        legacy block-speed override and apply the modern movement-efficiency
        plus level-based movement-speed effects at their source breakpoint.
  - [x] Apply the typed `sneaking_speed` attribute for sneaking movement,
        retaining the vanilla `0.3` default when absent.
- [ ] Implement effect interactions with fluids, blocks, poses, and vehicles.

## Fluids

- [ ] Implement water source, flowing, falling, and level behavior.
  - [x] Add version-neutral fluid level, falling flag, and flow-vector
        representation to the native world snapshot and N-API block updates.
  - [x] Add an explicit source-fluid bit to the native block state and N-API
        update bridge, with source height semantics and validation.
  - [x] Encode omitted non-empty fluid levels as canonical source states
        (`fluid_source=true`, `fluid_level=0`) at the N-API boundary.
  - [x] Smoke-test source/flowing round-trips and reject source flags on empty
        fluid states.
  - [x] Reject the impossible vanilla combination of source and falling fluid
        flags at the N-API boundary.
  - [x] Preserve the distinct own height of falling level-eight fluid states.
  - [x] Accept vanilla falling flowing levels through 15 and decode their
        amount-based own heights while preserving the existing 0-8 bridge
        representation.
  - [x] Reject invalid falling flags on empty fluid states at the N-API boundary.
- [ ] Implement lava source, flowing, falling, and level behavior.
- [ ] Implement waterlogged block behavior.
  - [x] Treat waterlogged states as continuation of the water fluid tag for
        same-fluid-above height and bounds queries.
- [ ] Implement fluid height and eye-in-fluid checks.
  - [x] Expose per-block fluid height and flow through the native world model.
  - [x] Return full fluid height when the same fluid state continues above,
        matching `FlowingFluid.getHeight`.
  - [x] Use fluid surface height for body and swimming-head immersion checks.
  - [x] Ignore fluid surfaces below the queried entity bounds.
  - [x] Reset fall distance on water contact.
- [ ] Implement fluid flow vectors and current acceleration.
  - [x] Expose fluid height and flow queries through the N-API world boundary.
  - [x] Normalize currents above the vanilla threshold before applying
        water/lava push coefficients.
- [ ] Implement water drag and input speed per version.
  - [x] Implement source-derived sprint, Depth Strider, airborne halving,
        and Dolphin's Grace horizontal drag rules.
  - [x] Apply the matching Depth Strider water input-speed interpolation.
  - [x] Apply water fluid gravity adjustment after movement using the
        source-derived gravity/16 operation.
- [ ] Implement lava drag and input speed per version.
  - [x] Preserve source no-gravity and sprinting bypass conditions in fluid
        vertical adjustment.
  - [x] Apply lava horizontal drag, fluid-height threshold, and vertical
        scaling branches.
- [x] Apply swimming vertical steering only in the player travel path; vanilla
      `LivingEntity.travel` does not apply this look-based adjustment to every
      entity.
- [x] Preserve ordinary air vertical drag after player swimming steering;
      swimming in air does not introduce an additional `0.9` multiplier.
- [x] Own the sprinting water slowdown (`0.9F`) in every concrete release
      profile rather than hardcoding it in shared simulation logic.
- [x] Use the source `Player.travel` swimming head-block lookup at `Y + 0.9`
      instead of reusing the generic eye-fluid predicate.
- [x] Keep the lava `-gravity / 4` term active while sprinting; only the
      fluid-falling adjustment is sprint-suppressed by vanilla.
- [x] Route lava gravity through each concrete profile's declared divisor
      rather than embedding a shared `/ 4.0` constant.
- [x] Preserve the source breakpoint for fluid-falling adjustment: 1.19-1.20.6
      checks the gravity argument, while older and 1.21 profiles check the
      entity no-gravity flag.
- [x] Add a runtime differential fixture for the 1.18.2/1.19 fluid-falling
      gravity-condition transition.
- [x] Preserve fluid climbable branch ordering: horizontal-collision adjustment
      occurs before fluid drag, and land jump handling is not reused in fluid.
- [x] Transport explicit passenger state through entity state, TypeScript, and
      native simulation so `Player.travel` can skip swimming steering while
      riding.
  - [x] Apply the source-derived look-angle coefficients and submerged-head
        condition for the current player movement slice.
- [ ] Implement fluid jump thresholds.
  - [x] Derive the jump threshold from the entity eye height and cover the
        short-entity zero-threshold case with regression tests.
- [ ] Implement bubble columns, direction, drag, and entity effects.
  - [x] Apply surface versus enclosed bubble-column acceleration and velocity
  - [x] Determine bubble-column surface state from actual air occupancy rather
        than the absence of a block effect.
  - [x] Reset fall distance when an entity is inside a bubble column.
        caps for upward and downward columns.
  - [x] Preserve the source `DRAG_DOWN` block-state property when adapting
        prismarine block metadata into native bubble-column effects.
- [ ] Implement fluid interactions with ladders, vines, scaffolding, and webs.
  - [x] Add explicit no-gravity state and source-derived fluid falling
        adjustment conditions for water and lava movement.
  - [x] Reset fall distance when cobweb movement applies stuck-in-block
        velocity scaling.
  - [x] Preserve the player-only ladder sliding suppression and keep
        scaffolding exempt from that suppression.
- [ ] Implement fluid interaction with boats, striders, fish, and other aquatic
      entities.
- [ ] Implement fluid collision and standing-on-fluid rules.
- [ ] Implement fluid behavior around partial and waterlogged shapes.
- [ ] Generate fluid tags and fluid-state tables per version.

## Blocks and movement surfaces

- [ ] Generate every block-state collision shape.
- [ ] Generate every block-state outline/support shape used by movement.
- [ ] Generate friction and slipperiness exactly.
- [ ] Implement ice, packed ice, blue ice, and version-specific slipperiness.
- [x] Distinguish source-backed soul sand speed-factor ordering from soul soil,
      which has no movement speed factor.
- [ ] Implement honey block movement and side adhesion.
  - [x] Implement source-backed edge-slide detection across adjacent honey
        blocks, horizontal throttling, vertical slide velocity, and fall reset.
- [ ] Implement slime block bounce and sneaking behavior.
  - [x] Implement source-backed sneaking suppression, living/non-living bounce
        scaling, and step-on horizontal damping for the supported movement path.
  - [x] Expose the source `isSteppingCarefully` gate so slime step-on damping
        is independently suppressible from generic sneaking state.
  - [x] Use the post-collision support block and suppress fall distance/damage
        on vanilla slime bounces.
- [ ] Implement cobweb movement.
  - [x] Clear velocity after applying the source `makeStuckInBlock` multiplier
        during the movement step.
  - [x] Skip stuck-block multipliers only for flying players, matching the
        source `Player.makeStuckInBlock` guard while preserving base entity
        behavior for other flying entities.
  - [x] Expose the modern Weaving effect and apply its source
        `(0.5, 0.25, 0.5)` multiplier.
- [x] Expose sweet-berry-bush immunity for source entities such as foxes and
      bees while preserving the vanilla multiplier for affected living entities.
  - [x] Return world-derived cobweb occupancy through native state updates.
- [x] Implement ladders, vines, scaffolding, and climbable blocks.
- [x] Implement source-backed powder-snow stuck movement multiplier
      (`0.9, 1.5, 0.9`) and fall-distance reset.
- [x] Implement source-backed sweet-berry-bush stuck movement multiplier
      (`0.8, 0.75, 0.8`) and fall-distance reset.
- [ ] Implement powder snow freezing damage and immunity behavior.
  - [x] Expose powder-snow contact and immunity state and suppress the source
        stuck multiplier for immune entities.
  - [x] Preserve source walkability for leather-boot entities and walkable
        entity types through the native collision path.
  - [x] Track source-compatible freeze-tick accumulation, clamping, and
        two-tick decay when no longer freezing.
  - [x] Expose periodic fully-frozen damage as an accumulated native state
        signal at the vanilla 40-tick cadence; server damage application remains
        outside the movement-only adapter boundary.
- [ ] Implement berry bush, cactus, magma, campfire, and damage surfaces where
      movement state is affected.
  - [x] Expose source-specific cactus/campfire/magma contact damage as a
        deterministic native damage signal, including lit-campfire gating and
        sneaking magma immunity.
  - [x] Preserve the vanilla soul-campfire fire-damage value of `2.0`, distinct
        from the normal campfire/cactus value of `1.0`.
  - [x] Model fire and soul-fire contact damage (`1.0`/`2.0`) and clear
        freeze ticks when fire contact applies the vanilla clear-freeze effect.
  - [x] Expose contact damage as a per-tick signal while retaining cumulative
        freeze-damage signaling.
  - [x] Query inside-block effects across the complete entity bounds, matching
        vanilla `Entity.checkInsideBlocks` coverage rather than one body cell.
  - [x] Apply vanilla's `1.0E-5` bounding-box deflation so touching a block
        face does not incorrectly count as inside-block contact.
- [ ] Implement carpets, snow layers, slabs, stairs, fences, walls, gates,
      trapdoors, doors, beds, signs, rails, and all partial shapes.
- [ ] Implement piston movement and moving-block collision.
- [ ] Implement honey/slime piston interactions where entity movement changes.
- [ ] Implement block tags and predicates used by vanilla movement methods.

## Collision and stepping

- [ ] Port vanilla swept movement against voxel shapes.
- [ ] Port exact axis clipping order.
- [ ] Port horizontal collision and vertical collision flags.
  - [x] Bridge version-gated local-player minor horizontal collision state
        through native Rust, N-API-RS, and TypeScript.
  - [x] Centralize the 1.18+ minor-collision version capability and concrete
        version parsing in the native version model.
  - [x] Preserve `verticalCollisionBelow` independently during native state
        conversion.
- [ ] Port step-up candidate generation and selection.
- [ ] Port step-down and landing behavior.
- [ ] Port sneaking edge prevention.
- [ ] Port collision behavior at exact block boundaries.
- [ ] Port entity collision and push resolution.
- [ ] Port collision against moving pistons and entities.
- [ ] Port world-border collision.
- [ ] Port shape emptiness, face culling, and support checks.
- [ ] Test all combinations of partial blocks, diagonal movement, corners,
      stairs, slabs, fences, walls, and negative coordinates.

## Elytra and fall flying

- [ ] Port fall-flying eligibility and activation.
  - [x] Port source-ordered fall-flying look steering, dive correction,
        velocity redirect, and version-neutral glide drag.
- [ ] Port pitch/look-vector glide equations per version.
- [ ] Port horizontal steering, lift, drag, and descent limits.
- [ ] Port collision damage and wall impact handling.
- [ ] Port landing, fall-distance, and flag reset behavior.
- [ ] Port firework propulsion, duration, and vector semantics.
- [ ] Port rocket/entity interaction and invalid propulsion handling.
- [ ] Port Elytra durability state only where it affects flight.

## Vehicles

- [ ] Port boat status detection and water-height calculations.
- [ ] Port boat paddling, steering, acceleration, drag, and land movement.
- [x] Separate native boat control acceleration from status physics so the
      world-aware path applies vanilla drag exactly once per tick.
- [ ] Port boat bubble columns, waves, fall, and collision behavior.
- [x] Route boat water status, buoyancy, and block clipping through the native
      world snapshot; source-specific bubble/wave and full status handling
      remains open.
- [x] Preserve native boat bubble-column state across ticks and apply the
      source-derived 60-tick activation and directional launch impulse.
- [x] Forward player-passenger state to native boat bubble handling and apply
      the source 2.7 upward launch impulse for player passengers.
- [x] Apply native boat horizontal and vertical collision results back through
      the N-API state boundary.
- [x] Return native boat ground-contact state and apply it to Mineflayer.
- [x] Return native horse ground-contact state and apply it to Mineflayer.
- [x] Clear stale native vehicle ground contact before each movement tick;
      only downward collision restores `onGround`.
- [x] Derive native horse water state from the world snapshot before movement.
- [x] Return the source-derived boat water surface level through the native
      boundary and preserve it in `BoatState.waterLevel`.
- [x] Preserve boat status transitions across ticks and perform the
      source-ordered air-to-water repositioning when collision-free.
- [x] Classify native boat water status as `IN_WATER`, `UNDER_WATER`,
      `UNDER_FLOWING_WATER`, `ON_LAND`, or `IN_AIR`, and apply status-specific
      buoyancy/drag behavior through the native boundary.
- [x] Regression-test source and flowing-water status classification.
- [x] Regression-test native boat horizontal collision against a full block.
- [x] Port source-backed boat passenger positioning and yaw-aware offset
      rotation.
- [ ] Port horse, donkey, mule, skeleton horse, and zombie horse travel.
- [x] Route horse movement through native world collision resolution and return
      native collision flags through the state boundary.
- [x] Regression-test native horse ground contact against a full block.
- [x] Preserve upward-versus-downward horse collision direction when setting
      `onGround`; ceiling collisions must not become ground contact.
- [x] Query swept vehicle bounds for native boat and horse collision resolution
      so fast motion cannot tunnel through loaded block shapes.
- [ ] Port horse jump strength, jump power, movement speed, and attributes.
  - [x] Forward `HorseState` movement-speed and jump-strength attributes
        through the native horse tick instead of player-effect/default values.
- [ ] Port horse rider input and diagonal movement.
- [ ] Port horse water behavior and dismount behavior.
- [ ] Port pig, strider, camel, and all rideable entities in supported versions.
- [ ] Port minecart rail following, slopes, acceleration, drag, and collision.
- [ ] Port powered, furnace, hopper, TNT, chest, and command minecart behavior
      where movement differs.
- [ ] Port post-1.21.2 experimental/reworked minecart behavior when supported.
- [ ] Port mount/flying behavior introduced in later versions.
- [x] Port source-backed vehicle passenger update ordering: move the vehicle
      before attaching the passenger position.

## Projectiles and moving entities

- [ ] Port arrow, spectral arrow, tipped arrow, trident, snowball, egg, pearl,
      potion, firework, fishing hook, and other projectile motion.
- [x] Preserve the 26.2 `ThrowableProjectile` first-tick bubble-column
      interaction before gravity/inertia, including above-column and inside-
      column vertical limits.
- [x] Gate first-tick bubble-column handling to the source-backed 26.1+
      projectile implementation; legacy releases use the pre-26.1 tick order.
- [x] Match `Mth.clamp(double, ...)` NaN propagation in the shared native math
      layer and cover the boundary with a regression.
- [x] Match `AABB.clip` strict face-coordinate bounds and source tolerance in
      native segment clipping.
- [x] Carry persistent boat `deltaRotation` and backward input through the
      native boundary, and match the 26.2 boat control acceleration ordering.
- [x] Route production boat and horse ticks through version-validated native
      entry points; unversioned vehicle exports remain compatibility/test APIs.
- [x] Keep horse yaw separate from movement input and normalize diagonal
      forward/strafe input before native movement-relative projection.
- [x] Return projectile `firstTick` state from the N-API tick result so the
      one-time source prelude is explicitly carryable by callers.
- [x] Exercise projectile first-tick state propagation through the native
      smoke integration path.
- [x] Exercise native boat `deltaRotation` propagation through the smoke
      integration path.
- [x] Add a source-specialized arrow tick path with in-ground state and the
      26.2 water/air/gravity ordering.
- [x] Use the 26.2 `AbstractArrow` `WATER_INERTIA = 0.6F` constant for the
      specialized arrow default, independently of living-entity water drag.
- [x] Carry the arrow `life` counter and 1200-tick in-ground despawn boundary.
- [x] Carry arrow `inGroundTime` and `shakeTime` lifecycle state through the
      native boundary.
- [x] Initialize the source seven-tick arrow shake window when a block impact
      transitions the arrow into the ground.
- [x] Implement the source arrow `startFalling` transition when the embedded
      collision shape disappears, with an explicit deterministic impulse
      boundary.
- [x] Carry the supporting block-state identity so replacement collision
      shapes trigger the source `lastState` change branch.
- [x] Add a source-specialized trident motion path with the 26.1.2/modern
      water inertia (`0.99F`), gravity, drag, and block-trace ordering.
- [x] Repair the native N-API trident export nesting bug and revalidate the
      native suite after the fix.
- [x] Add explicit projectile-family dispatch tags for common thrown-item
      families (snowball, egg, ender pearl, potion, firework, fishing hook,
      etc.) while preserving the shared `ThrowableProjectile` ordering.
- [x] Port the 26.2 firework rocket acceleration rule: horizontal boost
      scaling and the upward `+0.04` impulse before gravity/inertia.
- [ ] Port projectile gravity, drag, water drag, and collision.
- [ ] Port projectile target tolerance and version-specific changes.
- [ ] Port entity hitboxes and block hitboxes for projectile ray tracing.
- [ ] Port TNT, falling blocks, experience orbs, items, and environmental
      moving entities where Mineflayer prediction requires them.
- [ ] Port dragon, vex, guardian, fish, squid, flying mobs, and special travel
      overrides exposed by the supported entity set.

## N-API-RS and TypeScript surface

- [ ] Define version-specific Rust constructors and lifecycle ownership.
- [ ] Define version-specific TypeScript classes with stable names.
- [ ] Implement `FROM_BOT -> version -> engine` construction.
- [ ] Add direct constructors for every supported version.
- [ ] Expose complete world, block-state, fluid, entity, player, and vehicle
      inputs without lossy coercion.
  - [x] Expose fluid level, flow, falling state, flying state, and flying
        speed through the Rust and TypeScript boundaries.
- [ ] Expose complete output state, including all flags and derived values.
- [ ] Expose bulk tick and multi-entity tick operations.
  - [x] Expose concrete-version `simulateVersionedTicks` for bulk state
        ticking with per-state version dispatch and collision flag propagation.
- [ ] Avoid JavaScript callbacks in the inner simulation loop.
- [ ] Validate all inputs and report errors with actionable messages.
  - [x] Reject out-of-range fluid levels at the N-API block-update boundary.
- [ ] Preserve ownership and lifetime guarantees across N-API boundaries.
- [ ] Generate declarations from the Rust bindings and verify them in TypeScript.
- [ ] Remove obsolete generic version gates once version-specific engines cover
      the same behavior.
- [x] Keep unsupported versions unavailable instead of silently falling back;
      TypeScript now validates against the explicit source-backed registry
      before constructing an engine.
- [ ] Provide migration adapters only outside the core 1:1 engine.
- [ ] Wire Mineflayer entity snapshots and world updates into the engine.
- [ ] Wire engine outputs back to Mineflayer entities without mutating unrelated
      state.
- [ ] Add serialization for deterministic replay inputs and outputs.

## Differential and conformance testing

- [ ] Build a vanilla harness for each supported version.
- [ ] Run identical initial state, world, input, and tick sequences in vanilla
      and Rust.
- [ ] Capture every observable state field after every tick.
- [ ] Compare position, velocity, rotation, dimensions, pose, collision flags,
      fluid flags, fall state, effects, passengers, and vehicle state.
- [ ] Compare intermediate phases when final state matches accidentally.
- [ ] Add golden traces for every movement mode.
- [ ] Add tests for empty worlds, full blocks, partial blocks, stairs, slabs,
      fences, walls, fluids, waterlogged blocks, and world borders.
- [ ] Add tests for positive, negative, zero, subnormal, and very large
      coordinates.
- [ ] Add tests for diagonal input, yaw/pitch boundaries, and precision edges.
- [ ] Add tests for every effect, attribute, enchantment, pose, and ability.
- [ ] Add tests for every vehicle and projectile.
- [ ] Add tests for chunk loading/unloading and incremental updates.
- [ ] Add long-run deterministic replay tests.
- [ ] Add randomized property tests against the vanilla harness.
- [ ] Add version-to-version differential tests to detect unintended sharing.
- [ ] Require zero unexplained mismatches before marking a version complete.
- [ ] Store mismatch traces, source references, and fixes in the repository.

## Performance and reliability

- [ ] Benchmark single-entity and multi-entity ticks per supported version.
- [ ] Benchmark world queries, collision queries, and N-API boundary overhead.
- [ ] Measure allocations and memory usage for long simulations.
- [ ] Ensure generated tables are compact and cache-friendly.
- [ ] Ensure deterministic results across supported platforms.
- [ ] Add overflow, malformed world, and invalid-state robustness tests.
- [ ] Add cancellation and resource cleanup for long-running bulk simulations.
- [ ] Verify thread-safety rules and document whether engines are `Send`/`Sync`.
- [ ] Add reproducible release builds with locked dependencies.

## Documentation and package integrity

- [ ] Document the supported versions and their completion status.
- [ ] Document that each version class is source/data generated and independent.
- [ ] Document the world synchronization contract.
- [ ] Document all input and output fields.
- [ ] Document unsupported behavior explicitly.
- [ ] Exclude decompiled sources, temporary jars, and generator caches from npm.
- [ ] Include only generated runtime data required by the package.
- [ ] Verify the published package contains all native binaries, loaders, types,
      generated tables, and version classes.
- [ ] Test installation and loading from a clean consumer project.
- [ ] Test Windows, Linux, and macOS packaging.

## Per-version completion gate

For each version, all items below must be true before it is advertised as
supported:

- [ ] Required vanilla source and mappings are available and fingerprinted.
- [ ] All required generated block, fluid, entity, attribute, and shape data is
      present and integrity-checked.
- [ ] The version has its own Rust engine module.
- [ ] The version has its own TypeScript constructor and factory entry.
- [ ] No shared fallback is used for any version-specific behavior.
- [ ] Entity, player, fluid, collision, vehicle, projectile, effect, attribute,
      pose, and tick-order behavior is implemented.
- [ ] Vanilla differential traces pass with zero unexplained mismatches.
- [ ] Long-run deterministic replay passes.
- [ ] N-API and TypeScript integration tests pass.
- [ ] Package loading works from a clean installation.
- [ ] Performance and memory regressions are understood and accepted.
- [ ] Source provenance and known limitations are documented.

## Final release gate

- [ ] Every requested version has passed its per-version completion gate.
- [ ] No requested subsystem remains marked partial, approximate, or inherited
      without a verified identical source implementation.
- [ ] No generic version gate changes behavior for a completed version.
- [ ] All generated artifacts are reproducible from scripts and pinned inputs.
- [ ] Rust tests, TypeScript tests, differential tests, fuzz tests, benchmarks,
      lint, build, and package verification pass.
- [ ] A clean checkout can regenerate the complete engine and package.
- [ ] A clean consumer project can instantiate an engine directly and through
      `FROM_BOT`.
- [ ] The release notes list exact supported versions and verification evidence.
