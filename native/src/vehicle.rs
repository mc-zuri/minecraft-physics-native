use crate::entity::EntityState;
use crate::math::Vec3;
use crate::collision::resolve_motion;
use crate::math::Aabb;
use crate::world::{FluidState, WorldSnapshot};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VehicleKind {
    Boat,
    Horse,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum BoatStatus {
    #[default]
    InAir,
    InWater,
    UnderWater,
    UnderFlowingWater,
    OnLand,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VehicleState {
    pub kind: VehicleKind,
    pub entity: EntityState,
    pub passenger: Option<EntityState>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct BoatSimulationState {
    pub position: Vec3,
    pub velocity: Vec3,
    pub yaw: f64,
    pub forward: bool,
    pub left: bool,
    pub right: bool,
    pub input_down: bool,
    pub delta_rotation: f64,
    pub in_water: bool,
    pub water_level: f64,
    pub status: BoatStatus,
    pub previous_status: BoatStatus,
    pub bubble_time: i32,
    pub bubble_column_direction_is_down: bool,
    pub above_bubble_column: bool,
    pub player_passenger: bool,
    pub collided_horizontally: bool,
    pub collided_vertically: bool,
    pub on_ground: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct HorseSimulationState {
    pub position: Vec3,
    pub velocity: Vec3,
    pub yaw: f64,
    pub forward: f64,
    pub strafe: f64,
    pub jump_requested: bool,
    pub on_ground: bool,
    pub in_water: bool,
    pub movement_speed: f64,
    pub jump_strength: f64,
    pub half_width: f64,
    pub height: f64,
    pub collided_horizontally: bool,
    pub collided_vertically: bool,
}

/// Returns the passenger position used after a vehicle has moved for the tick.
///
/// This follows vanilla's `Entity.positionRider`/boat riding-position order:
/// the local passenger offset is rotated by the vehicle yaw, then translated
/// from the vehicle's current position.
#[must_use]
pub fn passenger_position(vehicle_position: Vec3, vehicle_yaw: f64, local_offset: Vec3) -> Vec3 {
    let (sin, cos) = vehicle_yaw.sin_cos();
    vehicle_position.add_components(
        local_offset.x * cos + local_offset.z * sin,
        local_offset.y,
        local_offset.z * cos - local_offset.x * sin,
    )
}

/// Ticks a boat first and attaches its passenger to the boat's new position.
pub fn tick_boat_with_passenger(
    vehicle: &mut BoatSimulationState,
    passenger: &mut EntityState,
    local_offset: Vec3,
) {
    tick_boat(vehicle);
    passenger.position = passenger_position(vehicle.position, vehicle.yaw, local_offset);
}

pub fn tick_boat(state: &mut BoatSimulationState) {
    apply_boat_controls(state);
    let drag = if state.in_water { 0.92 } else { 0.8 };
    state.velocity = state.velocity.scale(drag);
    state.position = state.position + state.velocity;
}

fn apply_boat_controls(state: &mut BoatSimulationState) {
    if state.left {
        state.delta_rotation += 1.0;
    }

    if state.right {
        state.delta_rotation -= 1.0;
    }
    let mut acceleration = 0.0_f64;
    if state.right != state.left && !state.forward && !state.input_down {
        acceleration += 0.005;
    }
    state.yaw += state.delta_rotation.to_radians();
    if state.forward {
        acceleration += 0.04;
    }
    if state.input_down {
        acceleration -= 0.005;
    }
    state.velocity.x += state.yaw.sin() * acceleration;
    state.velocity.z -= state.yaw.cos() * acceleration;
}

/// Ticks a boat against the supplied world snapshot. The world-aware path
/// keeps fluid status, buoyancy, and block clipping in native code.
pub fn tick_boat_in_world(state: &mut BoatSimulationState, world: &WorldSnapshot) {
    let mut start = state.position;
    state.on_ground = false;
    let bounds = Aabb::new(
        Vec3::new(start.x - 0.6875, start.y, start.z - 0.6875),
        Vec3::new(start.x + 0.6875, start.y + 0.6, start.z + 0.6875),
    );
    let water_height = world.fluid_height_in_bounds(FluidState::Water, bounds);
    state.in_water = water_height > 0.0;
    state.water_level = start.y + water_height;
    let top_slice = Aabb::new(
        Vec3::new(bounds.min.x, bounds.max.y, bounds.min.z),
        Vec3::new(bounds.max.x, bounds.max.y + 0.001, bounds.max.z),
    );
    let under_water = world.fluid_height_in_bounds(FluidState::Water, top_slice) > 0.0;
    let flowing = world.has_non_source_fluid_in_bounds(FluidState::Water, top_slice);
    let old_status = state.status;
    let was_in_air = old_status == BoatStatus::InAir;
    state.status = if under_water {
        if flowing {
            BoatStatus::UnderFlowingWater
        } else {
            BoatStatus::UnderWater
        }
    } else if state.in_water {
        BoatStatus::InWater
    } else if world.supporting_block_state(bounds).shape.is_some() {
        BoatStatus::OnLand
    } else {
        BoatStatus::InAir
    };
    if was_in_air
        && matches!(
            state.status,
            BoatStatus::InWater | BoatStatus::UnderWater | BoatStatus::UnderFlowingWater
        )
    {
        if let Some(surface) = world.water_surface_above(bounds) {
            let target_y = surface - 0.6 + 0.101;
            let target_bounds = bounds.translated(Vec3::new(0.0, target_y - start.y, 0.0));
            if world.collision_shapes(target_bounds).is_empty() {
                state.position.y = target_y;
                start = state.position;
                state.velocity.y = 0.0;
                state.status = BoatStatus::InWater;
            }
        }
        state.previous_status = old_status;
    }
    let bubble_effects = world.effects_in_bounds(bounds);
    let bubble_down = bubble_effects
        .iter()
        .any(|effect| *effect == crate::world::BlockEffect::BubbleDown);
    let above_bubble = bubble_effects.iter().any(|effect| {
        matches!(
            effect,
            crate::world::BlockEffect::BubbleUp | crate::world::BlockEffect::BubbleDown
        )
    });
    if above_bubble {
        state.bubble_column_direction_is_down = bubble_down;
        if !state.above_bubble_column {
            state.bubble_time = 60;
        }
    } else {
        state.bubble_time = 0;
    }
    state.above_bubble_column = above_bubble;
    if state.bubble_time > 0 {
        state.bubble_time -= 1;
        if state.bubble_time == 0 {
            state.velocity.y = if state.bubble_column_direction_is_down {
                -0.7
            } else if state.player_passenger {
            2.7
            } else {
            0.6
            };
        }
    }
    apply_boat_controls(state);
    state.position = start;
    let support_position = (
        start.x.floor() as i32,
        (start.y - 1.0e-6).floor() as i32,
        start.z.floor() as i32,
    );
    let land_friction = world.slipperiness_at(support_position).clamp(0.0, 1.0);
    let rotation_friction = match state.status {
        BoatStatus::InWater => {
            state.velocity.x *= 0.9;
            state.velocity.z *= 0.9;
            let buoyancy = (state.water_level - start.y) / 0.6;
            state.velocity.y = (state.velocity.y + buoyancy * (0.04 / 0.65)) * 0.75;
            0.9
        }
        BoatStatus::UnderWater => {
            state.velocity.x *= 0.45;
            state.velocity.z *= 0.45;
            state.velocity.y += 0.01;
            0.45
        }
        BoatStatus::UnderFlowingWater => {
            state.velocity.x *= 0.9;
            state.velocity.z *= 0.9;
            state.velocity.y -= 0.0007;
            0.9
        }
        BoatStatus::OnLand => land_friction,
        BoatStatus::InAir => {
            state.velocity.x *= 0.9;
            state.velocity.z *= 0.9;
            0.9
        }
    };
    state.delta_rotation *= rotation_friction;
    if !state.in_water {
        state.velocity.y -= 0.04;
        if state.status == BoatStatus::OnLand {
            let support = world.supporting_block_state(bounds);
            let slipperiness = if support.shape.is_some() {
                world.slipperiness_at(support_position)
            } else {
                0.6
            };
            let friction = slipperiness.clamp(0.0, 1.0);
            state.velocity.x *= friction;
            state.velocity.z *= friction;
        }
    }
    let obstacles = world.collision_shapes(bounds.expand_towards(state.velocity));
    let (motion, collided) = resolve_motion(bounds, state.velocity, &obstacles);
    state.position = start + motion;
    state.collided_horizontally = collided[0] || collided[2];
    state.collided_vertically = collided[1];
    state.on_ground = collided[1] && state.velocity.y <= 0.0;
    if collided[0] {
        state.velocity.x = 0.0;
    }
    if collided[1] {
        state.velocity.y = 0.0;
    }
    if collided[2] {
        state.velocity.z = 0.0;
    }
}

pub fn tick_horse(state: &mut HorseSimulationState) {
    if state.on_ground && state.jump_requested {
        state.velocity.y = if state.jump_strength > 0.0 {
            state.jump_strength
        } else {
            0.42
        };
        state.on_ground = false;
    }

    let speed = if state.movement_speed > 0.0 {
        state.movement_speed
    } else {
        0.1
    };
    let forward = state.forward.clamp(-1.0, 1.0);
    let strafe = state.strafe.clamp(-1.0, 1.0);
    let input_length = (forward * forward + strafe * strafe).sqrt();
    let input_scale = if input_length > 1.0 {
        1.0 / input_length
    } else {
        1.0
    };
    let forward = forward * input_scale;
    let strafe = strafe * input_scale;
    state.velocity.x += (state.yaw.sin() * forward + state.yaw.cos() * strafe) * speed;
    state.velocity.z += (state.yaw.cos() * forward - state.yaw.sin() * strafe) * speed;
    if state.in_water {
        state.velocity.y -= 0.01;
        state.velocity.x *= 0.8;
        state.velocity.z *= 0.8;
    } else {
        state.velocity.y -= 0.08;
        state.velocity.x *= 0.91;
        state.velocity.z *= 0.91;
    }
    state.position = state.position + state.velocity;
    state.jump_requested = false;
}

pub fn tick_horse_in_world(state: &mut HorseSimulationState, world: &WorldSnapshot) {
    let start = state.position;
    let bounds = Aabb::new(
        Vec3::new(
            state.position.x - state.half_width,
            state.position.y,
            state.position.z - state.half_width,
        ),
        Vec3::new(
            state.position.x + state.half_width,
            state.position.y + state.height,
            state.position.z + state.half_width,
        ),
    );
    state.in_water = world.fluid_height_in_bounds(FluidState::Water, bounds) > 0.0;
    tick_horse(state);
    state.on_ground = false;
    state.position = start;
    let obstacles = world.collision_shapes(bounds.expand_towards(state.velocity));
    let (motion, collided) = resolve_motion(bounds, state.velocity, &obstacles);
    state.position = state.position + motion;
    state.collided_horizontally = collided[0] || collided[2];
    state.collided_vertically = collided[1];
    if collided[0] {
        state.velocity.x = 0.0;
    }
    if collided[1] {
        let descending = state.velocity.y <= 0.0;
        state.velocity.y = 0.0;
        state.on_ground = descending;
    }
    if collided[2] {
        state.velocity.z = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::{
        passenger_position, tick_boat, tick_boat_in_world, tick_boat_with_passenger, tick_horse,
        tick_horse_in_world, BoatSimulationState,
        HorseSimulationState,
    };
    use crate::entity::{Dimensions, EntityFlags, EntityState};
    use crate::math::Vec3;
    use crate::world::{FluidState, WorldSnapshot};

    #[test]
    fn boat_accelerates_and_turns() {
        let mut state = BoatSimulationState {
            forward: true,
            right: true,
            in_water: true,
            ..BoatSimulationState::default()
        };
        tick_boat(&mut state);
        assert!(state.position.z < 0.0);
        assert!(state.yaw < 0.0);
    }

    #[test]
    fn boat_control_persists_rotation_and_applies_backward_acceleration() {
        let mut state = BoatSimulationState {
            input_down: true,
            right: true,
            in_water: true,
            ..BoatSimulationState::default()
        };

        tick_boat(&mut state);

        assert_eq!(state.delta_rotation, -1.0);
        assert!((state.yaw + 1.0_f64.to_radians()).abs() < 1.0e-12);
        assert!(state.velocity.z > 0.0);
        assert!(state.velocity.x > 0.0);
    }

    #[test]
    fn horse_jumps_and_moves_forward() {
        let mut state = HorseSimulationState {
            forward: 1.0,
            jump_requested: true,
            on_ground: true,
            ..HorseSimulationState::default()
        };
        tick_horse(&mut state);
        assert!(state.position.z > 0.0);
        assert!(state.position.y > 0.0);
        assert!(!state.on_ground);
    }

    #[test]
    fn horse_strafe_changes_lateral_motion() {
        let mut state = HorseSimulationState {
            strafe: 1.0,
            yaw: 0.25,
            ..HorseSimulationState::default()
        };
        tick_horse(&mut state);
        assert!(
            (state.position.x - 0.08817103037566869).abs() < 1.0e-12,
            "x={:?}",
            state.position.x
        );
        assert!(
            (state.position.z + 0.02251376029266159).abs() < 1.0e-9,
            "z={:?}",
            state.position.z
        );
        assert_eq!(state.yaw, 0.25);
    }

    #[test]
    fn horse_diagonal_input_is_normalized_before_move_relative() {
        let mut state = HorseSimulationState {
            forward: 1.0,
            strafe: 1.0,
            movement_speed: 1.0,
            ..HorseSimulationState::default()
        };

        tick_horse(&mut state);

        assert!((state.position.x - 0.7071067811865475 * 0.91).abs() < 1.0e-12);
        assert!((state.position.z - 0.7071067811865475 * 0.91).abs() < 1.0e-12);
    }

    #[test]
    fn passenger_offset_rotates_with_vehicle_yaw() {
        let position = passenger_position(
            Vec3::new(10.0, 2.0, 10.0),
            std::f64::consts::FRAC_PI_2,
            Vec3::new(0.5, 1.0, 1.0),
        );

        assert!((position.x - 11.0).abs() < 1e-12);
        assert!((position.y - 3.0).abs() < 1e-12);
        assert!((position.z - 9.5).abs() < 1e-12);
    }

    #[test]
    fn vehicle_moves_before_passenger_is_attached() {
        let mut vehicle = BoatSimulationState {
            forward: true,
            in_water: true,
            ..BoatSimulationState::default()
        };
        let mut passenger = EntityState {
            position: Vec3::new(50.0, 50.0, 50.0),
            velocity: Vec3::ZERO,
            dimensions: Dimensions::new(0.3, 1.8),
            flags: EntityFlags::default(),
        };

        tick_boat_with_passenger(&mut vehicle, &mut passenger, Vec3::new(0.0, 1.0, 0.0));

        assert_eq!(
            passenger.position,
            vehicle.position.add_components(0.0, 1.0, 0.0)
        );
        assert!(passenger.position.z < 0.0);
    }

    #[test]
    fn world_aware_boat_derives_water_status_from_snapshot() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            crate::world::BlockState {
                fluid: FluidState::Water,
                fluid_source: true,
                ..crate::world::BlockState::default()
            },
        );
        let mut boat = BoatSimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            status: super::BoatStatus::UnderFlowingWater,
            previous_status: super::BoatStatus::InWater,
            ..BoatSimulationState::default()
        };

        tick_boat_in_world(&mut boat, &world);

        assert!(boat.in_water);
        assert_eq!(boat.water_level, f64::from(8.0_f32 / 9.0));
        assert_eq!(boat.status, super::BoatStatus::InWater);
        assert!(boat.position.y >= 0.0);
    }

    #[test]
    fn world_aware_boat_distinguishes_underwater_and_flowing_water() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            crate::world::BlockState {
                fluid: FluidState::Water,
                fluid_source: false,
                fluid_level: 4,
                ..crate::world::BlockState::default()
            },
        );
        let mut boat = BoatSimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            status: super::BoatStatus::UnderFlowingWater,
            previous_status: super::BoatStatus::InWater,
            ..BoatSimulationState::default()
        };

        tick_boat_in_world(&mut boat, &world);

        assert_eq!(boat.status, super::BoatStatus::UnderFlowingWater);
        assert!(boat.in_water);
    }

    #[test]
    fn world_aware_boat_repositions_when_entering_water() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            crate::world::BlockState {
                fluid: FluidState::Water,
                fluid_source: true,
                ..crate::world::BlockState::default()
            },
        );
        let mut boat = BoatSimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            ..BoatSimulationState::default()
        };

        tick_boat_in_world(&mut boat, &world);

        assert!(boat.position.y > 1.0 + f64::from(8.0_f32 / 9.0) - 0.6);
        assert_eq!(boat.status, super::BoatStatus::InWater);
    }

    #[test]
    fn world_aware_boat_preserves_bubble_column_state() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            crate::world::BlockState {
                shape: Some(crate::world::BlockShape {
                    bounds: crate::math::Aabb::new(Vec3::ZERO, Vec3::new(1.0, 1.0, 1.0)),
                    slipperiness: 0.6,
                    fluid: FluidState::Water,
                    effect: crate::world::BlockEffect::BubbleUp,
                }),
                fluid: FluidState::Water,
                fluid_source: true,
                ..crate::world::BlockState::default()
            },
        );
        let mut boat = BoatSimulationState {
            position: Vec3::new(0.5, 0.0, 0.5),
            ..BoatSimulationState::default()
        };

        tick_boat_in_world(&mut boat, &world);

        assert!(boat.above_bubble_column);
        assert_eq!(boat.bubble_time, 59);
        assert!(!boat.bubble_column_direction_is_down);
    }

    #[test]
    fn world_aware_boat_uses_player_bubble_launch_impulse() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            crate::world::BlockState {
                shape: Some(crate::world::BlockShape {
                    bounds: crate::math::Aabb::new(Vec3::ZERO, Vec3::new(1.0, 1.0, 1.0)),
                    slipperiness: 0.6,
                    fluid: FluidState::Water,
                    effect: crate::world::BlockEffect::BubbleUp,
                }),
                fluid: FluidState::Water,
                fluid_source: true,
                ..crate::world::BlockState::default()
            },
        );
        let mut boat = BoatSimulationState {
            position: Vec3::new(0.5, 0.0, 0.5),
            bubble_time: 1,
            above_bubble_column: true,
            player_passenger: true,
            ..BoatSimulationState::default()
        };

        tick_boat_in_world(&mut boat, &world);

        assert!(boat.velocity.y > 2.0);
    }

    #[test]
    fn world_aware_boat_reports_block_collision() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (1, 0, 0),
            crate::world::BlockState {
                shape: Some(crate::world::BlockShape::full_block()),
                ..crate::world::BlockState::default()
            },
        );
        let mut boat = BoatSimulationState {
            position: Vec3::new(0.25, 0.0, 0.5),
            velocity: Vec3::new(1.0, 0.0, 0.0),
            ..BoatSimulationState::default()
        };

        tick_boat_in_world(&mut boat, &world);

        assert!(boat.collided_horizontally);
        assert_eq!(boat.velocity.x, 0.0);
    }

    #[test]
    fn world_aware_boat_sweeps_fast_motion_for_collisions() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (1, 0, 0),
            crate::world::BlockState {
                shape: Some(crate::world::BlockShape::full_block()),
                ..crate::world::BlockState::default()
            },
        );
        let mut boat = BoatSimulationState {
            position: Vec3::new(0.0, 0.0, 0.5),
            velocity: Vec3::new(3.0, 0.0, 0.0),
            ..BoatSimulationState::default()
        };

        tick_boat_in_world(&mut boat, &world);

        assert!(boat.collided_horizontally);
        assert!(boat.position.x < 1.0);
    }

    #[test]
    fn world_aware_boat_reports_ground_contact() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, -1, 0),
            crate::world::BlockState {
                shape: Some(crate::world::BlockShape::full_block()),
                ..crate::world::BlockState::default()
            },
        );
        let mut boat = BoatSimulationState {
            position: Vec3::new(0.5, 0.0, 0.5),
            velocity: Vec3::new(0.0, -0.5, 0.0),
            ..BoatSimulationState::default()
        };

        tick_boat_in_world(&mut boat, &world);

        assert!(boat.on_ground);
        assert_eq!(boat.velocity.y, 0.0);
    }

    #[test]
    fn world_aware_boat_damps_rotation_with_status_friction() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, -1, 0),
            crate::world::BlockState {
                shape: Some(crate::world::BlockShape {
                    slipperiness: 0.4,
                    ..crate::world::BlockShape::full_block()
                }),
                ..crate::world::BlockState::default()
            },
        );
        let mut boat = BoatSimulationState {
            position: Vec3::new(0.5, 0.0, 0.5),
            delta_rotation: 2.0,
            ..BoatSimulationState::default()
        };

        tick_boat_in_world(&mut boat, &world);

        assert_eq!(boat.status, super::BoatStatus::OnLand);
        assert!((boat.delta_rotation - 0.8).abs() < 1.0e-12);
    }

    #[test]
    fn world_aware_horse_reports_ground_contact() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, -1, 0),
            crate::world::BlockState {
                shape: Some(crate::world::BlockShape::full_block()),
                ..crate::world::BlockState::default()
            },
        );
        let mut horse = HorseSimulationState {
            position: Vec3::new(0.5, 0.0, 0.5),
            velocity: Vec3::new(0.0, -0.5, 0.0),
            half_width: 0.7,
            height: 1.6,
            ..HorseSimulationState::default()
        };
        let query = crate::math::Aabb::new(
            Vec3::new(-0.7, -0.08, -0.2),
            Vec3::new(3.7, 1.6, 1.2),
        );
        assert_eq!(world.collision_shapes(query).len(), 1);

        tick_horse_in_world(&mut horse, &world);

        assert!(horse.collided_vertically);
        assert!(horse.on_ground);
        assert_eq!(horse.velocity.y, 0.0);
    }

    #[test]
    fn world_aware_horse_ceiling_collision_is_not_ground_contact() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 2, 0),
            crate::world::BlockState {
                shape: Some(crate::world::BlockShape::full_block()),
                ..crate::world::BlockState::default()
            },
        );
        let mut horse = HorseSimulationState {
            position: Vec3::new(0.5, 0.0, 0.5),
            velocity: Vec3::new(0.0, 0.5, 0.0),
            half_width: 0.7,
            height: 1.6,
            ..HorseSimulationState::default()
        };
        tick_horse_in_world(&mut horse, &world);

        assert!(horse.collided_vertically);
        assert!(!horse.on_ground);
        assert_eq!(horse.velocity.y, 0.0);
    }

    #[test]
    fn world_aware_horse_sweeps_fast_motion_for_collisions() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (1, 0, 0),
            crate::world::BlockState {
                shape: Some(crate::world::BlockShape::full_block()),
                ..crate::world::BlockState::default()
            },
        );
        let mut horse = HorseSimulationState {
            position: Vec3::new(0.0, 0.0, 0.5),
            velocity: Vec3::new(3.0, 0.0, 0.0),
            half_width: 0.7,
            height: 1.6,
            ..HorseSimulationState::default()
        };
        let bounds = crate::math::Aabb::new(
            Vec3::new(-0.7, 0.0, -0.2),
            Vec3::new(0.7, 1.6, 1.2),
        );
        let obstacles = world.collision_shapes(bounds.expand_towards(Vec3::new(3.03, -0.08, 0.0)));
        assert_eq!(obstacles.len(), 1);
        let (motion, collision) =
            crate::collision::resolve_motion(bounds, Vec3::new(3.03, -0.08, 0.0), &obstacles);
        assert!(collision[0]);
        assert!(motion.x < 1.0);

        tick_horse_in_world(&mut horse, &world);

        assert!(horse.collided_horizontally);
        assert!(
            horse.position.x < 1.0,
            "horse tunneled through swept collision: x={}",
            horse.position.x
        );
    }

    #[test]
    fn world_aware_horse_clears_ground_contact_without_support() {
        let world = WorldSnapshot::new();
        let mut horse = HorseSimulationState {
            position: Vec3::new(0.5, 2.0, 0.5),
            on_ground: true,
            half_width: 0.7,
            height: 1.6,
            ..HorseSimulationState::default()
        };

        tick_horse_in_world(&mut horse, &world);

        assert!(!horse.on_ground);
    }

    #[test]
    fn world_aware_horse_derives_water_status_from_snapshot() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            crate::world::BlockState {
                fluid: FluidState::Water,
                fluid_source: true,
                ..crate::world::BlockState::default()
            },
        );
        let mut horse = HorseSimulationState {
            position: Vec3::new(0.5, 0.0, 0.5),
            in_water: false,
            half_width: 0.7,
            height: 1.6,
            ..HorseSimulationState::default()
        };

        tick_horse_in_world(&mut horse, &world);

        assert!(horse.in_water);
    }
}
