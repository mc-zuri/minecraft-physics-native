use crate::block_traversal::{blocks_visited, blocks_visited_where, Movement, Visit};
use crate::collision::{
    collide_legacy, collide_shapes, vanilla_equal, Colliders, CollisionRules, StepUp,
};
use crate::entity::{
    boost_by_attached_rockets, check_auto_spin_attack, nearby_entity_colliders,
    push_by_nearby_entities, Dimensions, EntityFlags, EntityPush, EntityState, NearbyEntity,
};
use crate::phase::{self, Phase};
use crate::piston::{push_by_moving_pistons, MovingPiston};
use crate::legacy_fluid;
use crate::projectile::{clip_hits, ClipShape};
use crate::math::{
    MAX_WALKED_CELLS,
    ceil_f32, ceil_i32_for, clamp_f64_for, fast_inv_sqrt, fast_inv_sqrt_f32, floor_f32,
    floor_f32_for, floor_i32_for, java_cos, java_cos_legacy, java_float, java_sin,
    java_sin_legacy, lerp, Aabb, Vec3,
};
use crate::trig;
use crate::version::MinecraftVersion;
use crate::world::{WorldSnapshot, FENCE_LIKE, WALL_OR_GATE};
use crate::world::{
    shapes_join, BlockEffect, CollisionQueryEntity, EntityCollisionContext, FluidContact, FluidState,
};

type BlockPosition = (i32, i32, i32);

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PhysicsConfig {
    pub gravity: f64,
    pub drag: f64,
    pub movement_speed: f64,
    pub sprint_multiplier: f64,
    pub jump_velocity: f64,
    pub step_height: f64,
    pub negligible_velocity: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VersionPhysicsRules {
    pub release: MinecraftVersion,
    pub gravity: f64,
    /// getFluidFallingAdjustedMovement's divisor of the gravity in water and shallow lava (1.13+;
    /// before, the water branch takes a literal 0.02, legacy_fluid::sink_in_water).
    pub water_gravity_divisor: f64,
    pub lava_gravity_divisor: f64,
    pub water_drag: f64,
    pub water_sprint_drag: f64,
    pub lava_drag: f64,
    pub air_drag: f64,
    pub vertical_drag: f64,
    pub fluid_vertical_drag: f64,
    pub water_flow_scale: f64,
    pub lava_flow_scale: f64,
    pub ultra_warm_lava_flow_scale: f64,
    pub fluid_travel_split: bool,
    pub fluid_falling_checks_gravity_argument: bool,
    pub water_input_speed: f64,
    pub lava_input_speed: f64,
    pub step_height: f64,
    pub swimming_vertical_steering: f64,
    pub swimming_downward_steering: f64,
    pub water_movement_efficiency_divisor: f64,
    pub water_movement_efficiency_attribute: bool,
}

pub trait VersionPhysicsProfile {
    fn rules() -> VersionPhysicsRules;
    fn landing_damage_rounding() -> LandingDamageRounding;

    /// Whether a landing bounces by the restitution of the block it lands on (Entity.move from
    /// 26.2); the profiles of those releases say so.
    fn restitution_enabled() -> bool {
        false
    }

    /// Whether the fall damage takes the SAFE_FALL_DISTANCE and FALL_DAMAGE_MULTIPLIER attributes
    /// (from 1.20.5); by default with the WATER_MOVEMENT_EFFICIENCY attribute, and the profiles of
    /// 1.20.5-1.20.6 and 26.1-26.3 say so themselves.
    fn modern_fall_damage() -> bool {
        Self::rules().water_movement_efficiency_attribute
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LandingDamageRounding {
    Ceil,
    Floor,
}

/// LivingEntity.computeFallDamage before 1.20.5, in float: `ceil((fallDistance - 3.0F -
/// jumpBoost) * damageMultiplier)`, where `safe_fall_distance` stands for the 3.0F (1.8.9
/// LivingEntity.java:864, 1.20.4 :1557-1564). Nothing below one point.
pub(crate) fn landing_damage(
    fall_distance: f64,
    safe_fall_distance: f64,
    multiplier: f64,
    jump_boost_amplifier: Option<i32>,
    rounding: LandingDamageRounding,
) -> f64 {
    let jump_boost = jump_boost_amplifier.map_or(0.0, |amplifier| (amplifier + 1) as f32);
    let damage =
        (fall_distance as f32 - safe_fall_distance as f32 - jump_boost) * multiplier as f32;
    // Mth.ceil and Mth.floor of a float, an int; this formula ends before 26.1, so a huge fall wraps
    let damage = match rounding {
        LandingDamageRounding::Ceil => ceil_f32(damage),
        LandingDamageRounding::Floor => floor_f32(damage),
    };
    f64::from(damage.max(0))
}

/// LivingEntity.computeFallDamage from 1.20.5, with the SAFE_FALL_DISTANCE and
/// FALL_DAMAGE_MULTIPLIER attributes (Jump Boost raises the first) and the landing block's
/// damage multiplier (1.0F but where Block.fallOn says otherwise): 1.20.5 - 1.21.4 in float,
/// `ceil((double)((fallDistance - (float)safe) * damageMultiplier) * multiplier)` (1.20.5
/// LivingEntity.java:1602-1609, 1.21.4 :1657-1664); from 1.21.5 in double with an epsilon,
/// `floor((fallDistance + 1.0E-6 - safe) * damageMultiplier * multiplier)` (1.21.5
/// LivingEntity.java:1672-1682). Nothing below one point.
pub(crate) fn attribute_landing_damage(
    fall_distance: f64,
    safe_fall_distance: f64,
    damage_multiplier: f32,
    multiplier: f64,
    rounding: LandingDamageRounding,
    release: MinecraftVersion,
) -> f64 {
    let damage = if release.at_least(1, 21, 5) {
        (fall_distance + 1.0e-6 - safe_fall_distance) * f64::from(damage_multiplier) * multiplier
    } else {
        f64::from((fall_distance as f32 - safe_fall_distance as f32) * damage_multiplier)
            * multiplier
    };
    // an int: past its range Mth.ceil wraps to a negative, so to no damage, until 26.1 saturates
    let damage = match rounding {
        LandingDamageRounding::Ceil => ceil_i32_for(release, damage),
        LandingDamageRounding::Floor => floor_i32_for(release, damage),
    };
    f64::from(damage.max(0))
}

/// Entity.fall's (checkFallDamage's) count of a downward move: in float before 1.21.5,
/// `(float)((double)fallDistance - dy)` up to 1.18.x and `fallDistance -= (float)dy` from 1.19
/// (1.18.1 Entity.java:1019, 1.19 :1005; 1.18.2 has no source and is taken as 1.18.1); a double
/// field from 1.21.5, `fallDistance -= (double)(float)dy` (1.21.5 Entity.java:1286).
pub(crate) fn accumulated_fall_distance(
    fall_distance: f64,
    dy: f64,
    release: MinecraftVersion,
) -> f64 {
    if release.at_least(1, 21, 5) {
        fall_distance - f64::from(dy as f32)
    } else if release.at_least(1, 18, 2) {
        // from 1.18.2 (its Entity.checkFallDamage: d2f, fsub; 1.18.1 subtracts the doubles, then rounds)
        f64::from(fall_distance as f32 - dy as f32)
    } else {
        f64::from((fall_distance - dy) as f32)
    }
}

pub fn tick_with_profile<P: VersionPhysicsProfile>(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    config: PhysicsConfig,
) -> TickResult {
    tick_with_rules_and_rounding_and_restitution(
        state,
        world,
        config,
        P::rules(),
        P::landing_damage_rounding(),
        P::restitution_enabled(),
        P::modern_fall_damage(),
    )
}

pub fn tick_with_profile_and_restitution<P: VersionPhysicsProfile>(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    config: PhysicsConfig,
) -> TickResult {
    tick_with_rules_and_rounding_and_restitution(
        state,
        world,
        config,
        P::rules(),
        P::landing_damage_rounding(),
        true,
        true,
    )
}

pub fn tick_with_profile_and_modern_fall_damage<P: VersionPhysicsProfile>(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    config: PhysicsConfig,
) -> TickResult {
    tick_with_rules_and_rounding_and_restitution(
        state,
        world,
        config,
        P::rules(),
        P::landing_damage_rounding(),
        false,
        true,
    )
}

impl Default for VersionPhysicsRules {
    fn default() -> Self {
        Self {
            release: MinecraftVersion::new(26, 2, 0),
            gravity: 0.08,
            water_gravity_divisor: 16.0,
            lava_gravity_divisor: 4.0,
            water_drag: 0.8,
            water_sprint_drag: 0.9,
            lava_drag: 0.5,
            air_drag: 0.91,
            vertical_drag: 0.98,
            fluid_vertical_drag: 0.8,
            water_flow_scale: 0.014,
            lava_flow_scale: 0.0023333333333333335,
            ultra_warm_lava_flow_scale: 0.007,
            fluid_travel_split: false,
            fluid_falling_checks_gravity_argument: true,
            water_input_speed: 0.02,
            lava_input_speed: 0.02,
            step_height: 0.6,
            swimming_vertical_steering: 0.06,
            swimming_downward_steering: 0.085,
            water_movement_efficiency_divisor: 3.0,
            water_movement_efficiency_attribute: false,
        }
    }
}

impl Default for PhysicsConfig {
    fn default() -> Self {
        Self {
            gravity: 0.08,
            drag: 0.98,
            movement_speed: 0.1,
            sprint_multiplier: 1.3,
            jump_velocity: 0.42,
            step_height: 0.6,
            negligible_velocity: 0.003,
        }
    }
}

impl PhysicsConfig {
    pub fn validate(self) -> std::result::Result<(), &'static str> {
        let finite = self.gravity.is_finite()
            && self.drag.is_finite()
            && self.movement_speed.is_finite()
            && self.sprint_multiplier.is_finite()
            && self.jump_velocity.is_finite()
            && self.step_height.is_finite()
            && self.negligible_velocity.is_finite();
        if !finite {
            return Err("simulation config contains non-finite values");
        }
        if !(0.0..=10.0).contains(&self.gravity)
            || !(0.0..=2.0).contains(&self.drag)
            || !(0.0..=100.0).contains(&self.movement_speed)
            || !(0.0..=10.0).contains(&self.sprint_multiplier)
            || !(0.0..=10.0).contains(&self.jump_velocity)
            || !(0.0..=10.0).contains(&self.step_height)
            || !(0.0..=1.0).contains(&self.negligible_velocity)
        {
            return Err("simulation config contains out-of-range values");
        }
        Ok(())
    }
}

/// The movement speed attribute with the sprint, speed and slowness
/// modifiers. They are all `ADD_MULTIPLIED_TOTAL`: each multiplies the value
/// by one plus its amount, in the order vanilla's modifier map iterates them.
#[must_use]
pub(crate) fn movement_speed_attribute(
    base: f64,
    speed_effect_amplifier: Option<i32>,
    slowness_effect_amplifier: Option<i32>,
    sprint_active: bool,
    sprint_multiplier: f64,
    release: MinecraftVersion,
) -> f64 {
    let sprint = sprint_active.then(|| java_float(sprint_multiplier - 1.0));
    let speed =
        speed_effect_amplifier.map(|amplifier| 0.20000000298023224 * (f64::from(amplifier) + 1.0));
    let slowness = slowness_effect_amplifier
        .map(|amplifier| -0.15000000596046448 * (f64::from(amplifier) + 1.0));
    let modifiers = if release.at_least(1, 21, 0) {
        [sprint, speed, slowness]
    } else if release.at_least(1, 20, 5) {
        [sprint, slowness, speed]
    } else {
        [slowness, sprint, speed]
    };
    modifiers
        .into_iter()
        .flatten()
        .fold(base, |value, amount| value * (1.0 + amount))
        .clamp(0.0, 1024.0)
}

/// The boat's observed state when its passenger checks fluids. Its ordinary IN_WATER status
/// is not underwater: only UNDER_WATER and UNDER_FLOWING_WATER set `underwater`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BoatVehicle {
    pub bounding_box: Aabb,
    pub underwater: bool,
}

/// The ordered nextInt(1, 3) draws a ServerPlayer's ignitions read from the level's random
/// (BaseFireBlock.fireIgnite, 1.21.2+), which the engine cannot draw itself. One bit each, so the
/// state stays Copy and the draws follow it through every tick path; the rest of a stream goes
/// back to the caller with the state.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ServerFireDraws {
    bits: u128,
    remaining: u8,
}

impl ServerFireDraws {
    pub const CAPACITY: usize = 128;

    /// None for more draws than a stream holds or a draw that is not 1 or 2.
    pub fn new(draws: &[i32]) -> Option<Self> {
        if draws.len() > Self::CAPACITY {
            return None;
        }
        let mut bits = 0_u128;
        for (index, draw) in draws.iter().enumerate() {
            match draw {
                1 => {}
                2 => bits |= 1 << index,
                _ => return None,
            }
        }
        Some(Self {
            bits,
            remaining: draws.len() as u8,
        })
    }

    fn next(&mut self) -> Option<i32> {
        if self.remaining == 0 {
            return None;
        }
        let draw = 1 + (self.bits & 1) as i32;
        self.bits = self.bits.checked_shr(1).unwrap_or(0);
        self.remaining -= 1;
        Some(draw)
    }

    /// The draws not read yet, in order.
    pub fn to_vec(self) -> Vec<i32> {
        let mut rest = self;
        std::iter::from_fn(|| rest.next()).collect()
    }
}

/// One tick of one entity. Its counters, all a Java int in vanilla, starting at 0 (26.3 lines):
///
/// - `tick_count`: Entity.tickCount. Advanced before the tick, for every tick the level admits
///   (Entity.commonTick, :550, from ClientLevel.tickNonPassenger); kept as the int's bits, it wraps.
/// - `jump_ticks`: LivingEntity.noJumpDelay. Down at the top of aiStep (:2959), 10 on a jump (:3026),
///   0 on a tick without the jump key (:3035).
/// - `auto_jump_time`: LocalPlayer.autoJumpTime. Down in aiStep, holding the jump key (:768); set by
///   the move's updateAutoJump (:1083).
/// - `ticks_frozen`: Entity.TicksFrozen, tracked data. The server's to count, up 1 to the limit in
///   powder snow and down 2 to 0 outside; the client reads it.
/// - `remaining_fire_ticks`: Entity.remainingFireTicks, the server's; the client clears its own.
///
/// The adapter owns what the engine does not read or that lives in the caller's tick: `age`
/// (mineflayer-physics-utils' count, no input here), itemUseTicks, autoSpinAttackTicks,
/// fireworkRocketDuration, sprintTriggerTime and flyJumpTriggerTime. A projectile's tick count,
/// flying ticks, life, inGroundTime and shakeTime are in projectile.rs and projectile_hits.rs; a
/// vehicle's boost, stand, dash and bubble counters in ridden.rs and vehicle.rs.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SimulationState {
    pub position: Vec3,
    pub velocity: Vec3,
    pub yaw: f64,
    /// The float yaw in degrees (Entity.rotationYaw), for the radians a release turns it into
    /// itself: moveFlying before 1.9 (see `yaw_radians`). None uses `yaw`.
    pub yaw_degrees: Option<f32>,
    pub pitch: f64,
    pub half_width: f64,
    pub height: f64,
    pub on_ground: bool,
    pub collided_horizontally: bool,
    pub minor_horizontal_collision: bool,
    pub minor_horizontal_collision_supported: bool,
    pub collided_vertically: bool,
    pub vertical_collision_below: bool,
    pub block_fall_callback: bool,
    pub entity_bounciness: f64,
    pub block_bounciness: f64,
    pub input: Vec3,
    pub jump_requested: bool,
    pub jump_ticks: u32,
    pub auto_jump: bool,
    pub auto_jump_time: u32,
    pub riptide_launch: Option<u8>,
    /// How far this tick's riptide launch lifted the entity off the ground (the 1.2 move of
    /// TridentItem.releaseUsing), zero without one: the box aiStep takes before travel is past it.
    pub riptide_lift: Vec3,
    pub sprinting: bool,
    pub was_sprinting: bool,
    pub sprint_modifier: Option<bool>,
    pub in_water: bool,
    pub in_lava: bool,
    pub ultra_warm: bool,
    pub is_player: bool,
    pub controlled_by_local_instance: bool,
    /// Exact Entity.canSimulateMovement result for 26.3+ piston bounce/restitution and bubble
    /// column pushes. Without it, players use their side/local authority and other entities use local authority.
    pub can_simulate_movement: Option<bool>,
    /// The entity is no LivingEntity: a slime block or bed returns 0.8 of the bounce (from 1.9,
    /// the bed's from 1.12), from 26.2 0.8F of the block's restitution. `block_bounciness` is
    /// taken as resolved.
    pub non_living: bool,
    pub passenger: bool,
    /// Absolute boat geometry at the fluid-query phase; ignored when not a passenger.
    pub boat_vehicle: Option<BoatVehicle>,
    pub in_web: bool,
    pub weaving: bool,
    /// Frost Walker on the boots: magma and lit campfires deal no contact damage.
    pub frost_walker: bool,
    pub sweet_berry_bush_immune: bool,
    /// A boat, which is no LivingEntity: powder snow holds it wherever its feet are
    /// (PowderSnowBlock.entityInside), and a bubble column with nothing above it does not move
    /// the boat its player controls (AbstractBoat.onAboveBubbleColumn).
    pub boat: bool,
    /// A boat's onAboveBubbleColumn on the last block effects: the column's drag.
    pub above_bubble_column: Option<bool>,
    pub powder_snow_immune: bool,
    pub powder_snow_walkable: bool,
    pub in_powder_snow: bool,
    /// EntityType.fireImmune: fire never ignites it and it takes no fire damage.
    pub fire_immune: bool,
    /// MobEffects.FIRE_RESISTANCE: LivingEntity.hurt refuses all fire damage (1.8.9
    /// LivingEntity.java:682, 1.20.4 :1104, 26.3 :1154), while the burning itself goes on.
    pub fire_resistance: bool,
    /// Entity.getSharedFlag(0) as the server last sent it, which isOnFire reads on a client.
    pub on_fire_flag: bool,
    /// Entity.isInRain (isBeingRainedOn before 1.21.5), which the world does not know: rain at
    /// the block position or at the box's top, which puts the fire out.
    pub in_rain: bool,
    /// A spear's stab that dealt knockback since the last tick, with the weapon's own knockback
    /// (take_stab_hit). Taken once, and only on a server state.
    pub stab_hit: Option<f32>,
    /// The highest Fire Protection level the entity wears, which shortens its burning before 1.21.
    pub fire_protection: u32,
    /// The BURNING_TIME attribute (1.21+), 1.0 when not given.
    pub burning_time: Option<f64>,
    /// Entity.remainingFireTicks; the field's initial value when not given.
    pub remaining_fire_ticks: Option<i32>,
    /// The nextInt(1, 3) of a ServerPlayer's ignition (BaseFireBlock.fireIgnite, 1.21.2+), which
    /// the engine cannot draw; 1 when not given. A fixed value for every ignition, an
    /// approximation of the level's random; server_fire_draws is the exact form.
    pub server_fire_increment: Option<i32>,
    /// Each ignition's own draw, read one per ignition that reaches nextInt, in order.
    pub server_fire_draws: Option<ServerFireDraws>,
    /// An ignition found server_fire_draws empty: the result is no exact replay.
    pub server_fire_draws_exhausted: bool,
    /// A tick needed a ServerPlayer's fire draw and the state gave neither input.
    pub server_fire_draw_missing: bool,
    /// The tick's move swept more cells than a call may walk (MAX_WALKED_CELLS): it did not run, and
    /// no result of the tick is published.
    pub move_out_of_range: bool,
    pub ticks_frozen: u32,
    pub ticks_required_to_freeze: u32,
    /// Entity.tickCount, the bits of a Java int.
    pub tick_count: u32,
    pub freeze_damage: f64,
    pub contact_damage: f64,
    /// What this tick's flight into a wall hands hurt, the server's alone (flyIntoWall).
    pub wall_damage: f64,
    pub inside_wall: bool,
    /// LivingEntity.isSleeping (Player.inBed before 1.14): a sleeper is never in a wall.
    pub sleeping: bool,
    pub eye_height: Option<f64>,
    pub eye_in_water: bool,
    pub eye_in_lava: bool,
    pub slow_falling: bool,
    pub levitation: bool,
    pub levitation_amplifier: Option<i32>,
    pub fall_distance: f64,
    pub safe_fall_distance: f64,
    pub fall_damage_immune: bool,
    /// The state is the client's (the local player as the client ticks it): the client's rules where vanilla's sides
    /// differ (a living entity's fire cleared in baseTick up to 1.21.8, freeze ticks counted by the server alone).
    pub client_side: bool,
    /// The height the pose update leaves (Player.tick's updatePlayerPose, updateSize before 1.14),
    /// when the caller knows it: what ticks after the player meets the box of that height.
    pub height_after_tick: Option<f64>,
    /// Abilities.invulnerable (creative, or set by a command): a player's fire ticks are at most 1 from 1.16
    /// (Player.setRemainingFireTicks).
    pub invulnerable: bool,
    pub fall_damage_multiplier: Option<f64>,
    pub sneaking: bool,
    pub moving_slowly: Option<bool>,
    pub stepping_carefully: bool,
    pub using_item: bool,
    /// UseEffects.speedMultiplier of the item in use (1.21.11+); 0.2 when absent.
    pub item_use_speed_multiplier: Option<f32>,
    pub swimming: bool,
    pub flying: bool,
    pub flying_speed: f64,
    pub climbing: bool,
    pub no_physics: bool,
    /// Spider.makeStuckInBlock: a cobweb does not hold it.
    pub web_immune: bool,
    /// WitherBoss.makeStuckInBlock: nothing holds it.
    pub stuck_immune: bool,
    pub no_gravity: bool,
    /// Removed from the level this tick (LocalPlayer.tickDeath at the 20th tick of death, 1.17+).
    pub removed: bool,
    /// Its health is 0 (LivingEntity.isAlive is false): from 1.11 no entity pushes it.
    pub dead: bool,
    pub gravity: Option<f64>,
    pub step_height: Option<f64>,
    pub movement_speed: Option<f64>,
    /// AttributeInstance.getValue of MOVEMENT_SPEED as the caller folded it, with every modifier it
    /// holds (the sprint, speed and slowness ones too). None folds `movement_speed` with the
    /// sprint, speed and slowness modifiers alone.
    pub movement_speed_value: Option<f64>,
    pub jump_strength: Option<f64>,
    pub speed_effect_amplifier: Option<i32>,
    pub slowness_effect_amplifier: Option<i32>,
    pub jump_boost_amplifier: Option<i32>,
    pub dolphins_grace: u8,
    pub depth_strider: u8,
    pub soul_speed: u8,
    pub water_movement_efficiency: f64,
    pub movement_efficiency: f64,
    pub air_drag_modifier: f64,
    pub friction_modifier: f64,
    pub air_drag_modifier_present: bool,
    pub friction_modifier_present: bool,
    pub sneaking_speed: Option<f64>,
    pub fall_damage: f64,
    pub fall_flying: bool,
    pub look: Vec3,
    pub firework_boost: Vec3,
    pub stuck_speed_multiplier: Vec3,
    /// The tick's move was slowed by the stuck speed multiplier (Entity.isInWeb before 1.14), the
    /// one a riptide launch's lift left included.
    pub move_slowed: bool,
    pub previous_position: Option<Vec3>,
    pub bounding_box: Option<Aabb>,
    /// Entity.mainSupportingBlockPos as the last move left it (1.20+), when a move of this state
    /// set it (`supporting_block_kept`); a state without one takes it from its position and its
    /// last move.
    pub supporting_block: Option<BlockPosition>,
    pub supporting_block_kept: bool,
    /// Entity.onGroundNoBlocks: the last move left the entity on the ground with no block under it.
    pub on_ground_no_blocks: bool,
    /// Entity.isOutsideBorder before 1.14: the last collision found the entity outside the world
    /// border, which then has to be a block further in to count as inside it.
    pub outside_border: bool,
}

impl From<EntityState> for SimulationState {
    fn from(value: EntityState) -> Self {
        Self {
            position: value.position,
            velocity: value.velocity,
            yaw: 0.0,
            yaw_degrees: None,
            pitch: 0.0,
            half_width: value.dimensions.half_width,
            height: value.dimensions.height,
            on_ground: value.flags.on_ground,
            collided_horizontally: value.flags.horizontal_collision,
            minor_horizontal_collision: false,
            minor_horizontal_collision_supported: false,
            collided_vertically: value.flags.vertical_collision,
            vertical_collision_below: value.flags.vertical_collision_below,
            block_fall_callback: false,
            entity_bounciness: 0.0,
            block_bounciness: 0.0,
            input: Vec3::ZERO,
            jump_requested: false,
            jump_ticks: 0,
            auto_jump: false,
            auto_jump_time: 0,
            riptide_launch: None,
            riptide_lift: Vec3::ZERO,
            sprinting: false,
            was_sprinting: false,
            sprint_modifier: None,
            in_water: value.flags.in_water,
            in_lava: value.flags.in_lava,
            ultra_warm: false,
            is_player: false,
            controlled_by_local_instance: false,
            can_simulate_movement: None,
            non_living: false,
            passenger: false,
            boat_vehicle: None,
            in_web: false,
            weaving: false,
            frost_walker: false,
            sweet_berry_bush_immune: false,
            boat: false,
            above_bubble_column: None,
            powder_snow_immune: false,
            powder_snow_walkable: false,
            in_powder_snow: false,
            fire_immune: false,
            fire_resistance: false,
            on_fire_flag: false,
            in_rain: false,
            stab_hit: None,
            fire_protection: 0,
            burning_time: None,
            remaining_fire_ticks: None,
            server_fire_increment: None,
            server_fire_draws: None,
            server_fire_draws_exhausted: false,
            server_fire_draw_missing: false,
            move_out_of_range: false,
            ticks_frozen: 0,
            ticks_required_to_freeze: 140,
            tick_count: 0,
            freeze_damage: 0.0,
            contact_damage: 0.0,
            wall_damage: 0.0,
            inside_wall: false,
            sleeping: false,
            eye_height: None,
            eye_in_water: false,
            eye_in_lava: false,
            slow_falling: false,
            levitation: false,
            levitation_amplifier: None,
            fall_distance: 0.0,
            safe_fall_distance: 3.0,
            fall_damage_immune: false,
            client_side: false,
            height_after_tick: None,
            invulnerable: false,
            fall_damage_multiplier: Some(1.0),
            sneaking: false,
            moving_slowly: None,
            stepping_carefully: false,
            using_item: false,
            item_use_speed_multiplier: None,
            swimming: false,
            flying: false,
            // Abilities.flyingSpeed (1.21.11 Abilities.java:19)
            flying_speed: f64::from(0.05_f32),
            climbing: false,
            no_physics: false,
            web_immune: false,
            stuck_immune: false,
            no_gravity: value.no_gravity,
            removed: false,
            dead: false,
            gravity: value.gravity,
            step_height: value.step_height,
            movement_speed: None,
            movement_speed_value: None,
            jump_strength: None,
            speed_effect_amplifier: None,
            slowness_effect_amplifier: None,
            jump_boost_amplifier: None,
            dolphins_grace: 0,
            depth_strider: 0,
            soul_speed: 0,
            water_movement_efficiency: 0.0,
            movement_efficiency: 0.0,
            air_drag_modifier: 0.0,
            friction_modifier: 0.0,
            air_drag_modifier_present: false,
            friction_modifier_present: false,
            sneaking_speed: None,
            fall_damage: 0.0,
            fall_flying: false,
            look: Vec3::new(0.0, 0.0, 1.0),
            firework_boost: Vec3::ZERO,
            stuck_speed_multiplier: Vec3::ZERO,
            move_slowed: false,
            previous_position: None,
            bounding_box: None,
            supporting_block: None,
            supporting_block_kept: false,
            on_ground_no_blocks: false,
            outside_border: false,
        }
    }
}

impl From<SimulationState> for EntityState {
    fn from(value: SimulationState) -> Self {
        Self {
            position: value.position,
            velocity: value.velocity,
            dimensions: Dimensions::new(value.half_width, value.height),
            flags: EntityFlags {
                on_ground: value.on_ground,
                horizontal_collision: value.collided_horizontally,
                vertical_collision: value.collided_vertically,
                vertical_collision_below: value.vertical_collision_below,
                in_water: value.in_water,
                in_lava: value.in_lava,
                ..EntityFlags::default()
            },
            no_gravity: value.no_gravity,
            gravity: value.gravity,
            step_height: value.step_height,
        }
    }
}

impl SimulationState {
    /// Merges an entity state (a prediction's result, or the server's correction of it) into
    /// this one: its motion, size, contact flags and its own gravity replace this state's, and
    /// everything EntityState has no place for (the input, effects, counters) stays.
    pub fn merge_entity_state(&mut self, entity: EntityState) {
        self.position = entity.position;
        self.velocity = entity.velocity;
        self.half_width = entity.dimensions.half_width;
        self.height = entity.dimensions.height;
        self.on_ground = entity.flags.on_ground;
        self.collided_horizontally = entity.flags.horizontal_collision;
        self.collided_vertically = entity.flags.vertical_collision;
        self.vertical_collision_below = entity.flags.vertical_collision_below;
        self.in_water = entity.flags.in_water;
        self.in_lava = entity.flags.in_lava;
        self.no_gravity = entity.no_gravity;
        self.gravity = entity.gravity;
        self.step_height = entity.step_height;
    }
}

impl SimulationState {
    /// Entity.updateInWaterStateAndDoWaterCurrentPushing skips a boat passenger from 1.9;
    /// 1.19.3 lets an underwater boat's passenger touch water (1.19.2 Entity.java:1075,
    /// 1.19.3 :1080). From 26.1 the adjusted interaction box replaces this exclusion.
    pub(crate) fn boat_excludes_water(self, release: MinecraftVersion) -> bool {
        release.at_least(1, 9, 0)
            && !release.at_least(26, 1, 0)
            && self.boat_vehicle.filter(|_| self.passenger).is_some_and(|boat| {
                !release.at_least(1, 19, 3) || !boat.underwater
            })
    }

    /// Entity.getFluidInteractionBox, then AbstractBoat.modifyPassengerFluidInteractionBox
    /// (26.1+, 26.3 Entity.java:4233, AbstractBoat.java:787): deflate first, then trim. None
    /// means the boat covers the whole scan, not that the physical entity has no bounds.
    pub(crate) fn fluid_interaction_area(self) -> Option<Aabb> {
        let mut area = self.bounds().deflate(Vec3::new(0.001, 0.001, 0.001));
        if let Some(boat) = self.boat_vehicle.filter(|boat| self.passenger && !boat.underwater) {
            if boat.bounding_box.max.y >= area.max.y {
                return None;
            }
            area.min.y = area.min.y.max(boat.bounding_box.max.y);
        }
        Some(area)
    }

    #[must_use]
    pub fn bounds(self) -> Aabb {
        self.bounding_box
            .unwrap_or_else(|| self.bounds_around_position())
    }

    #[must_use]
    pub fn bounds_around_position(self) -> Aabb {
        Aabb::new(
            Vec3::new(
                self.position.x - self.half_width,
                self.position.y,
                self.position.z - self.half_width,
            ),
            Vec3::new(
                self.position.x + self.half_width,
                self.position.y + self.height,
                self.position.z + self.half_width,
            ),
        )
    }

    pub fn check_fall_distance_accumulation(&mut self) {
        if self.velocity.y > -0.5 && self.fall_distance > 1.0 {
            self.fall_distance = 1.0;
        }
    }

    /// Entity.addDeltaMovement: from 1.21.11 an impulse that is not finite, or a sum that is not,
    /// leaves the motion as it was (1.21.11 Entity.java:3664-3674, setDeltaMovement's guard; 1.21.10
    /// :3640-3646 has none, nor do the setVelocity/addVelocity of 1.20.4 - 1.21.4).
    pub fn add_delta_movement(&mut self, impulse: Vec3, release: MinecraftVersion) {
        if !release.at_least(1, 21, 11) {
            self.velocity = self.velocity + impulse;
            return;
        }
        if impulse.is_finite() {
            self.set_delta_movement(self.velocity + impulse, release);
        }
    }

    /// Entity.setDeltaMovement: from 1.21.11 a motion that is not finite is refused and the motion
    /// stays as it was (1.21.11 Entity.java:3664-3668); before, any motion is taken.
    pub fn set_delta_movement(&mut self, velocity: Vec3, release: MinecraftVersion) {
        if velocity.is_finite() || !release.at_least(1, 21, 11) {
            self.velocity = velocity;
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TickResult {
    pub displacement: Vec3,
    pub collided_horizontally: bool,
    pub collided_vertically: bool,
    pub block_fall_callback: bool,
}

/// AttributeModifier.Operation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttributeOperation {
    AddValue,
    AddMultipliedBase,
    AddMultipliedTotal,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AttributeModifier {
    pub amount: f64,
    pub operation: AttributeOperation,
}

/// The movement speed attribute: its base, its modifiers but the powder snow one, and that one's
/// amount if it holds it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MovementSpeedAttribute {
    pub base: f64,
    pub modifiers: Vec<AttributeModifier>,
    pub frost: Option<f64>,
}

impl MovementSpeedAttribute {
    /// AttributeInstance.calculateValue, sanitized as the clamped attribute is, 0 to 1024.
    fn value(&self) -> f64 {
        let held = |operation| {
            self.modifiers
                .iter()
                .filter(move |modifier| modifier.operation == operation)
                .map(|modifier| modifier.amount)
        };
        let mut added = self.base;
        for amount in held(AttributeOperation::AddValue).chain(self.frost) {
            added += amount;
        }
        let mut scaled = added;
        for amount in held(AttributeOperation::AddMultipliedBase) {
            scaled += added * amount;
        }
        for amount in held(AttributeOperation::AddMultipliedTotal) {
            scaled *= 1.0 + amount;
        }
        scaled.clamp(0.0, 1024.0)
    }
}

/// What one client tick of the local player reads beside its state and world: the entities near
/// it in the order the client ticks them, the firework rockets attached to it (all of them and
/// those the client ticks before it), whether its riptide spin attack runs this tick, the moving
/// piston blocks that push it after every entity ticked, and how far the pistons of this tick
/// already moved it (Entity.pistonDeltas). `rocket_ticks` lists the ticks each attached rocket
/// has left, those before the player first; None: the rockets do not end.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TickScene {
    /// The movement speed attribute as the tick begins, where a caller has its parts: only the
    /// frost modifier changes it in the tick (apply_frost).
    pub movement_speed: Option<MovementSpeedAttribute>,
    pub nearby_entities: Vec<NearbyEntity>,
    pub firework_rockets: u32,
    pub firework_rockets_before_player: u32,
    pub rocket_ticks: Option<Vec<u32>>,
    pub auto_spin_attack: bool,
    pub moving_pistons: Vec<MovingPiston>,
    pub piston_deltas: [f64; 3],
}

impl TickScene {
    /// Takes `spent` ticks off each attached rocket's and drops those left with none, keeping
    /// the count of those before the player.
    pub fn end_rockets(&mut self, spent: u32) {
        let Some(ticks) = &mut self.rocket_ticks else {
            return;
        };
        let before = self.firework_rockets_before_player as usize;
        let mut kept_before = 0;
        let mut index = 0;
        ticks.retain_mut(|left| {
            *left = left.saturating_sub(spent);
            let keep = *left > 0;
            if keep && index < before {
                kept_before += 1;
            }
            index += 1;
            keep
        });
        self.firework_rockets = ticks.len() as u32;
        self.firework_rockets_before_player = kept_before;
    }

    /// The scene's own part of the tick, after the player's, which leaves the scene the next tick
    /// reads: the moving pistons' progressO = progress, and below 1 progress = min(progress +
    /// 0.5F, 1), the block ending (pushing nothing from 1.11) the tick after it reaches 1 (1.8.9
    /// PistonBlockEntity.java:128-145, 1.12.2 :277-292, 1.21.11 PistonMovingBlockEntity.java:
    /// 294-326). Before 1.11 that tick pushes a last time, pushEntities(1.0F, 0.25F), and removes
    /// the block entity, so the piston leaves the scene (1.8.9 PistonBlockEntity.java:128-136,
    /// 1.10.2 :166-171); from 1.11 the ended block pushes nothing, removed (1.12.2 :279-285) or
    /// kept 5 client death ticks (1.16.4 PistonMovingBlockEntity.java:277-279), so it stays. The
    /// attached rockets count the tick off (FireworkRocketEntity.tick, 1.21.11
    /// FireworkRocketEntity.java:160-174), an ended spin attack runs no more, and the piston
    /// deltas start over, as the next game time clears them (1.21.11 Entity.java:1016-1019).
    pub fn advance(&mut self, auto_spin_attack_ended: bool, release: MinecraftVersion) {
        let ended_removed = !release.at_least(1, 11, 0);
        self.moving_pistons.retain_mut(|piston| {
            if piston.progress >= 1.0 {
                return !ended_removed;
            }
            piston.progress = (piston.progress + 0.5).min(1.0);
            true
        });
        self.end_rockets(1);
        self.auto_spin_attack &= !auto_spin_attack_ended;
        self.piston_deltas = [0.0; 3];
    }
}

/// One client tick of the local player in a scene (tick_local_player_scene), then the scene's
/// own (TickScene::advance): what simulateVersionedTick and a TickInputSnapshot both run.
pub(crate) fn tick_scene(
    world: &mut WorldSnapshot,
    state: &mut SimulationState,
    scene: &mut TickScene,
    config: PhysicsConfig,
    release: MinecraftVersion,
    tick: impl FnOnce(&mut SimulationState, &WorldSnapshot) -> Result<TickResult, String>,
) -> Result<TickSceneOutcome, String> {
    let outcome = tick_local_player_scene(
        world,
        state,
        scene.movement_speed.as_mut(),
        &scene.nearby_entities,
        (scene.firework_rockets, scene.firework_rockets_before_player),
        scene.auto_spin_attack,
        &scene.moving_pistons,
        &mut scene.piston_deltas,
        config,
        release,
        tick,
    )?;
    scene.advance(outcome.auto_spin_attack_ended, release);
    Ok(outcome)
}

/// What one client tick of the local player did beside its state: the move's result, the pushes
/// the nearby entities took back from it, whether its spin attack ended, and the piston deltas
/// the moving pistons left.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TickSceneOutcome {
    pub result: TickResult,
    pub entity_pushes: Vec<EntityPush>,
    pub auto_spin_attack_ended: bool,
    pub piston_deltas: [f64; 3],
}

/// One client tick of the local player in its scene: the attached rockets and the entities the
/// client ticks before it boost and push it, `tick` moves it (colliding with the entities that are
/// colliders), the spin attack is checked (LivingEntity.aiStep after travel), the rockets and
/// entities after it boost and push it, then the moving pistons push it with the colliders where
/// the entities' ticks left them. The world's entity colliders are left empty.
#[allow(clippy::too_many_arguments)]
pub(crate) fn tick_local_player_scene(
    world: &mut WorldSnapshot,
    state: &mut SimulationState,
    movement_speed: Option<&mut MovementSpeedAttribute>,
    nearby_entities: &[NearbyEntity],
    (rockets, rockets_before_player): (u32, u32),
    auto_spin_attack: bool,
    moving_pistons: &[MovingPiston],
    piston_deltas: &mut [f64; 3],
    config: PhysicsConfig,
    release: MinecraftVersion,
    tick: impl FnOnce(&mut SimulationState, &WorldSnapshot) -> Result<TickResult, String>,
) -> Result<TickSceneOutcome, String> {
    let moved = move_local_player(
        world,
        state,
        movement_speed,
        nearby_entities,
        (rockets, rockets_before_player),
        auto_spin_attack,
        release,
        tick,
    )?;
    // Player.tick ends with the pose update, after aiStep and before the level ticks the next
    // entity (1.13.2 PlayerEntity.java:293, 339; 1.14 :293-294 ff.; 26.2 Player.java:242, 266), so
    // those meet the box of the new pose, as the block entities do. The player's own tick's height
    // comes back for what follows, which is the caller's pose update.
    let height = state.height;
    let bounding_box = state.bounding_box;
    let after_pose = state.height_after_tick.filter(|after| *after != height);
    if let Some(after) = after_pose {
        set_pose_height(state, after);
    }
    let mut pushes = moved.entity_pushes;
    pushes.extend(finish_local_player(
        world,
        state,
        nearby_entities,
        rockets - rockets_before_player.min(rockets),
        moving_pistons,
        piston_deltas,
        config,
        release,
    ));
    if after_pose.is_some() {
        state.height = height;
        if let (Some(bounds), Some(kept)) = (state.bounding_box.as_mut(), bounding_box) {
            bounds.max.y = bounds.min.y + (kept.max.y - kept.min.y);
        }
    }
    phase::emit(Phase::ClientTickEnd, state);
    Ok(TickSceneOutcome {
        result: moved.result,
        entity_pushes: pushes,
        auto_spin_attack_ended: moved.auto_spin_attack_ended,
        piston_deltas: *piston_deltas,
    })
}

/// The height the pose update leaves, on the state and the box kept before 1.17.
pub(crate) fn set_pose_height(state: &mut SimulationState, height: f64) {
    state.height = height;
    if let Some(bounds) = state.bounding_box.as_mut() {
        bounds.max.y = bounds.min.y + height;
    }
}

/// tick_local_player_scene up to Player.tick's pose update: the rockets and entities before the
/// player, its move and the spin attack's check. A caller that decides the pose from where the
/// move left the player sets it, then runs finish_local_player.
#[allow(clippy::too_many_arguments)]
pub(crate) fn move_local_player(
    world: &mut WorldSnapshot,
    state: &mut SimulationState,
    movement_speed: Option<&mut MovementSpeedAttribute>,
    nearby_entities: &[NearbyEntity],
    (rockets, rockets_before_player): (u32, u32),
    auto_spin_attack: bool,
    release: MinecraftVersion,
    tick: impl FnOnce(&mut SimulationState, &WorldSnapshot) -> Result<TickResult, String>,
) -> Result<TickSceneOutcome, String> {
    let rockets_before_player = rockets_before_player.min(rockets);
    state.minor_horizontal_collision_supported = release.supports_minor_horizontal_collision();
    boost_by_attached_rockets(state, rockets_before_player, release);
    let pushes = push_by_nearby_entities(state, world, nearby_entities, true, release);
    world.set_entity_colliders(nearby_entity_colliders(nearby_entities, false));
    // the box where the move starts: before 1.17 the kept box refitted to this tick's pose, as
    // Entity.setPose -> refreshDimensions already refitted it when the pose changed (1.16.5
    // LivingEntity.java:2504 takes getBoundingBox() of the new size), and past the lift of a
    // riptide launch, which TridentItem.releaseUsing moved before aiStep took it (the use key is
    // handled before the level ticks: 1.16.5 MinecraftClient.java:1433, 1601, TridentItem.java:102)
    let before = kept_bounding_box(state);
    let result = tick(state, world);
    world.set_entity_colliders(Vec::new());
    let result = result?;
    let before = before.translated(state.riptide_lift);
    if let Some(attribute) = movement_speed {
        apply_frost(state, world, attribute, release);
    }
    // LivingEntity.aiStep checks the spin attack after travel, before the pushes
    let auto_spin_attack_ended = auto_spin_attack
        && release.at_least(1, 13, 0)
        && check_auto_spin_attack(state, before, nearby_entities);
    phase::emit(Phase::AfterAiStep, state);
    Ok(TickSceneOutcome {
        result,
        entity_pushes: pushes,
        auto_spin_attack_ended,
        piston_deltas: [0.0; 3],
    })
}

/// LivingEntity.aiStep's removeFrost and tryAddFrost after travel: on every side before 1.21.5,
/// which makes them the server's (1.17 LivingEntity.java:2555-2556, 505-527; 1.21.4 :2812-2813,
/// 509-531; 1.21.5 :2775-2783). The attribute packet carries the server's modifier a tick after
/// the client made its own where the frozen ticks start or the landing block turns to air, so the
/// value comes from the parts. A modifier that did not change leaves the value the caller gave.
fn apply_frost(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    attribute: &mut MovementSpeedAttribute,
    release: MinecraftVersion,
) {
    if !release.at_least(1, 17, 0) || (state.client_side && release.at_least(1, 21, 5)) {
        return;
    }
    let frost = (state.ticks_frozen > 0 && !landing_block_is_air(state, world, release)).then(|| {
        // Entity.getFreezingScale, float ticks over the required int, and -0.05F of it
        // (1.17 Entity.java:2064-2067, LivingEntity.java:523)
        let required = state.ticks_required_to_freeze.max(140);
        let scale = state.ticks_frozen.min(required) as f32 / required as f32;
        f64::from(-0.05_f32 * scale)
    });
    if frost != attribute.frost {
        attribute.frost = frost;
        state.movement_speed_value = Some(attribute.value());
    }
}

/// Entity.getLandingBlockState().isAir() (1.17 Entity.java:1129-1131, 26.3 getBlockStateOnLegacy).
fn landing_block_is_air(
    state: &SimulationState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> bool {
    let support = kept_supporting_block(world, state, None, release);
    world.is_air_at(landing_position(world, state, support, release))
}

/// tick_local_player_scene after Player.tick's pose update: the rockets and entities after the
/// player, then the moving pistons with the colliders where the entities' ticks left them.
/// Returns the pushes the entities took back.
#[allow(clippy::too_many_arguments)]
pub(crate) fn finish_local_player(
    world: &mut WorldSnapshot,
    state: &mut SimulationState,
    nearby_entities: &[NearbyEntity],
    rockets_after_player: u32,
    moving_pistons: &[MovingPiston],
    piston_deltas: &mut [f64; 3],
    config: PhysicsConfig,
    release: MinecraftVersion,
) -> Vec<EntityPush> {
    boost_by_attached_rockets(state, rockets_after_player, release);
    let pushes = push_by_nearby_entities(state, world, nearby_entities, false, release);
    if !moving_pistons.is_empty() {
        world.set_entity_colliders(nearby_entity_colliders(nearby_entities, true));
        push_by_moving_pistons(state, world, moving_pistons, piston_deltas, config, release);
        world.set_entity_colliders(Vec::new());
    }
    pushes
}

/// Everything one client tick of the local player reads, which executing it leaves as it was: the
/// state, the world, the runtime config, the release's rules and fall-damage policy, and the
/// scene around the player (nearby entities, attached rockets, the spin attack, moving pistons).
#[derive(Clone, Debug)]
pub struct TickInputSnapshot {
    pub state: SimulationState,
    pub world: WorldSnapshot,
    pub config: PhysicsConfig,
    pub rules: VersionPhysicsRules,
    pub landing_damage_rounding: LandingDamageRounding,
    pub restitution_enabled: bool,
    pub modern_fall_damage: bool,
    pub water_movement_efficiency_attribute: bool,
    pub scene: TickScene,
}

/// Everything one client tick of the local player writes: the state after it, the move's result,
/// the pushes the nearby entities took back, whether the spin attack ended, the piston deltas the
/// moving pistons left, and the scene the next tick reads (the pistons moved on, the rockets'
/// tick counted off: TickScene::advance).
#[derive(Clone, Debug, PartialEq)]
pub struct TickOutputSnapshot {
    pub state: SimulationState,
    pub result: TickResult,
    pub entity_pushes: Vec<EntityPush>,
    pub auto_spin_attack_ended: bool,
    pub piston_deltas: [f64; 3],
    pub scene: TickScene,
}

impl TickInputSnapshot {
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        state: SimulationState,
        world: WorldSnapshot,
        config: PhysicsConfig,
        rules: VersionPhysicsRules,
        landing_damage_rounding: LandingDamageRounding,
        restitution_enabled: bool,
        modern_fall_damage: bool,
        water_movement_efficiency_attribute: bool,
    ) -> Self {
        Self {
            state,
            world,
            config,
            rules,
            landing_damage_rounding,
            restitution_enabled,
            modern_fall_damage,
            water_movement_efficiency_attribute,
            scene: TickScene::default(),
        }
    }

    /// The snapshot of a release's tick as its versioned engine runs it: tick_with_profile, with
    /// the profile's own restitution and fall-damage policy.
    #[must_use]
    pub fn for_profile<P: VersionPhysicsProfile>(
        state: SimulationState,
        world: WorldSnapshot,
        config: PhysicsConfig,
    ) -> Self {
        let rules = P::rules();
        Self::new(
            state,
            world,
            config,
            rules,
            P::landing_damage_rounding(),
            P::restitution_enabled(),
            P::modern_fall_damage(),
            rules.water_movement_efficiency_attribute,
        )
    }

    #[must_use]
    pub fn with_scene(mut self, scene: TickScene) -> Self {
        self.scene = scene;
        self
    }

    /// The snapshot of the tick after the one `output` came from: its state and scene, in the
    /// same world, config and release.
    #[must_use]
    pub fn next(&self, output: &TickOutputSnapshot) -> Self {
        Self {
            state: output.state,
            scene: output.scene.clone(),
            ..self.clone()
        }
    }

    #[must_use]
    pub fn execute(&self) -> TickOutputSnapshot {
        let mut state = self.state;
        let mut world = self.world.clone();
        let mut rules = self.rules;
        rules.water_movement_efficiency_attribute = self.water_movement_efficiency_attribute;
        let mut scene = self.scene.clone();
        let outcome = tick_scene(
            &mut world,
            &mut state,
            &mut scene,
            self.config,
            rules.release,
            |state, world| {
                Ok(tick_with_rules_and_rounding_and_restitution(
                    state,
                    world,
                    self.config,
                    rules,
                    self.landing_damage_rounding,
                    self.restitution_enabled,
                    self.modern_fall_damage,
                ))
            },
        )
        .expect("the snapshot's tick does not fail");
        TickOutputSnapshot {
            state,
            result: outcome.result,
            entity_pushes: outcome.entity_pushes,
            auto_spin_attack_ended: outcome.auto_spin_attack_ended,
            piston_deltas: outcome.piston_deltas,
            scene,
        }
    }
}

#[cfg(test)]
pub fn tick(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    config: PhysicsConfig,
) -> TickResult {
    tick_with_rules(state, world, config, VersionPhysicsRules::default())
}

#[cfg(test)]
pub fn tick_with_rules(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    config: PhysicsConfig,
    rules: VersionPhysicsRules,
) -> TickResult {
    tick_with_rules_and_rounding_and_restitution(
        state,
        world,
        config,
        rules,
        LandingDamageRounding::Ceil,
        false,
        false,
    )
}

pub(crate) fn push_by_fluid(
    state: &mut SimulationState,
    contact: FluidContact,
    scale: f64,
    release: MinecraftVersion,
) {
    let average = || contact.flow.scale(1.0 / f64::from(contact.flowing_blocks));
    let current = if release.at_least(26, 1, 0) {
        if contact.flowing_blocks == 0 || contact.flow.length_squared() < 9.999999747378752e-6 {
            return;
        }
        if state.is_player {
            average()
        } else {
            contact.flow.normalized(release)
        }
    } else {
        if !(contact.flow.length_in(release) > 0.0) {
            return;
        }
        let current = if contact.flowing_blocks > 0 {
            average()
        } else {
            contact.flow
        };
        if state.is_player {
            current
        } else {
            current.normalized(release)
        }
    };
    let mut push = current.scale(scale);
    if release.at_least(1, 16, 0)
        && state.velocity.x.abs() < 0.003
        && state.velocity.z.abs() < 0.003
        && push.length_in(release) < 0.0045000000000000005
    {
        push = push.normalized(release).scale(0.0045000000000000005);
    }
    state.velocity = state.velocity + push;
}

pub(crate) fn water_contact(
    world: &WorldSnapshot,
    bounds: Aabb,
    release: MinecraftVersion,
) -> FluidContact {
    if release.at_least(1, 14, 0) {
        world.fluid_contact(FluidState::Water, bounds, release)
    } else {
        legacy_fluid::fluid_contact_1_13(world, FluidState::Water, bounds)
    }
}

/// Entity's fluid query with its current vehicle context. Before 26.1 a boat excludes water
/// independently of lava; the modern shared scan adjusts both, retaining the original depth
/// origin (26.3 EntityFluidInteraction.java:57, 91).
pub(crate) fn entity_fluid_contact(
    state: &SimulationState,
    world: &WorldSnapshot,
    fluid: FluidState,
    release: MinecraftVersion,
) -> FluidContact {
    if release.at_least(26, 1, 0) {
        return state.fluid_interaction_area().map_or_else(FluidContact::default, |area| {
            world.fluid_contact_in_area(fluid, area, state.bounds().min.y, release)
        });
    }
    if fluid == FluidState::Water {
        if state.boat_excludes_water(release) {
            FluidContact::default()
        } else {
            water_contact(world, state.bounds(), release)
        }
    } else {
        world.fluid_contact(fluid, state.bounds(), release)
    }
}

/// Eye-fluid queries use the original eye position even when the boat changes the scan.
/// Before 1.16 any boat excludes the query; 1.16/1.16.1 use AABB.contains, and 1.16.2+
/// only inclusive vertical bounds (exact cached Entity.updateFluidOnEyes bytecode).
pub(crate) fn entity_eyes_in_fluid(
    state: &SimulationState,
    world: &WorldSnapshot,
    fluid: FluidState,
    release: MinecraftVersion,
) -> bool {
    let eye_height = state.eye_height.unwrap_or(state.height * 0.85);
    let eyes = (
        state.position.x,
        state.position.y + java_float(eye_height),
        state.position.z,
    );
    if release.at_least(26, 1, 0) {
        return state.fluid_interaction_area().is_some_and(|area| {
            world.eyes_in_fluid_in_area(fluid, area, eyes, release)
        });
    }
    if release.at_least(1, 9, 0) {
        if let Some(boat) = state.boat_vehicle.filter(|_| state.passenger) {
            if !release.at_least(1, 16, 0) {
                return false;
            }
            let sample_y = if release.at_least(1, 20, 5) {
                eyes.1
            } else {
                eyes.1 - f64::from(0.11111111_f32)
            };
            let inside_boat = if release.at_least(1, 16, 2) {
                boat.bounding_box.min.y <= sample_y && boat.bounding_box.max.y >= sample_y
            } else {
                boat.bounding_box.contains(Vec3::new(eyes.0, sample_y, eyes.2))
            };
            if !boat.underwater && inside_boat {
                return false;
            }
        }
    }
    world.eyes_in_fluid(fluid, state.bounds(), eyes, release)
}

/// Entity.move's `inLava = false; checkBlockCollision()` 1.14 - 1.16.1: a lava block of the box
/// (above its foot in 1.16 - 1.16.1, FluidBlock.onEntityCollision) sets it (1.14
/// Entity.java:636-638, 1.16 :657-659); from 1.16.2 the base tick's lava height does.
pub(crate) fn update_in_lava_after_move(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) {
    if release.at_least(1, 14, 0) && !release.at_least(1, 16, 2) {
        state.in_lava = if release.at_least(1, 16, 0) {
            world.has_lava_above_feet_inside(state.bounds())
        } else {
            world.has_fluid_block_inside(FluidState::Lava, state.bounds())
        };
    }
}

/// What the fluid travel handlers need from the tick once the move is done: the fluid the
/// entity travels in, its lava height against getFluidJumpThreshold, the water slow-down picked
/// before the move, the pre-move gravity and falling flag, and the Y the travel started at.
pub(crate) struct FluidTravelAfterMove {
    pub fluid: FluidState,
    pub fluid_height: f64,
    pub fluid_jump_threshold: f64,
    pub water_slowdown: f32,
    pub gravity: f64,
    pub going_down: bool,
    pub start_y: f64,
}

/// The fluid travel handler a profile selects with `fluid_travel_split`: LivingEntity.travel's
/// inline water and lava branches until 1.21.1 (1.21.1 LivingEntity.java:2126-2177), and the
/// travelInFluid method travel calls from 1.21.2 (1.21.2 LivingEntity.java:2202-2203, 2241-2293).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FluidTravelHandler {
    InlineTravel,
    TravelInFluid,
}

impl FluidTravelHandler {
    #[must_use]
    pub fn for_rules(rules: VersionPhysicsRules) -> Self {
        if rules.fluid_travel_split {
            Self::TravelInFluid
        } else {
            Self::InlineTravel
        }
    }

    pub(crate) fn after_move(
        self,
        state: &mut SimulationState,
        world: &WorldSnapshot,
        rules: VersionPhysicsRules,
        after_move: &FluidTravelAfterMove,
    ) {
        match self {
            Self::InlineTravel => legacy_fluid_travel_after_move(state, world, rules, after_move),
            Self::TravelInFluid => travel_in_fluid_after_move(state, world, rules, after_move),
        }
    }
}

/// LivingEntity.travel's inline fluid branches after the move, through 1.21.1: in water the
/// 0.2 climb on a horizontal collision (from 1.14), the water slow-down and 0.8F vertical drag
/// with getFluidFallingAdjustedMovement (before 1.13 the literal 0.02 sink), in lava 0.5 with the
/// shallow-lava branch from 1.16 and gravity / 4, then the 0.3 hop (1.21.1
/// LivingEntity.java:2146-2177, 1.12.2 EntityLivingBase.java travel).
pub(crate) fn legacy_fluid_travel_after_move(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    rules: VersionPhysicsRules,
    after_move: &FluidTravelAfterMove,
) {
    let legacy_fluids = legacy_fluid::applies(rules.release);
    let in_water = matches!(after_move.fluid, FluidState::Water | FluidState::Waterlogged);
    if in_water
        && state.collided_horizontally
        && rules.release.at_least(1, 14, 0)
        && climbable(world, state, rules.release)
    {
        state.velocity.y = 0.2;
    }
    fluid_horizontal_drag(state, rules, after_move);
    if legacy_fluids && after_move.fluid == FluidState::Water {
        legacy_fluid::sink_in_water(state);
    } else {
        fluid_travel_vertical(state, rules, after_move);
    }
    fluid_travel_hop(state, world, rules, after_move, legacy_fluids);
}

/// LivingEntity.travelInFluid after the move, from 1.21.2: in water the 0.2 climb, the water
/// slow-down and 0.8 vertical drag with getFluidFallingAdjustedMovement, otherwise (lava) 0.5 with
/// the shallow-lava branch and -gravity / 4 while the effective gravity is not 0, then the 0.3 hop
/// out of the fluid (1.21.2 LivingEntity.java:2264-2291).
pub(crate) fn travel_in_fluid_after_move(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    rules: VersionPhysicsRules,
    after_move: &FluidTravelAfterMove,
) {
    if matches!(after_move.fluid, FluidState::Water | FluidState::Waterlogged)
        && state.collided_horizontally
        && climbable(world, state, rules.release)
    {
        state.velocity.y = 0.2;
    }
    fluid_horizontal_drag(state, rules, after_move);
    fluid_travel_vertical(state, rules, after_move);
    fluid_travel_hop(state, world, rules, after_move, false);
}

fn fluid_horizontal_drag(
    state: &mut SimulationState,
    rules: VersionPhysicsRules,
    after_move: &FluidTravelAfterMove,
) {
    let drag = if after_move.fluid == FluidState::Lava {
        java_float(rules.lava_drag)
    } else {
        f64::from(after_move.water_slowdown)
    };
    state.velocity.x *= drag;
    state.velocity.z *= drag;
}

fn fluid_travel_vertical(
    state: &mut SimulationState,
    rules: VersionPhysicsRules,
    after_move: &FluidTravelAfterMove,
) {
    apply_fluid_travel_vertical(
        state,
        after_move.fluid,
        after_move.fluid_height,
        after_move.fluid_jump_threshold,
        rules,
        after_move.gravity,
        after_move.going_down,
    );
}

/// The 0.3 hop out of a fluid: isFree(dx, dy + 0.6 - getY() + startY, dz) after a horizontal
/// collision (before 1.13 World.getCollisionBoxes and isAnyLiquid, legacy_fluid::is_free).
fn fluid_travel_hop(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    rules: VersionPhysicsRules,
    after_move: &FluidTravelAfterMove,
    legacy_fluids: bool,
) {
    if !state.collided_horizontally {
        return;
    }
    let hop_bounds = state.bounds().translated(Vec3::new(
        state.velocity.x,
        state.velocity.y + 0.6000000238418579 - state.position.y + after_move.start_y,
        state.velocity.z,
    ));
    let context = entity_collision_context(state);
    let entity = collision_query_entity(state, &context);
    let free = if legacy_fluids {
        legacy_fluid::is_free(world, entity, hop_bounds, rules.release)
    } else {
        world.is_free_for_entity(hop_bounds, entity, rules.release)
    };
    if free {
        state.velocity.y = 0.30000001192092896;
    }
}

fn apply_fluid_travel_vertical(
    state: &mut SimulationState,
    fluid: FluidState,
    fluid_height: f64,
    fluid_jump_threshold: f64,
    rules: VersionPhysicsRules,
    gravity: f64,
    going_down: bool,
) {
    match fluid {
        FluidState::Water | FluidState::Waterlogged => {
            state.velocity.y *= java_float(rules.fluid_vertical_drag);
            if fluid_falling_gravity_enabled(state, rules, state.sprinting) {
                state.velocity.y = fluid_falling_adjusted_y(
                    gravity,
                    rules.water_gravity_divisor,
                    going_down,
                    state.velocity.y,
                );
            }
        }
        FluidState::Lava => {
            if rules.release.at_least(1, 16, 0) && fluid_height <= fluid_jump_threshold {
                state.velocity.y *= java_float(rules.fluid_vertical_drag);
                if fluid_falling_gravity_enabled(state, rules, state.sprinting) {
                    state.velocity.y = fluid_falling_adjusted_y(
                        gravity,
                        rules.water_gravity_divisor,
                        going_down,
                        state.velocity.y,
                    );
                }
            } else {
                state.velocity.y *= 0.5;
            }
            // while the effective gravity is not 0 from 1.20.5 (1.20.4 LivingEntity.java:2092,
            // 1.20.5 :2165, 26.3 :2473)
            let gravity_adds = !state.no_gravity
                && (gravity != 0.0 || !rules.release.at_least(1, 20, 5));
            if gravity_adds {
                state.velocity.y -= gravity / rules.lava_gravity_divisor;
                // Vec3.add(0.0, -gravity / 4.0, 0.0): its 0.0 turns the -0.0 a wall's restitution
                // leaves from 26.2 into 0.0 (26.3 LivingEntity.java:2474, Entity.java:867-872)
                state.velocity.x += 0.0;
                state.velocity.z += 0.0;
            }
        }
        FluidState::Empty => {}
    }
}

pub(crate) fn blocks_inside(
    state: &SimulationState,
    release: MinecraftVersion,
) -> Vec<(i32, i32, i32)> {
    let inset = if !release.at_least(1, 19, 3) {
        0.001
    } else if !release.at_least(1, 21, 2) {
        1.0e-7
    } else {
        f64::from(1.0e-5_f32)
    };
    let inside = state.bounds().deflate(Vec3::new(inset, inset, inset));
    let min = block_position(inside.min, release);
    let max = block_position(inside.max, release);
    let mut blocks = Vec::new();
    if release.at_least(1, 21, 2) {
        for z in min.2..=max.2 {
            for y in min.1..=max.1 {
                for x in min.0..=max.0 {
                    blocks.push((x, y, z));
                }
            }
        }
    } else {
        for x in min.0..=max.0 {
            for y in min.1..=max.1 {
                for z in min.2..=max.2 {
                    blocks.push((x, y, z));
                }
            }
        }
    }
    blocks
}

/// The last makeStuckInBlock of the blocks the entity is inside, in the order Entity.checkInsideBlocks
/// visits them: the deflated box before 1.21.2, every block the tick's moves sweep from 1.21.2
/// (cobwebs and bushes have the full inside shape: 1.21.4 Entity.java:1072-1100, 1.21.11
/// BlockBehaviour.java:316-318; powder snow its collision shape for the entity from 1.21.5, which
/// blocks_inside_moves tests).
fn stuck_speed_multiplier_inside(
    state: &SimulationState,
    world: &WorldSnapshot,
    inside: &[((i32, i32, i32), bool)],
    release: MinecraftVersion,
) -> Option<Vec3> {
    let in_powder_snow = world.effect_at(block_position(state.position, release)) == BlockEffect::PowderSnow;
    inside
        .iter()
        .filter_map(|&(position, _)| match world.effect_at(position) {
            _ if state.stuck_immune => None,
            BlockEffect::Web if state.web_immune => None,
            BlockEffect::Web if state.weaving => Some(Vec3::new(0.5, 0.25, 0.5)),
            BlockEffect::Web => Some(Vec3::new(0.25, java_float(0.05), 0.25)),
            BlockEffect::SweetBerryBush | BlockEffect::SweetBerrySapling
                if !state.sweet_berry_bush_immune =>
            {
                Some(Vec3::new(java_float(0.8), 0.75, java_float(0.8)))
            }
            // (1.17 PowderSnowBlock.java:50-52, 1.21.11 :62-64)
            BlockEffect::PowderSnow if in_powder_snow || state.boat || state.non_living => {
                Some(Vec3::new(java_float(0.9), 1.5, java_float(0.9)))
            }
            _ => None,
        })
        .last()
}

pub(crate) fn block_speed_factor(
    world: &WorldSnapshot,
    state: &SimulationState,
    support: Option<BlockPosition>,
    release: MinecraftVersion,
) -> f32 {
    if state.is_player && (state.flying || state.fall_flying) {
        return 1.0;
    }
    let factor_at = |position| match world.effect_at(position) {
        BlockEffect::SoulSand | BlockEffect::Honey => 0.4_f32,
        _ => 1.0,
    };
    let below = block_below_affecting_movement(world, state, support, release);
    let feet = block_position(state.position, release);
    let at_position = factor_at(feet);
    // the water block and the bubble column keep their own factor: the block below is not read
    // (1.15 Entity.java:676-684, 1.21.11 :996-1004, 26.3 :1131-1139)
    let feet_in_water = world.block(feet).water_block
        || matches!(
            world.effect_at(feet),
            BlockEffect::BubbleUp | BlockEffect::BubbleDown
        );
    let factor = if at_position == 1.0 && !feet_in_water {
        factor_at(below)
    } else {
        at_position
    };
    if release.at_least(1, 21, 0) {
        factor + state.movement_efficiency as f32 * (1.0 - factor)
    } else if release.at_least(1, 16, 0)
        && state.soul_speed > 0
        && matches!(
            world.effect_at(soul_speed_position(state, below, release)),
            BlockEffect::SoulSand | BlockEffect::SoulSoil
        )
    {
        1.0
    } else {
        factor
    }
}

/// The block LivingEntity.onSoulSpeedBlock reads: in 1.16 and 1.16.1 Entity.getBlockStateOn,
/// the block at floor(y - 0.2F) (1.16 LivingEntity.java:653-655, Entity.java:683-698; its fence
/// fallback finds a fence, wall or gate, never a soul speed block), from 1.16.2 the block below
/// that affects the movement (1.16.5 LivingEntity.java:664-666).
fn soul_speed_position(
    state: &SimulationState,
    below: BlockPosition,
    release: MinecraftVersion,
) -> BlockPosition {
    if release.at_least(1, 16, 2) {
        below
    } else {
        block_position(state.position - Vec3::new(0.0, f64::from(0.2_f32), 0.0), release)
    }
}

pub(crate) fn block_below_affecting_movement(
    world: &WorldSnapshot,
    state: &SimulationState,
    support: Option<BlockPosition>,
    release: MinecraftVersion,
) -> BlockPosition {
    let below = |offset: f64| {
        (
            floor_i32_for(release, state.position.x),
            floor_i32_for(release, state.position.y - offset),
            floor_i32_for(release, state.position.z),
        )
    };
    if !release.at_least(1, 15, 0) {
        return below(1.0);
    }
    if !release.at_least(1, 20, 0) {
        return below(0.5000001);
    }
    on_position(world, state, support, 0.500001, release)
}

/// Entity.getLandingPos and getOnPosLegacy, getOnPos(0.2F) from 1.20: before, the block at
/// floor(y - 0.2F), or the fence, wall or gate under it when that is air (1.8.9 Entity.java:645-653,
/// 1.14 :577-584, 1.19.4 :734-746; up to 1.13.2 by class, then by tag).
pub(crate) fn landing_position(
    world: &WorldSnapshot,
    state: &SimulationState,
    support: Option<BlockPosition>,
    release: MinecraftVersion,
) -> BlockPosition {
    if release.at_least(1, 20, 0) {
        return on_position(world, state, support, 0.2, release);
    }
    let landing = block_position(state.position - Vec3::new(0.0, f64::from(0.2_f32), 0.0), release);
    let under = (landing.0, landing.1 - 1, landing.2);
    if world.is_air_at(landing) && world.block(under).tags & FENCE_LIKE != 0 {
        under
    } else {
        landing
    }
}

/// Entity.getOnPos(offset) (getPosWithYOffset before 1.21.5) from 1.20: the height in the supporting
/// block's column, but the supporting block itself when it is a wall or gate, or a fence for an
/// offset up to 0.5 (1.20 Entity.java:804-821, 1.21.4 :864-881, 26.3 :1109-1124).
pub(crate) fn on_position(
    world: &WorldSnapshot,
    state: &SimulationState,
    support: Option<BlockPosition>,
    offset: f32,
    release: MinecraftVersion,
) -> BlockPosition {
    let below = block_position(state.position - Vec3::new(0.0, f64::from(offset), 0.0), release);
    let Some(block) = support else {
        return below;
    };
    let tags = world.block(block).tags;
    if tags & WALL_OR_GATE != 0 || (f64::from(offset) <= 0.5 && tags & FENCE_LIKE != 0) {
        block
    } else {
        (block.0, below.1, block.2)
    }
}

/// Entity.mainSupportingBlockPos (1.20+, checkSupportingBlock) of an entity that keeps none: the
/// block under an entity on the ground that supports it, else, after a move that leaves the box
/// over nothing, the one under the box where the move started.
pub(crate) fn main_supporting_block(
    world: &WorldSnapshot,
    state: &SimulationState,
    movement: Option<Vec3>,
    release: MinecraftVersion,
) -> Option<BlockPosition> {
    if !state.on_ground {
        return None;
    }
    let area = supporting_block_area(state);
    let context = entity_collision_context(state);
    world
        .supporting_block_position(area, state.position, &context, release)
        .or_else(|| {
            let movement = movement?;
            let start = area.translated(Vec3::new(-movement.x, 0.0, -movement.z));
            world.supporting_block_position(start, state.position, &context, release)
        })
}

/// The test area of Entity.checkSupportingBlock: the 1e-6 under the box.
fn supporting_block_area(state: &SimulationState) -> Aabb {
    let bounds = state.bounds();
    Aabb::new(
        Vec3::new(bounds.min.x, bounds.min.y - 1.0e-6, bounds.min.z),
        Vec3::new(bounds.max.x, bounds.min.y, bounds.max.z),
    )
}

/// Entity.mainSupportingBlockPos before a move: as the last move left it, else (a state no move
/// kept it in) from the position and the last move.
pub(crate) fn kept_supporting_block(
    world: &WorldSnapshot,
    state: &SimulationState,
    movement: Option<Vec3>,
    release: MinecraftVersion,
) -> Option<BlockPosition> {
    if state.supporting_block_kept {
        state.supporting_block
    } else {
        main_supporting_block(world, state, movement, release)
    }
}

/// Entity.checkSupportingBlock (1.20+) after a move: the block found under the box; with none,
/// unless the last check found none either (onGroundNoBlocks), the one under the box where the
/// move started; with no move to retry it, the block kept before. Off the ground, none.
pub(crate) fn check_supporting_block(
    world: &WorldSnapshot,
    state: &mut SimulationState,
    movement: Option<Vec3>,
    release: MinecraftVersion,
) -> Option<BlockPosition> {
    if state.on_ground {
        let area = supporting_block_area(state);
        let context = entity_collision_context(state);
        let mut found = world.supporting_block_position(area, state.position, &context, release);
        if found.is_some() || state.on_ground_no_blocks {
            state.supporting_block = found;
        } else if let Some(movement) = movement {
            let start = area.translated(Vec3::new(-movement.x, 0.0, -movement.z));
            found = world.supporting_block_position(start, state.position, &context, release);
            state.supporting_block = found;
        } else if !state.supporting_block_kept {
            state.supporting_block = None;
        }
        state.on_ground_no_blocks = found.is_none();
    } else {
        state.on_ground_no_blocks = false;
        state.supporting_block = None;
    }
    state.supporting_block_kept = true;
    state.supporting_block
}

pub(crate) fn apply_block_effects(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    support: Option<BlockPosition>,
    release: MinecraftVersion,
    inside: &[((i32, i32, i32), bool)],
) {
    if state.no_physics {
        return;
    }
    let stepping_carefully = state.stepping_carefully || state.sneaking;
    if state.on_ground {
        match world.effect_at(landing_position(world, state, support, release)) {
            BlockEffect::Slime if !stepping_carefully && state.velocity.y.abs() < 0.1 => {
                let step_factor = 0.4 + state.velocity.y.abs() * 0.2;
                state.velocity.x *= step_factor;
                state.velocity.z *= step_factor;
            }
            // MagmaBlock.stepOn: no fall-flying test; Frost Walker spares the boots' wearer, in
            // the block before 1.21 (1.20.5 MagmaBlock.java:29) and by the enchantment's
            // damage immunity to #burn_from_stepping from 1.21 (1.21.11 Enchantments.java:389-394);
            // a hot floor is fire to what is immune to it (1.10.2 MagmaBlock.java, 26.3 hurtServer)
            BlockEffect::Magma
                if !stepping_carefully && !state.frost_walker && takes_fire_damage(state) =>
            {
                deal_contact_damage(state, 1.0);
            }
            _ => {}
        }
    }
    apply_inside_block_effects(state, world, release, inside);
}

/// The entityInside part of apply_block_effects (Entity.checkInsideBlocks without the stepOn of
/// the block under the entity): the stuck speed, bubble columns, soul sand before 1.15 and honey.
pub(crate) fn apply_inside_block_effects(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    inside: &[((i32, i32, i32), bool)],
) {
    if state.no_physics {
        return;
    }
    if !(state.is_player && state.flying) {
        if let Some(multiplier) = stuck_speed_multiplier_inside(state, world, inside, release) {
            state.stuck_speed_multiplier = multiplier;
            state.fall_distance = 0.0;
        }
    }
    let pushed_by_bubbles = !(release.at_least(1, 21, 2) && state.is_player && state.flying);
    for &(position, precise) in inside {
        match world.effect_at(position) {
            effect @ (BlockEffect::BubbleUp | BlockEffect::BubbleDown)
                if pushed_by_bubbles && precise =>
            {
                let drag_down = effect == BlockEffect::BubbleDown;
                push_by_bubble_column(state, world, position, drag_down, release);
            }
            BlockEffect::SoulSand if !release.at_least(1, 15, 0) => {
                state.velocity.x *= 0.4;
                state.velocity.z *= 0.4;
            }
            BlockEffect::Honey if sliding_down_honey(state, position, release) => {
                let falling = honey_slide_falling(state.velocity.y, release);
                let scale = if falling < -0.13 {
                    -0.05 / falling
                } else {
                    1.0
                };
                let slide = if release.at_least(1, 21, 2) {
                    (-0.05 - 0.08) * java_float(0.98)
                } else {
                    -0.05
                };
                state.velocity =
                    Vec3::new(state.velocity.x * scale, slide, state.velocity.z * scale);
                state.fall_distance = 0.0;
            }
            _ => {}
        }
    }
}

/// The signals of the blocks the move leaves the entity inside, the list apply_block_effects
/// takes (Entity.checkInsideBlocks on the box after the move, deflated by 0.001, 1e-7 from 1.19.3,
/// the swept blocks from 1.21.2: 1.19.2 Entity.java:891-894, 1.19.3 :899-902, 1.21.4 :1072-1100),
/// and LivingEntity.aiStep's freezing after it (1.17 LivingEntity.java:2543-2559, 1.21.11
/// :2985-2995): Entity.isInPowderSnow, the cobweb, the contact damage of cactus, fire and lit
/// campfires (none under Frost Walker: 1.20.5 CampfireBlock.java:104, the enchantment's damage
/// immunity from 1.21; none of the fire ones to a fire-immune entity: 1.17 CampfireBlock.java:88,
/// AbstractFireBlock.java:122-128, 1.21.11 Entity.java:2903) and the freeze ticks, counted up in
/// powder snow and down by two outside it. From 1.21.5 the steps' InsideBlockEffectType.FREEZE
/// counts them up (apply_inside_fire_effects) and aiStep only takes two off outside powder snow
/// (1.21.5 LivingEntity.java:2778-2779). Fire and lava clear them through the fire ticks:
/// base_tick_fire before 1.21.5, the ignitions and CLEAR_FREEZE from 1.21.5.
/// A block's hurt is the server's: the local player's returns false (1.8.9
/// ClientPlayerEntity.java:90-92, 1.20.4 :151-153, 1.21 :154-156), any living entity's does on a
/// client (1.8.9 LivingEntity.java:672-674, 1.20.4 :1096-1098), and from 1.21.2 the blocks call a
/// server-only damage (1.21.3 MagmaBlock.java:30, 26.3 Entity.java:1969-1975).
fn deal_contact_damage(state: &mut SimulationState, amount: f64) {
    if !state.client_side {
        state.contact_damage += amount;
    }
}

/// Whether fire damage hurts the entity: EntityType.fireImmune and Fire Resistance refuse it in
/// LivingEntity.hurt (1.8.9 LivingEntity.java:682, 26.3 :1154).
fn takes_fire_damage(state: &SimulationState) -> bool {
    !state.fire_immune && !state.fire_resistance
}

/// The horizontal length of a motion (Vec3.horizontalDistance).
fn horizontal_speed(velocity: Vec3) -> f64 {
    (velocity.x * velocity.x + velocity.z * velocity.z).sqrt()
}

/// LivingEntity's flight into a wall on the server, from 1.9: `speed`, the motion's before the
/// glide changed it, less the motion Entity.move left, ten times over less 3, as a float, when
/// the move ended in a horizontal collision and that is above 0 (1.9.4 LivingEntity.java:1335,
/// 1363-1371; 1.20.4 :2133; 1.21.3 :2278-2286, 2314-2322; 26.3 :2504-2510, 2546-2553). The client
/// computes none of it, and 1.8.9 has no such damage source.
fn deal_wall_damage(state: &mut SimulationState, speed: f64, release: MinecraftVersion) {
    if state.client_side || !state.collided_horizontally || !release.at_least(1, 9, 0) {
        return;
    }
    let damage = ((speed - horizontal_speed(state.velocity)) * 10.0 - 3.0) as f32;
    if damage > 0.0 {
        state.wall_damage = f64::from(damage);
    }
}

fn apply_inside_block_signals(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    inside: &[((i32, i32, i32), bool)],
    moved: Vec3,
    release: MinecraftVersion,
) {
    let effects: Vec<BlockEffect> = inside
        .iter()
        .map(|&(position, _)| world.effect_at(position))
        .collect();
    state.in_web = effects.contains(&BlockEffect::Web);
    state.in_powder_snow = effects.contains(&BlockEffect::PowderSnow);
    if effects.contains(&BlockEffect::Cactus) {
        deal_contact_damage(state, 1.0);
    }
    // SweetBerryBushBlock.entityInside: a grown bush hurts a living entity that moved 0.003F or
    // more along x or z (1.14 SweetBerryBushBlock.java:62-67, 1.21 :80-85; the known movement
    // from 1.21.5, 1.21.5 :84-91, 26.3 :80-88)
    let pricked = f64::from(0.003_f32);
    if effects.contains(&BlockEffect::SweetBerryBush)
        && !state.sweet_berry_bush_immune
        && (moved.x.abs() >= pricked || moved.z.abs() >= pricked)
    {
        deal_contact_damage(state, 1.0);
    }
    let burns = takes_fire_damage(state);
    if effects.contains(&BlockEffect::Campfire) && !state.frost_walker && burns {
        deal_contact_damage(state, 1.0);
    }
    if effects.contains(&BlockEffect::SoulCampfire) && !state.frost_walker && burns {
        deal_contact_damage(state, 2.0);
    }
    if effects.contains(&BlockEffect::Fire) && burns {
        deal_contact_damage(state, 1.0);
    }
    if effects.contains(&BlockEffect::SoulFire) && burns {
        deal_contact_damage(state, 2.0);
    }
    let required_to_freeze = state.ticks_required_to_freeze.max(140);
    if state.client_side {
        // the client keeps the count the server's entity data gives it (LivingEntity.aiStep's "freezing" is the
        // server's: 1.17 LivingEntity.java:2546, 1.20.4 :2609, 1.21.5 :2776)
    } else if release.at_least(1, 21, 5) {
        if !state.in_powder_snow || state.powder_snow_immune {
            state.ticks_frozen = state.ticks_frozen.saturating_sub(2);
        }
    } else if state.in_powder_snow && !state.powder_snow_immune {
        state.ticks_frozen = state.ticks_frozen.saturating_add(1).min(required_to_freeze);
    } else {
        // only the count up is clamped: the count down is max(0, i - 2), so ticks over the limit
        // (a command's, the server's) fall by two (1.17 LivingEntity.java:2546-2552, 1.21.5
        // :2778-2779)
        state.ticks_frozen = state.ticks_frozen.saturating_sub(2);
    }
    // the server's alone (1.17 LivingEntity.java:2557, 1.21.11 :2989-2996, 26.3 :3074-3087)
    if !state.client_side
        && (state.tick_count as i32) % 40 == 0
        && state.ticks_frozen >= required_to_freeze
        && !state.powder_snow_immune
    {
        state.freeze_damage += 1.0;
    }
}

/// Entity.getFireImmuneTicks: 20 for a player, for any other entity 1 up to 1.21.5 and 0 from
/// 1.21.6 (1.17 PlayerEntity.java:434-436, Entity.java:176; 1.21.5 Player.java:517-519,
/// Entity.java:3230-3232; 1.21.6 Entity.java:3403-3405).
pub(crate) fn fire_immune_ticks(is_player: bool, release: MinecraftVersion) -> i32 {
    if is_player {
        20
    } else if release.at_least(1, 21, 6) {
        0
    } else {
        1
    }
}

/// Entity.remainingFireTicks until a state sets it: -getFireImmuneTicks up to 1.21.5 (1.17
/// Entity.java:176, 1.21.5 :212), the field's 0 from 1.21.6 (1.21.6 Entity.java:233).
fn fire_ticks(state: &SimulationState, release: MinecraftVersion) -> i32 {
    state
        .remaining_fire_ticks
        .unwrap_or(if release.at_least(1, 21, 6) {
            0
        } else {
            -fire_immune_ticks(state.is_player, release)
        })
}

/// Entity.setRemainingFireTicks; a player's is at most 1 while invulnerable from 1.16
/// (1.16 PlayerEntity.java:1951, 1.20.4 :1904-1905, 1.21.5 Player.java, 1.21.11 Player.java).
fn set_fire_ticks(state: &mut SimulationState, ticks: i32, release: MinecraftVersion) {
    let ticks = if state.is_player && state.invulnerable && release.at_least(1, 16, 0) {
        ticks.min(1)
    } else {
        ticks
    };
    state.remaining_fire_ticks = Some(ticks);
}

/// Entity.isOnFire: not fire-immune, with burning ticks left or, on a client, the server's flag
/// (1.8.9 Entity.java:1459-1462, 1.20.4 :2121-2124, 26.3 :2779-2782): a client that cleared its
/// ticks in lava still burns for the wet test after the move.
fn on_fire(state: &SimulationState, release: MinecraftVersion) -> bool {
    !state.fire_immune
        && (fire_ticks(state, release) > 0 || state.client_side && state.on_fire_flag)
}

/// Entity.extinguish / clearFire: setRemainingFireTicks(0) up to 1.21.8, so a fire-free entity's
/// negative ticks go to 0 too (1.21.4 Entity.java:578-580, 1.21.5 :581-583, 1.21.8 :608-610),
/// and min(0, ticks) from 1.21.9 (1.21.9 Entity.java:615-617).
fn clear_fire(state: &mut SimulationState, release: MinecraftVersion) {
    let ticks = if release.at_least(1, 21, 9) {
        fire_ticks(state, release).min(0)
    } else {
        0
    };
    set_fire_ticks(state, ticks, release);
}

/// Entity.setOnFireForTicks / igniteForTicks of a LivingEntity: the duration less 15% a level of
/// Fire Protection before 1.21 (1.17 ProtectionEnchantment.java:59-66, 1.20.5
/// LivingEntity.java:3515-3517), times the BURNING_TIME attribute from 1.21 (1.21
/// LivingEntity.java:3524-3526, 1.21.11 :3819-3821), kept when the ticks left are more; from
/// 1.21.5 the ignition clears the freeze ticks (1.21.5 Entity.java:565-571).
fn ignite_for_ticks(state: &mut SimulationState, ticks: i32, release: MinecraftVersion) {
    let ticks = if release.at_least(1, 21, 0) {
        ceil_i32_for(release, f64::from(ticks) * state.burning_time.unwrap_or(1.0))
    } else if state.fire_protection > 0 {
        ticks - floor_f32_for(release, ticks as f32 * (state.fire_protection as f32 * 0.15_f32))
    } else {
        ticks
    };
    if fire_ticks(state, release) < ticks {
        set_fire_ticks(state, ticks, release);
    }
    if release.at_least(1, 21, 5) {
        state.ticks_frozen = 0;
    }
}

/// A fire block's ignition (AbstractFireBlock.onEntityCollision, BaseFireBlock.fireIgnite from
/// 1.21.5) of an entity that is not fire-immune: before 1.21.2 a tick more, and eight seconds of
/// fire when that reaches 0 (1.17 AbstractFireBlock.java:121-129, 1.21 :127-133); from 1.21.2 a
/// tick more while the ticks are negative, else for a ServerPlayer alone nextInt(1, 3) more (the
/// state's server_fire_draws or server_fire_increment), and eight seconds of fire from 0 on (1.21.3
/// AbstractFireBlock.java:127-139, 1.21.11 BaseFireBlock.java:136-150, 26.3 :122-136).
fn fire_ignite(state: &mut SimulationState, release: MinecraftVersion) {
    if state.fire_immune {
        return;
    }
    if !release.at_least(1, 21, 2) {
        set_fire_ticks(state, fire_ticks(state, release) + 1, release);
        if fire_ticks(state, release) == 0 {
            ignite_for_ticks(state, 160, release);
        }
        return;
    }
    if fire_ticks(state, release) < 0 {
        set_fire_ticks(state, fire_ticks(state, release) + 1, release);
    } else if state.is_player && !state.client_side {
        let increment = match state.server_fire_draws.as_mut() {
            Some(draws) => draws.next().unwrap_or_else(|| {
                state.server_fire_draws_exhausted = true;
                1
            }),
            None => match state.server_fire_increment {
                Some(increment) => increment.clamp(1, 2),
                // vanilla draws here: with no draw given there is nothing to read, and a 1 would pass for one
                None => {
                    state.server_fire_draw_missing = true;
                    1
                }
            },
        };
        set_fire_ticks(state, fire_ticks(state, release) + increment, release);
    }
    if fire_ticks(state, release) >= 0 {
        ignite_for_ticks(state, 160, release);
    }
}

/// Entity.setOnFireFromLava / lavaIgnite: fifteen seconds of fire to an entity that is not
/// fire-immune (1.17 Entity.java:483-490, 1.21.5 :538-542).
fn lava_ignite(state: &mut SimulationState, release: MinecraftVersion) {
    if !state.fire_immune {
        ignite_for_ticks(state, 300, release);
    }
}

/// Entity.isWet (isInWaterRainOrBubble): in water, in the rain or in a bubble column at the block
/// position (1.17 Entity.java:1023-1038); the rain is the caller's in_rain.
fn is_wet(state: &SimulationState, world: &WorldSnapshot, release: MinecraftVersion) -> bool {
    state.in_water
        || state.in_rain
        || matches!(
            world.effect_at(block_position(state.position, release)),
            BlockEffect::BubbleUp | BlockEffect::BubbleDown
        )
}

/// The fire part of the server's Entity.baseTick and LivingEntity.baseTick, from 1.17 where the
/// fire ticks first reach a signal (the freeze ticks), with the fluid flags this tick's base tick
/// measured: water extinguishes before 1.21.5 (Entity.checkWaterState, 1.17 Entity.java:1065-1076);
/// burning ticks count down, four at a time for a fire-immune entity until 1.21.9 and cleared at
/// once from it (1.17 Entity.java:419-439, 1.21.8 :471-483, 1.21.9 / 26.3 :551-563), and before
/// 1.21.5 clear the freeze ticks (1.21.4 Entity.java:475-478); lava sets the entity on fire before
/// 1.21.5 (setOnFireFromLava, 1.21.4 Entity.java:485-488), its inside effect from 1.21.5; then
/// LivingEntity.baseTick puts a fire-immune entity out, and before 1.21.5 a wet one (1.17
/// LivingEntity.java:350-352, 391-397; 1.21.4 :403, 461-467; 1.21.5 :387-389).
pub(crate) fn base_tick_fire(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) {
    let modern = release.at_least(1, 21, 5);
    if !modern && release.at_least(1, 17, 0) && state.in_water {
        clear_fire(state, release);
    }
    if state.client_side {
        // Entity.baseTick on the client: no burning down, the ticks are cleared (1.17 Entity.java:419-420, 1.21.4
        // and 1.21.5 the else of `level() instanceof ServerLevel`, 1.21.9 the same)
        clear_fire(state, release);
    } else if fire_ticks(state, release) > 0 {
        if !state.fire_immune {
            set_fire_ticks(state, fire_ticks(state, release) - 1, release);
        } else if release.at_least(1, 21, 9) {
            clear_fire(state, release);
        } else {
            set_fire_ticks(state, fire_ticks(state, release) - 4, release);
            if fire_ticks(state, release) < 0 {
                clear_fire(state, release);
            }
        }
        if !modern {
            state.ticks_frozen = 0;
        }
    }
    if !modern && state.in_lava {
        lava_ignite(state, release);
    }
    if state.boat {
        return;
    }
    // LivingEntity.baseTick after Entity's: a fire-immune entity, and up to 1.21.8 any on the client, is cleared
    // (1.17 LivingEntity.java:350-351, 1.21.5 :387-388, 1.21.8 the same; gone from 1.21.9)
    let client_clears = state.client_side && !release.at_least(1, 21, 9);
    if state.fire_immune || client_clears || (!modern && is_wet(state, world, release)) {
        clear_fire(state, release);
    }
}

/// One InsideBlockEffectApplier.StepBasedCollector step's effects that reach the fire and freeze
/// ticks, applied in InsideBlockEffectType's order: FREEZE, CLEAR_FREEZE (1.21.9+), FIRE_IGNITE,
/// LAVA_IGNITE, EXTINGUISH (1.21.5 InsideBlockEffectType.java:6-15, 1.21.9 :6-16, 26.3 the same).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct InsideEffectStep {
    pub freeze: bool,
    pub clear_freeze: bool,
    pub fire_ignite: bool,
    pub lava_ignite: bool,
    pub extinguish: bool,
}

/// What a cauldron's entityInside does at once in 1.21.5 - 1.21.8, while the blocks are visited
/// and before any step's effects: the lava cauldron's lavaIgnite and a water or powder snow
/// cauldron's clearFire of a burning entity, each with the entity inside its content (1.21.5
/// LavaCauldronBlock.java:35-40, LayeredCauldronBlock.java:64-71, AbstractCauldronBlock.java:56-58).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DirectInsideEffect {
    LavaIgnite,
    ExtinguishBurning,
}

/// The inside-block effects of a move's visit from 1.21.5: the direct ones in visit order, then
/// the steps.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct InsideEffects {
    pub direct: Vec<DirectInsideEffect>,
    pub steps: Vec<InsideEffectStep>,
    /// How many of the steps' lava cells run Entity.lavaHurt after LAVA_IGNITE, one each
    /// (LavaFluid.entityInside's runAfter, 1.21.5 LavaFluid.java:116-120, 26.3 :the same).
    pub lava_hurts: u32,
}

/// The content height of a cauldron: 0.9375 of lava, (6 + 3 * level) / 16 of a layered (water or
/// powder snow) cauldron (1.17 LavaCauldronBlock.java, LeveledCauldronBlock.java; 1.21.9
/// LavaCauldronBlock.java:32-34, LayeredCauldronBlock.java:68-74).
fn cauldron_content(effect: BlockEffect) -> Option<f64> {
    match effect {
        BlockEffect::LavaCauldron => Some(0.9375),
        BlockEffect::LayeredCauldron(level) => Some((6.0 + f64::from(level) * 3.0) / 16.0),
        _ => None,
    }
}

/// AbstractCauldronBlock.isEntityTouchingFluid / isEntityInsideContent: the entity's feet below the
/// content and its box above a quarter of the block (1.17 AbstractCauldronBlock.java:52-54, 1.21.5
/// :56-58).
fn inside_cauldron_content(
    state: &SimulationState,
    world: &WorldSnapshot,
    position: (i32, i32, i32),
) -> bool {
    cauldron_content(world.effect_at(position)).is_some_and(|content| {
        let floor = f64::from(position.1);
        state.position.y < floor + content && state.bounds().max.y > floor + 0.25
    })
}

/// A block of #fire or Blocks.LAVA, the blocks that keep the fire ticks after a move before 1.21.5
/// (1.17 Entity.java:633-635, 1.21.4 :779).
pub(crate) fn fire_or_lava_block(world: &WorldSnapshot, position: (i32, i32, i32)) -> bool {
    matches!(
        world.effect_at(position),
        BlockEffect::Fire | BlockEffect::SoulFire
    ) || world.block(position).fluid == FluidState::Lava
}

/// The fire test after Entity.move before 1.17, in the box shrunk by 0.001. 1.16: each fire block
/// ignites (fire_ignite), then with no fire and no lava there ticks not above 0 go back to
/// -getFireImmuneTicks, and a wet burning entity does too (1.16.5 Entity.java:698-707). Before:
/// fire or lava in the box raises the ticks unless the entity is in water (eight seconds of fire
/// on reaching 0), else the same reset (1.8.9 Entity.java:709-725, 1.12.2 :875-890, 1.15 :630-646).
fn legacy_inside_fire(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    inside: &[((i32, i32, i32), bool)],
    reset_ticks: i32,
    release: MinecraftVersion,
) {
    let area = state.bounds().deflate(Vec3::new(0.001, 0.001, 0.001));
    let (min, max) = (block_position(area.min, release), block_position(area.max, release));
    let touches_fire = (min.0..=max.0).any(|x| {
        (min.1..=max.1).any(|y| (min.2..=max.2).any(|z| fire_or_lava_block(world, (x, y, z))))
    });
    if release.at_least(1, 16, 0) {
        for &(position, _) in inside {
            if matches!(world.effect_at(position), BlockEffect::Fire | BlockEffect::SoulFire) {
                fire_ignite(state, release);
            }
        }
        if !touches_fire && fire_ticks(state, release) <= 0 {
            set_fire_ticks(state, reset_ticks, release);
        }
        if on_fire(state, release) && is_wet(state, world, release) {
            set_fire_ticks(state, reset_ticks, release);
        }
        return;
    }
    let wet = state.in_water;
    if touches_fire {
        if !wet && !state.fire_immune {
            set_fire_ticks(state, fire_ticks(state, release) + 1, release);
            if fire_ticks(state, release) == 0 {
                ignite_for_ticks(state, 160, release);
            }
        }
    } else if fire_ticks(state, release) <= 0 {
        set_fire_ticks(state, reset_ticks, release);
    }
    // Entity.move asks for the ticks through 1.10.2 and for isOnFire from 1.11 (1.10.2
    // Entity.java:824, 1.11.2 :883)
    let burning = if release.at_least(1, 11, 0) {
        on_fire(state, release)
    } else {
        fire_ticks(state, release) > 0
    };
    if wet && burning {
        set_fire_ticks(state, reset_ticks, release);
    }
}

/// The fire and freeze effects of the blocks a move leaves the entity inside, from 1.17.
///
/// Before 1.21.5 (Entity.move's checkBlockCollision and the fire test after it, 1.17
/// Entity.java:630-648; tickBlockCollision from 1.21.2, 1.21.4 :763-797): each fire block ignites
/// (fire_ignite), a lava cauldron with the entity in its lava sets it on fire, a water or powder
/// snow cauldron puts a burning entity in it out (1.17 LavaCauldronBlock.java:24-28,
/// LeveledCauldronBlock.java:49-56); with no fire and no lava in the box shrunk by 1e-6 (the
/// blocks visited from 1.21.2) ticks not above 0 go back to -getFireImmuneTicks, and a burning
/// entity in powder snow or wet does too.
///
/// From 1.21.5 (Entity.applyEffectsFromBlocks, 1.21.5 Entity.java:797-821, 1.21.6 :830-854, 26.3
/// :915-941): the direct effects, then each step's (FREEZE, CLEAR_FREEZE, FIRE_IGNITE, LAVA_IGNITE,
/// EXTINGUISH), the rain's clearFire, and the reset to -getFireImmuneTicks: of an entity that
/// burned before and no longer does with no ticks left in 1.21.5, of any entity not burning that
/// no ignition raised this tick from 1.21.6.
pub(crate) fn apply_inside_fire_effects(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    inside: &[((i32, i32, i32), bool)],
    effects: &InsideEffects,
    release: MinecraftVersion,
) {
    if state.no_physics {
        return;
    }
    let reset_ticks = -fire_immune_ticks(state.is_player, release);
    if !release.at_least(1, 17, 0) {
        legacy_inside_fire(state, world, inside, reset_ticks, release);
        return;
    }
    if !release.at_least(1, 21, 5) {
        let mut in_powder_snow = false;
        let mut touches_fire = false;
        for &(position, _) in inside {
            match world.effect_at(position) {
                BlockEffect::Fire | BlockEffect::SoulFire => fire_ignite(state, release),
                BlockEffect::PowderSnow => in_powder_snow = true,
                BlockEffect::LavaCauldron if inside_cauldron_content(state, world, position) => {
                    lava_ignite(state, release);
                }
                BlockEffect::LayeredCauldron(_)
                    if on_fire(state, release) && inside_cauldron_content(state, world, position) =>
                {
                    clear_fire(state, release);
                }
                _ => {}
            }
            if release.at_least(1, 21, 2) {
                touches_fire |= fire_or_lava_block(world, position);
            }
        }
        // a dead entity keeps its count from 1.21.2 (1.21.3 Entity.java:769, 1.21.4 :778)
        let alive = !(release.at_least(1, 21, 2) && state.dead);
        if !release.at_least(1, 21, 2) {
            // World.getStatesInBoxIfLoaded: the cells from floor(min) to floor(max) (1.17
            // WorldView.java:37-45)
            let area = state.bounds().deflate(Vec3::new(1.0e-6, 1.0e-6, 1.0e-6));
            let (min, max) = (block_position(area.min, release), block_position(area.max, release));
            touches_fire = (min.0..=max.0).any(|x| {
                (min.1..=max.1)
                    .any(|y| (min.2..=max.2).any(|z| fire_or_lava_block(world, (x, y, z))))
            });
        }
        if !touches_fire && alive && fire_ticks(state, release) <= 0 {
            set_fire_ticks(state, reset_ticks, release);
        }
        if on_fire(state, release) && (in_powder_snow || is_wet(state, world, release)) {
            set_fire_ticks(state, reset_ticks, release);
        }
        return;
    }
    let was_on_fire = on_fire(state, release);
    let previous_ticks = fire_ticks(state, release);
    for effect in &effects.direct {
        match effect {
            DirectInsideEffect::LavaIgnite => lava_ignite(state, release),
            DirectInsideEffect::ExtinguishBurning => {
                if on_fire(state, release) {
                    clear_fire(state, release);
                }
            }
        }
    }
    let required_to_freeze = state.ticks_required_to_freeze.max(140);
    for step in &effects.steps {
        if step.freeze {
            state.in_powder_snow = true;
            if !state.powder_snow_immune {
                state.ticks_frozen = state.ticks_frozen.saturating_add(1).min(required_to_freeze);
            }
        }
        if step.clear_freeze {
            state.ticks_frozen = 0;
        }
        if step.fire_ignite {
            fire_ignite(state, release);
        }
        if step.lava_ignite {
            lava_ignite(state, release);
        }
        if step.extinguish {
            clear_fire(state, release);
        }
    }
    if state.in_rain {
        clear_fire(state, release);
    }
    let reset = if release.at_least(1, 21, 6) {
        // the server's alone from 1.21.6 (1.21.6 Entity.java:851, 26.3 :1028-1030)
        !state.client_side
            && !on_fire(state, release)
            && fire_ticks(state, release) <= previous_ticks
    } else {
        was_on_fire && !on_fire(state, release) && fire_ticks(state, release) <= 0
    };
    if reset {
        set_fire_ticks(state, reset_ticks, release);
    }
}

/// The blocks Entity.checkInsideBlocks gives entityInside from 1.21.2 and, from 1.21.5, the
/// effects of each step. From 1.21.5 a block passes when its getEntityInsideCollisionShape is
/// Shapes.block() or the move collides along with it, and its fluid's when the move collides
/// along with its AABB (1.21.5 Entity.java:1096-1124, 1.21.11 :1222-1255), with the release's
/// AABB.collidedAlongVector inset: powder snow's inside shape is its collision shape for the
/// entity, FALLING_COLLISION_SHAPE (0.9F high) past a fall of 2.5 (1.21.5 - 1.21.11
/// PowderSnowBlock.java:108-123, 26.3 :89-104), and from 1.21.9 a cauldron's is the cauldron with
/// its content (1.21.9 LavaCauldronBlock.java:19-20, 42-44; LayeredCauldronBlock.java:41-43,
/// 77-79). Each block's entityInside changes the entity on the way: a makeStuckInBlock, a bubble
/// column it is inside and a honey slide end the fall (1.21.11 Entity.java:2762-2777, 2824-2827,
/// HoneyBlock.java:106-115), which a later powder snow's shape reads.
pub(crate) fn blocks_inside_moves(
    state: &SimulationState,
    world: &WorldSnapshot,
    movements: &[Movement],
    release: MinecraftVersion,
) -> (Vec<((i32, i32, i32), bool)>, InsideEffects) {
    if !release.at_least(1, 21, 5) {
        let inside = blocks_visited(
            movements,
            state.bounds(),
            state.half_width,
            state.height,
            release,
        );
        return (inside, InsideEffects::default());
    }
    let box_at = |position: Vec3| {
        Aabb::new(
            Vec3::new(
                position.x - state.half_width,
                position.y,
                position.z - state.half_width,
            ),
            Vec3::new(
                position.x + state.half_width,
                position.y + state.height,
                position.z + state.half_width,
            ),
        )
    };
    let inset = if release.at_least(1, 21, 9) {
        1.0e-7
    } else {
        0.0
    };
    let filled_cauldrons = release.at_least(1, 21, 9);
    // the entity as the blocks visited so far leave it, for the fall a powder snow shape reads
    let mut running = *state;
    let mut effects = InsideEffects::default();
    let mut last_step = None;
    let inside = blocks_visited_where(
        movements,
        state.bounds(),
        state.half_width,
        state.height,
        release,
        |visit: &Visit| {
            let (x, y, z) = visit.position;
            if world.is_air_at(visit.position) {
                return false;
            }
            let corner = Vec3::new(f64::from(x), f64::from(y), f64::from(z));
            let moving = box_at(visit.from);
            let travel = visit.to - visit.from;
            let collides = |boxes: &[Aabb]| moving.collided_along_vector(travel, boxes, inset);
            let effect = world.effect_at(visit.position);
            let shape_hit = match effect {
                BlockEffect::PowderSnow => {
                    running.fall_distance <= 2.5
                        || collides(&[Aabb::new(
                            corner,
                            corner + Vec3::new(1.0, java_float(0.9), 1.0),
                        )])
                }
                BlockEffect::LavaCauldron | BlockEffect::LayeredCauldron(_) if filled_cauldrons => {
                    // Block.column(12, 4, top): the content, to 15/16 of lava
                    let top = match effect {
                        BlockEffect::LayeredCauldron(level) => {
                            (6.0 + f64::from(level) * 3.0) / 16.0
                        }
                        _ => 15.0 / 16.0,
                    };
                    let mut boxes = world.block_collision_boxes(visit.position);
                    boxes.push(Aabb::new(
                        corner + Vec3::new(2.0 / 16.0, 4.0 / 16.0, 2.0 / 16.0),
                        corner + Vec3::new(14.0 / 16.0, top, 14.0 / 16.0),
                    ));
                    collides(&boxes)
                }
                _ => true,
            };
            // a block whose inside shape the move can miss (powder snow, a cauldron) holds no fluid
            if !shape_hit {
                return false;
            }
            let fluid = world.block(visit.position).fluid;
            let fluid_hit = fluid != FluidState::Empty
                && collides(&[Aabb::new(
                    corner,
                    corner + Vec3::new(1.0, world.fluid_height_at(visit.position), 1.0),
                )]);
            if last_step != Some(visit.step) {
                last_step = Some(visit.step);
                effects.steps.push(InsideEffectStep::default());
            }
            let step = effects.steps.last_mut().expect("a step was just pushed");
            match effect {
                // PowderSnowBlock.entityInside: FREEZE and EXTINGUISH (1.21.5
                // PowderSnowBlock.java:79-93, 1.21.11 :86-100)
                BlockEffect::PowderSnow => {
                    step.freeze = true;
                    step.extinguish = true;
                }
                // BaseFireBlock: CLEAR_FREEZE from 1.21.9 and FIRE_IGNITE (1.21.5
                // BaseFireBlock.java:130-134, 1.21.9 :131-136)
                BlockEffect::Fire | BlockEffect::SoulFire => {
                    step.clear_freeze |= filled_cauldrons;
                    step.fire_ignite = true;
                }
                // CLEAR_FREEZE and LAVA_IGNITE, EXTINGUISH from 1.21.9 (1.21.9
                // LavaCauldronBlock.java:47-51, LayeredCauldronBlock.java:82-93)
                BlockEffect::LavaCauldron if filled_cauldrons => {
                    step.clear_freeze = true;
                    step.lava_ignite = true;
                }
                BlockEffect::LayeredCauldron(_) if filled_cauldrons => step.extinguish = true,
                BlockEffect::LavaCauldron
                    if inside_cauldron_content(state, world, visit.position) =>
                {
                    effects.direct.push(DirectInsideEffect::LavaIgnite);
                }
                BlockEffect::LayeredCauldron(_)
                    if inside_cauldron_content(state, world, visit.position) =>
                {
                    effects.direct.push(DirectInsideEffect::ExtinguishBurning);
                }
                _ => {}
            }
            // LavaFluid.entityInside: CLEAR_FREEZE from 1.21.9 and LAVA_IGNITE (1.21.5
            // LavaFluid.java:116-120, 1.21.9 :116-121); WaterFluid.entityInside: EXTINGUISH
            // (1.21.5 WaterFluid.java:87-90)
            if fluid_hit {
                if fluid == FluidState::Lava {
                    step.clear_freeze |= filled_cauldrons;
                    step.lava_ignite = true;
                    effects.lava_hurts += 1;
                } else {
                    step.extinguish = true;
                }
            }
            apply_inside_block_effects(
                &mut running,
                world,
                release,
                &[(visit.position, visit.precise)],
            );
            true
        },
    );
    (inside, effects)
}

/// The moves Entity.applyEffectsFromBlocks checks from 1.21.2: the tick's move, recorded by
/// Entity.move from 1.21.5 with the movement whose axis order splits it (the collided one, the
/// requested one from 1.21.9), and the rest of the way to the position.
pub(crate) fn movements_this_tick(
    state: &SimulationState,
    old_position: Vec3,
    requested: Vec3,
    moved: Vec3,
    release: MinecraftVersion,
) -> Vec<Movement> {
    let whole_tick = Movement {
        from: old_position,
        to: state.position,
        axis_order: None,
    };
    let moved_length = moved.length_squared();
    let recorded = moved_length > 1.0e-7 || requested.length_squared() - moved_length < 1.0e-7;
    if !release.at_least(1, 21, 5) || state.no_physics || !recorded {
        return vec![whole_tick];
    }
    let to = old_position + moved;
    let axis_order = if release.at_least(1, 21, 9) {
        requested
    } else {
        moved
    };
    let mut movements = vec![Movement {
        from: old_position,
        to,
        axis_order: Some(axis_order),
    }];
    if to.distance_squared(state.position) > 9.999999439624929e-11 {
        movements.push(Movement {
            from: to,
            to: state.position,
            axis_order: None,
        });
    }
    movements
}

/// Player simulates on its server as well as its authoritative client; Entity's default
/// AUTHORITATIVE_SIDE uses isLocalInstanceAuthoritative (26.2 Player.java:1200, Entity.java:3599;
/// 26.3 Player.java:1190, Entity.java:3721). Other 26.3 modes require the caller's exact result.
pub(crate) fn can_simulate_movement(state: &SimulationState, release: MinecraftVersion) -> bool {
    let inferred = (state.is_player && !state.client_side) || state.controlled_by_local_instance;
    if release.at_least(26, 3, 0) {
        state.can_simulate_movement.unwrap_or(inferred)
    } else {
        inferred
    }
}

/// BubbleColumnBlock.entityInside: a column with nothing above it
/// (Entity.onAboveBubbleCol) pushes harder and does not end a fall.
fn push_by_bubble_column(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    (x, y, z): (i32, i32, i32),
    drag_down: bool,
    release: MinecraftVersion,
) {
    let above = (x, y + 1, z);
    let nothing_above = if release.at_least(1, 21, 5) {
        !world.has_collision_shape(above) && world.fluid_at(above) == FluidState::Empty
    } else {
        world.is_air_at(above)
    };
    if nothing_above && state.boat {
        // the boat's own onAboveBubbleColumn moves it on the server alone (1.16
        // BoatEntity.java:205-215, 1.21.11 AbstractBoat.java:155-162, 26.3 :151-158)
        state.above_bubble_column = Some(drag_down);
        return;
    }
    // 26.3 pushes only an entity that simulates its movement, and the fall still ends in the
    // column (26.3 Entity.java:2974, 3006; 26.2 Entity.java:2883-2891, 2912-2921 has no test)
    if !release.at_least(26, 3, 0) || can_simulate_movement(state, release) {
        state.velocity.y = match (nothing_above, drag_down) {
            (true, true) => (state.velocity.y - 0.03).max(-0.9),
            (true, false) => (state.velocity.y + 0.1).min(1.8),
            (false, true) => (state.velocity.y - 0.03).max(-0.3),
            (false, false) => (state.velocity.y + 0.06).min(0.7),
        };
    }
    if !nothing_above {
        state.fall_distance = 0.0;
    }
}

fn honey_slide_falling(velocity_y: f64, release: MinecraftVersion) -> f64 {
    if release.at_least(1, 21, 2) {
        velocity_y / java_float(0.98) + 0.08
    } else {
        velocity_y
    }
}

fn sliding_down_honey(
    state: &SimulationState,
    (x, y, z): (i32, i32, i32),
    release: MinecraftVersion,
) -> bool {
    let reach = 0.4375 + state.half_width;
    !state.on_ground
        && state.position.y <= f64::from(y) + 0.9375 - 1.0e-7
        && honey_slide_falling(state.velocity.y, release) < -0.08
        && ((f64::from(x) + 0.5 - state.position.x).abs() + 1.0e-7 > reach
            || (f64::from(z) + 0.5 - state.position.z).abs() + 1.0e-7 > reach)
}

/// Where a move meets the entity colliders: since 1.14 the swept box grown by 1.0E-7
/// (Level.getEntityCollisions), since 26.3 first stretched up by the step height
/// (Entity.collide: `expandTowards(movement).expandTowards(0, maxUpStep(), 0)`); before, the
/// blocks' query (World.getCollisionBoxes).
pub(crate) fn entity_collision_query(
    swept: Aabb,
    query: Aabb,
    max_step: f32,
    release: MinecraftVersion,
) -> Aabb {
    if release.at_least(26, 3, 0) {
        swept
            .expand_towards(Vec3::new(0.0, f64::from(max_step), 0.0))
            .inflate(Vec3::new(1.0e-7, 1.0e-7, 1.0e-7))
    } else if release.at_least(1, 14, 0) {
        swept.inflate(Vec3::new(1.0e-7, 1.0e-7, 1.0e-7))
    } else {
        query
    }
}

/// LivingEntity.onClimbable; from 1.21.4 Player.onClimbable is false while flying (1.21.4
/// PlayerEntity.java:2219-2221, 26.3 Player.java:1876-1878; 1.21.3 has no override). From
/// 1.21.11 a fall-flying entity is not on a #can_glide_through block (1.21.11
/// LivingEntity.java:1675-1676, 26.3 :1671).
pub(crate) fn climbable(
    world: &WorldSnapshot,
    state: &SimulationState,
    release: MinecraftVersion,
) -> bool {
    !state.no_physics
        && !(state.is_player && state.flying && release.at_least(1, 21, 4))
        && (state.climbing
            || match world.effect_at(block_position(state.position, release)) {
                BlockEffect::Climbable | BlockEffect::Scaffolding => true,
                BlockEffect::GlideThroughClimbable => {
                    !(state.fall_flying && release.at_least(1, 21, 11))
                }
                _ => false,
            })
}

/// Before 1.17 an entity keeps its bounding box between ticks: Entity.move moves the box and takes
/// the position from it. A pose of another size refits it as Entity.refreshDimensions does.
pub(crate) fn kept_bounding_box(state: &SimulationState) -> Aabb {
    let around_position = state.bounds_around_position();
    let Some(kept) = state.bounding_box else {
        return around_position;
    };
    let kept_half_width = (kept.max.x - kept.min.x) / 2.0;
    // a moved box keeps its size up to rounding
    let same_size = |box_size: f64, size: f64| (box_size - size).abs() < 1.0e-4;
    let same_width = same_size(kept_half_width, state.half_width);
    if same_width && same_size(kept.max.y - kept.min.y, state.height) {
        kept
    } else if !same_width && state.half_width < kept_half_width {
        around_position
    } else {
        let width = state.half_width * 2.0;
        Aabb::new(kept.min, kept.min + Vec3::new(width, state.height, width))
    }
}

pub(crate) fn position_of_bounding_box(bounds: Aabb) -> Vec3 {
    Vec3::new(
        (bounds.min.x + bounds.max.x) / 2.0,
        bounds.min.y,
        (bounds.min.z + bounds.max.z) / 2.0,
    )
}

/// Whether the chunk column under the entity is loaded, as LivingEntity.travel asks before 1.14
/// (a client entity over one that is not sinks at 0.1): its x and z cast to int on 1.8, floored
/// since.
fn column_loaded(world: &WorldSnapshot, position: Vec3, release: MinecraftVersion) -> bool {
    let block = |value: f64| {
        if release.at_least(1, 9, 0) {
            floor_i32_for(release, value)
        } else {
            value as i32
        }
    };
    world.is_chunk_loaded(block(position.x) >> 4, block(position.z) >> 4)
}

/// BlockPos.containing (the BlockPos of doubles before 1.19.4, through Vec3i's Mth.floor).
pub(crate) fn block_position(position: Vec3, release: MinecraftVersion) -> (i32, i32, i32) {
    (
        floor_i32_for(release, position.x),
        floor_i32_for(release, position.y),
        floor_i32_for(release, position.z),
    )
}

/// LivingEntity.getFluidFallingAdjustedMovement: `divisor` is the 16.0 of every 1.13+ release
/// (1.13.2 LivingEntity.java:1674-1677, 1.20.4 :2219-2222, 1.21.11 :2547-2550, 26.3 :2611-2614).
pub(crate) fn fluid_falling_adjusted_y(
    gravity: f64,
    divisor: f64,
    falling: bool,
    current_y: f64,
) -> f64 {
    if falling
        && (current_y - 0.005).abs() >= 0.003
        && (current_y - gravity / divisor).abs() < 0.003
    {
        -0.003
    } else {
        current_y - gravity / divisor
    }
}

fn fluid_falling_gravity_enabled(
    state: &SimulationState,
    rules: VersionPhysicsRules,
    sprint_active: bool,
) -> bool {
    !sprint_active
        && !state.no_gravity
        && (!rules.fluid_falling_checks_gravity_argument || rules.gravity != 0.0)
}

fn flying_speed(state: &SimulationState, release: MinecraftVersion) -> f64 {
    if state.flying && !state.passenger {
        let speed = state.flying_speed as f32;
        return f64::from(if state.sprinting { speed * 2.0 } else { speed });
    }
    if !state.is_player {
        return java_float(0.02);
    }
    let sprinting = if release.at_least(1, 19, 4) {
        state.sprinting
    } else {
        state.was_sprinting
    };
    if !sprinting {
        java_float(0.02)
    } else if release.at_least(1, 19, 4) {
        f64::from(0.025999999_f32)
    } else if release.at_least(1, 18, 2) {
        f64::from(0.02_f32 + 0.006_f32)
    } else {
        f64::from((f64::from(0.02_f32) + 0.005999999865889549) as f32)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FluidJump {
    Swim,
    Ground,
    None,
}

/// LivingEntity.aiStep's jump: swim up (jumpInLiquid) in fluid deeper than
/// the jump threshold or off the ground, else jump from the ground. Before
/// 1.16 the water height is held against 0.4 and any lava swims up; before
/// 1.13 any water or lava the entity is in does.
fn fluid_jump(
    state: &SimulationState,
    water_height: f64,
    lava_height: f64,
    threshold: f64,
    release: MinecraftVersion,
) -> FluidJump {
    if legacy_fluid::applies(release) {
        return if state.in_water || state.in_lava {
            FluidJump::Swim
        } else if state.on_ground {
            FluidJump::Ground
        } else {
            FluidJump::None
        };
    }
    if !release.at_least(1, 16, 0) {
        let in_water = water_height > 0.0;
        return if in_water && (!state.on_ground || water_height > 0.4) || state.in_lava {
            FluidJump::Swim
        } else if state.on_ground || in_water && water_height <= 0.4 {
            FluidJump::Ground
        } else {
            FluidJump::None
        };
    }
    let height = if state.in_lava {
        lava_height
    } else {
        water_height
    };
    let in_water = state.in_water && height > 0.0;
    let swims = !state.on_ground || height > threshold;
    if (in_water || state.in_lava) && swims {
        FluidJump::Swim
    } else if state.on_ground || in_water && height <= threshold {
        FluidJump::Ground
    } else {
        FluidJump::None
    }
}

/// LivingEntity.jumpFromGround with the power of the jump: from 1.20.5 nothing up to 1.0E-5F jumps
/// (26.3 LivingEntity.java:2303-2312), and the sprint push multiplies a double, before a float.
pub(crate) fn jump_from_ground(state: &mut SimulationState, power: f64, release: MinecraftVersion) {
    if release.at_least(1, 20, 5) && power as f32 <= 1.0e-5 {
        return;
    }
    state.velocity.y = if release.at_least(1, 21, 2) {
        power.max(state.velocity.y)
    } else {
        power
    };
    if state.sprinting {
        let (x, z) = sprint_jump_push(state.yaw, release);
        state.velocity.x += x;
        state.velocity.z += z;
    }
}

pub(crate) use crate::math::{friction_influenced_speed, sprint_jump_push};

pub(crate) fn jump_power(
    state: &SimulationState,
    config: PhysicsConfig,
    release: MinecraftVersion,
    block_jump_factor: f32,
) -> f64 {
    let strength = state.jump_strength.unwrap_or(config.jump_velocity);
    let power = strength as f32 * block_jump_factor;
    let boost = state
        .jump_boost_amplifier
        .map_or(0.0, |amplifier| 0.1_f32 * (amplifier as f32 + 1.0));
    let boost_added_in_double =
        !release.at_least(1, 14, 0) || (release.at_least(1, 17, 1) && !release.at_least(1, 20, 0));
    if boost_added_in_double {
        f64::from(power) + f64::from(boost)
    } else {
        f64::from(power + boost)
    }
}

fn glide(state: &mut SimulationState, gravity: f64, release: MinecraftVersion) {
    let look = state.look;
    let look_horizontal = (look.x * look.x + look.z * look.z).sqrt();
    let horizontal_speed =
        (state.velocity.x * state.velocity.x + state.velocity.z * state.velocity.z).sqrt();
    let look_factor = if release.at_least(1, 21, 2) {
        1.0
    } else {
        (look.length_in(release) / 0.4).min(1.0)
    };
    let lift = if release.at_least(1, 18, 2) {
        let cos = trig::cos(state.pitch);
        cos * cos * look_factor
    } else {
        let cos = mth_cos(state.pitch, release);
        java_float(cos * cos * look_factor)
    };
    let mut velocity = state.velocity;
    velocity.y += if release.at_least(1, 13, 0) {
        gravity * (-1.0 + lift * 0.75)
    } else {
        -0.08 + lift * 0.06
    };
    if velocity.y < 0.0 && look_horizontal > 0.0 {
        let dive = velocity.y * -0.1 * lift;
        velocity = velocity
            + Vec3::new(
                look.x * dive / look_horizontal,
                dive,
                look.z * dive / look_horizontal,
            );
    }
    if state.pitch < 0.0 && look_horizontal > 0.0 {
        let climb = horizontal_speed * -mth_sin(state.pitch, release) * 0.04;
        velocity = velocity
            + Vec3::new(
                -look.x * climb / look_horizontal,
                climb * 3.2,
                -look.z * climb / look_horizontal,
            );
    }
    if look_horizontal > 0.0 {
        velocity = velocity
            + Vec3::new(
                (look.x / look_horizontal * horizontal_speed - velocity.x) * 0.1,
                0.0,
                (look.z / look_horizontal * horizontal_speed - velocity.z) * 0.1,
            );
    }
    state.velocity = Vec3::new(
        velocity.x * java_float(0.99),
        velocity.y * java_float(0.98),
        velocity.z * java_float(0.99),
    );
}

fn movement_input(state: &SimulationState, release: MinecraftVersion) -> Vec3 {
    let [strafe, forward] = if !state.is_player {
        scale_input([state.input.x as f32, state.input.z as f32], 0.98)
    } else if release.at_least(1, 21, 5) {
        modified_input(input_move_vector(state, release), state)
    } else {
        scale_input(input_move_vector(state, release), 0.98)
    };
    Vec3::new(f64::from(strafe), state.input.y, f64::from(forward))
}

/// The player's Input.getMoveVector during the move: the keys normalized from 1.21.5, before it
/// the impulses LocalPlayer scaled for sneaking and using an item.
fn input_move_vector(state: &SimulationState, release: MinecraftVersion) -> [f32; 2] {
    let keys = [state.input.x as f32, state.input.z as f32];
    if release.at_least(1, 21, 5) {
        let length = (keys[0] * keys[0] + keys[1] * keys[1]).sqrt();
        return if length < 1.0e-4 {
            [0.0, 0.0]
        } else {
            [keys[0] / length, keys[1] / length]
        };
    }
    let item_slows_first = release.at_least(1, 21, 4);
    let slowed_by_item = slowed_by_using_item(state);
    let mut input = keys;
    if slowed_by_item && item_slows_first {
        input = scale_input(input, 0.2);
    }
    if state.moving_slowly.unwrap_or(state.sneaking) {
        input = if release.at_least(1, 19, 0) {
            scale_input(input, sneaking_speed(state))
        } else {
            input.map(|impulse| (f64::from(impulse) * 0.3) as f32)
        };
    }
    if slowed_by_item && !item_slows_first {
        input = scale_input(input, 0.2);
    }
    // LocalPlayer.aiStep undoes the sneak slowdown of a flying player, 1.9 - 1.14 (1.9.4
    // ClientPlayerEntity.java:712-715, 1.14 :717-721); 1.8 only moves it down (1.8.9
    // ClientPlayerEntity.java:596-603), and from 1.15 a flying player does not crouch
    if state.flying && state.sneaking && release.at_least(1, 9, 0) && !release.at_least(1, 15, 0) {
        input = input.map(|impulse| (f64::from(impulse) / 0.3) as f32);
    }
    input
}

/// LocalPlayer's item-use slowdown spares a passenger in every release: isUsingItem() && !hasVehicle()
/// (1.8.9 ClientPlayerEntity.java:540, 1.13.2 :703, 1.14 :621, 1.20.4 :662, 1.21.4 :667), in
/// modifyInput from 1.21.5 (1.21.5 LocalPlayer.java:629, 26.3 :695).
fn slowed_by_using_item(state: &SimulationState) -> bool {
    state.using_item && !state.passenger
}

fn modified_input(move_vector: [f32; 2], state: &SimulationState) -> [f32; 2] {
    if move_vector == [0.0, 0.0] {
        return move_vector;
    }
    let mut input = scale_input(move_vector, 0.98);
    if slowed_by_using_item(state) {
        input = scale_input(input, state.item_use_speed_multiplier.unwrap_or(0.2));
    }
    if state.moving_slowly.unwrap_or(state.sneaking) {
        input = scale_input(input, sneaking_speed(state));
    }
    let length = (input[0] * input[0] + input[1] * input[1]).sqrt();
    if length <= 0.0 {
        return input;
    }
    let direction = scale_input(input, 1.0 / length);
    let (x, y) = (direction[0].abs(), direction[1].abs());
    let ratio = if y > x { x / y } else { y / x };
    scale_input(direction, (length * (1.0 + ratio * ratio).sqrt()).min(1.0))
}

fn scale_input(input: [f32; 2], factor: f32) -> [f32; 2] {
    [input[0] * factor, input[1] * factor]
}

fn sneaking_speed(state: &SimulationState) -> f32 {
    state.sneaking_speed.map_or(0.3, |speed| speed as f32)
}

pub(crate) fn mth_sin(radians: f64, release: MinecraftVersion) -> f64 {
    if release.at_least(1, 21, 11) {
        java_sin(radians)
    } else {
        java_sin_legacy(radians as f32)
    }
}

pub(crate) fn mth_cos(radians: f64, release: MinecraftVersion) -> f64 {
    if release.at_least(1, 21, 11) {
        java_cos(radians)
    } else {
        java_cos_legacy(radians as f32)
    }
}

pub(crate) fn relative_movement(
    input: Vec3,
    speed: f64,
    yaw: f64,
    release: MinecraftVersion,
) -> Vec3 {
    if !release.at_least(1, 14, 0) {
        return relative_movement_in_float(input, speed as f32, yaw as f32);
    }
    let length_squared = input.x * input.x + input.y * input.y + input.z * input.z;
    if length_squared < 1.0e-7 {
        return Vec3::ZERO;
    }
    let direction = if length_squared > 1.0 {
        input.normalized(release)
    } else {
        input
    };
    let scaled = direction.scale(speed);
    let sin = mth_sin(yaw, release);
    let cos = mth_cos(yaw, release);
    Vec3::new(
        scaled.x * cos - scaled.z * sin,
        scaled.y,
        scaled.z * cos + scaled.x * sin,
    )
}

/// A float yaw in degrees as radians the way moveFlying turns it: `yaw * (float) Math.PI /
/// 180.0F` (two float roundings) before 1.9 (1.8.9 Entity.java:942-943, HorseBaseEntity.java:1091),
/// `yaw * (float) (Math.PI / 180.0)` from 1.9 (1.9.4 Entity.java:1050-1051).
pub(crate) fn yaw_radians(degrees: f32, release: MinecraftVersion) -> f64 {
    if release.at_least(1, 9, 0) {
        f64::from(degrees * 0.017453292)
    } else {
        f64::from(degrees * 3.1415927 / 180.0)
    }
}

/// The radians the player's moveFlying turns its yaw into: `yaw_radians` of the float degrees
/// when the state has them, else the radians it holds.
fn move_relative_yaw(state: &SimulationState, release: MinecraftVersion) -> f64 {
    state
        .yaw_degrees
        .map_or(state.yaw, |degrees| yaw_radians(degrees, release))
}

fn relative_movement_in_float(input: Vec3, speed: f32, yaw: f32) -> Vec3 {
    let (strafe, up, forward) = (input.x as f32, input.y as f32, input.z as f32);
    let length_squared = strafe * strafe + up * up + forward * forward;
    if length_squared < 1.0e-4 {
        return Vec3::ZERO;
    }
    let scale = speed / length_squared.sqrt().max(1.0);
    let (strafe, up, forward) = (strafe * scale, up * scale, forward * scale);
    let sin = java_sin_legacy(yaw) as f32;
    let cos = java_cos_legacy(yaw) as f32;
    Vec3::new(
        f64::from(strafe * cos - forward * sin),
        f64::from(up),
        f64::from(forward * cos + strafe * sin),
    )
}

fn negligible_velocity(config: PhysicsConfig, release: MinecraftVersion) -> f64 {
    let customized = config.negligible_velocity != PhysicsConfig::default().negligible_velocity;
    if customized || release.at_least(1, 9, 0) {
        config.negligible_velocity
    } else {
        0.005
    }
}

pub(crate) fn compute_modified_friction(friction: f64, modifier: f64) -> f64 {
    f64::from((1.0 - (1.0 - friction as f32) * modifier as f32).clamp(0.0, 1.0))
}

fn effective_modifier(modifier: f64, present: bool) -> f64 {
    if present || modifier != 0.0 {
        modifier
    } else {
        1.0
    }
}

pub(crate) fn moves_position(requested: Vec3, movement: Vec3, release: MinecraftVersion) -> bool {
    let length_squared = movement.length_squared();
    length_squared > 1.0e-7
        || (release.at_least(1, 21, 2) && requested.length_squared() - length_squared < 1.0e-7)
}

pub(crate) fn horizontal_collision_is_minor(
    state: &SimulationState,
    movement: Vec3,
    release: MinecraftVersion,
) -> bool {
    let input = movement_input(state, release);
    let sin = mth_sin(state.yaw, release);
    let cos = mth_cos(state.yaw, release);
    let input_x = input.x * cos - input.z * sin;
    let input_z = input.z * cos + input.x * sin;
    let input_length_squared = input_x * input_x + input_z * input_z;
    let movement_length_squared = movement.x * movement.x + movement.z * movement.z;
    if input_length_squared < 9.999999747378752e-6 || movement_length_squared < 9.999999747378752e-6
    {
        return false;
    }
    let dot = input_x * movement.x + input_z * movement.z;
    (dot / (input_length_squared * movement_length_squared).sqrt()).acos() < 0.13962633907794952
}

/// Player.maybeBackOffFromEdge from 1.14 (Entity.move's sneak edge check before): a sneaking
/// player's move backs off while it would leave the ground below by the step height (the float
/// maxUpStep).
/// - 1.14 - 1.16.1: only on the ground, the whole box moved by the step down meets no collision
///   (client1.14.4 Entity.java:600-640, 1.16 PlayerEntity.java:1035-1081).
/// - 1.16.2 - 1.18.2: also not flying, and above the ground: on it, or the whole box moved down by
///   what is left of the step after the fall distance (both floats) meets a collision (1.16.5
///   PlayerEntity.java:1116-1120, 1.18 :1068-1072).
/// - 1.19 - 1.20.4: also not while the move rises (1.19 PlayerEntity.java:1059-1064).
/// - 1.20.5 - 1.21.4: the boxes are the feet's slab from minY less the step and the float 1.0E-5F
///   (1.20.5 PlayerEntity.java:1121-1128, 1.21.4 :1124-1132); the fall distance a float yet.
/// - 1.21.5 on: the slab is 1e-7 shorter than 1e-5 below and 1e-7 in all round, the fall distance
///   a double (1.21.5 Player.java:1077-1085, client26.3 :876-883).
pub(crate) fn back_off_from_edge(
    state: &SimulationState,
    world: &WorldSnapshot,
    context: &EntityCollisionContext,
    delta: Vec3,
    max_down_step: f64,
    release: MinecraftVersion,
) -> Vec3 {
    if !release.at_least(1, 14, 0) {
        return back_off_from_edge_before_1_14(
            state,
            world,
            context,
            delta,
            max_down_step,
            release,
        );
    }
    let step = max_down_step as f32;
    let checks_above_ground = release.at_least(1, 16, 2);
    if state.no_physics
        || !state.is_player
        || !state.sneaking
        || (checks_above_ground && state.flying)
        || (release.at_least(1, 19, 0) && delta.y > 0.0)
        || (!checks_above_ground && !state.on_ground)
    {
        return delta;
    }
    let bounds = state.bounds();
    let entity = collision_query_entity(state, context);
    let feet_slab = release.at_least(1, 20, 5);
    // the box moved by (x, -fall, z): the whole box before 1.20.5, else the feet's slab
    let can_fall = |x: f64, z: f64, fall: f64| {
        let lowered = if !feet_slab {
            bounds.translated(Vec3::new(x, -fall, z))
        } else if release.at_least(1, 21, 5) {
            Aabb::new(
                Vec3::new(
                    bounds.min.x + 1.0e-7 + x,
                    bounds.min.y - fall - 1.0e-7,
                    bounds.min.z + 1.0e-7 + z,
                ),
                Vec3::new(
                    bounds.max.x - 1.0e-7 + x,
                    bounds.min.y,
                    bounds.max.z - 1.0e-7 + z,
                ),
            )
        } else {
            Aabb::new(
                Vec3::new(
                    bounds.min.x + x,
                    bounds.min.y - fall - f64::from(1.0e-5_f32),
                    bounds.min.z + z,
                ),
                Vec3::new(bounds.max.x + x, bounds.min.y, bounds.max.z + z),
            )
        };
        world.no_collision_for_entity(lowered, entity, release)
    };
    if checks_above_ground {
        let (falls_short, rest_of_step) = if release.at_least(1, 21, 5) {
            let fall_distance = state.fall_distance;
            (
                fall_distance < f64::from(step),
                f64::from(step) - fall_distance,
            )
        } else {
            let fall_distance = state.fall_distance as f32;
            (fall_distance < step, f64::from(step - fall_distance))
        };
        let above_ground = state.on_ground || (falls_short && !can_fall(0.0, 0.0, rest_of_step));
        if !above_ground {
            return delta;
        }
    }
    back_off_while(delta, |x, z| can_fall(x, z, f64::from(step)))
}

/// The entity a no-collision query of the entity's own is made for.
pub(crate) fn collision_query_entity<'a>(
    state: &SimulationState,
    context: &'a EntityCollisionContext,
) -> CollisionQueryEntity<'a> {
    CollisionQueryEntity {
        context,
        bounds: state.bounds(),
        position: state.position,
        outside_border: state.outside_border,
    }
}

/// Entity.move's sneak edge check before 1.14: whole box moved down by 1, from 1.11 by the step
/// height, must meet no collision box for a grounded sneaking player's move to back off.
/// World.getCollisionBoxes(entity, box) gives the blocks' boxes, the cells outside the border as
/// stone and the boxes of the entities that meet the query (1.8.9 Entity.java:487, 1.12.2
/// Entity.java:616 and World.java:1180-1203, 1.13.2 Entity.java:627 through World.java:1805-1808).
fn back_off_from_edge_before_1_14(
    state: &SimulationState,
    world: &WorldSnapshot,
    context: &EntityCollisionContext,
    delta: Vec3,
    step_height: f64,
    release: MinecraftVersion,
) -> Vec3 {
    if state.no_physics || !state.is_player || !state.sneaking || !state.on_ground {
        return delta;
    }
    let drop = if release.at_least(1, 11, 0) {
        f64::from(step_height as f32)
    } else {
        1.0
    };
    let bounds = state.bounds();
    let entity = collision_query_entity(state, context);
    // the box moved as it is, 1.13.x included: `getBoundingBox().offset(x, -stepHeight, z)` with
    // no deflate (1.13.2 Entity.java:627, 639, 650)
    let can_fall = |x: f64, z: f64| {
        let lowered = bounds.translated(Vec3::new(x, -drop, z));
        // (World.getCollisionBoxes before 1.13: a box of no height, one layer of snow, too)
        world.no_collision_for_entity(lowered, entity, release)
    };
    back_off_while(delta, can_fall)
}

/// The 0.05 steps by which a sneaking move backs off while it would leave the ground: on x, on z,
/// then on both while the diagonal move would.
fn back_off_while(delta: Vec3, can_fall: impl Fn(f64, f64) -> bool) -> Vec3 {
    // (no step takes a NaN to zero, and the walks below would not end)
    if delta.x.is_nan() || delta.z.is_nan() {
        return delta;
    }
    let mut x = delta.x;
    let mut z = delta.z;
    let step_x = x.signum() * 0.05;
    let step_z = z.signum() * 0.05;
    while x != 0.0 && can_fall(x, 0.0) {
        if x.abs() <= 0.05 {
            x = 0.0;
        } else {
            x -= step_x;
        }
    }
    while z != 0.0 && can_fall(0.0, z) {
        if z.abs() <= 0.05 {
            z = 0.0;
        } else {
            z -= step_z;
        }
    }
    while x != 0.0 && z != 0.0 && can_fall(x, z) {
        if x.abs() <= 0.05 {
            x = 0.0;
        } else {
            x -= step_x;
        }
        if z.abs() <= 0.05 {
            z = 0.0;
        } else {
            z -= step_z;
        }
    }
    Vec3::new(x, delta.y, z)
}

/// Entity.isInWall, which LivingEntity (Player before 1.14) answers false for while sleeping.
/// Before 1.16 a suffocating block in a cell under any of 8 points 0.1 tall and 0.8 of the width
/// around the eye (Entity.java:1291-1311 in 1.8.9, :1572-1592 in 1.15); in 1.16 a suffocating
/// collision shape meeting a box 0.1 tall around the eye (:1640-1649 in 1.16.5), 1e-6 tall from
/// 1.17 (:1662-1670), or the world border the entity's box touches from inside; 1.18 tests each
/// block's shape moved to the eye instead of to its cell (client1.18.1 Entity.java:1698-1710);
/// from 1.19 each non-air suffocating block's shape at its
/// cell (:1676-1694 in 1.19, client1.21.11 :2192-2203).
fn is_in_wall(state: &SimulationState, world: &WorldSnapshot, release: MinecraftVersion) -> bool {
    if state.no_physics || state.sleeping {
        return false;
    }
    let eye_height = state.eye_height.unwrap_or(state.height * 0.85) as f32;
    let width = (state.half_width * 2.0) as f32;
    if !release.at_least(1, 16, 0) {
        return (0..8).any(|corner: i32| {
            let offset = |bit: i32| ((corner >> bit) % 2) as f32 - 0.5;
            let y = state.position.y + f64::from(offset(0) * 0.1) + f64::from(eye_height);
            let x = state.position.x + f64::from(offset(1) * width * 0.8);
            let z = state.position.z + f64::from(offset(2) * width * 0.8);
            world.is_in_wall_block((
                floor_i32_for(release, x),
                floor_i32_for(release, y),
                floor_i32_for(release, z),
            ))
        });
    }
    let half_width = f64::from(width * 0.8) / 2.0;
    let half_height = if release.at_least(1, 17, 0) {
        1.0e-6 / 2.0
    } else {
        f64::from(0.1_f32) / 2.0
    };
    let eye = Vec3::new(
        state.position.x,
        state.position.y + f64::from(eye_height),
        state.position.z,
    );
    let eye_box = Aabb::new(
        eye - Vec3::new(half_width, half_height, half_width),
        eye + Vec3::new(half_width, half_height, half_width),
    );
    if release.at_least(1, 18, 0) && !release.at_least(1, 19, 0) {
        return world.collides_with_suffocating_block_moved_to(eye_box, eye, release);
    }
    // (1.16 - 1.17.1: getBlockCollisions with the entity offers the world border's shape first,
    // which the suffocation predicate does not filter)
    if !release.at_least(1, 18, 0) && world.entity_touches_world_border(state.bounds()) {
        return true;
    }
    // (1.16 - 1.17.1 walk getBlockCollisions, with its Shapes.block() shortcut; from 1.19 every
    // shape is joined with the eye box)
    world.collides_with_suffocating_block(eye_box, release, !release.at_least(1, 18, 0))
}

/// LocalPlayer.moveTowardsClosestSpace (checkInBlock before 1.16.2): from each corner of the box
/// shrunk to 0.35 of its width, a player inside a suffocating block moves at 0.1 toward the
/// nearest side of that block that is open. Until 1.16.1 a cell of the column is suffocating
/// whatever its collision shape (1.16 ClientPlayerEntity.java:406-464, blocked() in the 1.16.1
/// bytecode); from 1.16.2 a suffocating collision shape meets the column (suffocatesAt, 1.16.5
/// :406-439).
fn move_towards_closest_space(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) {
    if !release.at_least(1, 14, 0) {
        push_out_of_blocks_before_1_14(state, world, release);
        return;
    }
    let bounds = state.bounds();
    // 1.16.2 - 1.17.1 ask with the entity, so the walk offers the world border's shape first, which the
    // suffocation predicate does not filter, as in is_in_wall: every column suffocates and no side
    // is open (1.16.5 ClientPlayerEntity.java:435-439, BlockCollisionSpliterator.java:101-114; 1.18 asks
    // canCollide). 1.16 - 1.16.1 read the cells alone.
    let at_border = release.at_least(1, 16, 2)
        && !release.at_least(1, 18, 0)
        && world.entity_touches_world_border(bounds);
    let suffocates_at = |x: i32, z: i32| {
        if at_border {
            true
        } else if release.at_least(1, 16, 2) {
            let column = Aabb::new(
                Vec3::new(f64::from(x), bounds.min.y, f64::from(z)),
                Vec3::new(f64::from(x) + 1.0, bounds.max.y, f64::from(z) + 1.0),
            );
            let column = column.deflate(Vec3::new(1.0e-7, 1.0e-7, 1.0e-7));
            world.collides_with_suffocating_block(column, release, true)
        } else {
            (floor_i32_for(release, bounds.min.y)..ceil_i32_for(release, bounds.max.y))
                .any(|y| world.is_suffocating((x, y, z)))
        }
    };
    let offset = state.half_width * 2.0 * 0.35;
    let corners = [
        (-offset, offset),
        (-offset, -offset),
        (offset, -offset),
        (offset, offset),
    ];
    for (offset_x, offset_z) in corners {
        let x = state.position.x + offset_x;
        let z = state.position.z + offset_z;
        let (cell_x, cell_z) = (floor_i32_for(release, x), floor_i32_for(release, z));
        if !suffocates_at(cell_x, cell_z) {
            continue;
        }
        let (inside_x, inside_z) = (x - f64::from(cell_x), z - f64::from(cell_z));
        let sides = [
            (-1, 0, inside_x),
            (1, 0, 1.0 - inside_x),
            (0, -1, inside_z),
            (0, 1, 1.0 - inside_z),
        ];
        let mut closest = if release.at_least(1, 16, 2) {
            f64::MAX
        } else {
            9999.0
        };
        let mut direction = None;
        for (step_x, step_z, distance) in sides {
            if distance < closest && !suffocates_at(cell_x + step_x, cell_z + step_z) {
                closest = distance;
                direction = Some((step_x, step_z));
            }
        }
        match direction {
            Some((0, step_z)) => state.velocity.z = 0.1 * f64::from(step_z),
            Some((step_x, _)) => state.velocity.x = 0.1 * f64::from(step_x),
            None => {}
        }
    }
}

fn push_out_of_blocks_before_1_14(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) {
    let open = |(x, y, z): BlockPosition| {
        !world.is_suffocating((x, y, z)) && !world.is_suffocating((x, y + 1, z))
    };
    let feet_y = state.bounds().min.y + 0.5;
    let offset = state.half_width * 2.0 * 0.35;
    let corners = [
        (-offset, offset),
        (-offset, -offset),
        (offset, -offset),
        (offset, offset),
    ];
    for (offset_x, offset_z) in corners {
        let (x, z) = (state.position.x + offset_x, state.position.z + offset_z);
        let cell = (floor_i32_for(release, x), floor_i32_for(release, feet_y), floor_i32_for(release, z));
        let blocked = if release.at_least(1, 13, 0) && state.swimming {
            world.is_suffocating(cell)
        } else {
            !open(cell)
        };
        if !blocked {
            continue;
        }
        let (inside_x, inside_z) = (x - f64::from(cell.0), z - f64::from(cell.2));
        let sides = [
            (-1, 0, inside_x),
            (1, 0, 1.0 - inside_x),
            (0, -1, inside_z),
            (0, 1, 1.0 - inside_z),
        ];
        let mut closest = 9999.0;
        let mut direction = None;
        for (step_x, step_z, distance) in sides {
            if open((cell.0 + step_x, cell.1, cell.2 + step_z)) && distance < closest {
                closest = distance;
                direction = Some((step_x, step_z));
            }
        }
        let push = f64::from(0.1_f32);
        match direction {
            Some((0, step_z)) => state.velocity.z = push * f64::from(step_z),
            Some((step_x, _)) => state.velocity.x = push * f64::from(step_x),
            None => {}
        }
    }
}

pub(crate) fn restitute_movement_after_collisions(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    support: Option<BlockPosition>,
    rules: VersionPhysicsRules,
    collisions: [bool; 3],
    moved_y: f64,
) {
    let current = state.velocity;
    let suppressing_bounce = state.sneaking;
    let entity_restitution = if suppressing_bounce {
        0.0
    } else {
        state.entity_bounciness
    };
    let mut after = current;
    if collisions[0] {
        after.x = -current.x * entity_restitution;
    }
    if collisions[2] {
        after.z = -current.z * entity_restitution;
    }
    if !collisions[1] {
        state.velocity = after;
        return;
    }
    let gravity = if state.no_gravity {
        0.0
    } else if state.slow_falling && current.y <= 0.0 {
        rules.gravity.min(0.01)
    } else {
        rules.gravity
    };
    let restitution = if !state.vertical_collision_below {
        entity_restitution
    } else {
        let effect_state = world.block(landing_position(world, state, support, rules.release));
        let resting = if rules.release.at_least(26, 3, 0) {
            -current.y <= gravity
        } else {
            -current.y < gravity
        };
        if resting || suppressing_bounce || effect_state.suppresses_bounce {
            0.0
        } else {
            // Entity.getBlockBounciness: the whole restitution for a LivingEntity, 0.8F of it in
            // float for any other (26.2 Entity.java:874-881, 26.3 :905-911)
            let block_restitution = if state.non_living {
                f64::from(effect_state.bounce_restitution as f32 * 0.8)
            } else {
                effect_state.bounce_restitution
            };
            entity_restitution
                .max(block_restitution)
                .max(state.block_bounciness)
        }
    };
    let (gravity_compensation, effective_drag) = if restitution > 0.0 {
        let portion_with_movement = moved_y / current.y;
        let air_drag = compute_modified_friction(
            rules.vertical_drag,
            effective_modifier(state.air_drag_modifier, state.air_drag_modifier_present),
        );
        (
            portion_with_movement * gravity,
            1.0 + portion_with_movement * (air_drag - 1.0),
        )
    } else {
        (0.0, 1.0)
    };
    after.y = (gravity_compensation - current.y) * effective_drag * restitution;
    // (0 / 0 of a bounce with no motion, which setDeltaMovement refuses as a whole, 26.2 Entity.java:
    // the last line of the method)
    state.set_delta_movement(after, rules.release);
}

pub(crate) fn entity_collision_context(state: &SimulationState) -> EntityCollisionContext {
    EntityCollisionContext {
        bottom: state.position.y,
        descending: state.sneaking,
        fall_distance: state.fall_distance,
        walks_on_powder_snow: state.powder_snow_walkable,
    }
}

/// Entity.move inside cobwebs, berry bushes and powder snow: the movement scaled by the stuck
/// speed multiplier, which the move uses up along with the motion.
pub(crate) fn slowed_by_stuck_speed(state: &mut SimulationState, movement: Vec3) -> Vec3 {
    if state.no_physics || state.stuck_speed_multiplier.length_squared() <= 1.0e-7 {
        return movement;
    }
    let slowed = movement.multiply(state.stuck_speed_multiplier);
    state.stuck_speed_multiplier = Vec3::ZERO;
    state.velocity = Vec3::ZERO;
    slowed
}

/// Entity.collide: how much of `desired` the blocks and the world border let the entity move.
pub(crate) struct WorldCollision {
    pub(crate) movement: Vec3,
    moved_bounds: Option<Aabb>,
    /// Entity.isOutsideBorder as the collision left it.
    outside_border: bool,
}

pub(crate) fn collide_with_world(
    state: &SimulationState,
    world: &WorldSnapshot,
    context: &EntityCollisionContext,
    desired: Vec3,
    rules: VersionPhysicsRules,
) -> WorldCollision {
    let bounds = state.bounds();
    let max_step = rules.step_height as f32;
    let swept = bounds.expand_towards(desired);
    let query = Aabb::new(
        Vec3::new(swept.min.x, swept.min.y - 1.0e-5, swept.min.z),
        Vec3::new(
            swept.max.x,
            swept.max.y.max(bounds.max.y + f64::from(max_step)),
            swept.max.z,
        ),
    );
    let entities = world.entity_collisions(
        entity_collision_query(swept, query, max_step, rules.release),
        context,
    );
    if !rules.release.at_least(1, 14, 0) {
        let mut obstacles = if rules.release.at_least(1, 13, 0) {
            // (past the query's 1.0E-7, whose shapes legacy_colliders tells)
            let reach = query.inflate(Vec3::new(1.0e-6, 1.0e-6, 1.0e-6));
            world.collision_shapes_for_entity(reach, context, rules.release)
        } else {
            world.legacy_collision_shapes_for_entity(query, context, rules.release)
        };
        let inside = world.is_inside_legacy_world_border(state.position, state.outside_border);
        let outside_border = if updates_outside_border(world, swept, rules.release) {
            !inside
        } else {
            state.outside_border
        };
        if inside {
            let outside_cell = |bounds: &Aabb| {
                world.is_outside_world_border_cell(bounds.min.x.floor(), bounds.min.z.floor())
            };
            obstacles.retain(|obstacle| !outside_cell(obstacle));
            obstacles.extend(world.legacy_world_border_cells(query));
        }
        let voxel_shapes = rules.release.at_least(1, 13, 0);
        let legacy = collide_legacy(
            bounds,
            desired,
            &obstacles,
            &entities,
            state.on_ground,
            max_step,
            voxel_shapes,
        );
        return WorldCollision {
            movement: legacy.movement,
            moved_bounds: Some(legacy.bounds),
            outside_border,
        };
    }
    let border = world.world_border_collision_boxes();
    let collides_with_border = if rules.release.at_least(1, 18, 0) {
        world.is_inside_close_to_world_border(
            state.position,
            bounds.expand_towards(desired),
            rules.release,
        )
    } else {
        // Shapes.joinIsNotEmpty of the border and the box less 1.0E-7, whose merge takes another
        // 1.0E-7 off (1.16.5 Entity.java:791, 1.17 :755)
        let inside = bounds.deflate(Vec3::new(1.0e-7, 1.0e-7, 1.0e-7));
        !border.iter().any(|outside| shapes_join(*outside, inside))
    };
    // the blocks as whole shapes with their cells, in BlockCollisions' order; the border's shape
    // between the entity colliders and them (Entity.collectColliders)
    let blocks = world.collision_block_shapes_for_entity(query, context, rules.release);
    let collision = CollisionRules {
        step_up: if rules.release.at_least(1, 21, 0) {
            StepUp::CandidateHeights
        } else {
            StepUp::Lifted
        },
        border_always_collides: collides_with_border && !rules.release.at_least(1, 18, 0),
        single_axis_walk: !rules.release.at_least(1, 18, 0),
    };
    let colliders = Colliders {
        entities: &entities,
        border: collides_with_border.then_some(&border[..]),
        boxes: &[],
        block_border: world
            .block_collisions_offer_world_border(bounds, rules.release)
            .then_some(&border[..]),
        blocks: &blocks,
        release: Some(rules.release),
    };
    let movement = collide_shapes(
        bounds,
        desired,
        colliders,
        state.on_ground,
        max_step,
        collision,
    );
    WorldCollision {
        movement,
        moved_bounds: None,
        outside_border: state.outside_border,
    }
}

/// Whether World.getCollisionBoxes sets Entity.isOutsideBorder for a move sweeping `swept`: from
/// 1.13 always (IWorldReaderBase.getCollisionBoxes), before only once its walk over the columns
/// reaches one in a loaded chunk, the columns of the box before 1.9 and, from 1.9, those around it
/// too but the corners (World.getCollisionBoxes).
fn updates_outside_border(world: &WorldSnapshot, swept: Aabb, release: MinecraftVersion) -> bool {
    if release.at_least(1, 13, 0) {
        return true;
    }
    let (columns_x, columns_z) = if release.at_least(1, 9, 0) {
        (
            floor_i32_for(release, swept.min.x).wrapping_sub(1)..ceil_i32_for(release, swept.max.x).wrapping_add(1),
            floor_i32_for(release, swept.min.z).wrapping_sub(1)..ceil_i32_for(release, swept.max.z).wrapping_add(1),
        )
    } else {
        (
            floor_i32_for(release, swept.min.x)..floor_i32_for(release, swept.max.x + 1.0),
            floor_i32_for(release, swept.min.z)..floor_i32_for(release, swept.max.z + 1.0),
        )
    };
    let corners = release.at_least(1, 9, 0);
    columns_x.clone().any(|x| {
        columns_z.clone().any(|z| {
            let edge_x = x == columns_x.start || x == columns_x.end - 1;
            let edge_z = z == columns_z.start || z == columns_z.end - 1;
            !(corners && edge_x && edge_z) && world.is_chunk_loaded(x >> 4, z >> 4)
        })
    })
}

/// Moves the entity by the collided movement, and before 1.17 the bounding box it keeps, which the
/// position follows: before 1.14 to where the collision moved the box.
pub(crate) fn displace(
    state: &mut SimulationState,
    desired: Vec3,
    collision: WorldCollision,
    release: MinecraftVersion,
) {
    state.outside_border = collision.outside_border;
    let moved = match (collision.moved_bounds, state.bounding_box) {
        (Some(moved), _) => moved,
        _ if !state.no_physics && !moves_position(desired, collision.movement, release) => return,
        (None, Some(bounds)) => bounds.translated(collision.movement),
        (None, None) => {
            state.position = state.position + collision.movement;
            return;
        }
    };
    state.bounding_box = Some(moved);
    state.position = position_of_bounding_box(moved);
}

/// TridentItem.releaseUsing (1.13+), before the tick: a riptide trident let go of in water pushes
/// the player along its look by the spin attack strength, and a player on the ground moves up by
/// 1.2 at once.
fn launch_riptide(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    level: u8,
    rules: VersionPhysicsRules,
) {
    let release = rules.release;
    let riding = state.passenger && release.at_least(26, 1, 0);
    // Entity.isInWaterOrRain (1.13.2 class_3564.java:62 through Entity.java:1023-1024, 1.20.4
    // TridentItem.java:70, 26.3 :64)
    let wet = state.in_water || state.in_rain;
    if level == 0 || !release.at_least(1, 13, 0) || !wet || riding {
        return;
    }
    let (yaw, pitch) = (f64::from(state.yaw as f32), f64::from(state.pitch as f32));
    let cos_pitch = mth_cos(pitch, release) as f32;
    let x = -(mth_sin(yaw, release) as f32) * cos_pitch;
    let y = -(mth_sin(pitch, release) as f32);
    let z = mth_cos(yaw, release) as f32 * cos_pitch;
    let length = (x * x + y * y + z * z).sqrt();
    let strength = if release.at_least(1, 21, 0) {
        1.5 + 0.75 * f32::from(level - 1)
    } else {
        3.0 * ((1.0 + f32::from(level)) / 4.0)
    };
    let push = Vec3::new(
        f64::from(x * (strength / length)),
        f64::from(y * (strength / length)),
        f64::from(z * (strength / length)),
    );
    state.velocity = state.velocity + push;
    if !state.on_ground {
        return;
    }
    let lift = slowed_by_stuck_speed(state, Vec3::new(0.0, 1.1999999284744263, 0.0));
    let context = entity_collision_context(state);
    let collision = collide_with_world(state, world, &context, lift, rules);
    let displacement = collision.movement;
    displace(state, lift, collision, release);
    state.collided_horizontally = false;
    state.minor_horizontal_collision = false;
    state.collided_vertically = lift.y != displacement.y;
    state.vertical_collision_below = false;
    state.on_ground = false;
    let support = check_supporting_block(world, state, Some(displacement), release);
    if state.collided_vertically {
        state.velocity.y = if release.at_least(1, 14, 0) {
            state.velocity.y * 0.0
        } else {
            0.0
        };
    }
    // the lift is an Entity.move, whose checkInsideBlocks pushes, slows and sticks as the tick's
    // own (1.13.2 Entity.java:841, 1.20.4 :713, 1.21 :713); from 1.21.2 the move only queues its
    // path, which the tick's check leaves out: it runs from where the tick started (1.21.3
    // Entity.java:752-767, 1057, LivingEntity.java:2785)
    if !release.at_least(1, 21, 2) {
        let inside: Vec<_> = blocks_inside(state, release)
            .into_iter()
            .map(|position| (position, true))
            .collect();
        apply_block_effects(state, world, support, release, &inside);
    }
    if release.at_least(1, 15, 0) {
        let speed_factor = f64::from(block_speed_factor(world, state, None, release));
        state.velocity.x *= speed_factor;
        state.velocity.z *= speed_factor;
    }
}

/// Block.getJumpFactor of the block at the feet, else of the block below that affects movement.
pub(crate) fn block_jump_factor(
    world: &WorldSnapshot,
    body: BlockPosition,
    below: BlockPosition,
) -> f32 {
    if world.effect_at(body) == BlockEffect::Honey || world.effect_at(below) == BlockEffect::Honey {
        0.5
    } else {
        1.0
    }
}

/// Entity.getForward, horizontally: Vec3.directionFromRotation of the pitch and yaw.
fn forward_direction(state: &SimulationState, release: MinecraftVersion) -> (f32, f32) {
    let yaw = -(state.yaw as f32) - 3.1415927;
    let pitch = -(state.pitch as f32);
    let horizontal = -(mth_cos(f64::from(pitch), release) as f32);
    (
        mth_sin(f64::from(yaw), release) as f32 * horizontal,
        mth_cos(f64::from(yaw), release) as f32 * horizontal,
    )
}

/// The inverse square root updateAutoJump normalizes the move with: Mth.fastInvSqrt in double
/// before 1.15, in float until 1.19.4, then Mth.invSqrt.
fn auto_jump_inverse_length(length_squared: f32, release: MinecraftVersion) -> f32 {
    if release.at_least(1, 19, 4) {
        1.0 / length_squared.sqrt()
    } else if release.at_least(1, 15, 0) {
        fast_inv_sqrt_f32(length_squared)
    } else {
        fast_inv_sqrt(f64::from(length_squared)) as f32
    }
}

/// LocalPlayer.updateAutoJump (1.10+, with the auto-jump option on), after a move by `moved`: a
/// player walking on the ground towards a step 0.5 to 1.2 high (more with jump boost) with room
/// above jumps the next tick. The step is the first block box that one of the two lines half a
/// width to each side, 0.51 above the feet, crosses within 7 ticks of speed (at least the move).
pub(crate) fn update_auto_jump(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    moved: Vec3,
    speed: f32,
    jump_factor: f32,
    release: MinecraftVersion,
) {
    if !state.auto_jump
        || !state.is_player
        || !release.at_least(1, 10, 0)
        || state.auto_jump_time > 0
        || !state.on_ground
        || state.sneaking
        || state.passenger
        || jump_factor < 1.0
    {
        return;
    }
    let move_vector = input_move_vector(state, release);
    if move_vector == [0.0, 0.0] {
        return;
    }
    let bounds = state.bounds();
    // 1.15 starts the probe at position() (1.15 ClientPlayerEntity.java:860), 1.14 at the
    // bounding box minY (1.14 ClientPlayerEntity.java:851).
    let feet_y = if release.at_least(1, 15, 0) {
        state.position.y
    } else {
        bounds.min.y
    };
    let begin = Vec3::new(state.position.x, feet_y, state.position.z);
    let (moved_x, moved_z) = (moved.x as f32, moved.z as f32);
    let mut direction = Vec3::new(f64::from(moved_x), 0.0, f64::from(moved_z));
    let mut length_squared = direction.length_squared() as f32;
    if length_squared <= 0.001 {
        let input_x = speed * move_vector[0];
        let input_z = speed * move_vector[1];
        let sin = mth_sin(state.yaw, release) as f32;
        let cos = mth_cos(state.yaw, release) as f32;
        direction = Vec3::new(
            f64::from(input_x * cos - input_z * sin),
            0.0,
            f64::from(input_z * cos + input_x * sin),
        );
        length_squared = direction.length_squared() as f32;
        if length_squared <= 0.001 {
            return;
        }
    }
    let inverse_length = auto_jump_inverse_length(length_squared, release);
    let direction = direction.scale(f64::from(inverse_length));
    let (forward_x, forward_z) = forward_direction(state, release);
    if ((f64::from(forward_x) * direction.x + f64::from(forward_z) * direction.z) as f32) < -0.15 {
        return;
    }
    let context = entity_collision_context(state);
    let empty = |position| {
        world
            .block_collision_boxes_for_entity(position, &context)
            .is_empty()
    };
    let mut ceiling = block_position(Vec3::new(state.position.x, bounds.max.y, state.position.z), release);
    if !empty(ceiling) {
        return;
    }
    ceiling.1 += 1;
    if !empty(ceiling) {
        return;
    }
    let mut jump_height = 1.2_f32;
    if let Some(amplifier) = state.jump_boost_amplifier {
        jump_height += (amplifier + 1) as f32 * 0.75;
    }
    let look_ahead = (speed * 7.0).max(1.0 / inverse_length);
    let end = begin + Vec3::new(f64::from(moved_x), 0.0, f64::from(moved_z));
    let end = end + direction.scale(f64::from(look_ahead));
    let width = (state.half_width * 2.0) as f32;
    let top = end + Vec3::new(0.0, f64::from(state.height as f32), 0.0);
    let area = Aabb::new(
        Vec3::new(begin.x.min(top.x), begin.y.min(top.y), begin.z.min(top.z)),
        Vec3::new(begin.x.max(top.x), begin.y.max(top.y), begin.z.max(top.z)),
    )
    .inflate(Vec3::new(f64::from(width), 0.0, f64::from(width)));
    let lift = Vec3::new(0.0, 0.5099999904632568, 0.0);
    let (line_begin, line_end) = (begin + lift, end + lift);
    let side = direction
        .cross(Vec3::new(0.0, 1.0, 0.0))
        .scale(f64::from(width * 0.5));
    let lines = [
        (line_begin - side, line_end - side),
        (line_begin + side, line_end + side),
    ];
    let crosses = |bounds: Aabb, (from, to): (Vec3, Vec3)| {
        bounds.min.x < from.x.max(to.x)
            && bounds.max.x > from.x.min(to.x)
            && bounds.min.y < from.y.max(to.y)
            && bounds.max.y > from.y.min(to.y)
            && bounds.min.z < from.z.max(to.z)
            && bounds.max.z > from.z.min(to.z)
    };
    // Level.getCollisions: the boxes of the entities the player collides with (boats, shulkers)
    // after the block shapes before 1.18, before them from 1.18 (1.12.2 World.getCollisionBoxes,
    // 1.16.5 CollisionView.java:58-59, 1.18 CollisionView.java:67-70, 1.21.11
    // CollisionGetter.java:85-89); from 1.14 the entities meeting the area grown by 1.0E-7
    // (1.14.4 EntityGetter.java:54-58, 1.21.11 EntityGetter.java:54-60)
    let entity_area = if release.at_least(1, 14, 0) {
        area.inflate(Vec3::new(1.0e-7, 1.0e-7, 1.0e-7))
    } else {
        area
    };
    let entities = world.entity_collisions(entity_area, &context);
    // 1.13 - 1.14.0 defer the full cubes into one merged shape after the partial ones (1.13.2
    // RenderBlockView.java:113-153, 1.14 ViewableWorld.java:145-195); 1.14.4 and 1.15 walk every
    // block in order (1.14.4 LevelReader.java:130-145, 1.15 CollisionView.java:67-106)
    let blocks = if release.at_least(1, 13, 0) && !release.at_least(1, 14, 1) {
        world.block_collision_boxes_merging_full_cubes(area, &context)
    } else {
        world.block_collision_boxes_in_order(area, &context, release)
    };
    let obstacles: Vec<Aabb> = if release.at_least(1, 18, 0) {
        entities.into_iter().chain(blocks).collect()
    } else {
        blocks.into_iter().chain(entities).collect()
    };
    let unset = f32::from_bits(1);
    let mut step_top = unset;
    for obstacle in obstacles {
        if !lines.iter().any(|&line| crosses(obstacle, line)) {
            continue;
        }
        step_top = obstacle.max.y as f32;
        let center = block_position(Vec3::new(
            lerp(0.5, obstacle.min.x, obstacle.max.x),
            lerp(0.5, obstacle.min.y, obstacle.max.y),
            lerp(0.5, obstacle.min.z, obstacle.max.z),
        ), release);
        let mut steps = 1;
        while (steps as f32) < jump_height {
            let above = (center.0, center.1 + steps, center.2);
            let shape = world.block_collision_boxes_for_entity(above, &context);
            if let Some(shape_top) = shape.iter().map(|bounds| bounds.max.y).reduce(f64::max) {
                step_top = shape_top as f32 + above.1 as f32;
                if f64::from(step_top) - feet_y > f64::from(jump_height) {
                    return;
                }
            }
            if steps > 1 {
                ceiling.1 += 1;
                if !empty(ceiling) {
                    return;
                }
            }
            steps += 1;
        }
        break;
    }
    if step_top != unset {
        let rise = (f64::from(step_top) - feet_y) as f32;
        if !(rise <= 0.5) && !(rise > jump_height) {
            state.auto_jump_time = 1;
        }
    }
}

/// How a release lands an entity: LivingEntity.computeFallDamage's rounding, the attributes'
/// damage from 1.20.5 and the restitution from 26.2 in place of the landing block's bounce.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FallDamageRules {
    pub landing_damage_rounding: LandingDamageRounding,
    pub restitution_enabled: bool,
    pub modern_fall_damage: bool,
}

/// What check_fall_damage left for the rest of Entity.move: a slime block's bounce, a bed's
/// landing, and the lava height its water refresh measured (26.1+).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct FallCheck {
    pub bounced: bool,
    pub landed_on_bed: bool,
    pub lava_height: Option<f64>,
}

/// The share of a slime block's or bed's bounce an entity keeps: a LivingEntity all of it, any
/// other 0.8 from 1.9, where the slime block's test arrives (1.8.9 SlimeBlock.java:33-39; 1.9.4
/// :34-44, 1.21.11 :44). The bed bounces only from 1.12 and has the test from there (1.12.2
/// BedBlock.java:155-159, 1.21.11 :149-150).
pub(crate) fn landing_bounce(state: &SimulationState, release: MinecraftVersion) -> f64 {
    if state.non_living && release.at_least(1, 9, 0) {
        0.8
    } else {
        1.0
    }
}

/// Entity.checkFallDamage (Entity.fall, updateFallState before 1.14) after a move that went
/// `displacement_y` and collided vertically or not: the water refresh, the drop counted into the
/// fall distance or the landing that deals the damage and ends the fall, and the slime block's
/// bounce in place of it before 26.2.
pub(crate) fn check_fall_damage(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    rules: VersionPhysicsRules,
    support: Option<BlockPosition>,
    displacement_y: f64,
    y_collision: bool,
    fall: FallDamageRules,
) -> FallCheck {
    let affected_by_fluids = !(state.is_player && state.flying);
    let legacy_fluids = legacy_fluid::applies(rules.release);
    let mut lava_height = None;
    // Entity.move (1.21.2+) runs checkFallDamage on the client only for a locally controlled
    // entity (isLogicalSideForUpdatingMovement, isLocalInstanceAuthoritative from 1.21.5). 1.21.4
    // leaves a player out of it on both sides (1.21.4 Entity.java:697, PlayerEntity.java:2214),
    // where the client then has no landing at all and the server has the one the moves it receives
    // make (handleFall, Entity.java:1250-1256, ServerPlayNetworkHandler.java:999, :1018).
    let checks_fall_damage = !state.no_physics
        && !(state.is_player && state.client_side && rules.release == MinecraftVersion::new(1, 21, 4))
        && (!rules.release.at_least(1, 21, 2)
            || state.controlled_by_local_instance
            || (!state.client_side && !rules.release.at_least(1, 21, 5)));
    if checks_fall_damage && !state.in_water && legacy_fluids {
        legacy_fluid::handle_water_movement(state, world, affected_by_fluids, rules.release);
    } else if checks_fall_damage && !state.in_water {
        let water = entity_fluid_contact(state, world, FluidState::Water, rules.release);
        if water.touching {
            state.in_water = true;
            state.fall_distance = 0.0;
            if affected_by_fluids {
                push_by_fluid(state, water, rules.water_flow_scale, rules.release);
            }
        }
        if rules.release.at_least(26, 1, 0) {
            // LivingEntity.checkFallDamage's updateFluidInteraction refreshes the eyes as well,
            // at where the move left them (26.1 EntityFluidInteraction.update)
            state.eye_in_water =
                entity_eyes_in_fluid(state, world, FluidState::Water, rules.release);
            state.eye_in_lava =
                entity_eyes_in_fluid(state, world, FluidState::Lava, rules.release);
            let lava = entity_fluid_contact(state, world, FluidState::Lava, rules.release);
            state.in_lava = lava.touching;
            lava_height = Some(lava.height);
            if affected_by_fluids && lava.touching {
                let lava_flow_scale = if state.ultra_warm {
                    rules.ultra_warm_lava_flow_scale
                } else {
                    rules.lava_flow_scale
                };
                push_by_fluid(state, lava, lava_flow_scale, rules.release);
            }
        }
    }
    // Entity.checkFallDamage (1.21.5+) counts this move's drop out of the water first, after
    // LivingEntity's water refresh, and lands with it (1.21.5 Entity.java:1284-1297,
    // LivingEntity.java:328-331); before, Entity.fall counts it only when not landing.
    let counts_drop_before_landing = rules.release.at_least(1, 21, 5);
    if checks_fall_damage && counts_drop_before_landing && !state.in_water && displacement_y < 0.0 {
        state.fall_distance =
            accumulated_fall_distance(state.fall_distance, displacement_y, rules.release);
    }
    let landed_on = world.effect_at(landing_position(world, state, support, rules.release));
    // SlimeBlock.updateEntityMovementAfterFallOn, the block's callback. The fall ends in
    // checkFallDamage, on the ground and for an entity that runs it, as any other landing
    // (1.21.11 Entity.java:754-769, 1.20.4 :660-663).
    let bounced = !fall.restitution_enabled
        && y_collision
        && simulates_landing(state, rules.release)
        && landed_on == BlockEffect::Slime
        && !state.sneaking;
    if bounced {
        if state.velocity.y < 0.0 {
            state.velocity.y = -state.velocity.y * landing_bounce(state, rules.release);
        }
        if state.on_ground && (checks_fall_damage || !state.client_side) {
            state.fall_distance = 0.0;
        }
    }
    // Block.fallOn: the fall distance and damage multiplier the landing block hands
    // causeFallDamage. The bed halves the distance from 1.12 (BedBlock); an upward pointed
    // dripstone tip adds 2.0F to it and doubles the damage, 2.5 in double from 1.21.5 (1.17
    // PointedDripstoneBlock.java:128-130, 1.21.5 :147-149); hay deals a fifth from 1.9 (1.9.4
    // HayBlock.java:19-20; 1.8.9 has no fallOn), honey a fifth (1.15 HoneyBlock.java:55-61).
    let landed_on_bed = landed_on == BlockEffect::Bed && rules.release.at_least(1, 12, 0);
    let landing_fall_distance = match landed_on {
        _ if landed_on_bed => state.fall_distance * 0.5,
        BlockEffect::PointedDripstoneTip if rules.release.at_least(1, 21, 5) => {
            state.fall_distance + 2.5
        }
        BlockEffect::PointedDripstoneTip => f64::from(state.fall_distance as f32 + 2.0),
        _ => state.fall_distance,
    };
    let block_damage_multiplier = match landed_on {
        BlockEffect::Hay if rules.release.at_least(1, 9, 0) => 0.2_f32,
        BlockEffect::Honey => 0.2,
        BlockEffect::PointedDripstoneTip => 2.0,
        _ => 1.0,
    };
    // A fallOn that never calls causeFallDamage: powder snow's from 1.18 (1.18
    // PowderSnowBlock.java:85-91; 1.17.1's jar declares none) and, from 1.21.2, the slime
    // block's for an entity suppressing the bounce (1.21.2 SlimeBlock.java:24-28; 1.21.1 hands it
    // to Block.fallOn). Entity.checkFallDamage still resets the fall distance.
    let landing_deals_no_damage = match landed_on {
        BlockEffect::PowderSnow => rules.release.at_least(1, 18, 0),
        BlockEffect::Slime => fall.restitution_enabled || rules.release.at_least(1, 21, 2),
        _ => false,
    };
    if checks_fall_damage && state.on_ground && !bounced {
        // Block.fallOn runs for a fall distance above 0 only (1.8.9 Entity.java, 1.20.4
        // Entity.java:1118, 26.3 :1602): a move on the ground leaves what a landing of the same tick
        // reported, as a piston's after the player's own
        if state.fall_distance > 0.0 {
            // Player.causeFallDamage deals nothing where the player may fly (1.8.9
            // PlayerEntity.java:1387-1388, 1.21.5 Player.java:1470-1472)
            state.fall_damage = if state.fall_damage_immune || landing_deals_no_damage {
                0.0
            } else if fall.modern_fall_damage {
                attribute_landing_damage(
                    landing_fall_distance,
                    state.safe_fall_distance,
                    block_damage_multiplier,
                    state.fall_damage_multiplier.unwrap_or(1.0),
                    fall.landing_damage_rounding,
                    rules.release,
                )
            } else {
                landing_damage(
                    landing_fall_distance,
                    state.safe_fall_distance,
                    f64::from(
                        block_damage_multiplier
                            * state.fall_damage_multiplier.unwrap_or(1.0) as f32,
                    ),
                    state.jump_boost_amplifier,
                    fall.landing_damage_rounding,
                )
            };
        }
        state.fall_distance = 0.0;
    } else if checks_fall_damage && !counts_drop_before_landing && !bounced && displacement_y < 0.0
    {
        state.fall_distance =
            accumulated_fall_distance(state.fall_distance, displacement_y, rules.release);
    }
    // before 1.16 no eye flag is kept: Entity.isUnderLiquid asks the world where the entity is now
    // (1.15 Entity.java isSubmergedIn), so what the tick leaves is where the move left the eyes
    if !rules.release.at_least(1, 16, 0) {
        state.eye_in_water =
            entity_eyes_in_fluid(state, world, FluidState::Water, rules.release);
        state.eye_in_lava =
            entity_eyes_in_fluid(state, world, FluidState::Lava, rules.release);
    }
    FallCheck {
        bounced,
        landed_on_bed,
        lava_height,
    }
}

/// Whether the block's fall callback, which stops or bounces the motion, runs for this instance of
/// the entity: from 1.21.2 not on a client that does not own it (1.21.3 Entity.java:698-703, 1.21.11
/// :763-768, canSimulateMovement).
pub(crate) fn simulates_landing(state: &SimulationState, release: MinecraftVersion) -> bool {
    !release.at_least(1, 21, 2) || state.controlled_by_local_instance || !state.client_side
}

/// Whether a move, the tick's own or a piston's, ends in the block's fall callback (see its call in
/// the tick): `requested_y` is the vertical part of the move as asked.
pub(crate) fn block_fall_callback_runs(
    state: &SimulationState,
    y_collision: bool,
    requested_y: f64,
    release: MinecraftVersion,
) -> bool {
    !state.no_physics
        && !(state.removed && release.at_least(1, 17, 0))
        && y_collision
        && (!release.at_least(1, 21, 2) || state.controlled_by_local_instance)
        && (!release.at_least(26, 2, 0) || requested_y != 0.0)
}

/// Player.stabAttack's recoil on the attacker, from 1.21.11, where spears come: causeExtraKnockback
/// takes 0.6 of the horizontal motion and ends the sprint (1.21.11 Player.java:1111-1120). It runs
/// once with 0.4F + the weapon's knockback (1.21.11 :1200; 26.1, 26.1.1 and 26.1.2 by their jars),
/// from 26.2 once with 0.4F and again with the knockback when that is above 0 (26.2 Player.java:
/// 1152-1153, 26.3 :1142-1143). Only the server runs it: a client sends STAB and stops there (26.3
/// MultiPlayerGameMode.java:513-516; 1.21.11 :500-505) and LivingEntity.stabAttack is the server's
/// (26.3 LivingEntity.java:2815-2818, ItemStack.java:1093).
fn take_stab_hit(state: &mut SimulationState, release: MinecraftVersion) {
    let Some(knockback) = state.stab_hit.take() else {
        return;
    };
    if state.client_side || !release.at_least(1, 21, 11) {
        return;
    }
    let takes = if release.at_least(26, 2, 0) && knockback > 0.0 {
        2
    } else {
        1
    };
    for _ in 0..takes {
        state.velocity.x *= 0.6;
        state.velocity.z *= 0.6;
    }
    state.sprinting = false;
}

/// An impulse straight up or down. From 1.14 it is Vec3.add(0, y, 0), which clears the sign of a
/// horizontal -0.0 (26.3 LivingEntity.java:2317-2323, LocalPlayer.java:861; 1.14
/// ClientPlayerEntity.java:719-731); before, it is a sum on motionY alone.
fn add_vertical_impulse(state: &mut SimulationState, y: f64, release: MinecraftVersion) {
    if release.at_least(1, 14, 0) {
        state.velocity = state.velocity + Vec3::new(0.0, y, 0.0);
    } else {
        state.velocity.y += y;
    }
}

pub(crate) fn tick_with_rules_and_rounding_and_restitution(
    state: &mut SimulationState,
    world: &WorldSnapshot,
    config: PhysicsConfig,
    rules: VersionPhysicsRules,
    landing_damage_rounding: LandingDamageRounding,
    restitution_enabled: bool,
    modern_fall_damage: bool,
) -> TickResult {
    let mut rules = rules;
    // Entity.tickCount is a Java int: `++this.tickCount` wraps (26.3 Entity.java:250, 550)
    state.tick_count = state.tick_count.wrapping_add(1);
    // the landing damage is this tick's: check_fall_damage sets it only on a landing
    state.fall_damage = 0.0;
    take_stab_hit(state, rules.release);
    if state.removed && rules.release.at_least(1, 19, 1) {
        return TickResult {
            displacement: Vec3::ZERO,
            collided_horizontally: state.collided_horizontally,
            collided_vertically: state.collided_vertically,
            block_fall_callback: false,
        };
    }
    state.bounding_box = (!rules.release.at_least(1, 17, 0)).then(|| kept_bounding_box(state));
    state.contact_damage = 0.0;
    state.wall_damage = 0.0;
    state.block_fall_callback = false;
    // A passenger's tick is Entity.rideTick: the motion goes, the whole tick runs (LocalPlayer.aiStep,
    // travel and its move included) and the vehicle's positionRider then overwrites where the move
    // went, with the fall distance reset (1.8.9 Entity.java:1321-1330, LivingEntity.java:1519-1524;
    // 1.12.2 Entity.java:1639-1649, 1.20.4 :1843-1847; 26.3 Entity.java:2465-2470,
    // LivingEntity.java:3233-3236). The engine has no vehicle: the position a caller hands in is the
    // seat, positionRider's result for this tick, and the tick ends on it. Moving the seat with the
    // vehicle is the caller's, as is leaving it (clear `passenger`).
    let seat = state.passenger.then_some(state.position);
    // Entity.setOnGround(false) empties mainSupportingBlockPos and onGroundNoBlocks (1.21.11
    // Entity.java:680-684), and nothing else takes an entity off the ground: a state handed in off
    // it (a player Player.tick kept off it while it rode, :238-241, or a new one after a respawn)
    // keeps no block from before.
    if !state.on_ground {
        state.supporting_block = None;
        state.on_ground_no_blocks = false;
    }
    if state.is_player && state.no_physics {
        state.on_ground = false;
        check_supporting_block(world, state, None, rules.release);
    }
    // a motion handed in that is not finite: from 1.21.11 setDeltaMovement refuses it, and the
    // entity keeps the motion it had, which a state without a tick before knows only as
    // Entity.deltaMovement's initial Vec3.ZERO (1.21.11 Entity.java:3664-3668); before, it is
    // taken as it is (1.21.10 Entity.java:3640-3642)
    if !state.velocity.is_finite() && rules.release.at_least(1, 21, 11) {
        state.velocity = Vec3::ZERO;
    }
    // Keep the profile's gravity, drag and step height when callers use the default config; an
    // explicitly customized runtime value remains an override.
    let default_config = PhysicsConfig::default();
    if config.gravity != default_config.gravity {
        rules.gravity = config.gravity;
    }
    if config.drag != default_config.drag {
        rules.air_drag = config.drag;
    }
    if config.step_height != default_config.step_height {
        rules.step_height = config.step_height;
    }
    // The GRAVITY and STEP_HEIGHT attributes read through RangedAttribute.sanitizeValue: NaN is the
    // minimum, the rest is clamped to -1..1 and 0..10 (1.21.11 RangedAttribute.java:35-37,
    // Attributes.java:46, 86; NaN maps to the minimum from 1.19, 1.19 ClampedEntityAttribute.java:36,
    // and both attributes exist from 1.20.5).
    let sanitize = |value: f64, min: f64, max: f64| {
        if value.is_nan() {
            min
        } else {
            value.clamp(min, max)
        }
    };
    if let Some(gravity) = state.gravity {
        rules.gravity = sanitize(gravity, -1.0, 1.0);
    }
    if let Some(step_height) = state.step_height {
        rules.step_height = sanitize(step_height, 0.0, 10.0);
    }
    // firework_boost is a rocket's FireworkRocketEntity.tick, which runs before the player's: all of
    // the player's tick reads the boosted motion (1.20.4 LivingEntity.java:2036-2043, 26.3
    // FireworkRocketEntity.java:123-128, LivingEntity.java:2337-2339)
    // (no rocket adds nothing: adding a zero would turn a motion of -0.0 into 0.0)
    if state.firework_boost != Vec3::ZERO {
        state.add_delta_movement(state.firework_boost, rules.release);
    }
    state.riptide_lift = Vec3::ZERO;
    if let Some(level) = state.riptide_launch.take() {
        let launched_from = state.position;
        launch_riptide(state, world, level, rules);
        state.riptide_lift = state.position - launched_from;
    }
    phase::emit(Phase::TickStart, state);
    // the rockets and the release of the use key come before the rider's tick, whose rideTick
    // takes what they added away; Player.tick then takes a passenger off the ground from 1.21.4
    // (1.21.3 PlayerEntity.java:256, 1.21.4 :259-260, 26.3 Player.java:219-221)
    if seat.is_some() {
        state.velocity = Vec3::ZERO;
        if state.is_player && rules.release.at_least(1, 21, 4) {
            state.on_ground = false;
            state.supporting_block = None;
            state.on_ground_no_blocks = false;
        }
    }
    let old_position = state.position;
    let flight_resets_fall_before_travel = rules.release.at_least(1, 21, 2);
    let effects_reset_fall_before_travel = rules.release.at_least(1, 20, 0);
    state.jump_ticks = state.jump_ticks.saturating_sub(1);
    let requested_jump = state.jump_requested;
    if state.auto_jump_time > 0 {
        state.auto_jump_time -= 1;
        state.jump_requested = true;
    }
    let body_position = (
        floor_i32_for(rules.release, state.position.x),
        floor_i32_for(rules.release, state.position.y),
        floor_i32_for(rules.release, state.position.z),
    );
    let previous_movement = state
        .previous_position
        .map(|previous| state.position - previous);
    let mut support = kept_supporting_block(world, state, previous_movement, rules.release);
    let below_position = block_below_affecting_movement(world, state, support, rules.release);
    let bounds = state.bounds();
    let eye_height = state.eye_height.unwrap_or(state.height * 0.85);
    state.inside_wall = is_in_wall(state, world, rules.release);
    let affected_by_fluids = !(state.is_player && state.flying);
    let legacy_fluids = legacy_fluid::applies(rules.release);
    let water = if legacy_fluids {
        legacy_fluid::handle_water_movement(state, world, affected_by_fluids, rules.release);
        FluidContact::default()
    } else {
        let water = entity_fluid_contact(state, world, FluidState::Water, rules.release);
        state.in_water = water.touching;
        if state.in_water {
            state.fall_distance = 0.0;
            if affected_by_fluids {
                push_by_fluid(state, water, rules.water_flow_scale, rules.release);
            }
        }
        water
    };
    // 1.16 - 1.16.1 Entity.updateWaterState returns in water before it measures the lava (its
    // height stays 0), and isInLava is the flag of the last move (1.16 Entity.java:1042-1051,
    // 1164-1166); 1.16.2 always measures it (1.16.5 Entity.java:1046-1052, 1181-1183)
    let measures_lava =
        rules.release.at_least(1, 16, 2) || !rules.release.at_least(1, 16, 0) || !state.in_water;
    let lava = if measures_lava {
        entity_fluid_contact(state, world, FluidState::Lava, rules.release)
    } else {
        FluidContact::default()
    };
    if rules.release.at_least(1, 16, 0) {
        if affected_by_fluids && measures_lava {
            let lava_flow_scale = if state.ultra_warm {
                rules.ultra_warm_lava_flow_scale
            } else {
                rules.lava_flow_scale
            };
            push_by_fluid(state, lava, lava_flow_scale, rules.release);
        }
        if rules.release.at_least(1, 16, 2) {
            state.in_lava = lava.height > 0.0;
        }
    } else if !rules.release.at_least(1, 14, 0) {
        state.in_lava = legacy_fluid::touching_lava(world, bounds, rules.release);
    }
    base_tick_fire(state, world, rules.release);
    // Entity.baseTick halves the fall distance every tick in lava, on the client too (1.8.9
    // Entity.java:410, 1.14 :481, 1.21.4 :487, 1.21.5 :490 `*= 0.5`; 1.14 - 1.15 read the inLava
    // of the last move). Halving is exact in float and double alike.
    if state.in_lava {
        state.fall_distance *= 0.5;
    }
    phase::emit(Phase::AfterBaseTick, state);
    // !isPassenger from 26.3 (26.2 LocalPlayer.java:753, 26.3 :774)
    if state.is_player
        && !state.no_physics
        && !(state.passenger && rules.release.at_least(26, 3, 0))
    {
        move_towards_closest_space(state, world, rules.release);
    }
    let sinks_in_water =
        !legacy_fluids && (affected_by_fluids || !rules.release.at_least(1, 16, 0));
    if state.is_player && state.in_water && state.sneaking && sinks_in_water {
        add_vertical_impulse(state, -0.03999999910593033, rules.release);
    }
    if state.flying && !rules.release.at_least(1, 14, 0) {
        // Before 1.14 sneak and jump are two separate double steps, so holding both is not
        // a no-op in double (1.8.9 ClientPlayerEntity.java:596-603, 1.13.2 :797-805).
        let impulse = f64::from(state.flying_speed as f32 * 3.0);
        if state.sneaking {
            state.velocity.y -= impulse;
        }
        if state.jump_requested {
            state.velocity.y += impulse;
        }
    } else if state.flying {
        // 1.14 nets the input into one impulse (1.14 ClientPlayerEntity.java:719-731).
        let direction = i8::from(state.jump_requested) - i8::from(state.sneaking);
        if direction != 0 {
            let impulse = f64::from(f32::from(direction) * state.flying_speed as f32 * 3.0);
            add_vertical_impulse(state, impulse, rules.release);
        }
    }
    phase::emit(Phase::BeforeLivingAiStep, state);
    // LivingEntity.aiStep clears jumping, xxa and zza of an immobile entity: dead, or a sleeping
    // player (1.8.9 LivingEntity.java:1438-1443, PlayerEntity.java:441-442; 1.20.4
    // LivingEntity.java:1971-1972, 2552-2555; 1.21.5 :2711; 26.3 :2254-2255, 3000-3003, Player.java:823-824)
    let immobile = state.dead || (state.is_player && state.sleeping);
    let requested_input = state.input;
    if immobile {
        state.jump_requested = false;
        state.input.x = 0.0;
        state.input.z = 0.0;
    }
    let negligible_velocity = negligible_velocity(config, rules.release);
    if state.is_player && rules.release.at_least(1, 21, 5) {
        let horizontal_squared =
            state.velocity.x * state.velocity.x + state.velocity.z * state.velocity.z;
        if horizontal_squared < negligible_velocity * negligible_velocity {
            state.velocity.x = 0.0;
            state.velocity.z = 0.0;
        }
    } else {
        if state.velocity.x.abs() < negligible_velocity {
            state.velocity.x = 0.0;
        }
        if state.velocity.z.abs() < negligible_velocity {
            state.velocity.z = 0.0;
        }
    }
    if state.velocity.y.abs() < negligible_velocity {
        state.velocity.y = 0.0;
    }
    let fluid = if !affected_by_fluids {
        FluidState::Empty
    } else if state.in_water {
        FluidState::Water
    } else if state.in_lava {
        FluidState::Lava
    } else {
        FluidState::Empty
    };
    let mut fluid_height = if state.in_water {
        water.height
    } else {
        lava.height
    };
    let fluid_jump_threshold = if java_float(eye_height) < 0.4 {
        0.0
    } else {
        0.4
    };
    let body_effect = world.effect_at(body_position);
    let was_in_powder_snow = state.in_powder_snow;
    let climbing = climbable(world, state, rules.release);
    let on_scaffolding = body_effect == BlockEffect::Scaffolding;
    // Player.travel steers a swimmer while any fluid, lava too, is at (y + 1.0) - 0.1 (1.13.2
    // PlayerEntity.java:1489, 1.21.4 :1503, 1.21.11 Player.java:1364, 26.3 :1301)
    let swimming_head_position = (
        floor_i32_for(rules.release, state.position.x),
        floor_i32_for(rules.release, state.position.y + 1.0 - 0.1),
        floor_i32_for(rules.release, state.position.z),
    );
    let swimming_head_in_fluid = world.block(swimming_head_position).fluid != FluidState::Empty;
    state.eye_in_water = entity_eyes_in_fluid(state, world, FluidState::Water, rules.release);
    state.eye_in_lava = entity_eyes_in_fluid(state, world, FluidState::Lava, rules.release);
    let vertical_drag = match fluid {
        FluidState::Water => rules.water_drag,
        FluidState::Lava => rules.lava_drag,
        FluidState::Waterlogged => rules.water_drag,
        FluidState::Empty => rules.vertical_drag,
    };
    let jumping = state.jump_requested
        && !(state.is_player && state.flying && rules.release.at_least(1, 16, 0));
    let jump = if jumping {
        fluid_jump(
            state,
            water.height,
            lava.height,
            fluid_jump_threshold,
            rules.release,
        )
    } else {
        FluidJump::None
    };
    if jump == FluidJump::Swim {
        add_vertical_impulse(state, 0.03999999910593033, rules.release);
    } else if jump == FluidJump::Ground && state.jump_ticks == 0 {
        let jump_factor = block_jump_factor(world, body_position, below_position);
        let power = jump_power(state, config, rules.release, jump_factor);
        jump_from_ground(state, power, rules.release);
        state.jump_ticks = 10;
    }
    if !jumping {
        state.jump_ticks = 0;
    }
    // LivingEntity.aiStep (1.21.2+) checks the fall distance every tick the fall-flying flag is set,
    // before travel and in any fluid (1.21.2 LivingEntity.java:2796, 2865); before, only the glide
    // in travel does (below).
    let fall_flying_checks_before_travel = rules.release.at_least(1, 21, 2);
    if state.fall_flying && fall_flying_checks_before_travel {
        state.check_fall_distance_accumulation();
    }
    // LivingEntity.aiStep (1.20+) resets the fall distance under Slow Falling or Levitation just
    // before travel, after the base tick and the glide's check (1.20 LivingEntity.java:2566-2567,
    // 26.3 :3040-3048); before, travel resets it itself (below).
    if ((state.slow_falling || state.levitation) && effects_reset_fall_before_travel)
        || (state.flying && flight_resets_fall_before_travel)
    {
        state.fall_distance = 0.0;
    }
    phase::emit_before_travel(state, || movement_input(state, rules.release));
    if state.is_player && !state.passenger && state.swimming && state.in_water {
        let steering = if state.look.y < -0.2 {
            rules.swimming_downward_steering
        } else {
            rules.swimming_vertical_steering
        };
        if state.look.y <= 0.0 || state.jump_requested || swimming_head_in_fluid {
            state.velocity.y += (state.look.y - state.velocity.y) * steering;
        }
    }
    let flying_vertical_velocity = state.velocity.y;
    let going_down = state.velocity.y <= 0.0;
    // LivingEntity.travel before 1.20 resets the fall distance under Slow Falling only while not
    // rising (1.13.2 LivingEntity.java:1511-1513, 1.19.4 :1986-1990)
    if state.slow_falling && going_down && !effects_reset_fall_before_travel {
        state.fall_distance = 0.0;
    }
    // from 1.20.5 travel's gravity is getFinalGravity(), 0 with NoGravity, which the glide takes
    // too (1.20.5 LivingEntity.java:2111, Entity.java:1112-1114; 1.21.11 Entity.java:1398-1400);
    // before, the glide's fixed 0.08 ignores NoGravity (1.16.5 LivingEntity.java:1963)
    let travel_gravity = if state.no_gravity && rules.release.at_least(1, 20, 5) {
        0.0
    } else if state.slow_falling && going_down {
        rules.gravity.min(0.01)
    } else {
        rules.gravity
    };
    // LivingEntity.getSpeed reads the attribute with every modifier it holds (1.21.11
    // AttributeInstance.java:150-172), which a caller that has them folds itself
    let movement_speed = state.movement_speed_value.unwrap_or_else(|| {
        movement_speed_attribute(
            state.movement_speed.unwrap_or(config.movement_speed),
            state.speed_effect_amplifier,
            state.slowness_effect_amplifier,
            state.sprint_modifier.unwrap_or(state.sprinting),
            config.sprint_multiplier,
            rules.release,
        )
    });
    let water_efficiency = {
        let efficiency = if rules.water_movement_efficiency_attribute {
            state.water_movement_efficiency as f32
        } else {
            f32::from(state.depth_strider.min(3))
        };
        if state.on_ground {
            efficiency
        } else {
            efficiency * 0.5
        }
    };
    let toward_water_efficiency = |value: f32, target: f32| {
        if water_efficiency > 0.0 {
            value
                + (target - value) * water_efficiency
                    / rules.water_movement_efficiency_divisor as f32
        } else {
            value
        }
    };
    let water_slowdown = if state.dolphins_grace > 0 {
        0.96
    } else if state.sprinting && !legacy_fluids {
        toward_water_efficiency(rules.water_sprint_drag as f32, 0.54600006)
    } else {
        toward_water_efficiency(rules.water_drag as f32, 0.54600006)
    };
    let fluid_input_speed = match fluid {
        FluidState::Water | FluidState::Waterlogged => f64::from(toward_water_efficiency(
            rules.water_input_speed as f32,
            movement_speed as f32,
        )),
        FluidState::Lava => java_float(rules.lava_input_speed),
        FluidState::Empty => movement_speed,
    };
    let block_friction = {
        let friction = world.slipperiness_at(below_position);
        if rules.fluid_travel_split {
            compute_modified_friction(
                friction,
                effective_modifier(state.friction_modifier, state.friction_modifier_present),
            )
        } else {
            friction
        }
    };
    let air_inertia = if rules.fluid_travel_split {
        compute_modified_friction(
            rules.air_drag,
            effective_modifier(state.air_drag_modifier, state.air_drag_modifier_present),
        )
    } else {
        rules.air_drag
    };
    let ground_inertia = if state.on_ground {
        java_float(java_float(block_friction) * java_float(air_inertia))
    } else {
        java_float(air_inertia)
    };
    let input_speed = if matches!(fluid, FluidState::Empty) {
        if state.on_ground {
            friction_influenced_speed(movement_speed, block_friction, rules.release)
        } else {
            flying_speed(state, rules.release)
        }
    } else {
        fluid_input_speed
    };
    // LivingEntity.travelFallFlying from 1.21.5: on a climbable block the glide travels as in the
    // air and stops (1.21.5 LivingEntity.java:2299-2302, 1.21.11 :2439-2442, 26.3 :2499-2502)
    let glide_stopped = state.fall_flying
        && matches!(fluid, FluidState::Empty)
        && climbing
        && rules.release.at_least(1, 21, 5);
    let gliding = state.fall_flying && matches!(fluid, FluidState::Empty) && !glide_stopped;
    if !gliding {
        let input = movement_input(state, rules.release);
        let yaw = move_relative_yaw(state, rules.release);
        state.velocity = state.velocity + relative_movement(input, input_speed, yaw, rules.release);
    }
    let mut glide_speed = None;
    if gliding {
        // LivingEntity.travel's glide: from 1.19.3 Entity.checkSlowFallDistance lowers the fall
        // distance to 1.0 (1.19.3 Entity.java:2156-2158, LivingEntity.java:2117); 1.9 - 1.19.2 set
        // it to 1.0 outright, raising a smaller one (1.9.4 LivingEntity.java:1328-1329, 1.19.2
        // :2107-2109)
        if !fall_flying_checks_before_travel {
            if rules.release.at_least(1, 19, 3) {
                state.check_fall_distance_accumulation();
            } else if state.velocity.y > -0.5 {
                state.fall_distance = 1.0;
            }
        }
        glide_speed = Some(horizontal_speed(state.velocity));
        glide(state, travel_gravity, rules.release);
    } else if state.flying {
        state.velocity.y = flying_vertical_velocity;
    }
    if climbing && matches!(fluid, FluidState::Empty) && !gliding {
        let limit = java_float(0.15);
        state.fall_distance = 0.0;
        // Mth.clamp(double) (LivingEntity.handleOnClimbable, 1.21.11 Mth.java:112-114).
        state.velocity.x = clamp_f64_for(rules.release, state.velocity.x, -limit, limit);
        state.velocity.z = clamp_f64_for(rules.release, state.velocity.z, -limit, limit);
        let fall_limit = if rules.release.at_least(1, 14, 0) {
            limit
        } else {
            0.15
        };
        state.velocity.y = state.velocity.y.max(-fall_limit);
        let suppresses_sliding_down =
            state.sneaking && !(state.flying && rules.release.at_least(1, 16, 0));
        if state.is_player && suppresses_sliding_down && !on_scaffolding && state.velocity.y < 0.0 {
            state.velocity.y = 0.0;
        }
    }
    phase::emit(Phase::BeforeMove, state);
    state.move_slowed =
        !state.no_physics && state.stuck_speed_multiplier.length_squared() > 1.0e-7;
    let mut movement = slowed_by_stuck_speed(state, state.velocity);
    // (every source of motion ends here: the walks below take a step or a cell at a time)
    if state.bounds().expand_towards(movement).cell_count() > MAX_WALKED_CELLS {
        state.move_out_of_range = true;
        movement = Vec3::ZERO;
    }
    let collision_context = entity_collision_context(state);
    let desired = back_off_from_edge(
        state,
        world,
        &collision_context,
        movement,
        rules.step_height,
        rules.release,
    );
    let collision = if state.no_physics {
        WorldCollision {
            movement: desired,
            moved_bounds: None,
            outside_border: state.outside_border,
        }
    } else {
        collide_with_world(state, world, &collision_context, desired, rules)
    };
    let displacement = collision.movement;
    let move_start = state.position;
    // Entity.move (1.18.2+): a collided move of a block or more clips with FALLDAMAGE_RESETTING and
    // Fluid.WATER and resets the fall distance on a hit; from 1.21.9 the clip covers at most 8
    // blocks (1.19 Entity.java:570-580, 1.21.9 :703-711; 1.18.1 has none, 1.18.2 has the
    // #fall_damage_resetting tag). checkFallDamage still counts this move's drop afterwards.
    if !state.no_physics
        && rules.release.at_least(1, 18, 2)
        && state.fall_distance != 0.0
        && displacement.length_squared() >= 1.0
    {
        let clip_end = if rules.release.at_least(1, 21, 9) {
            // Vec3.normalize divides by the length (never under 1.0E-5F here)
            let length = displacement.length();
            let normal = Vec3::new(
                displacement.x / length,
                displacement.y / length,
                displacement.z / length,
            );
            move_start + normal.scale(length.min(8.0))
        } else {
            move_start + displacement
        };
        let shape = ClipShape::FallDamageResetting {
            player: state.is_player,
        };
        if clip_hits(world, move_start, clip_end, rules.release, shape) {
            state.fall_distance = 0.0;
        }
    }
    displace(state, desired, collision, rules.release);
    let horizontal_collision = |requested: f64, moved: f64| {
        if rules.release.at_least(1, 14, 0) {
            !vanilla_equal(requested, moved)
        } else {
            requested != moved
        }
    };
    let x_collision = horizontal_collision(desired.x, displacement.x);
    let y_collision = desired.y != displacement.y;
    let z_collision = horizontal_collision(desired.z, displacement.z);
    if !state.no_physics {
        state.collided_horizontally = x_collision || z_collision;
        state.minor_horizontal_collision = state.minor_horizontal_collision_supported
            && state.is_player
            && state.collided_horizontally
            && horizontal_collision_is_minor(state, displacement, rules.release);
        // Entity.move (1.21.4+) refreshes the vertical collision only on a vertical move or for
        // a locally controlled entity; earlier releases refresh it on every move.
        if !rules.release.at_least(1, 21, 4)
            || desired.y != 0.0
            || state.controlled_by_local_instance
        {
            state.collided_vertically = y_collision;
            state.vertical_collision_below = state.collided_vertically && desired.y < 0.0;
            state.on_ground = state.collided_vertically && desired.y < 0.0;
            support = check_supporting_block(world, state, Some(displacement), rules.release);
        }
    } else if rules.release.at_least(1, 21, 9) {
        state.collided_horizontally = false;
        state.minor_horizontal_collision = false;
        state.collided_vertically = false;
        state.vertical_collision_below = false;
    }
    let fall_check = check_fall_damage(
        state,
        world,
        rules,
        support,
        displacement.y,
        y_collision,
        FallDamageRules {
            landing_damage_rounding,
            restitution_enabled,
            modern_fall_damage,
        },
    );
    if let Some(lava_height) = fall_check.lava_height {
        fluid_height = lava_height;
    }
    let FallCheck {
        bounced,
        landed_on_bed,
        ..
    } = fall_check;

    // Entity.move (1.17 - 1.19) stops after checkFallDamage for a removed entity
    let removed_in_move = state.removed && rules.release.at_least(1, 17, 0);
    // Block.updateEntityMovementAfterFallOn (onLanded, setEntityVelocity before 1.14) runs on any
    // vertical collision, a ceiling's too, for a locally controlled entity only from 1.21.2 (1.21
    // Entity.java:665-668, 1.21.3 :698-703, 1.21.11 :768-773; 1.12.2 :826-828). 26.2 has no such
    // hook: restituteMovementAfterCollisions takes the vertical collision of a vertical move only,
    // `movedVertically = Math.abs(delta.y) > 0.0`, so a step-up from a move with no y does not
    // count (26.2 Entity.java:793, 815).
    state.block_fall_callback = block_fall_callback_runs(state, y_collision, desired.y, rules.release);
    if restitution_enabled && !removed_in_move {
        // only for a move that went vertically into its vertical collision or hit something
        // sideways (26.2 Entity.java:793, 815; 26.3 :818, 837)
        if (desired.y.abs() > 0.0 && y_collision) || x_collision || z_collision {
            restitute_movement_after_collisions(
                state,
                world,
                support,
                rules,
                [x_collision, y_collision, z_collision],
                displacement.y,
            );
        }
    } else if !removed_in_move {
        let (stops_x, stops_z) = if rules.release.at_least(1, 18, 2) {
            (x_collision, z_collision)
        } else if rules.release.at_least(1, 14, 0) {
            // Until 1.18.2 the z reset puts back the x motion it read before the x reset.
            let stops_z = desired.z != displacement.z;
            (desired.x != displacement.x && !stops_z, stops_z)
        } else {
            (desired.x != displacement.x, desired.z != displacement.z)
        };
        if stops_x {
            state.velocity.x = 0.0;
        }
        if y_collision && simulates_landing(state, rules.release) && !bounced {
            if landed_on_bed && !state.sneaking {
                if state.velocity.y < 0.0 {
                    // BedBlock.bounceUp (1.21.11 BedBlock.java:149-150)
                    state.velocity.y = -state.velocity.y
                        * 0.6600000262260437
                        * landing_bounce(state, rules.release);
                }
            } else {
                // Block.updateEntityAfterFallOn multiplies by zero: a landing leaves -0.0.
                // Before 1.14 Block.onLanded sets 0.0.
                state.velocity.y = if rules.release.at_least(1, 14, 0) {
                    state.velocity.y * 0.0
                } else {
                    0.0
                };
            }
        }
        if stops_z {
            state.velocity.z = 0.0;
        }
    }
    if !state.no_physics {
        update_in_lava_after_move(state, world, rules.release);
    }
    let jump_factor = block_jump_factor(
        world,
        block_position(state.position, rules.release),
        block_below_affecting_movement(world, state, support, rules.release),
    );
    // only xxa, zza and jumping are cleared: the keys stay in LocalPlayer.input, which the auto-jump
    // reads after the move (1.20.4 ClientPlayerEntity.java:871, 996; 26.3 LocalPlayer.java:983, 1003,
    // 1110-1114), so a pushed sleeper can arm the jump its first tick awake takes
    if immobile {
        state.input = requested_input;
    }
    update_auto_jump(
        state,
        world,
        state.position - old_position,
        movement_speed as f32,
        jump_factor,
        rules.release,
    );
    let mut inside_after_move = Vec::new();
    if !rules.release.at_least(1, 21, 2) && !removed_in_move {
        let inside: Vec<_> = blocks_inside(state, rules.release)
            .into_iter()
            .map(|position| (position, true))
            .collect();
        apply_block_effects(state, world, support, rules.release, &inside);
        inside_after_move = inside;
    }
    if rules.release.at_least(1, 15, 0) && !state.no_physics && !removed_in_move {
        let speed_factor = f64::from(block_speed_factor(world, state, support, rules.release));
        state.velocity.x *= speed_factor;
        state.velocity.z *= speed_factor;
    }
    phase::emit(Phase::AfterMove, state);
    if let Some(speed) = glide_speed {
        deal_wall_damage(state, speed, rules.release);
    }
    let climbs_powder_snow = state.powder_snow_walkable
        && if rules.release.at_least(1, 21, 5) {
            was_in_powder_snow
        } else {
            world.effect_at(block_position(state.position, rules.release)) == BlockEffect::PowderSnow
        };
    // From 1.21.2 travelInAir takes getEffectiveGravity after the move: Slow Falling tests the delta
    // the move left, before handleRelativeFrictionAndCalculateMovement's climb (1.21.2
    // LivingEntity.java:2194-2197, 2213-2229, 2383-2393; 26.3 :2337-2340, 2382-2397); before, travel
    // tests the delta it started with (1.21 LivingEntity.java:2095-2101)
    let air_gravity = if rules.release.at_least(1, 21, 2) && !state.no_gravity {
        if state.slow_falling && state.velocity.y <= 0.0 {
            rules.gravity.min(0.01)
        } else {
            rules.gravity
        }
    } else {
        travel_gravity
    };
    if matches!(fluid, FluidState::Empty)
        && !gliding
        && (state.collided_horizontally
            || (state.jump_requested && rules.release.at_least(1, 14, 0)))
        && (climbable(world, state, rules.release) || climbs_powder_snow)
    {
        state.velocity.y = 0.2;
    }
    // a passenger's flight is no flight to Player.travel, which passes it to LivingEntity.travel
    // as it is (1.8.9 PlayerEntity.java:1303, 1.12.2 :1419, 1.20.4 :1488, 26.3 Player.java:1294-1296)
    let flight_travel = state.flying && !state.passenger;
    if matches!(fluid, FluidState::Empty) && !gliding && !flight_travel {
        if state.levitation {
            let target = 0.05 * (f64::from(state.levitation_amplifier.unwrap_or(0)) + 1.0);
            state.velocity.y += (target - state.velocity.y) * 0.2;
            // LivingEntity.travel's air move resets the fall distance under Levitation after the
            // move, 1.13 - 1.19.4 (1.13.2 LivingEntity.java:1609-1612, 1.19.4 :2093-2095); 1.9 -
            // 1.12 never reset it (1.12.2 LivingEntity.java:1543-1545)
            if rules.release.at_least(1, 13, 0) && !effects_reset_fall_before_travel {
                state.fall_distance = 0.0;
            }
        } else if !rules.release.at_least(1, 14, 0)
            && state.client_side
            && !column_loaded(world, state.position, rules.release)
        {
            // only the client sinks, at world.isClient's test (1.8.9 LivingEntity.java:1186-1190,
            // 1.12.2 :1548); from 1.14 ClientWorld.isChunkLoaded answers true for every chunk (1.14
            // ClientWorld.java:212, ViewableWorld.java:234; 26.3 ClientLevel.java:490), which also
            // admits every LocalPlayer.tick (1.14 ClientPlayerEntity.java:173, 1.20.4 :191), and
            // from 1.21.2 no column is asked there at all (1.21.3 ClientPlayerEntity.java:193)
            state.velocity.y = if state.position.y > 0.0 { -0.1 } else { 0.0 };
        } else if !state.no_gravity {
            state.velocity.y -= air_gravity;
        }
    }
    let horizontal_drag = if gliding { 1.0 } else { ground_inertia };
    if matches!(fluid, FluidState::Empty) {
        state.velocity.x *= horizontal_drag;
        state.velocity.z *= horizontal_drag;
    } else {
        let after_move = FluidTravelAfterMove {
            fluid,
            fluid_height,
            fluid_jump_threshold,
            water_slowdown,
            gravity: travel_gravity,
            going_down,
            start_y: old_position.y,
        };
        FluidTravelHandler::for_rules(rules).after_move(state, world, rules, &after_move);
    }
    if matches!(fluid, FluidState::Empty) {
        let air_drag = if rules.fluid_travel_split {
            compute_modified_friction(
                rules.vertical_drag,
                effective_modifier(state.air_drag_modifier, state.air_drag_modifier_present),
            )
        } else {
            vertical_drag
        };
        state.velocity.y *= if gliding { 1.0 } else { java_float(air_drag) };
    }
    if flight_travel {
        state.velocity.y = flying_vertical_velocity * 0.6;
        // Player.travel's flight resets the fall distance and the glide from 1.9 (1.9.4
        // PlayerEntity.java:1410-1411); 1.8 only scales the vertical motion (1.8.9
        // PlayerEntity.java:1303-1309)
        if !flight_resets_fall_before_travel && rules.release.at_least(1, 9, 0) {
            state.fall_distance = 0.0;
            state.fall_flying = false;
        }
    }
    // LivingEntity.stopFallFlying, after the air travel
    if glide_stopped {
        state.fall_flying = false;
    }
    phase::emit(Phase::AfterTravel, state);

    let mut inside_effects = InsideEffects::default();
    if rules.release.at_least(1, 21, 2) {
        let movements =
            movements_this_tick(state, old_position, desired, displacement, rules.release);
        let (inside, effects) = blocks_inside_moves(state, world, &movements, rules.release);
        apply_block_effects(state, world, support, rules.release, &inside);
        inside_after_move = inside;
        inside_effects = effects;
    }
    if state.no_physics {
        inside_after_move.clear();
        inside_effects = InsideEffects::default();
    }
    if !removed_in_move {
        apply_inside_fire_effects(
            state,
            world,
            &inside_after_move,
            &inside_effects,
            rules.release,
        );
    }
    let moved = state.position - old_position;
    apply_inside_block_signals(state, world, &inside_after_move, moved, rules.release);
    if state.is_player && state.flying && state.on_ground && !state.no_physics {
        state.flying = false;
    }
    if !rules.release.at_least(1, 14, 0) {
        state.in_lava = legacy_fluid::touching_lava(world, state.bounds(), rules.release);
    }
    state.was_sprinting = state.sprinting;
    state.previous_position = Some(old_position);
    // the state keeps what the caller asks for, as LocalPlayer.input does: the tick after waking
    // reads the keys, whichever way the state came back
    if immobile {
        state.jump_requested = requested_jump;
    }
    let displacement = if let Some(seat) = seat {
        state.position = seat;
        state.fall_distance = 0.0;
        // Entity.setPos fits the box to the position again (1.12.2 Entity.java:403, 1.16.5 :466)
        state.bounding_box = None;
        Vec3::ZERO
    } else {
        displacement
    };

    TickResult {
        displacement,
        collided_horizontally: state.collided_horizontally,
        collided_vertically: state.collided_vertically,
        block_fall_callback: state.block_fall_callback,
    }
}
