use crate::collision::{resolve_motion, resolve_step_motion, vanilla_equal};
use crate::entity::{Dimensions, EntityFlags, EntityState};
use crate::math::{java_cos, java_cos_legacy, java_float, java_sin, java_sin_legacy, Aabb, Vec3};
use crate::version::MinecraftVersion;
use crate::world::WorldSnapshot;
use crate::world::{BlockEffect, FluidContact, FluidState};

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
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LandingDamageRounding {
    Ceil,
    Floor,
}

pub(crate) fn landing_damage(
    fall_distance: f64,
    safe_fall_distance: f64,
    multiplier: f64,
    jump_boost_amplifier: Option<u8>,
    rounding: LandingDamageRounding,
) -> f64 {
    let jump_boost = jump_boost_amplifier.map_or(0.0, |amplifier| f64::from(amplifier) + 1.0);
    if fall_distance <= 3.0 + safe_fall_distance + jump_boost {
        return 0.0;
    }
    let damage = (fall_distance - 3.0 - safe_fall_distance - jump_boost) * multiplier;
    match rounding {
        LandingDamageRounding::Ceil => damage.ceil(),
        LandingDamageRounding::Floor => damage.floor(),
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
        false,
        P::rules().water_movement_efficiency_attribute,
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
            water_gravity_divisor: 5.0,
            lava_gravity_divisor: 4.0,
            water_drag: 0.8,
            water_sprint_drag: 0.9,
            lava_drag: 0.5,
            air_drag: 0.98,
            vertical_drag: 0.98,
            fluid_vertical_drag: 0.8,
            water_flow_scale: 0.014,
            lava_flow_scale: 0.0023333333333333335,
            ultra_warm_lava_flow_scale: 0.007,
            fluid_travel_split: false,
            fluid_falling_checks_gravity_argument: false,
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
    speed_effect_amplifier: Option<u8>,
    slowness_effect_amplifier: Option<u8>,
    sprint_active: bool,
    sprint_multiplier: f64,
    release: MinecraftVersion,
) -> f64 {
    let sprint = sprint_active.then(|| java_float(sprint_multiplier - 1.0));
    let speed = speed_effect_amplifier
        .map(|amplifier| 0.20000000298023224 * (f64::from(amplifier) + 1.0));
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

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SimulationState {
    pub position: Vec3,
    pub velocity: Vec3,
    pub yaw: f64,
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
    pub sprinting: bool,
    pub was_sprinting: bool,
    pub in_water: bool,
    pub in_lava: bool,
    pub ultra_warm: bool,
    pub is_player: bool,
    pub controlled_by_local_instance: bool,
    pub passenger: bool,
    pub in_web: bool,
    pub weaving: bool,
    pub sweet_berry_bush_immune: bool,
    pub powder_snow_immune: bool,
    pub powder_snow_walkable: bool,
    pub in_powder_snow: bool,
    pub ticks_frozen: u32,
    pub ticks_required_to_freeze: u32,
    pub tick_count: u32,
    pub freeze_damage: f64,
    pub contact_damage: f64,
    pub inside_wall: bool,
    pub eye_height: Option<f64>,
    pub eye_in_water: bool,
    pub eye_in_lava: bool,
    pub slow_falling: bool,
    pub levitation: bool,
    pub levitation_amplifier: Option<u8>,
    pub fall_distance: f64,
    pub safe_fall_distance: f64,
    pub fall_damage_immune: bool,
    pub fall_damage_multiplier: Option<f64>,
    pub sneaking: bool,
    pub moving_slowly: Option<bool>,
    pub stepping_carefully: bool,
    pub using_item: bool,
    pub swimming: bool,
    pub flying: bool,
    pub flying_speed: f64,
    pub climbing: bool,
    pub no_physics: bool,
    pub no_gravity: bool,
    pub gravity: Option<f64>,
    pub step_height: Option<f64>,
    pub movement_speed: f64,
    pub jump_strength: Option<f64>,
    pub speed_effect_amplifier: Option<u8>,
    pub slowness_effect_amplifier: Option<u8>,
    pub jump_boost_amplifier: Option<u8>,
    pub dolphins_grace: u8,
    pub depth_strider: u8,
    pub soul_speed: u8,
    pub water_movement_efficiency: f64,
    pub movement_efficiency: f64,
    pub air_drag_modifier: f64,
    pub friction_modifier: f64,
    pub air_drag_modifier_present: bool,
    pub friction_modifier_present: bool,
    pub sneaking_speed: f64,
    pub fall_damage: f64,
    pub fall_flying: bool,
    pub look: Vec3,
    pub firework_boost: Vec3,
    pub stuck_speed_multiplier: Vec3,
}

impl From<EntityState> for SimulationState {
    fn from(value: EntityState) -> Self {
        Self {
            position: value.position,
            velocity: value.velocity,
            yaw: 0.0,
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
            sprinting: false,
            was_sprinting: false,
            in_water: value.flags.in_water,
            in_lava: value.flags.in_lava,
            ultra_warm: false,
            is_player: false,
            controlled_by_local_instance: false,
            passenger: false,
            in_web: false,
            weaving: false,
            sweet_berry_bush_immune: false,
            powder_snow_immune: false,
            powder_snow_walkable: false,
            in_powder_snow: false,
            ticks_frozen: 0,
            ticks_required_to_freeze: 140,
            tick_count: 0,
            freeze_damage: 0.0,
            contact_damage: 0.0,
            inside_wall: false,
            eye_height: None,
            eye_in_water: false,
            eye_in_lava: false,
            slow_falling: false,
            levitation: false,
            levitation_amplifier: None,
            fall_distance: 0.0,
            safe_fall_distance: 0.0,
            fall_damage_immune: false,
            fall_damage_multiplier: Some(1.0),
            sneaking: false,
            moving_slowly: None,
            stepping_carefully: false,
            using_item: false,
            swimming: false,
            flying: false,
            flying_speed: 0.02,
            climbing: false,
            no_physics: false,
            no_gravity: false,
            gravity: None,
            step_height: None,
            movement_speed: 0.0,
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
            sneaking_speed: 0.0,
            fall_damage: 0.0,
            fall_flying: false,
            look: Vec3::new(0.0, 0.0, 1.0),
            firework_boost: Vec3::ZERO,
            stuck_speed_multiplier: Vec3::ZERO,
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
        }
    }
}

impl SimulationState {
    #[must_use]
    pub fn bounds(self) -> Aabb {
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

    pub fn add_delta_movement(&mut self, impulse: Vec3) {
        if impulse.is_finite() {
            let candidate = self.velocity + impulse;
            if candidate.is_finite() {
                self.velocity = candidate;
            }
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
}

#[derive(Clone, Debug, PartialEq)]
pub struct TickOutputSnapshot {
    pub state: SimulationState,
    pub result: TickResult,
}

impl TickInputSnapshot {
    #[must_use]
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
        }
    }

    #[must_use]
    pub fn execute(&self) -> TickOutputSnapshot {
        let mut state = self.state;
        let result = tick_with_rules_and_rounding_and_restitution(
            &mut state,
            &self.world,
            self.config,
            self.rules,
            self.landing_damage_rounding,
            self.restitution_enabled,
            self.modern_fall_damage,
        );
        TickOutputSnapshot { state, result }
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

fn push_by_fluid(
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
            normalize(contact.flow, release)
        }
    } else {
        if !(vector_length(contact.flow, release) > 0.0) {
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
            normalize(current, release)
        }
    };
    let mut push = current.scale(scale);
    if release.at_least(1, 16, 0)
        && state.velocity.x.abs() < 0.003
        && state.velocity.z.abs() < 0.003
        && vector_length(push, release) < 0.0045000000000000005
    {
        push = normalize(push, release).scale(0.0045000000000000005);
    }
    state.velocity = state.velocity + push;
}

fn vector_length(vector: Vec3, release: MinecraftVersion) -> f64 {
    let length = vector.length_squared().sqrt();
    if release.at_least(1, 17, 0) {
        length
    } else {
        java_float(length)
    }
}

fn normalize(vector: Vec3, release: MinecraftVersion) -> Vec3 {
    let length = vector_length(vector, release);
    if length < 1.0e-4 {
        Vec3::ZERO
    } else {
        Vec3::new(vector.x / length, vector.y / length, vector.z / length)
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
                state.velocity.y = fluid_falling_adjusted_y(gravity, going_down, state.velocity.y);
            }
        }
        FluidState::Lava => {
            if rules.release.at_least(1, 16, 0) && fluid_height <= fluid_jump_threshold {
                state.velocity.y *= java_float(rules.fluid_vertical_drag);
                if fluid_falling_gravity_enabled(state, rules, state.sprinting) {
                    state.velocity.y =
                        fluid_falling_adjusted_y(gravity, going_down, state.velocity.y);
                }
            } else {
                state.velocity.y *= 0.5;
            }
            if !state.no_gravity {
                state.velocity.y -= gravity / rules.lava_gravity_divisor;
            }
        }
        FluidState::Empty => {}
    }
}

fn stuck_speed_multiplier_inside(
    state: &SimulationState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> Option<Vec3> {
    let inset = if !release.at_least(1, 19, 3) {
        0.001
    } else if !release.at_least(1, 21, 2) {
        1.0e-7
    } else {
        f64::from(1.0e-5_f32)
    };
    let inside = state.bounds().deflate(Vec3::new(inset, inset, inset));
    let min = block_position(inside.min);
    let max = block_position(inside.max);
    let in_powder_snow = world.effect_at(block_position(state.position)) == BlockEffect::PowderSnow;
    let multiplier_at = |position| match world.effect_at(position) {
        BlockEffect::Web if state.weaving => Some(Vec3::new(0.5, 0.25, 0.5)),
        BlockEffect::Web => Some(Vec3::new(0.25, java_float(0.05), 0.25)),
        BlockEffect::SweetBerryBush if !state.sweet_berry_bush_immune => {
            Some(Vec3::new(java_float(0.8), 0.75, java_float(0.8)))
        }
        BlockEffect::PowderSnow if in_powder_snow => {
            Some(Vec3::new(java_float(0.9), 1.5, java_float(0.9)))
        }
        _ => None,
    };
    let mut multiplier = None;
    if release.at_least(1, 21, 2) {
        for z in min.2..=max.2 {
            for y in min.1..=max.1 {
                for x in min.0..=max.0 {
                    multiplier = multiplier_at((x, y, z)).or(multiplier);
                }
            }
        }
    } else {
        for x in min.0..=max.0 {
            for y in min.1..=max.1 {
                for z in min.2..=max.2 {
                    multiplier = multiplier_at((x, y, z)).or(multiplier);
                }
            }
        }
    }
    multiplier
}

fn climbable(world: &WorldSnapshot, state: &SimulationState) -> bool {
    !state.no_physics
        && (state.climbing
            || matches!(
                world.effect_at(block_position(state.position)),
                BlockEffect::Climbable | BlockEffect::Scaffolding
            ))
}

fn block_position(position: Vec3) -> (i32, i32, i32) {
    (
        position.x.floor() as i32,
        position.y.floor() as i32,
        position.z.floor() as i32,
    )
}

fn fluid_falling_adjusted_y(gravity: f64, falling: bool, current_y: f64) -> f64 {
    if falling && (current_y - 0.005).abs() >= 0.003 && (current_y - gravity / 16.0).abs() < 0.003 {
        -0.003
    } else {
        current_y - gravity / 16.0
    }
}

fn fluid_falling_gravity_enabled(
    state: &SimulationState,
    rules: VersionPhysicsRules,
    sprint_active: bool,
) -> bool {
    if sprint_active {
        return false;
    }

    if rules.fluid_falling_checks_gravity_argument {
        rules.gravity != 0.0
    } else {
        !state.no_gravity
    }
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

fn jump_power(
    state: &SimulationState,
    config: PhysicsConfig,
    release: MinecraftVersion,
    block_jump_factor: f32,
) -> f64 {
    let strength = state.jump_strength.unwrap_or(config.jump_velocity);
    let power = strength as f32 * block_jump_factor;
    let boost = state
        .jump_boost_amplifier
        .map_or(0.0, |amplifier| 0.1_f32 * (f32::from(amplifier) + 1.0));
    if release.at_least(1, 17, 1) && !release.at_least(1, 20, 0) {
        f64::from(power) + f64::from(boost)
    } else {
        f64::from(power + boost)
    }
}

fn friction_influenced_speed(speed: f64, friction: f64) -> f64 {
    let friction = friction as f32;
    f64::from(speed as f32 * (0.21600002_f32 / (friction * friction * friction)))
}

fn glide(state: &mut SimulationState, gravity: f64, release: MinecraftVersion) {
    let look = state.look;
    let look_horizontal = (look.x * look.x + look.z * look.z).sqrt();
    let horizontal_speed =
        (state.velocity.x * state.velocity.x + state.velocity.z * state.velocity.z).sqrt();
    let look_factor = if release.at_least(1, 21, 2) {
        1.0
    } else {
        (look.length() / 0.4).min(1.0)
    };
    let lift = if release.at_least(1, 18, 2) {
        let cos = state.pitch.cos();
        cos * cos * look_factor
    } else {
        let cos = mth_cos(state.pitch, release);
        java_float(cos * cos * look_factor)
    };
    let mut velocity = state.velocity;
    velocity.y += gravity * (-1.0 + lift * 0.75);
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
    let keys = [state.input.x as f32, state.input.z as f32];
    let [strafe, forward] = if !state.is_player {
        scale_input(keys, 0.98)
    } else if release.at_least(1, 21, 5) {
        modified_input(keys, state)
    } else {
        let item_slows_first = release.at_least(1, 21, 4);
        let mut input = keys;
        if state.using_item && item_slows_first {
            input = scale_input(input, 0.2);
        }
        if state.moving_slowly.unwrap_or(state.sneaking) {
            input = if release.at_least(1, 19, 0) {
                scale_input(input, sneaking_speed(state))
            } else {
                input.map(|impulse| (f64::from(impulse) * 0.3) as f32)
            };
        }
        if state.using_item && !item_slows_first {
            input = scale_input(input, 0.2);
        }
        scale_input(input, 0.98)
    };
    Vec3::new(f64::from(strafe), state.input.y, f64::from(forward))
}

fn modified_input(keys: [f32; 2], state: &SimulationState) -> [f32; 2] {
    let length = (keys[0] * keys[0] + keys[1] * keys[1]).sqrt();
    if length < 1.0e-4 {
        return [0.0, 0.0];
    }
    let mut input = scale_input([keys[0] / length, keys[1] / length], 0.98);
    if state.using_item {
        input = scale_input(input, 0.2);
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
    if state.sneaking_speed > 0.0 {
        state.sneaking_speed as f32
    } else {
        0.3
    }
}

fn mth_sin(radians: f64, release: MinecraftVersion) -> f64 {
    if release.at_least(1, 21, 11) {
        java_sin(radians)
    } else {
        java_sin_legacy(radians as f32)
    }
}

fn mth_cos(radians: f64, release: MinecraftVersion) -> f64 {
    if release.at_least(1, 21, 11) {
        java_cos(radians)
    } else {
        java_cos_legacy(radians as f32)
    }
}

fn relative_movement(input: Vec3, speed: f64, yaw: f64, release: MinecraftVersion) -> Vec3 {
    let length_squared = input.x * input.x + input.y * input.y + input.z * input.z;
    if length_squared < 1.0e-7 {
        return Vec3::ZERO;
    }
    let direction = if length_squared > 1.0 {
        let length = length_squared.sqrt();
        Vec3::new(input.x / length, input.y / length, input.z / length)
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

fn compute_modified_friction(friction: f64, modifier: f64) -> f64 {
    f64::from((1.0 - (1.0 - friction as f32) * modifier as f32).clamp(0.0, 1.0))
}

fn effective_modifier(modifier: f64, present: bool) -> f64 {
    if present || modifier != 0.0 {
        modifier
    } else {
        1.0
    }
}

fn back_off_from_edge(
    state: &SimulationState,
    world: &WorldSnapshot,
    delta: Vec3,
    max_down_step: f64,
) -> Vec3 {
    if state.no_physics
        || !state.is_player
        || !state.sneaking
        || state.flying
        || delta.y > 0.0
        || max_down_step <= 0.0
    {
        return delta;
    }
    let bounds = state.bounds();
    let above_ground = state.on_ground
        || (state.fall_distance < max_down_step
            && !world.no_collision(bounds.translated(Vec3::new(
                0.0,
                -max_down_step + state.fall_distance,
                0.0,
            ))));
    if !above_ground {
        return delta;
    }
    let mut x = delta.x;
    let mut z = delta.z;
    let step_x = x.signum() * 0.05;
    let step_z = z.signum() * 0.05;
    let can_fall = |x: f64, z: f64| {
        let lowered = Aabb::new(
            Vec3::new(
                bounds.min.x + 1.0e-7 + x,
                bounds.min.y - max_down_step - 1.0e-7,
                bounds.min.z + 1.0e-7 + z,
            ),
            Vec3::new(
                bounds.max.x - 1.0e-7 + x,
                bounds.min.y,
                bounds.max.z - 1.0e-7 + z,
            ),
        );
        world.no_collision(lowered)
    };
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
    state.tick_count = state.tick_count.saturating_add(1);
    let old_position = state.position;
    state.contact_damage = 0.0;
    state.block_fall_callback = false;
    if !state.velocity.is_finite() {
        state.velocity = Vec3::ZERO;
    }
    rules.gravity = config.gravity;
    // Keep source-generated version drag when callers use the default config;
    // an explicitly customized runtime drag remains an override.
    if config.drag != PhysicsConfig::default().drag {
        rules.air_drag = config.drag;
    }
    rules.step_height = config.step_height;
    if let Some(gravity) = state.gravity {
        rules.gravity = gravity;
    }
    if let Some(step_height) = state.step_height {
        rules.step_height = step_height;
    }
    if state.slow_falling || state.levitation {
        state.fall_distance = 0.0;
    }
    state.jump_ticks = state.jump_ticks.saturating_sub(1);
    let feet_position = (
        state.position.x.floor() as i32,
        (state.position.y - 0.01).floor() as i32,
        state.position.z.floor() as i32,
    );
    let body_position = (
        state.position.x.floor() as i32,
        state.position.y.floor() as i32,
        state.position.z.floor() as i32,
    );
    let bounds = state.bounds();
    let eye_height = state.eye_height.unwrap_or(state.height * 0.85);
    let eye_half_width = state.half_width * 0.8;
    let eye_box = Aabb::new(
        Vec3::new(
            state.position.x - eye_half_width,
            state.position.y + eye_height - 0.5e-6,
            state.position.z - eye_half_width,
        ),
        Vec3::new(
            state.position.x + eye_half_width,
            state.position.y + eye_height + 0.5e-6,
            state.position.z + eye_half_width,
        ),
    );
    state.inside_wall = !state.no_physics
        && world
            .collision_shapes(eye_box)
            .iter()
            .any(|shape| shape.intersects(eye_box));
    let affected_by_fluids = !(state.is_player && state.flying);
    let water = world.fluid_contact(FluidState::Water, bounds, rules.release);
    state.in_water = water.touching;
    if state.in_water {
        state.fall_distance = 0.0;
        if affected_by_fluids {
            push_by_fluid(state, water, rules.water_flow_scale, rules.release);
        }
    }
    let lava = world.fluid_contact(FluidState::Lava, bounds, rules.release);
    state.in_lava = if rules.release.at_least(1, 16, 0) {
        if affected_by_fluids {
            let lava_flow_scale = if state.ultra_warm {
                rules.ultra_warm_lava_flow_scale
            } else {
                rules.lava_flow_scale
            };
            push_by_fluid(state, lava, lava_flow_scale, rules.release);
        }
        lava.height > 0.0
    } else {
        world.has_fluid_block_inside(FluidState::Lava, bounds)
    };
    if state.velocity.x.abs() < config.negligible_velocity {
        state.velocity.x = 0.0;
    }
    if state.velocity.y.abs() < config.negligible_velocity {
        state.velocity.y = 0.0;
    }
    if state.velocity.z.abs() < config.negligible_velocity {
        state.velocity.z = 0.0;
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
    let fluid_height = if state.in_water {
        water.height
    } else {
        lava.height
    };
    let fluid_jump_threshold = if state.height - 0.1 < 0.4 { 0.0 } else { 0.4 };
    let head_position = (
        state.position.x.floor() as i32,
        (state.position.y + state.height - 0.1).floor() as i32,
        state.position.z.floor() as i32,
    );
    let feet_effect = world.effect_at(feet_position);
    let soul_speed_block = matches!(feet_effect, BlockEffect::SoulSand | BlockEffect::SoulSoil);
    let body_effect = world.effect_at(body_position);
    let inside_effects = world.effects_in_bounds(bounds);
    let in_web = inside_effects.contains(&BlockEffect::Web);
    state.in_web = in_web;
    let in_powder_snow = inside_effects.contains(&BlockEffect::PowderSnow);
    state.in_powder_snow = in_powder_snow;
    if in_powder_snow && !state.powder_snow_immune {
        state.ticks_frozen = state.ticks_frozen.saturating_add(1);
    } else {
        state.ticks_frozen = state.ticks_frozen.saturating_sub(2);
    }

    let required_to_freeze = state.ticks_required_to_freeze.max(140);
    state.ticks_frozen = state.ticks_frozen.min(required_to_freeze);
    if state.tick_count % 40 == 0
        && state.ticks_frozen >= required_to_freeze
        && !state.powder_snow_immune
    {
        state.freeze_damage += 1.0;
    }
    if inside_effects.contains(&BlockEffect::Cactus)
        || inside_effects.contains(&BlockEffect::Campfire)
    {
        state.contact_damage += 1.0;
    }
    if inside_effects.contains(&BlockEffect::SoulCampfire) {
        state.contact_damage += 2.0;
    }
    if inside_effects.contains(&BlockEffect::Fire) {
        state.ticks_frozen = 0;
        state.contact_damage += 1.0;
    }
    if inside_effects.contains(&BlockEffect::SoulFire) {
        state.ticks_frozen = 0;
        state.contact_damage += 2.0;
    }
    let ignores_stuck_block = state.is_player && state.flying;
    let honey_block = (-1..=1)
        .flat_map(|x| {
            (-1..=1).map(move |z| (feet_position.0 + x, feet_position.1, feet_position.2 + z))
        })
        .find(|&(x, y, z)| world.effect_at((x, y, z)) == BlockEffect::Honey);
    let honey_sliding = honey_block.is_some_and(|(x, y, z)| {
        !state.on_ground
            && state.position.y <= y as f64 + 0.9375 - 1.0e-7
            && state.velocity.y / 0.98 + 0.08 < -0.08
            && ((x as f64 + 0.5 - state.position.x).abs() + 1.0e-7 > 0.4375 + state.half_width
                || (z as f64 + 0.5 - state.position.z).abs() + 1.0e-7 > 0.4375 + state.half_width)
    });
    let climbing = climbable(world, state);
    let on_scaffolding = body_effect == BlockEffect::Scaffolding;
    let eye_y = state.position.y + state.height - 0.1;
    let eye_fluid_height = world.fluid_height_at(head_position);
    let eye_fluid_top = head_position.1 as f64 + eye_fluid_height;
    let head_fluid = world.block(head_position);
    let swimming_head_position = (
        state.position.x.floor() as i32,
        (state.position.y + 0.9).floor() as i32,
        state.position.z.floor() as i32,
    );
    let swimming_head_in_water = matches!(
        world.block(swimming_head_position).fluid,
        FluidState::Water | FluidState::Waterlogged
    );
    state.eye_in_water = matches!(
        head_fluid.fluid,
        FluidState::Water | FluidState::Waterlogged
    ) && eye_fluid_top > eye_y;
    state.eye_in_lava = head_fluid.fluid == FluidState::Lava && eye_fluid_top > eye_y;
    if state.flying {
        let vertical_input =
            if state.jump_requested { 1.0 } else { 0.0 } - if state.sneaking { 1.0 } else { 0.0 };
        state.velocity.y += vertical_input * state.flying_speed * 3.0;
    }
    let flying_vertical_velocity = state.velocity.y;
    let vertical_drag = match fluid {
        FluidState::Water => rules.water_drag,
        FluidState::Lava => rules.lava_drag,
        FluidState::Waterlogged => rules.water_drag,
        FluidState::Empty => rules.vertical_drag,
    };
    let jumping = state.jump_requested && !(state.is_player && state.flying);
    if matches!(
        fluid,
        FluidState::Water | FluidState::Waterlogged | FluidState::Lava
    ) && jumping
    {
        state.velocity.y += 0.03999999910593033;
    } else if state.on_ground && jumping && state.jump_ticks == 0 {
        let block_jump_factor = if world.effect_at(body_position) == BlockEffect::Honey
            || feet_effect == BlockEffect::Honey
        {
            0.5
        } else {
            1.0
        };
        let power = jump_power(state, config, rules.release, block_jump_factor);
        if !rules.release.at_least(1, 20, 5) || power as f32 > 1.0e-5 {
            state.velocity.y = if rules.release.at_least(1, 21, 2) {
                power.max(state.velocity.y)
            } else {
                power
            };
            if state.sprinting {
                let sin = mth_sin(state.yaw, rules.release);
                let cos = mth_cos(state.yaw, rules.release);
                if rules.release.at_least(1, 20, 5) {
                    state.velocity.x += -sin * 0.2;
                    state.velocity.z += cos * 0.2;
                } else {
                    state.velocity.x += f64::from(-(sin as f32) * 0.2);
                    state.velocity.z += f64::from(cos as f32 * 0.2);
                }
            }
        }
        state.fall_distance = 0.0;
        state.jump_ticks = 10;
    }
    if !jumping {
        state.jump_ticks = 0;
    }
    if state.is_player && !state.passenger && state.swimming && state.in_water {
        let steering = if state.look.y < -0.2 {
            rules.swimming_downward_steering
        } else {
            rules.swimming_vertical_steering
        };
        if state.look.y <= 0.0 || state.jump_requested || swimming_head_in_water {
            state.velocity.y += (state.look.y - state.velocity.y) * steering;
        }
    }
    let going_down = state.velocity.y <= 0.0;
    let travel_gravity = if state.slow_falling && going_down {
        rules.gravity.min(0.01)
    } else {
        rules.gravity
    };
    let mut base_speed = if state.movement_speed > 0.0 {
        state.movement_speed
    } else {
        config.movement_speed
    };
    if rules.fluid_travel_split && soul_speed_block && state.soul_speed > 0 {
        let level = f64::from(state.soul_speed);
        base_speed += 0.0405 + (level - 1.0) * 0.0105;
    }
    let movement_speed = movement_speed_attribute(
        base_speed,
        state.speed_effect_amplifier,
        state.slowness_effect_amplifier,
        state.sprinting,
        config.sprint_multiplier,
        rules.release,
    );
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
    } else if state.sprinting {
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
        let friction = world.slipperiness_at((
            state.position.x.floor() as i32,
            (state.position.y - 0.01).floor() as i32,
            state.position.z.floor() as i32,
        ));
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
            friction_influenced_speed(movement_speed, block_friction)
        } else {
            flying_speed(state, rules.release)
        }
    } else {
        fluid_input_speed
    };
    let gliding = state.fall_flying && matches!(fluid, FluidState::Empty);
    if !gliding {
        let input = movement_input(state, rules.release);
        state.velocity =
            state.velocity + relative_movement(input, input_speed, state.yaw, rules.release);
    }
    let bubble_surface = world.is_air_at((body_position.0, body_position.1 + 1, body_position.2));
    if body_effect == BlockEffect::BubbleUp {
        let (acceleration, maximum) = if bubble_surface {
            (0.1, 1.8)
        } else {
            (0.06, 0.7)
        };
        state.velocity.y = (state.velocity.y + acceleration).min(maximum);
        state.fall_distance = 0.0;
    } else if body_effect == BlockEffect::BubbleDown {
        let minimum = if bubble_surface { -0.9 } else { -0.3 };
        state.velocity.y = (state.velocity.y - 0.03).max(minimum);
        state.fall_distance = 0.0;
    }
    state.add_delta_movement(state.firework_boost);
    if gliding {
        state.check_fall_distance_accumulation();
        glide(state, travel_gravity, rules.release);
    } else if state.flying {
        state.velocity.y = flying_vertical_velocity;
    }
    if climbing && matches!(fluid, FluidState::Empty) && !gliding {
        let limit = java_float(0.15);
        state.fall_distance = 0.0;
        state.velocity.x = state.velocity.x.clamp(-limit, limit);
        state.velocity.z = state.velocity.z.clamp(-limit, limit);
        state.velocity.y = state.velocity.y.max(-limit);
        if state.is_player && state.sneaking && !on_scaffolding && state.velocity.y < 0.0 {
            state.velocity.y = 0.0;
        }
    }
    let mut movement = state.velocity;
    if !state.no_physics && state.stuck_speed_multiplier.length_squared() > 1.0e-7 {
        movement = movement.multiply(state.stuck_speed_multiplier);
        state.stuck_speed_multiplier = Vec3::ZERO;
        state.velocity = Vec3::ZERO;
    }
    let desired = back_off_from_edge(state, world, movement, rules.step_height);
    let bounds = state.bounds();
    let (normal_displacement, normal_collisions, obstacles) = if state.no_physics {
        (desired, [false; 3], Vec::new())
    } else {
        let target = bounds.translated(desired);
        let query = Aabb::new(
            Vec3::new(
                bounds.min.x.min(target.min.x),
                bounds.min.y.min(target.min.y),
                bounds.min.z.min(target.min.z),
            ),
            Vec3::new(
                bounds.max.x.max(target.max.x),
                bounds
                    .max
                    .y
                    .max(target.max.y)
                    .max(bounds.max.y + rules.step_height),
                bounds.max.z.max(target.max.z),
            ),
        );
        let obstacles = world.collision_shapes_for_entity(
            query,
            state.powder_snow_walkable,
            bounds,
            state.sneaking,
        );
        let (displacement, collisions) = resolve_motion(bounds, desired, &obstacles);
        (displacement, collisions, obstacles)
    };
    let can_step = state.on_ground || (normal_collisions[1] && desired.y < 0.0);
    let (displacement, collisions) = if can_step
        && !state.no_physics
        && (normal_collisions[0] || normal_collisions[2])
        && rules.step_height > 0.0
    {
        resolve_step_motion(
            if desired.y < 0.0 {
                bounds.translated(Vec3::new(0.0, normal_displacement.y, 0.0))
            } else {
                bounds
            },
            desired,
            rules.step_height,
            &obstacles,
            normal_displacement,
            normal_collisions,
        )
    } else {
        (normal_displacement, normal_collisions)
    };

    state.position = state.position + displacement;
    let mut reset_fall_distance = false;
    if state.fall_distance != 0.0
        && displacement.length_squared() >= 1.0
        && world.intersects_fall_damage_resetting_block(old_position, displacement)
    {
        state.fall_distance = 0.0;
        reset_fall_distance = true;
    }
    state.collided_horizontally = !state.no_physics
        && (!vanilla_equal(desired.x, displacement.x) || !vanilla_equal(desired.z, displacement.z));
    state.minor_horizontal_collision = false;
    if state.minor_horizontal_collision_supported && state.is_player && state.collided_horizontally
    {
        let input_length_squared = desired.x * desired.x + desired.z * desired.z;
        let displacement_length_squared =
            displacement.x * displacement.x + displacement.z * displacement.z;
        if input_length_squared >= 1.0e-5 && displacement_length_squared >= 1.0e-5 {
            let cosine = (desired.x * displacement.x + desired.z * displacement.z)
                / (input_length_squared * displacement_length_squared).sqrt();
            state.minor_horizontal_collision = cosine.clamp(-1.0, 1.0).acos() < 0.13962634;
        }
    }
    if !state.no_physics {
        if desired.y != 0.0 || state.controlled_by_local_instance {
            state.collided_vertically = !vanilla_equal(desired.y, displacement.y);
            state.vertical_collision_below = state.collided_vertically && desired.y < 0.0;
            state.block_fall_callback =
                state.vertical_collision_below && state.controlled_by_local_instance;
            state.on_ground = state.collided_vertically && desired.y < 0.0;
        }
    } else {
        state.collided_vertically = false;
        state.vertical_collision_below = false;
    }
    let checks_fall_damage =
        !(state.is_player && rules.release == MinecraftVersion::new(1, 21, 4));
    if checks_fall_damage && !state.in_water {
        let water = world.fluid_contact(FluidState::Water, state.bounds(), rules.release);
        if water.touching {
            state.in_water = true;
            state.fall_distance = 0.0;
            if affected_by_fluids {
                push_by_fluid(state, water, rules.water_flow_scale, rules.release);
            }
        }
        if rules.release.at_least(26, 1, 0) {
            let lava = world.fluid_contact(FluidState::Lava, state.bounds(), rules.release);
            state.in_lava = lava.touching;
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
    let support_effect = world.supporting_block_effect(state.bounds());
    if support_effect == BlockEffect::Magma && !state.stepping_carefully && !state.fall_flying {
        state.contact_damage += 1.0;
    }
    let slime_bounce = collisions[1]
        && support_effect == BlockEffect::Slime
        && desired.y <= 0.0
        && !state.sneaking;
    if slime_bounce {
        let bounce_scale = if state.is_player { 1.0 } else { 0.8 };
        state.velocity.y = -desired.y * bounce_scale;
        state.on_ground = false;
        state.fall_distance = 0.0;
        state.fall_damage = 0.0;
    }
    let bounced = slime_bounce;
    if checks_fall_damage && state.on_ground {
        if state.on_ground {
            state.fall_damage = if state.fall_damage_immune {
                0.0
            } else if modern_fall_damage {
                let fall_power = state.fall_distance + 1.0e-6 - state.safe_fall_distance;
                if fall_power > 0.0 {
                    let damage = fall_power * state.fall_damage_multiplier.unwrap_or(1.0);
                    match landing_damage_rounding {
                        LandingDamageRounding::Ceil => damage.ceil(),
                        LandingDamageRounding::Floor => damage.floor(),
                    }
                } else {
                    0.0
                }
            } else if state.fall_distance > 3.0 + state.safe_fall_distance {
                landing_damage(
                    state.fall_distance,
                    state.safe_fall_distance,
                    state.fall_damage_multiplier.unwrap_or(1.0),
                    state.jump_boost_amplifier,
                    landing_damage_rounding,
                )
            } else {
                0.0
            };
            state.fall_distance = 0.0;
        }
    } else if checks_fall_damage && !bounced && !reset_fall_distance && displacement.y < 0.0 {
        state.fall_distance += -displacement.y;
    }
    if !ignores_stuck_block {
        if let Some(multiplier) = stuck_speed_multiplier_inside(state, world, rules.release) {
            state.stuck_speed_multiplier = multiplier;
            state.fall_distance = 0.0;
        }
    }

    if restitution_enabled {
        let current_movement = state.velocity;
        let support_block = world.supporting_block_state(state.bounds());
        let world_block_bounciness = if support_block.suppresses_bounce {
            0.0
        } else {
            support_block.bounce_restitution * if state.is_player { 1.0 } else { 0.8 }
        };
        let entity_restitution = if state.sneaking {
            0.0
        } else {
            state.entity_bounciness
        };
        let vertical_restitution = entity_restitution
            .max(state.block_bounciness)
            .max(world_block_bounciness);
        if collisions[0] {
            state.velocity.x = -current_movement.x * entity_restitution;
        }
        if collisions[2] {
            state.velocity.z = -current_movement.z * entity_restitution;
        }
        if collisions[1] && !bounced {
            let vertical_bounce_allowed = state.vertical_collision_below
                && current_movement.y != 0.0
                && -current_movement.y >= rules.gravity
                && vertical_restitution > 0.0;
            if vertical_bounce_allowed {
                let portion_with_movement = displacement.y / current_movement.y;
                let gravity_compensation = portion_with_movement * rules.gravity;
                let effective_drag = 1.0 + portion_with_movement * (rules.air_drag - 1.0);
                state.velocity.y = (gravity_compensation - current_movement.y)
                    * effective_drag
                    * vertical_restitution;
                state.on_ground = false;
            } else {
                // restituteMovementAfterCollisions with no restitution: (0 - y) * 0, +0.0 after a fall.
                state.velocity.y = -current_movement.y * 0.0;
            }
        }
    } else {
        if collisions[0] {
            state.velocity.x = 0.0;
        }
        if collisions[1] && !bounced {
            // Block.updateEntityAfterFallOn multiplies by zero: a landing leaves -0.0.
            state.velocity.y *= 0.0;
        }
        if collisions[2] {
            state.velocity.z = 0.0;
        }
    }
    if support_effect == BlockEffect::Slime
        && state.on_ground
        && state.velocity.y.abs() < 0.1
        && !state.stepping_carefully
    {
        let step_factor = 0.4 + state.velocity.y.abs() * 0.2;
        state.velocity.x *= step_factor;
        state.velocity.z *= step_factor;
    }
    if honey_sliding {
        let scale = if state.velocity.y < -0.13 {
            -0.05 / state.velocity.y
        } else {
            1.0
        };
        state.velocity.x *= scale;
        state.velocity.y = -0.05;
        state.velocity.z *= scale;
        state.fall_distance = 0.0;
    }
    if (matches!(feet_effect, BlockEffect::Honey)
        || (soul_speed_block && (rules.fluid_travel_split || state.soul_speed == 0)))
        && state.on_ground
        && !state.fall_flying
        && !(state.is_player && state.flying)
    {
        let block_slowdown = if soul_speed_block && rules.fluid_travel_split {
            let efficiency = state
                .movement_efficiency
                .max(if state.soul_speed > 0 { 1.0 } else { 0.0 })
                .clamp(0.0, 1.0) as f32;
            f64::from(0.4_f32 + efficiency * (1.0 - 0.4_f32))
        } else {
            java_float(0.4)
        };
        state.velocity.x *= block_slowdown;
        state.velocity.z *= block_slowdown;
    }
    let climbs_powder_snow = state.powder_snow_walkable
        && if rules.release.at_least(1, 21, 5) {
            in_powder_snow
        } else {
            world.effect_at(block_position(state.position)) == BlockEffect::PowderSnow
        };
    if matches!(fluid, FluidState::Empty)
        && !gliding
        && (state.collided_horizontally || state.jump_requested)
        && (climbable(world, state) || climbs_powder_snow)
    {
        state.velocity.y = 0.2;
    }
    if matches!(fluid, FluidState::Empty) && !state.fall_flying && !state.flying {
        if state.levitation {
            let target = 0.05 * (f64::from(state.levitation_amplifier.unwrap_or(0)) + 1.0);
            state.velocity.y += (target - state.velocity.y) * 0.2;
        } else if !state.no_gravity {
            state.velocity.y -= travel_gravity;
        }
    }
    let horizontal_drag = if gliding { 1.0 } else { ground_inertia };
    if matches!(fluid, FluidState::Water | FluidState::Waterlogged)
        && state.collided_horizontally
        && climbable(world, state)
    {
        state.velocity.y = 0.2;
    }
    let liquid_horizontal_drag = if matches!(fluid, FluidState::Water | FluidState::Waterlogged) {
        f64::from(water_slowdown)
    } else if fluid == FluidState::Lava {
        java_float(rules.lava_drag)
    } else {
        horizontal_drag
    };
    state.velocity.x *= liquid_horizontal_drag;
    state.velocity.z *= liquid_horizontal_drag;
    apply_fluid_travel_vertical(
        state,
        fluid,
        fluid_height,
        fluid_jump_threshold,
        rules,
        travel_gravity,
        going_down,
    );
    if !matches!(fluid, FluidState::Empty)
        && state.collided_horizontally
        && world.is_free(state.bounds().translated(Vec3::new(
            state.velocity.x,
            state.velocity.y + 0.6000000238418579 - state.position.y + old_position.y,
            state.velocity.z,
        )))
    {
        state.velocity.y = 0.30000001192092896;
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
        state.velocity.y *= if state.flying {
            0.6
        } else if gliding {
            1.0
        } else {
            java_float(air_drag)
        };
    }

    if state.flying {
        state.fall_distance = 0.0;
    }
    state.was_sprinting = state.sprinting;

    TickResult {
        displacement,
        collided_horizontally: state.collided_horizontally,
        collided_vertically: state.collided_vertically,
        block_fall_callback: state.block_fall_callback,
    }
}
