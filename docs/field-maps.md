# Field maps

The public inputs other than the player's, which docs/state-contract.md maps. Each number is a double at the binding, kept
as the Rust type its field names in `native/src/napi_api.rs`. An optional field may be absent, which is never read as a
zero: a legal zero stays one. These families are object APIs with no packed form.

"kept" is read from a real tick on 1.21.5: `yes` means the tick hands the field back, so the caller passes it to the next
tick and the state persists through it. `no` means it is an input of that tick, or absent in that tick's scene, so the
caller owns it. An update or a shape is no state and has no such column. `test/state-transitions.test.cjs` fails if a table
loses or gains a field.

## NativeBoatState

| field | type | unit | absent | kept |
|---|---|---|---|---|
| `nearbyEntities` | NativeNearbyEntity[] or null | see the type | allowed | no |
| `position` | NativeVec3 | blocks | required | yes |
| `velocity` | NativeVec3 | blocks a tick | required | yes |
| `yaw` | number | radians | required | yes |
| `forward` | boolean | flag | required | yes |
| `left` | boolean | flag | required | yes |
| `right` | boolean | flag | required | yes |
| `inputDown` | boolean | flag | allowed | yes |
| `deltaRotation` | number | blocks a tick | allowed | yes |
| `inWater` | boolean | flag | required | yes |
| `waterLevel` | number | blocks | allowed | yes |
| `status` | 'in_water' or 'under_water' or 'under_flowing_water' or 'on_land' or 'in_air' | name | allowed | yes |
| `previousStatus` | 'in_water' or 'under_water' or 'under_flowing_water' or 'on_land' or 'in_air' | name | allowed | yes |
| `bubbleTime` | number | ticks | allowed | yes |
| `bubbleColumnDirectionIsDown` | boolean | flag | allowed | yes |
| `aboveBubbleColumn` | boolean | flag | allowed | yes |
| `serverSide` | boolean | flag | allowed | yes |
| `playerPassenger` | boolean | flag | allowed | yes |
| `collidedHorizontally` | boolean | flag | allowed | yes |
| `collidedVertically` | boolean | flag | allowed | yes |
| `onGround` | boolean | flag | allowed | yes |
| `yawDegrees` | number | degrees | allowed | yes |
| `landFriction` | number | as vanilla holds it | allowed | yes |
| `lastVerticalVelocity` | number | blocks a tick | allowed | yes |
| `boundingBox` | NativeAabb | see the type | allowed | no |
| `speedMultiplier` | number | attribute value, a double | allowed | yes |
| `riderYaw` | number | degrees | allowed | yes |
| `riderForward` | number | as vanilla holds it | allowed | yes |
| `riderStrafe` | number | as vanilla holds it | allowed | yes |
| `stuckSpeedMultiplier` | NativeVec3 | attribute value, a double | allowed | yes |
| `ultraWarm` | boolean | flag | allowed | yes |
| `noGravity` | boolean | flag | allowed | yes |
| `paddlePhases` | number[] | as vanilla holds it | allowed | yes |
| `silent` | boolean | flag | allowed | yes |

## NativeHorseState

| field | type | unit | absent | kept |
|---|---|---|---|---|
| `nearbyEntities` | NativeNearbyEntity[] or null | see the type | allowed | no |
| `position` | NativeVec3 | blocks | required | yes |
| `velocity` | NativeVec3 | blocks a tick | required | yes |
| `yaw` | number | radians | required | yes |
| `forward` | number | as vanilla holds it | required | yes |
| `strafe` | number | as vanilla holds it | required | yes |
| `jumpRequested` | boolean | flag | required | yes |
| `onGround` | boolean | flag | required | yes |
| `inWater` | boolean | flag | required | yes |
| `movementSpeed` | number | attribute value, a double | allowed | yes |
| `jumpStrength` | number | as vanilla holds it | allowed | yes |
| `halfWidth` | number | blocks | allowed | yes |
| `height` | number | blocks | allowed | yes |
| `collidedHorizontally` | boolean | flag | allowed | yes |
| `collidedVertically` | boolean | flag | allowed | yes |
| `entityType` | string | name | allowed | yes |
| `yawDegrees` | number | degrees | allowed | yes |
| `pitchDegrees` | number | degrees | allowed | yes |
| `riderYaw` | number | degrees | allowed | yes |
| `riderPitch` | number | degrees | allowed | yes |
| `riderSprinting` | boolean | flag | allowed | yes |
| `riderJump` | number | as vanilla holds it | allowed | no |
| `inLava` | boolean | flag | allowed | yes |
| `lavaHeightPositive` | boolean | flag | allowed | yes |
| `waterHeight` | number | as vanilla holds it | allowed | no |
| `fallDistance` | number | blocks | allowed | yes |
| `boundingBox` | NativeAabb | see the type | allowed | no |
| `stuckSpeedMultiplier` | NativeVec3 | attribute value, a double | allowed | yes |
| `slowFalling` | boolean | flag | allowed | yes |
| `levitationAmplifier` | number | as vanilla holds it | allowed | no |
| `dolphinsGrace` | boolean | flag | allowed | yes |
| `weaving` | boolean | flag | allowed | yes |
| `gravity` | number | attribute value, a double | allowed | no |
| `stepHeight` | number | blocks | allowed | no |
| `waterMovementEfficiency` | number | as vanilla holds it | allowed | yes |
| `airDragModifier` | number | attribute value, a double | allowed | no |
| `frictionModifier` | number | as vanilla holds it | allowed | no |
| `previousPosition` | NativeVec3 | blocks | allowed | yes |
| `flyingSpeed` | number | attribute value, a double | allowed | yes |
| `saddled` | boolean | flag | allowed | yes |
| `noAi` | boolean | flag | allowed | yes |
| `riddenSpeed` | number | attribute value, a double | allowed | yes |
| `ownForward` | number | as vanilla holds it | allowed | yes |
| `boosting` | boolean | flag | allowed | yes |
| `boostTime` | number | ticks | allowed | yes |
| `boostTimeTotal` | number | ticks | allowed | yes |
| `suffocating` | boolean | flag | allowed | yes |
| `suffocatingSpeed` | number | attribute value, a double | allowed | no |
| `jumpPendingScale` | number | as vanilla holds it | allowed | yes |
| `horseJumping` | boolean | flag | allowed | yes |
| `standing` | boolean | flag | allowed | yes |
| `allowStandSliding` | boolean | flag | allowed | yes |
| `standCounter` | number | ticks | allowed | yes |
| `dashCooldown` | number | ticks | allowed | yes |
| `dashing` | boolean | flag | allowed | yes |
| `sitting` | boolean | flag | allowed | yes |
| `poseTime` | number | ticks | allowed | yes |
| `lerpPosition` | NativeVec3 | see the type | allowed | no |
| `ultraWarm` | boolean | flag | allowed | yes |
| `jumpBoostAmplifier` | number | as vanilla holds it | allowed | no |
| `noGravity` | boolean | flag | allowed | yes |

## NativeMinecartState

| field | type | unit | absent | kept |
|---|---|---|---|---|
| `variant` | string | name | required | yes |
| `position` | NativeVec3 | blocks | required | yes |
| `velocity` | NativeVec3 | blocks a tick | required | yes |
| `yRot` | number | degrees | required | yes |
| `xRot` | number or null | degrees | allowed | yes |
| `flipped` | boolean | flag | required | yes |
| `onRails` | boolean or null | flag | allowed | yes |
| `onGround` | boolean | flag | required | yes |
| `firstTick` | boolean or null | flag | allowed | yes |
| `inWater` | boolean | flag | required | yes |
| `collidedHorizontally` | boolean or null | flag | allowed | yes |
| `collidedVertically` | boolean or null | flag | allowed | yes |
| `stuckSpeedMultiplier` | NativeVec3 or null | attribute value, a double | allowed | yes |
| `noGravity` | boolean or null | flag | allowed | yes |
| `ultraWarm` | boolean or null | flag | allowed | yes |
| `fallDistance` | number or null | blocks | allowed | yes |
| `boundingBox` | NativeAabb or null | see the type | allowed | no |
| `rider` | NativeMinecartRider or null | see the type | allowed | no |
| `fuel` | number or null | as vanilla holds it | allowed | no |
| `push` | NativeVec3 or null | see the type | allowed | no |
| `comparatorSignal` | number or null | as vanilla holds it | allowed | no |
| `hasLootTable` | boolean or null | flag | allowed | yes |
| `tickCount` | number or null | ticks | allowed | yes |
| `hurtTime` | number or null | ticks | allowed | yes |
| `hurtDir` | number or null | as vanilla holds it | allowed | yes |
| `damage` | number or null | as vanilla holds it | allowed | yes |
| `invulnerable` | boolean or null | flag | allowed | yes |
| `fuse` | number or null | ticks | allowed | no |
| `explosionPowerBase` | number or null | as vanilla holds it | allowed | no |
| `explosionSpeedFactor` | number or null | attribute value, a double | allowed | no |
| `randomSeed` | number or null | as vanilla holds it | allowed | no |
| `enabled` | boolean or null | flag | allowed | no |
| `inventory` | (NativeMinecartStack or undefined or null)[] or null | see the type | allowed | no |
| `lastActivated` | number or null | as vanilla holds it | allowed | yes |
| `portal` | string or null | name | allowed | no |
| `insidePortal` | boolean or null | flag | allowed | yes |
| `portalTime` | number or null | ticks | allowed | yes |
| `portalCooldown` | number or null | ticks | allowed | yes |
| `removed` | string or null | name | allowed | no |

## NativeMovingEntityState

| field | type | unit | absent | kept |
|---|---|---|---|---|
| `kind` | 'tnt' or 'falling_block' or 'item' or 'experience_orb' or (string & {}) | name | required | yes |
| `authority` | 'client' or 'server' or (string & {}) or null | name | allowed | yes |
| `id` | number or null | as vanilla holds it | allowed | yes |
| `tickCount` | number or null | ticks | allowed | yes |
| `position` | NativeVec3 | blocks | required | yes |
| `velocity` | NativeVec3 | blocks a tick | required | yes |
| `boundingBox` | NativeAabb or null | see the type | allowed | no |
| `onGround` | boolean or null | flag | allowed | yes |
| `collidedHorizontally` | boolean or null | flag | allowed | yes |
| `collidedVertically` | boolean or null | flag | allowed | yes |
| `verticalCollisionBelow` | boolean or null | flag | allowed | yes |
| `inWater` | boolean or null | flag | allowed | yes |
| `inLava` | boolean or null | flag | allowed | yes |
| `noGravity` | boolean or null | flag | allowed | yes |
| `noPhysics` | boolean or null | flag | allowed | yes |
| `stuckSpeedMultiplier` | NativeVec3 or null | attribute value, a double | allowed | yes |
| `fallDistance` | number or null | blocks | allowed | yes |
| `ultraWarm` | boolean or null | flag | allowed | yes |
| `firstTick` | boolean or null | flag | allowed | yes |
| `lastMovements` | NativeMovingEntityMovement[] or null | see the type | allowed | yes |
| `removed` | boolean or null | flag | allowed | yes |
| `fuse` | number or null | ticks | allowed | yes |
| `time` | number or null | ticks | allowed | yes |
| `carriedBlock` | number or null | as vanilla holds it | allowed | yes |
| `carriedAir` | boolean or null | flag | allowed | yes |
| `concretePowder` | boolean or null | flag | allowed | yes |
| `discarding` | boolean or null | flag | allowed | yes |
| `age` | number or null | ticks | allowed | yes |
| `pickupDelay` | number or null | ticks | allowed | yes |
| `itemEmpty` | boolean or null | flag | allowed | yes |
| `followingPlayer` | number or null | as vanilla holds it | allowed | no |
| `followingTime` | number or null | ticks | allowed | yes |
| `orbTicks` | number or null | ticks | allowed | yes |

## NativeProjectileState

| field | type | unit | absent | kept |
|---|---|---|---|---|
| `boundingBox` | NativeAabb | see the type | allowed | no |
| `position` | NativeVec3 | blocks | required | yes |
| `velocity` | NativeVec3 | blocks a tick | required | yes |
| `gravity` | number | attribute value, a double | allowed | no |
| `airDrag` | number | attribute value, a double | allowed | no |
| `power` | NativeVec3 | see the type | allowed | no |
| `accelerationPower` | number | as vanilla holds it | allowed | no |
| `dangerous` | boolean | flag | allowed | no |
| `inWater` | boolean | flag | allowed | yes |
| `ultraWarm` | boolean | flag | allowed | no |
| `firstTick` | boolean | flag | allowed | yes |
| `kind` | string | name | allowed | no |
| `horizontalCollision` | boolean | flag | allowed | yes |
| `onGround` | boolean | flag | allowed | yes |
| `shotAtAngle` | boolean | flag | allowed | no |
| `bobbing` | boolean | flag | allowed | yes |
| `bobRandom` | number | as vanilla holds it | allowed | no |
| `noPhysics` | boolean | flag | allowed | no |

## NativeArrowState

| field | type | unit | absent | kept |
|---|---|---|---|---|
| `position` | NativeVec3 | blocks | required | yes |
| `velocity` | NativeVec3 | blocks a tick | required | yes |
| `gravity` | number | attribute value, a double | allowed | no |
| `airDrag` | number | attribute value, a double | allowed | no |
| `waterInertia` | number | attribute value, a double | allowed | no |
| `inWater` | boolean | flag | allowed | yes |
| `inGround` | boolean | flag | allowed | yes |
| `life` | number | ticks | allowed | yes |
| `inGroundTime` | number | ticks | allowed | yes |
| `shakeTime` | number | ticks | allowed | yes |
| `fallImpulse` | NativeVec3 | blocks a tick | allowed | no |
| `lastBlockId` | number | as vanilla holds it | allowed | no |
| `lastBlockPosition` | NativeBlockPosition | see the type | allowed | no |
| `noPhysics` | boolean | flag | allowed | no |
| `ultraWarm` | boolean | flag | allowed | no |

## NativeTridentState

| field | type | unit | absent | kept |
|---|---|---|---|---|
| `position` | NativeVec3 | blocks | required | yes |
| `velocity` | NativeVec3 | blocks a tick | required | yes |
| `gravity` | number | attribute value, a double | allowed | no |
| `airDrag` | number | attribute value, a double | allowed | no |
| `waterInertia` | number | attribute value, a double | allowed | no |
| `inWater` | boolean | flag | allowed | yes |
| `dealtDamage` | boolean | flag | allowed | yes |
| `inGround` | boolean | flag | allowed | yes |
| `life` | number | ticks | allowed | yes |
| `inGroundTime` | number | ticks | allowed | yes |
| `shakeTime` | number | ticks | allowed | yes |
| `fallImpulse` | NativeVec3 | blocks a tick | allowed | no |
| `lastBlockId` | number | as vanilla holds it | allowed | no |
| `lastBlockPosition` | NativeBlockPosition | see the type | allowed | no |
| `noPhysics` | boolean | flag | allowed | no |
| `ultraWarm` | boolean | flag | allowed | no |

## NativeBlockUpdate

| field | type | unit | absent |
|---|---|---|---|
| `x` | number | block cell, a Java int | required |
| `y` | number | block cell, a Java int | required |
| `z` | number | block cell, a Java int | required |
| `id` | number | as vanilla holds it | allowed |
| `stateVersion` | string | name | allowed |
| `blockEntity` | string | name | allowed |
| `removeBlockEntity` | boolean | flag | allowed |
| `properties` | NativeBlockProperty[] | see the type | allowed |
| `tags` | number | as vanilla holds it | allowed |
| `shape` | NativeBlockShape | see the type | allowed |
| `outlineShape` | NativeBlockShape | see the type | allowed |
| `interactionShape` | NativeBlockShape | see the type | allowed |
| `fluid` | number | as vanilla holds it | allowed |
| `fluidTags` | number | as vanilla holds it | allowed |
| `fluidLevel` | number | as vanilla holds it | allowed |
| `fluidSource` | boolean | flag | allowed |
| `fluidFlow` | NativeVec3 | see the type | allowed |
| `fluidFalling` | boolean | flag | allowed |
| `waterBlock` | boolean | flag | allowed |
| `bounceRestitution` | number | as vanilla holds it | allowed |
| `suppressesBounce` | boolean | flag | allowed |
| `fallDamageResetting` | boolean | flag | allowed |
| `playerFallDamageResetting` | boolean | flag | allowed |
| `suffocating` | boolean | flag | allowed |
| `inWall` | boolean | flag | allowed |
| `bottomFaceSturdy` | boolean | flag | allowed |
| `remove` | boolean | flag | allowed |

## NativeBlockShape

| field | type | unit | absent |
|---|---|---|---|
| `minX` | number | blocks from the cell's corner | required |
| `minY` | number | blocks from the cell's corner | required |
| `minZ` | number | blocks from the cell's corner | required |
| `maxX` | number | blocks from the cell's corner | required |
| `maxY` | number | blocks from the cell's corner | required |
| `maxZ` | number | blocks from the cell's corner | required |
| `slipperiness` | number | as vanilla holds it | required |
| `effect` | number | as vanilla holds it | allowed |
| `bounceRestitution` | number | as vanilla holds it | allowed |
| `suppressesBounce` | boolean | flag | allowed |
| `fallDamageResetting` | boolean | flag | allowed |

## NativeMovingPiston

| field | type | unit | absent |
|---|---|---|---|
| `nextShapes` | NativeAabb[] | see the type | allowed |
| `x` | number | block cell, a Java int | required |
| `y` | number | block cell, a Java int | required |
| `z` | number | block cell, a Java int | required |
| `facing` | number | as vanilla holds it | required |
| `extending` | boolean | flag | required |
| `source` | boolean | flag | required |
| `progress` | number | as vanilla holds it | required |
| `shapes` | NativeAabb[] | see the type | required |
| `outlineShapes` | NativeAabb[] | see the type | allowed |
| `bounces` | boolean | flag | allowed |
| `stickyForEntities` | boolean | flag | allowed |

## NativeNearbyEntity

| field | type | unit | absent |
|---|---|---|---|
| `kind` | string | name | required |
| `position` | NativeVec3 | blocks | required |
| `boundingBox` | NativeAabb | see the type | required |
| `ticksBeforePlayer` | boolean | flag | allowed |
| `tickPosition` | NativeVec3 | see the type | allowed |
| `tickBoundingBox` | NativeAabb | see the type | allowed |
| `teamPushes` | boolean | flag | allowed |
