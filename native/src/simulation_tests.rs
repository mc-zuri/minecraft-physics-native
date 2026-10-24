#[cfg(test)]
mod tests {
    use crate::simulation::{
        landing_damage, movement_speed_attribute, tick, tick_with_rules, LandingDamageRounding,
        PhysicsConfig, SimulationState, TickInputSnapshot, VersionPhysicsProfile,
        VersionPhysicsRules,
    };
    use crate::world::{BlockEffect, BlockShape, BlockState, FluidState, WorldSnapshot};
    use crate::math::java_float;
    use crate::version::MinecraftVersion;
    use crate::{Aabb, Vec3};

    #[test]
    fn landing_damage_rounding_is_explicit_and_version_selectable() {
        assert_eq!(
            landing_damage(4.25, 0.0, 1.0, None, LandingDamageRounding::Ceil),
            2.0
        );
        assert_eq!(
            landing_damage(4.25, 0.0, 1.0, None, LandingDamageRounding::Floor),
            1.0
        );
        assert_eq!(
            landing_damage(3.0, 0.0, 1.0, None, LandingDamageRounding::Ceil),
            0.0
        );
        assert_eq!(
            landing_damage(6.0, 0.0, 1.0, Some(1), LandingDamageRounding::Ceil),
            1.0
        );
    }

    #[test]
    fn gravity_moves_state_downward() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            velocity: Vec3::ZERO,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        let result = tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(!result.collided_vertically);
        assert_eq!(state.position.y, 2.0);
        assert_eq!(state.velocity.y, -0.08 * java_float(0.98));

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert_eq!(state.position.y, 2.0 - 0.08 * java_float(0.98));
    }

    #[test]
    fn horizontal_drag_uses_the_ground_state_from_before_the_move() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                id: 1,
                shape: Some(BlockShape {
                    slipperiness: 0.98,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.2, 1.05, 0.5),
            velocity: Vec3::new(0.5, -0.1, 0.0),
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.on_ground);
        assert_eq!(state.velocity.x, 0.5 * java_float(0.98));
    }

    #[test]
    fn water_keeps_eight_tenths_of_the_vertical_motion() {
        let mut world = WorldSnapshot::new();
        for y in 0..3 {
            world.set_block(
                (0, y, 0),
                BlockState {
                    fluid: FluidState::Water,
                    ..BlockState::default()
                },
            );
        }
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            velocity: Vec3::new(0.0, 0.1, 0.0),
            no_gravity: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.in_water);
        assert_eq!(state.velocity.y, 0.1 * java_float(0.8));
    }

    #[test]
    fn landing_leaves_a_negative_zero_vertical_velocity() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                id: 1,
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.2, 0.5),
            velocity: Vec3::new(0.0, -0.5, 0.0),
            no_gravity: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        let mut restituted = state;

        tick(&mut state, &world, PhysicsConfig::default());
        crate::versioned::dispatch("26.2", &mut restituted, &world, PhysicsConfig::default())
            .expect("26.2 is supported");

        assert!(state.on_ground);
        assert_eq!(state.velocity.y, 0.0);
        assert!(state.velocity.y.is_sign_negative());
        assert!(restituted.on_ground);
        assert_eq!(restituted.velocity.y, 0.0);
        assert!(restituted.velocity.y.is_sign_positive());
    }

    #[test]
    fn slow_falling_keeps_full_gravity_while_rising() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            velocity: Vec3::new(0.0, 0.3, 0.0),
            slow_falling: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert_eq!(state.velocity.y, (0.3 - 0.08) * java_float(0.98));
    }

    #[test]
    fn immutable_tick_snapshot_is_reusable_and_does_not_mutate_input() {
        let state = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            velocity: Vec3::ZERO,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };
        let input = TickInputSnapshot::new(
            state,
            WorldSnapshot::new(),
            PhysicsConfig::default(),
            VersionPhysicsRules::default(),
            LandingDamageRounding::Ceil,
            false,
            false,
            false,
        );

        let first = input.execute();
        let second = input.execute();

        assert_eq!(first, second);
        assert_eq!(input.state, state);
        assert_eq!(input.state.tick_count, 0);
        assert!(first.state.velocity.y < state.velocity.y);
    }

    #[test]
    fn simulation_config_rejects_non_finite_and_out_of_range_values() {
        let mut config = PhysicsConfig::default();
        config.gravity = f64::NAN;
        assert!(config.validate().is_err());
        config = PhysicsConfig::default();
        config.drag = 2.1;
        assert!(config.validate().is_err());
        assert!(PhysicsConfig::default().validate().is_ok());
    }

    #[test]
    fn ground_input_uses_source_friction_influenced_speed() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape {
                    slipperiness: 0.98,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            input: Vec3::new(1.0, 0.0, 0.0),
            on_ground: true,
            ..SimulationState::default()
        };
        tick(&mut state, &world, PhysicsConfig::default());
        let expected = crate::math::java_float(
            crate::math::java_float(0.1)
                * crate::math::java_float(
                    crate::math::java_float(0.21600002)
                        / crate::math::java_float(0.98_f64 * 0.98 * 0.98),
                ),
        );
        assert!((state.position.x - (0.5 + crate::math::java_float(0.98) * expected)).abs() < 1.0e-7);
    }

    #[test]
    fn no_physics_bypasses_collision_and_clears_collision_flags() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            velocity: Vec3::new(0.0, -0.5, 0.0),
            no_physics: true,
            on_ground: true,
            collided_horizontally: true,
            collided_vertically: true,
            ..SimulationState::default()
        };

        let result = tick(&mut state, &world, PhysicsConfig::default());

        assert!(result.displacement.y < 0.0);
        assert!(state.position.y < 1.0);
        assert!(!state.collided_horizontally);
        assert!(!state.collided_vertically);
    }

    #[test]
    fn zero_vertical_motion_preserves_vanilla_vertical_state() {
        let mut state = SimulationState {
            velocity: Vec3::new(0.0, 0.0, 0.0),
            on_ground: true,
            collided_vertically: true,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(state.on_ground);
        assert!(state.collided_vertically);
    }

    #[test]
    fn downward_collision_sets_vertical_collision_below() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            velocity: Vec3::new(0.0, -1.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.collided_vertically);
        assert!(state.vertical_collision_below);
        assert!(state.on_ground);
    }

    #[test]
    fn player_minor_horizontal_collision_tracks_small_direction_change() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (1, 0, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.9, 0.5),
            velocity: Vec3::new(0.5, 0.0, 0.005),
            input: Vec3::new(1.0, 0.0, 0.01),
            half_width: 0.3,
            height: 1.8,
            is_player: true,
            minor_horizontal_collision_supported: true,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.collided_horizontally);
        assert!(state.minor_horizontal_collision);
    }

    #[test]
    fn falling_state_lands_on_full_block() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, -1, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        world.set_block(
            (0, 0, 0),
            BlockState {
                id: 1,
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            velocity: Vec3::new(0.0, -0.2, 0.0),
            on_ground: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        let result = tick(&mut state, &world, PhysicsConfig::default());

        assert!(result.collided_vertically);
        assert!(state.on_ground);
        assert_eq!(state.velocity.y, -0.08 * java_float(0.98));
        assert_eq!(state.position.y, 1.0);
    }

    #[test]
    fn applies_horizontal_input() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            input: Vec3::new(1.0, 0.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(state.position.x > 0.0);
    }

    #[test]
    fn movement_input_is_bounded_before_speed_application() {
        let world = WorldSnapshot::new();
        let mut state = SimulationState {
            input: Vec3::new(1.0, 0.0, 1.0),
            ..SimulationState::default()
        };
        tick(&mut state, &world, PhysicsConfig::default());

        let horizontal_speed =
            (state.velocity.x * state.velocity.x + state.velocity.z * state.velocity.z).sqrt();
        assert!((horizontal_speed - java_float(0.02) * java_float(0.98)).abs() < 1e-12);
    }

    #[test]
    fn speed_slowness_and_sprinting_multiply_the_movement_speed() {
        let base = java_float(0.1);
        let sprint = 1.0 + 0.30000001192092896;
        let speed = 1.0 + 0.20000000298023224;
        let slowness = 1.0 - 0.15000000596046448;

        assert_eq!(
            movement_speed_attribute(base, None, None, true, 1.3, MinecraftVersion::new(1, 21, 1)),
            base * sprint
        );
        assert_eq!(
            movement_speed_attribute(base, Some(0), Some(0), true, 1.3, MinecraftVersion::new(1, 21, 1)),
            base * sprint * speed * slowness
        );
        assert_eq!(
            movement_speed_attribute(base, Some(0), Some(0), true, 1.3, MinecraftVersion::new(1, 20, 5)),
            base * sprint * slowness * speed
        );
        assert_eq!(
            movement_speed_attribute(base, Some(0), Some(0), true, 1.3, MinecraftVersion::new(1, 20, 4)),
            base * slowness * sprint * speed
        );
        assert_eq!(
            movement_speed_attribute(base, None, Some(9), false, 1.3, MinecraftVersion::new(1, 21, 1)),
            0.0
        );
    }

    #[test]
    fn slowness_attribute_modifier_is_applied_before_movement_drag() {
        let mut state = SimulationState {
            input: Vec3::new(0.0, 0.0, 1.0),
            on_ground: true,
            no_gravity: true,
            slowness_effect_amplifier: Some(1),
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        // Base 0.1 * (1 - 0.30), then the drag of the default 0.6 friction.
        let ground_drag = java_float(java_float(0.6) * java_float(0.98));
        assert!((state.velocity.z - java_float(0.98) * java_float(0.1 * 0.7) * ground_drag).abs() < 1e-12);
    }

    #[test]
    fn modern_air_drag_modifier_uses_source_clamped_interpolation() {
        let mut state = SimulationState {
            input: Vec3::new(0.0, 0.0, 1.0),
            no_gravity: true,
            air_drag_modifier: 0.5,
            ..SimulationState::default()
        };

        let mut rules = VersionPhysicsRules::default();
        rules.fluid_travel_split = true;
        tick_with_rules(
            &mut state,
            &WorldSnapshot::new(),
            PhysicsConfig::default(),
            rules,
        );

        // clamp(1 - (1 - 0.98) * 0.5, 0, 1) == 0.99, in float.
        let drag = f64::from(1.0_f32 - (1.0_f32 - 0.98_f32) * 0.5_f32);
        assert!((state.velocity.z - java_float(0.98) * java_float(0.02) * drag).abs() < 1e-12);
    }

    #[test]
    fn explicit_zero_air_drag_modifier_is_not_treated_as_missing() {
        let mut state = SimulationState {
            input: Vec3::new(0.0, 0.0, 1.0),
            no_gravity: true,
            air_drag_modifier: 0.0,
            air_drag_modifier_present: true,
            ..SimulationState::default()
        };
        let mut rules = VersionPhysicsRules::default();
        rules.fluid_travel_split = true;

        tick_with_rules(
            &mut state,
            &WorldSnapshot::new(),
            PhysicsConfig::default(),
            rules,
        );

        assert!((state.velocity.z - java_float(0.98) * java_float(0.02)).abs() < 1e-12);
    }

    #[test]
    fn modern_friction_modifier_is_applied_to_ground_friction() {
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            input: Vec3::new(0.0, 0.0, 1.0),
            on_ground: true,
            friction_modifier: 0.5,
            ..SimulationState::default()
        };
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape {
                    slipperiness: 0.98,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );

        let mut rules = VersionPhysicsRules::default();
        rules.fluid_travel_split = true;
        tick_with_rules(&mut state, &world, PhysicsConfig::default(), rules);

        assert!(state.velocity.z > 0.0);
        assert!(state.velocity.z < 0.1);
    }

    fn airborne_displacement(state: SimulationState, release: MinecraftVersion) -> f64 {
        let mut state = SimulationState {
            input: Vec3::new(1.0, 0.0, 0.0),
            no_gravity: true,
            ..state
        };
        let rules = VersionPhysicsRules {
            release,
            ..VersionPhysicsRules::default()
        };
        tick_with_rules(&mut state, &WorldSnapshot::new(), PhysicsConfig::default(), rules);
        state.position.x
    }

    #[test]
    fn airborne_players_accelerate_with_the_flying_speed() {
        let player = SimulationState {
            is_player: true,
            ..SimulationState::default()
        };
        let sprinting = SimulationState {
            sprinting: true,
            ..player
        };
        let modern = MinecraftVersion::new(1, 21, 1);

        let input = java_float(0.98);
        assert_eq!(airborne_displacement(player, modern), input * java_float(0.02));
        assert_eq!(
            airborne_displacement(sprinting, modern),
            input * f64::from(0.025999999_f32)
        );
        assert_eq!(
            airborne_displacement(SimulationState::default(), modern),
            input * java_float(0.02)
        );
    }

    #[test]
    fn airborne_sprint_speed_lags_a_tick_before_1_19_4() {
        let sprinted_before = SimulationState {
            is_player: true,
            was_sprinting: true,
            ..SimulationState::default()
        };
        let started_sprinting = SimulationState {
            is_player: true,
            sprinting: true,
            ..SimulationState::default()
        };

        let input = java_float(0.98);
        assert_eq!(
            airborne_displacement(started_sprinting, MinecraftVersion::new(1, 19, 2)),
            input * java_float(0.02)
        );
        assert_eq!(
            airborne_displacement(sprinted_before, MinecraftVersion::new(1, 19, 2)),
            input * f64::from(0.02_f32 + 0.006_f32)
        );
        assert_eq!(
            airborne_displacement(sprinted_before, MinecraftVersion::new(1, 14, 4)),
            input * f64::from((f64::from(0.02_f32) + 0.005999999865889549) as f32)
        );
    }

    #[test]
    fn creative_flight_doubles_the_flying_speed_while_sprinting() {
        let flying = SimulationState {
            is_player: true,
            flying: true,
            flying_speed: 0.05,
            sprinting: true,
            ..SimulationState::default()
        };

        assert_eq!(
            airborne_displacement(flying, MinecraftVersion::new(1, 21, 1)),
            java_float(0.98) * f64::from(0.05_f32 * 2.0)
        );
    }

    #[test]
    fn input_rotation_uses_the_mth_sine_table_of_the_release() {
        for release in [MinecraftVersion::new(1, 21, 1), MinecraftVersion::new(1, 21, 11)] {
            let mut state = SimulationState {
                position: Vec3::new(0.5, 2.0, 0.5),
                yaw: f64::from(270.0_f32 * 0.017453292_f32),
                input: Vec3::new(0.0, 0.0, 1.0),
                on_ground: true,
                no_gravity: true,
                half_width: 0.3,
                height: 1.8,
                ..SimulationState::default()
            };
            let rules = VersionPhysicsRules {
                release,
                ..VersionPhysicsRules::default()
            };

            tick_with_rules(&mut state, &WorldSnapshot::new(), PhysicsConfig::default(), rules);

            assert_eq!(state.position.z, 0.5);
            assert_eq!(state.position.x, 0.5 + java_float(0.98) * java_float(0.1));
        }
    }

    #[test]
    fn gliding_moves_with_the_dragged_velocity_and_ignores_the_keys() {
        let glide = |input: Vec3| {
            let mut state = SimulationState {
                position: Vec3::new(0.5, 10.0, 0.5),
                velocity: Vec3::new(0.0, 0.0, 1.0),
                input,
                look: Vec3::new(0.0, 0.0, 1.0),
                fall_flying: true,
                is_player: true,
                half_width: 0.3,
                height: 0.6,
                ..SimulationState::default()
            };
            tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());
            state
        };

        let gliding = glide(Vec3::ZERO);
        let lift = 1.0;
        let falling = 0.08 * (-1.0 + lift * 0.75);
        let dive = falling * -0.1 * lift;
        assert_eq!(gliding.velocity.y, (falling + dive) * java_float(0.98));
        assert_eq!(gliding.position.y, 10.0 + gliding.velocity.y);
        assert_eq!(gliding.position.z, 0.5 + gliding.velocity.z);
        let keyed = glide(Vec3::new(1.0, 0.0, 1.0));
        assert_eq!(
            (keyed.position, keyed.velocity),
            (gliding.position, gliding.velocity)
        );
    }

    #[test]
    fn rotates_input_by_yaw() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            yaw: std::f64::consts::FRAC_PI_2,
            input: Vec3::new(1.0, 0.0, 0.0),
            on_ground: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };
        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());
        assert!(state.position.z > 0.09);
        assert!(state.position.x.abs() < 1e-12);
    }

    #[test]
    fn water_movement_effects_increase_horizontal_drag() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 2, 0),
            BlockState {
                fluid: crate::world::FluidState::Water,
                ..BlockState::default()
            },
        );
        let base = SimulationState {
            position: Vec3::new(0.5, 2.5, 0.5),
            velocity: Vec3::new(1.0, 0.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            fall_distance: 12.0,
            no_gravity: true,
            ..SimulationState::default()
        };
        let mut enhanced = base;
        enhanced.dolphins_grace = 1;
        enhanced.depth_strider = 3;
        let mut base = base;
        tick(&mut base, &world, PhysicsConfig::default());
        tick(&mut enhanced, &world, PhysicsConfig::default());
        assert!(enhanced.velocity.x > base.velocity.x);
    }

    #[test]
    fn depth_strider_uses_vanilla_water_drag_interpolation() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: FluidState::Water,
                ..BlockState::default()
            },
        );
        world.set_block(
            (0, 1, 0),
            BlockState {
                fluid: crate::world::FluidState::Water,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            depth_strider: 3,
            on_ground: true,
            velocity: Vec3::new(1.0, 0.0, 0.0),
            ..SimulationState::default()
        };
        tick_with_rules(
            &mut state,
            &world,
            PhysicsConfig::default(),
            crate::versioned::v1_20_6::Profile::rules(),
        );

        assert!((state.velocity.x - 0.54600006).abs() < 1e-7);
    }

    #[test]
    fn depth_strider_uses_vanilla_water_input_interpolation() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, -1, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: crate::world::FluidState::Water,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.0, 0.5),
            depth_strider: 3,
            movement_speed: 0.1,
            input: Vec3::new(0.0, 0.0, 1.0),
            on_ground: true,
            ..SimulationState::default()
        };

        tick_with_rules(
            &mut state,
            &world,
            PhysicsConfig::default(),
            crate::versioned::v1_20_6::Profile::rules(),
        );

        assert!((state.velocity.z - 0.054600006 * java_float(0.98)).abs() < 1e-7);
    }

    #[test]
    fn modern_water_efficiency_uses_full_attribute_interpolation() {
        assert_eq!(
            crate::versioned::v1_20_6::Profile::rules().water_movement_efficiency_divisor,
            3.0
        );
        assert_eq!(
            crate::versioned::v1_21_1::Profile::rules().water_movement_efficiency_divisor,
            1.0
        );
    }

    #[test]
    fn modern_water_efficiency_is_independent_of_depth_strider() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, -1, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: FluidState::Water,
                ..BlockState::default()
            },
        );
        let state_template = SimulationState {
            position: Vec3::new(0.5, 0.0, 0.5),
            depth_strider: 0,
            water_movement_efficiency: 3.0,
            movement_speed: 0.1,
            input: Vec3::new(0.0, 0.0, 1.0),
            on_ground: true,
            ..SimulationState::default()
        };
        let mut state = state_template.clone();
        let mut depth_strider_state = state_template;
        depth_strider_state.depth_strider = 3;

        tick_with_rules(
            &mut state,
            &world,
            PhysicsConfig::default(),
            crate::versioned::v1_21_1::Profile::rules(),
        );
        tick_with_rules(
            &mut depth_strider_state,
            &world,
            PhysicsConfig::default(),
            crate::versioned::v1_21_1::Profile::rules(),
        );

        assert!((state.velocity.z - depth_strider_state.velocity.z).abs() < 1e-12);
        assert!(state.velocity.z.is_finite());
    }

    #[test]
    fn water_uses_vanilla_fluid_input_speed() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 2, 0),
            BlockState {
                fluid: crate::world::FluidState::Water,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 2.5, 0.5),
            input: Vec3::new(0.0, 0.0, 1.0),
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!((state.velocity.z - 0.016 * java_float(0.98)).abs() < 1e-7);
    }

    #[test]
    fn water_applies_fluid_gravity_after_movement() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: crate::world::FluidState::Water,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!((state.velocity.y + 0.005).abs() < 1e-12);
    }

    #[test]
    fn sprinting_and_no_gravity_skip_fluid_falling_adjustment() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: crate::world::FluidState::Water,
                ..BlockState::default()
            },
        );
        let mut sprinting = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            velocity: Vec3::new(0.0, -0.1, 0.0),
            sprinting: true,
            ..SimulationState::default()
        };
        let mut no_gravity = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            velocity: Vec3::new(0.0, -0.1, 0.0),
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut sprinting, &world, PhysicsConfig::default());
        tick(&mut no_gravity, &world, PhysicsConfig::default());

        assert!((sprinting.velocity.y + 0.08).abs() < 1e-7);
        assert!((no_gravity.velocity.y + 0.08).abs() < 1e-7);
    }

    #[test]
    fn lava_uses_distinct_horizontal_drag_and_height_threshold() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: crate::world::FluidState::Lava,
                fluid_level: 4,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.2, 0.5),
            velocity: Vec3::new(1.0, 0.0, 0.0),
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!((state.velocity.x - 0.5).abs() < 1e-12);
        assert!(state.velocity.y < 0.0);
    }

    #[test]
    fn fluid_currents_normalize_only_above_vanilla_threshold() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: crate::world::FluidState::Water,
                fluid_flow: Vec3::new(0.5, 0.0, 0.0),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!((state.velocity.x - 0.014 * 0.8).abs() < 1e-7);
    }

    #[test]
    fn fluid_currents_apply_to_any_nonzero_flow_until_26_1() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: crate::world::FluidState::Water,
                fluid_flow: Vec3::new(0.001, 0.0, 0.0),
                ..BlockState::default()
            },
        );
        let pushed = |release: MinecraftVersion| {
            let mut state = SimulationState {
                position: Vec3::new(0.5, 0.5, 0.5),
                ..SimulationState::default()
            };
            let rules = VersionPhysicsRules {
                release,
                ..VersionPhysicsRules::default()
            };
            tick_with_rules(&mut state, &world, PhysicsConfig::default(), rules);
            state.velocity.x
        };

        assert!(pushed(MinecraftVersion::new(1, 21, 11)) > 0.0);
        assert_eq!(pushed(MinecraftVersion::new(26, 1, 0)), 0.0);
    }

    #[test]
    fn ultra_warm_dimensions_use_fast_lava_currents() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: crate::world::FluidState::Lava,
                fluid_flow: Vec3::new(1.0, 0.0, 0.0),
                ..BlockState::default()
            },
        );
        let pushed = |release: MinecraftVersion| {
            let mut state = SimulationState {
                position: Vec3::new(0.5, 0.5, 0.5),
                ultra_warm: true,
                ..SimulationState::default()
            };
            let rules = VersionPhysicsRules {
                release,
                ..VersionPhysicsRules::default()
            };
            tick_with_rules(&mut state, &world, PhysicsConfig::default(), rules);
            state.velocity.x
        };

        assert!((pushed(MinecraftVersion::new(1, 21, 11)) - 0.007 * 0.5).abs() < 1e-7);
        assert!((pushed(MinecraftVersion::new(26, 1, 0)) - (0.007 + 0.007) * 0.5).abs() < 1e-7);
    }

    #[test]
    fn players_preserve_fluid_flow_magnitude() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: crate::world::FluidState::Water,
                fluid_flow: Vec3::new(0.5, 0.0, 0.0),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.2, 0.5),
            is_player: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!((state.velocity.x - 0.014 * 0.5 * 0.8).abs() < 1e-7);
    }

    #[test]
    fn shallow_player_fluid_flow_is_height_scaled() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: crate::world::FluidState::Water,
                fluid_level: 7,
                fluid_flow: Vec3::new(100.0, 0.0, 0.0),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.1, 0.5),
            is_player: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        let height = 1.0 / 9.0 - 0.1;
        assert!((state.velocity.x - 0.014 * 100.0 * height * 0.8).abs() < 1e-7);
    }

    #[test]
    fn fluid_currents_average_all_intersecting_fluid_blocks() {
        let mut world = WorldSnapshot::new();
        for (position, flow) in [
            ((0, 0, 0), Vec3::new(1.0, 0.0, 0.0)),
            ((1, 0, 0), Vec3::new(0.0, 0.0, 1.0)),
        ] {
            world.set_block(
                position,
                BlockState {
                    fluid: crate::world::FluidState::Water,
                    fluid_flow: flow,
                    ..BlockState::default()
                },
            );
        }
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            half_width: 0.6,
            is_player: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.velocity.x > 0.0);
        assert!(state.velocity.z > 0.0);
    }

    #[test]
    fn players_receive_vanilla_minimum_horizontal_fluid_push() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: crate::world::FluidState::Water,
                fluid_flow: Vec3::new(0.1, 0.0, 0.0),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            is_player: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.velocity.x >= 0.0045 * 0.8);
    }

    #[test]
    fn non_players_receive_vanilla_minimum_horizontal_fluid_push() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: FluidState::Water,
                fluid_flow: Vec3::new(0.1, 0.0, 0.0),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.velocity.x >= 0.0045 * 0.8);
    }

    #[test]
    fn player_minimum_fluid_push_preserves_vertical_direction() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: crate::world::FluidState::Water,
                fluid_flow: Vec3::new(0.1, 0.1, 0.0),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            is_player: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.velocity.y > -0.08);
        assert!(state.velocity.x > 0.0);
    }

    #[test]
    fn short_entities_have_zero_fluid_jump_threshold() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: crate::world::FluidState::Lava,
                fluid_flow: Vec3::ZERO,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            height: 0.4,
            velocity: Vec3::new(1.0, 0.0, 0.0),
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!((state.velocity.x - 0.5).abs() < 1e-7);
    }

    #[test]
    fn swimming_does_not_inject_unconditional_look_steering() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 2, 0),
            BlockState {
                fluid: crate::world::FluidState::Water,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 2.5, 0.5),
            swimming: true,
            is_player: true,
            look: Vec3::new(0.0, -1.0, 0.0),
            sprinting: true,
            no_gravity: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.velocity.y < 0.0);
        state.velocity.y = 0.0;
        state.passenger = true;
        tick(&mut state, &world, PhysicsConfig::default());
        assert_eq!(state.velocity.y, 0.0);
    }

    #[test]
    fn swimming_steering_uses_the_source_head_block_height() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: FluidState::Water,
                ..BlockState::default()
            },
        );
        world.set_block(
            (0, 1, 0),
            BlockState {
                fluid: FluidState::Water,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            swimming: true,
            is_player: true,
            no_gravity: true,
            look: Vec3::new(0.0, 0.5, 0.0),
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.velocity.y > 0.0);
    }

    #[test]
    fn jumps_from_ground() {
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            on_ground: true,
            jump_requested: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(state.position.y > 1.0);
        assert!(!state.on_ground);
    }

    #[test]
    fn sprint_jumping_adds_forward_momentum() {
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            on_ground: true,
            jump_requested: true,
            sprinting: true,
            yaw: 0.0,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        let ground_drag = java_float(java_float(0.6) * java_float(0.98));
        assert_eq!(state.position.z, 0.5 + 0.2);
        assert_eq!(state.velocity.z, 0.2 * ground_drag);
    }

    fn jump_height(state: SimulationState, release: MinecraftVersion) -> f64 {
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            on_ground: true,
            jump_requested: true,
            half_width: 0.3,
            height: 1.8,
            ..state
        };
        let rules = VersionPhysicsRules {
            release,
            ..VersionPhysicsRules::default()
        };
        tick_with_rules(&mut state, &WorldSnapshot::new(), PhysicsConfig::default(), rules);
        state.position.y
    }

    #[test]
    fn jump_boost_adds_a_tenth_per_level_in_the_precision_of_the_release() {
        let boosted = SimulationState {
            jump_boost_amplifier: Some(0),
            ..SimulationState::default()
        };

        assert_eq!(
            jump_height(boosted, MinecraftVersion::new(1, 16, 5)),
            1.0 + f64::from(0.42_f32 + 0.1_f32)
        );
        assert_eq!(
            jump_height(boosted, MinecraftVersion::new(1, 19, 2)),
            1.0 + (f64::from(0.42_f32) + f64::from(0.1_f32))
        );
        assert_eq!(
            jump_height(boosted, MinecraftVersion::new(1, 21, 1)),
            1.0 + f64::from(0.42_f32 + 0.1_f32)
        );
    }

    #[test]
    fn jumping_keeps_a_faster_rise_from_1_21_2() {
        let rising = SimulationState {
            velocity: Vec3::new(0.0, 0.6, 0.0),
            ..SimulationState::default()
        };

        assert_eq!(jump_height(rising, MinecraftVersion::new(1, 21, 1)), 1.0 + java_float(0.42));
        assert_eq!(jump_height(rising, MinecraftVersion::new(1, 21, 2)), 1.0 + 0.6);
    }

    #[test]
    fn a_zero_jump_strength_does_not_jump_from_1_20_5() {
        let grounded = SimulationState {
            jump_strength: Some(0.0),
            ..SimulationState::default()
        };

        assert_eq!(jump_height(grounded, MinecraftVersion::new(1, 21, 1)), 1.0);
    }

    #[test]
    fn releasing_jump_clears_the_jump_delay() {
        let mut state = SimulationState {
            jump_ticks: 5,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert_eq!(state.jump_ticks, 0);
    }

    #[test]
    fn ground_jump_cooldown_blocks_immediate_repeat() {
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            on_ground: true,
            jump_requested: true,
            jump_ticks: 2,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(state.velocity.y < 0.0);
    }

    #[test]
    fn swimming_does_not_change_air_vertical_drag() {
        let mut swimming = SimulationState {
            swimming: true,
            is_player: true,
            no_gravity: true,
            velocity: Vec3::new(0.0, 1.0, 0.0),
            ..SimulationState::default()
        };
        let mut ordinary = swimming;
        ordinary.swimming = false;

        tick(
            &mut swimming,
            &WorldSnapshot::new(),
            PhysicsConfig::default(),
        );
        tick(
            &mut ordinary,
            &WorldSnapshot::new(),
            PhysicsConfig::default(),
        );

        assert_eq!(swimming.velocity.y, java_float(0.98));
        assert_eq!(swimming.velocity.y, ordinary.velocity.y);
    }

    #[test]
    fn sprinting_uses_source_owned_water_slowdown() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: FluidState::Water,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            velocity: Vec3::new(1.0, 0.0, 0.0),
            sprinting: true,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick_with_rules(
            &mut state,
            &world,
            PhysicsConfig::default(),
            crate::versioned::v1_19::Profile::rules(),
        );

        assert!((state.velocity.x - 0.9).abs() < 1.0e-7);
    }

    #[test]
    fn water_climbable_jump_does_not_use_land_jump_vertical_boost() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: FluidState::Water,
                shape: Some(BlockShape {
                    bounds: Aabb::new(Vec3::ZERO, Vec3::new(1.0, 1.0, 1.0)),
                    slipperiness: 0.6,
                    fluid: FluidState::Water,
                    effect: BlockEffect::Climbable,
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            jump_requested: true,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert_ne!(state.velocity.y, 0.2);
    }

    #[test]
    fn zero_vertical_request_clears_stale_collision_state() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, -1, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.0, 0.5),
            velocity: Vec3::new(0.1, 0.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            collided_vertically: true,
            vertical_collision_below: true,
            on_ground: true,
            is_player: true,
            controlled_by_local_instance: true,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick_with_rules(
            &mut state,
            &world,
            PhysicsConfig::default(),
            crate::versioned::v1_21_4::Profile::rules(),
        );

        assert!(!state.collided_vertically);
        assert!(!state.vertical_collision_below);
        assert!(!state.on_ground);
    }

    #[test]
    fn sprinting_lava_still_applies_source_gravity() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: FluidState::Lava,
                fluid_level: 8,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            sprinting: true,
            no_gravity: false,
            ..SimulationState::default()
        };

        tick_with_rules(
            &mut state,
            &world,
            PhysicsConfig::default(),
            crate::versioned::v1_19::Profile::rules(),
        );

        assert!(state.velocity.y < 0.0);
    }

    #[test]
    fn lava_gravity_uses_version_rule_divisor() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: FluidState::Lava,
                fluid_level: 8,
                ..BlockState::default()
            },
        );
        let mut rules = VersionPhysicsRules::default();
        rules.lava_gravity_divisor = 8.0;
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.2, 0.5),
            no_gravity: false,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick_with_rules(&mut state, &world, PhysicsConfig::default(), rules);

        assert!((state.velocity.y + 0.01).abs() < 1.0e-12);
    }

    #[test]
    fn water_reduces_gravity_and_sets_environment_state() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: crate::world::FluidState::Water,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            velocity: Vec3::ZERO,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.in_water);
        assert!(!state.in_lava);
        assert!(state.velocity.y > -0.08);
    }

    #[test]
    fn water_contact_resets_fall_distance() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: FluidState::Water,
                fluid_level: 0,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            fall_distance: 12.0,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.in_water);
        assert_eq!(state.fall_distance, 0.0);
    }

    #[test]
    fn entering_water_restarts_the_fall_distance_from_the_last_move() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        world.set_block(
            (0, 1, 0),
            BlockState {
                fluid: FluidState::Water,
                fluid_level: 8,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 2.5, 0.5),
            velocity: Vec3::new(0.0, -1.5, 0.0),
            on_ground: false,
            no_gravity: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.in_water);
        assert_eq!(state.fall_distance, 1.5);
    }

    #[test]
    fn supporting_effect_uses_entity_footprint_not_center_cell() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape {
                    bounds: Aabb::new(Vec3::new(0.5, 0.0, 0.0), Vec3::new(1.0, 1.0, 1.0)),
                    slipperiness: 0.6,
                    fluid: FluidState::Empty,
                    effect: BlockEffect::Magma,
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.9, 1.0, 0.5),
            half_width: 0.5,
            height: 1.0,
            on_ground: true,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert_eq!(state.contact_damage, 1.0);
    }

    #[test]
    fn sneaking_player_backs_off_from_uncovered_edge() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            velocity: Vec3::new(0.8, 0.0, 0.0),
            is_player: true,
            sneaking: true,
            on_ground: true,
            no_gravity: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.position.x < 1.3);
        assert!(state.position.x > 1.1);
    }

    #[test]
    fn fluid_surface_sets_eye_in_fluid_predicates() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                fluid: FluidState::Water,
                fluid_level: 0,
                ..BlockState::default()
            },
        );
        world.set_block(
            (0, 2, 0),
            BlockState {
                fluid: FluidState::Water,
                fluid_level: 0,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            height: 1.8,
            half_width: 0.3,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.in_water);
        assert!(state.eye_in_water);
        assert!(!state.eye_in_lava);
    }

    #[test]
    fn slow_falling_reduces_descent() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            slow_falling: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(state.velocity.y > -0.01);
    }

    #[test]
    fn slow_falling_clamps_custom_gravity_to_vanilla_cap() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            slow_falling: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };
        let config = PhysicsConfig {
            gravity: 0.2,
            ..PhysicsConfig::default()
        };

        tick(&mut state, &WorldSnapshot::new(), config);

        assert!((state.velocity.y + 0.01 * java_float(0.98)).abs() < 1.0e-12);
    }

    #[test]
    fn slow_falling_and_levitation_reset_fall_distance() {
        for effect in [0_u8, 1_u8] {
            let mut state = SimulationState {
                position: Vec3::new(0.0, 2.0, 0.0),
                slow_falling: effect == 0,
                levitation: effect == 1,
                fall_distance: 12.0,
                half_width: 0.3,
                height: 1.8,
                ..SimulationState::default()
            };

            tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

            assert!(state.fall_distance < 1.0);
        }
    }

    #[test]
    fn levitation_moves_state_upward() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            levitation: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert_eq!(state.velocity.y, 0.05 * 0.2 * java_float(0.98));

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(state.position.y > 2.0);
    }

    #[test]
    fn levitation_amplifier_controls_vertical_target() {
        let mut base = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            levitation: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };
        let mut amplified = SimulationState {
            levitation_amplifier: Some(2),
            ..base
        };

        for _ in 0..2 {
            tick(&mut base, &WorldSnapshot::new(), PhysicsConfig::default());
            tick(
                &mut amplified,
                &WorldSnapshot::new(),
                PhysicsConfig::default(),
            );
        }

        assert!(amplified.velocity.y > base.velocity.y);
        assert!(amplified.position.y > base.position.y);
    }

    #[test]
    fn accumulates_and_resets_fall_distance() {
        let mut state = SimulationState {
            position: Vec3::new(0.5, 2.5, 0.5),
            velocity: Vec3::new(0.0, -0.5, 0.0),
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };
        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());
        assert!(state.fall_distance > 0.0);

        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                id: 1,
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        state.position = Vec3::new(0.5, 1.9, 0.5);
        state.velocity.y = -1.0;
        tick(&mut state, &world, PhysicsConfig::default());
        assert_eq!(state.fall_distance, 0.0);
    }

    #[test]
    fn sneaking_reduces_horizontal_input() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            input: Vec3::new(1.0, 0.0, 0.0),
            sneaking: true,
            no_physics: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(state.position.x > 0.0);
        assert!(state.position.x < 0.04);
    }

    #[test]
    fn item_use_applies_vanilla_movement_slowdown() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            input: Vec3::new(1.0, 0.0, 0.0),
            using_item: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(state.position.x > 0.0);
        assert!(state.position.x < 0.03);
    }

    #[test]
    fn moving_slowly_decides_the_sneak_slowdown_not_the_sneak_key() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                id: 1,
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let walking = |sneaking: bool, moving_slowly: bool| {
            let mut state = SimulationState {
                position: Vec3::new(0.5, 1.0, 0.5),
                velocity: Vec3::new(0.0, -0.08 * java_float(0.98), 0.0),
                input: Vec3::new(1.0, 0.0, 0.0),
                on_ground: true,
                is_player: true,
                sneaking,
                moving_slowly: Some(moving_slowly),
                half_width: 0.3,
                height: 1.8,
                ..SimulationState::default()
            };
            tick(&mut state, &world, PhysicsConfig::default());
            state.position.x - 0.5
        };

        assert_eq!(walking(true, false), java_float(0.98) * java_float(0.1));
        assert!((walking(false, true) - 0.98 * 0.3 * 0.1).abs() < 1.0e-8);
    }

    #[test]
    fn swift_sneak_uses_the_sneaking_speed_attribute() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            input: Vec3::new(1.0, 0.0, 0.0),
            is_player: true,
            moving_slowly: Some(true),
            sneaking_speed: 0.45,
            on_ground: true,
            no_physics: true,
            no_gravity: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!((state.position.x - f64::from(0.98_f32 * 0.45_f32) * java_float(0.1)).abs() < 1.0e-12);
    }

    #[test]
    fn sneaking_spectators_do_not_back_off_from_edges() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            input: Vec3::new(1.0, 0.0, 0.0),
            on_ground: true,
            is_player: true,
            sneaking: true,
            no_physics: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(state.position.x > 0.0);
    }

    #[test]
    fn sprinting_keeps_its_speed_modifier_while_sneaking() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                id: 1,
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            velocity: Vec3::new(0.0, -0.08 * java_float(0.98), 0.0),
            input: Vec3::new(1.0, 0.0, 0.0),
            on_ground: true,
            is_player: true,
            sprinting: true,
            sneaking: true,
            moving_slowly: Some(false),
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        let sprint_speed = java_float(0.1 * (1.0 + 0.30000001192092896));
        assert_eq!(state.position.x, 0.5 + java_float(0.98) * sprint_speed);
    }

    #[test]
    fn climbing_jumps_up_when_requested_or_blocked() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            jump_requested: true,
            climbing: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert_eq!(state.velocity.y, (0.2 - 0.08) * java_float(0.98));
    }

    #[test]
    fn climbing_limits_horizontal_and_downward_velocity() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            velocity: Vec3::new(0.5, -0.5, -0.5),
            climbing: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        let limit = java_float(0.15);
        assert_eq!(state.position, Vec3::new(limit, 2.0 - limit, -limit));
    }

    #[test]
    fn standing_on_top_of_a_ladder_is_not_climbing() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 2, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: BlockEffect::Climbable,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 3.0, 0.5),
            velocity: Vec3::new(0.0, -0.5, 0.0),
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert_eq!(state.position.y, 2.5);
    }

    #[test]
    fn sneaking_player_stops_sliding_down_ladder_but_not_scaffolding() {
        let mut ladder_world = WorldSnapshot::new();
        ladder_world.set_block(
            (0, 2, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: BlockEffect::Climbable,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut ladder_state = SimulationState {
            position: Vec3::new(0.5, 2.0, 0.5),
            velocity: Vec3::new(0.0, -0.5, 0.0),
            is_player: true,
            sneaking: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };
        tick(&mut ladder_state, &ladder_world, PhysicsConfig::default());
        assert_eq!(ladder_state.position.y, 2.0);
    }

    #[test]
    fn leaving_climbable_block_does_not_persist_world_derived_climbing() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 2, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: BlockEffect::Climbable,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 2.0, 0.5),
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());
        assert!(!state.climbing);
    }

    #[test]
    fn water_jump_input_adds_vanilla_vertical_impulse() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: FluidState::Water,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            jump_requested: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.velocity.y > 0.02);
    }

    #[test]
    fn attributes_and_effects_modify_movement() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 2.0, 0.0),
            input: Vec3::new(1.0, 0.0, 0.0),
            movement_speed: 0.2,
            speed_effect_amplifier: Some(0),
            slowness_effect_amplifier: Some(0),
            on_ground: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(state.position.x > 0.15);
        assert!(state.position.x < 0.25);
    }

    #[test]
    fn jump_strength_and_boost_override_defaults() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 1.0, 0.0),
            on_ground: true,
            jump_requested: true,
            jump_strength: Some(0.5),
            jump_boost_amplifier: Some(1),
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(state.velocity.y > 0.5);
    }

    #[test]
    fn maximum_jump_boost_amplifier_does_not_overflow() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 1.0, 0.0),
            on_ground: true,
            jump_requested: true,
            jump_boost_amplifier: Some(u8::MAX),
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(state.velocity.y.is_finite());
        assert!(state.velocity.y > 25.0);
    }

    #[test]
    fn computes_fall_damage_on_long_landing() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                id: 1,
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.9, 0.5),
            velocity: Vec3::new(0.0, -1.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            fall_distance: 10.0,
            ..SimulationState::default()
        };
        tick(&mut state, &world, PhysicsConfig::default());
        assert!(state.fall_damage > 0.0);
    }

    #[test]
    fn fall_damage_immunity_tag_suppresses_calculated_damage() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.9, 0.5),
            velocity: Vec3::new(0.0, -1.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            fall_distance: 10.0,
            fall_damage_immune: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert_eq!(state.fall_damage, 0.0);
    }

    #[test]
    fn safe_fall_distance_reduces_landing_damage() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.9, 0.5),
            velocity: Vec3::new(0.0, -1.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            fall_distance: 10.0,
            safe_fall_distance: 4.0,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert_eq!(state.fall_damage, 3.0);
    }

    #[test]
    fn modern_fall_damage_uses_safe_fall_distance_without_legacy_offset() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.9, 0.5),
            velocity: Vec3::new(0.0, -1.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            fall_distance: 6.0,
            safe_fall_distance: 3.0,
            fall_damage_multiplier: Some(1.0),
            ..SimulationState::default()
        };

        crate::simulation::tick_with_profile_and_restitution::<crate::versioned::v26_2::Profile>(
            &mut state,
            &world,
            PhysicsConfig::default(),
        );

        assert_eq!(state.fall_damage, 3.0);
    }

    #[test]
    fn movement_ray_resets_fall_distance_on_resetting_block() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                fall_damage_resetting: true,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 2.0, 0.5),
            velocity: Vec3::new(0.0, -2.0, 0.0),
            fall_distance: 5.0,
            no_physics: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert_eq!(state.fall_distance, 0.0);
    }

    #[test]
    fn short_movement_does_not_reset_fall_distance() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                fall_damage_resetting: true,
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.8, 0.5),
            velocity: Vec3::new(0.0, -0.2, 0.0),
            fall_distance: 5.0,
            no_physics: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.fall_distance > 5.0);
    }

    #[test]
    fn landing_damage_rounds_up_like_vanilla() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.9, 0.5),
            velocity: Vec3::new(0.0, -1.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            fall_distance: 6.1,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert_eq!(state.fall_damage, 4.0);
    }

    #[test]
    fn landing_damage_applies_multiplier_before_rounding() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.9, 0.5),
            velocity: Vec3::new(0.0, -1.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            fall_distance: 6.1,
            fall_damage_multiplier: Some(0.5),
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert_eq!(state.fall_damage, 2.0);
    }

    #[test]
    fn fall_flying_glides_with_bounded_descent() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 20.0, 0.0),
            velocity: Vec3::ZERO,
            fall_flying: true,
            look: Vec3::new(0.0, -0.5, 1.0),
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(state.position.z > 0.0);
        assert!(state.velocity.y > -0.5);
    }

    #[test]
    fn fall_flying_redirects_velocity_toward_look_direction() {
        let mut state = SimulationState {
            velocity: Vec3::new(1.0, 0.0, 0.0),
            fall_flying: true,
            look: Vec3::new(0.0, 0.0, 1.0),
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(state.velocity.z > 0.0);
        assert!(state.velocity.x < 1.0);
    }

    #[test]
    fn creative_flying_preserves_and_scales_vertical_velocity() {
        let world = WorldSnapshot::new();
        let mut state = SimulationState {
            flying: true,
            is_player: true,
            velocity: Vec3::new(0.0, 0.5, 0.0),
            fall_distance: 12.0,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!((state.velocity.y - 0.3).abs() < 1e-12);
        assert_eq!(state.fall_distance, 0.0);
    }

    #[test]
    fn creative_flying_uses_flying_speed_for_horizontal_input() {
        let world = WorldSnapshot::new();
        let mut state = SimulationState {
            flying: true,
            flying_speed: 0.05,
            movement_speed: 0.2,
            input: Vec3::new(1.0, 0.0, 0.0),
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.velocity.x.abs() < 0.05);
    }

    #[test]
    fn creative_flying_uses_jump_and_sneak_for_vertical_input() {
        let world = WorldSnapshot::new();
        let mut ascending = SimulationState {
            flying: true,
            flying_speed: 0.05,
            jump_requested: true,
            ..SimulationState::default()
        };
        tick(&mut ascending, &world, PhysicsConfig::default());

        let mut descending = SimulationState {
            flying: true,
            flying_speed: 0.05,
            sneaking: true,
            ..SimulationState::default()
        };
        tick(&mut descending, &world, PhysicsConfig::default());

        assert!(ascending.velocity.y > 0.0);
        assert!(descending.velocity.y < 0.0);
    }

    #[test]
    fn firework_boost_adds_velocity() {
        let mut state = SimulationState {
            position: Vec3::new(0.0, 20.0, 0.0),
            firework_boost: Vec3::new(0.0, 0.2, 0.3),
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());

        assert!(state.position.z > 0.2);
        assert!(state.velocity.y > 0.0);
    }

    #[test]
    fn steps_over_low_obstacle_when_grounded() {
        let mut world = WorldSnapshot::new();
        for position in [(0, 0, 0), (1, 0, 0)] {
            world.set_block(
                position,
                BlockState {
                    id: 1,
                    shape: Some(BlockShape::full_block()),
                    ..BlockState::default()
                },
            );
        }
        world.set_block(
            (1, 1, 0),
            BlockState {
                id: 1,
                shape: Some(BlockShape {
                    bounds: crate::Aabb::new(Vec3::ZERO, Vec3::new(1.0, 0.5, 1.0)),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            velocity: Vec3::new(1.0, 0.0, 0.0),
            on_ground: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.position.x > 0.8);
        assert!(state.position.y >= 1.0);
    }

    #[test]
    fn block_effects_modify_native_movement() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::Slime,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        assert_eq!(world.effect_at((0, 0, 0)), crate::world::BlockEffect::Slime);
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            velocity: Vec3::new(0.0, -0.2, 0.0),
            on_ground: true,
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };
        tick(&mut state, &world, PhysicsConfig::default());
        assert!(state.velocity.y > 0.0);
    }

    #[test]
    fn stuck_blocks_slow_the_next_move_and_stop_the_motion() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::Web,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let web = Vec3::new(0.25, java_float(0.05), 0.25);
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            velocity: Vec3::new(1.0, 1.0, 1.0),
            stuck_speed_multiplier: web,
            half_width: 0.3,
            height: 1.8,
            no_gravity: true,
            fall_distance: 4.0,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert_eq!(state.position, Vec3::new(0.5, 1.5, 0.5) + web);
        assert_eq!(state.velocity, Vec3::ZERO);
        assert_eq!(state.stuck_speed_multiplier, web);
        assert_eq!(state.fall_distance, 0.0);
    }

    #[test]
    fn entering_a_cobweb_slows_only_the_next_move() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::Web,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            velocity: Vec3::new(0.1, 0.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert_eq!(state.position.x, 0.6);
        assert!(state.in_web);
        assert_eq!(
            state.stuck_speed_multiplier,
            Vec3::new(0.25, java_float(0.05), 0.25)
        );
    }

    #[test]
    fn bubble_columns_push_the_entity_inside() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::BubbleUp,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            half_width: 0.3,
            height: 1.8,
            no_gravity: true,
            fall_distance: 12.0,
            ..SimulationState::default()
        };
        tick(&mut state, &world, PhysicsConfig::default());
        assert!(state.velocity.y > 0.0);
        assert_eq!(state.fall_distance, 0.0);
        assert!(!state.in_web);

        world.set_block(
            (0, 2, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        state.velocity = Vec3::ZERO;
        state.position.y = 1.5;
        tick(&mut state, &world, PhysicsConfig::default());
        assert!(state.velocity.y > 0.0);
        assert!(state.velocity.y < 0.1);
    }

    #[test]
    fn weaving_uses_the_source_web_stuck_multiplier() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::Web,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            half_width: 0.3,
            height: 1.8,
            no_gravity: true,
            fall_distance: 4.0,
            weaving: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert_eq!(state.stuck_speed_multiplier, Vec3::new(0.5, 0.25, 0.5));
        assert_eq!(state.fall_distance, 0.0);
    }

    #[test]
    fn powder_snow_sticks_the_entity_whose_position_it_holds() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::PowderSnow,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            half_width: 0.3,
            height: 1.8,
            no_gravity: true,
            fall_distance: 4.0,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert_eq!(state.stuck_speed_multiplier, Vec3::new(java_float(0.9), 1.5, java_float(0.9)));
        assert_eq!(state.fall_distance, 0.0);
    }

    #[test]
    fn powder_snow_immunity_skips_stuck_multiplier_and_zeroing() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::PowderSnow,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            velocity: Vec3::new(1.0, 0.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            powder_snow_immune: true,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.in_powder_snow);
        assert!(state.velocity.x > 0.9);
    }

    #[test]
    fn powder_snow_accumulates_and_clears_freeze_ticks() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::PowderSnow,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            height: 1.8,
            no_gravity: true,
            ticks_frozen: 3,
            ..SimulationState::default()
        };

        assert_eq!(state.ticks_frozen, 3);
        tick(&mut state, &world, PhysicsConfig::default());
        assert_eq!(state.ticks_frozen, 4);

        world.set_block((0, 1, 0), BlockState::default());
        tick(&mut state, &world, PhysicsConfig::default());
        assert_eq!(state.ticks_frozen, 2);
    }

    #[test]
    fn powder_snow_walkable_entities_collide_with_the_surface() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape {
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    effect: BlockEffect::PowderSnow,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut walkable = SimulationState {
            position: Vec3::new(0.5, 1.8, 0.5),
            velocity: Vec3::new(0.0, -0.5, 0.0),
            height: 1.8,
            powder_snow_walkable: true,
            ..SimulationState::default()
        };
        let mut falling = walkable;
        falling.powder_snow_walkable = false;

        for _ in 0..3 {
            tick(&mut walkable, &world, PhysicsConfig::default());
            tick(&mut falling, &world, PhysicsConfig::default());
        }

        assert!(walkable.on_ground);
        assert!(walkable.position.y >= 1.0 - 1.0e-7);
        assert!(falling.position.y < walkable.position.y);
    }

    #[test]
    fn fully_frozen_entities_take_periodic_freeze_damage() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: BlockEffect::PowderSnow,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            height: 1.8,
            ticks_frozen: 140,
            tick_count: 39,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert_eq!(state.freeze_damage, 1.0);
    }

    #[test]
    fn damage_surfaces_emit_source_specific_contact_damage() {
        let mut magma_world = WorldSnapshot::new();
        magma_world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: BlockEffect::Magma,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut magma = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            on_ground: true,
            ..SimulationState::default()
        };
        tick(&mut magma, &magma_world, PhysicsConfig::default());
        assert_eq!(magma.contact_damage, 1.0);

        let mut cactus_world = WorldSnapshot::new();
        cactus_world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: BlockEffect::Cactus,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut cactus = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            height: 1.8,
            ..SimulationState::default()
        };
        tick(&mut cactus, &cactus_world, PhysicsConfig::default());
        assert_eq!(cactus.contact_damage, 1.0);

        let mut soul_campfire_world = WorldSnapshot::new();
        soul_campfire_world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: BlockEffect::SoulCampfire,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut soul_campfire = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            height: 1.8,
            ..SimulationState::default()
        };
        tick(
            &mut soul_campfire,
            &soul_campfire_world,
            PhysicsConfig::default(),
        );
        assert_eq!(soul_campfire.contact_damage, 2.0);

        let mut fire_world = WorldSnapshot::new();
        fire_world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: BlockEffect::SoulFire,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut fire = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            height: 1.8,
            ticks_frozen: 40,
            ..SimulationState::default()
        };
        tick(&mut fire, &fire_world, PhysicsConfig::default());
        assert_eq!(fire.ticks_frozen, 0);
        assert_eq!(fire.contact_damage, 2.0);
        tick(&mut fire, &WorldSnapshot::new(), PhysicsConfig::default());
        assert_eq!(fire.contact_damage, 0.0);
    }

    #[test]
    fn inside_effects_are_detected_across_the_full_entity_bounds() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 2, 0),
            BlockState {
                shape: Some(BlockShape {
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    effect: BlockEffect::Cactus,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.0, 0.5),
            height: 2.0,
            ..SimulationState::default()
        };
        tick(&mut state, &world, PhysicsConfig::default());
        assert_eq!(state.contact_damage, 1.0);
    }

    #[test]
    fn inside_effects_ignore_face_touching_entity_bounds() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 2, 0),
            BlockState {
                shape: Some(BlockShape {
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    effect: BlockEffect::Cactus,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.2, 0.5),
            height: 1.8,
            ..SimulationState::default()
        };
        tick(&mut state, &world, PhysicsConfig::default());
        assert_eq!(state.contact_damage, 0.0);
    }

    #[test]
    fn inside_wall_uses_the_eye_box_and_no_physics_gate() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.0, 0.5),
            half_width: 0.3,
            height: 1.8,
            eye_height: Some(1.53),
            no_gravity: true,
            ..SimulationState::default()
        };
        tick(&mut state, &world, PhysicsConfig::default());
        assert!(state.inside_wall);
        state.no_physics = true;
        tick(&mut state, &world, PhysicsConfig::default());
        assert!(!state.inside_wall);
    }

    #[test]
    fn non_finite_entity_motion_is_rejected_like_set_delta_movement() {
        let mut state = SimulationState {
            position: Vec3::new(f64::NAN, 0.0, 0.0),
            velocity: Vec3::new(f64::INFINITY, 0.0, 0.0),
            ..SimulationState::default()
        };
        tick(&mut state, &WorldSnapshot::new(), PhysicsConfig::default());
        assert!(state.velocity.is_finite());
        assert_eq!(state.velocity.x, 0.0);
    }

    #[test]
    fn fall_distance_accumulation_matches_vanilla_thresholds() {
        let mut state = SimulationState {
            velocity: Vec3::new(0.0, -0.49, 0.0),
            fall_distance: 12.0,
            ..SimulationState::default()
        };
        state.check_fall_distance_accumulation();
        assert_eq!(state.fall_distance, 1.0);

        state.fall_distance = 12.0;
        state.velocity.y = -0.5;
        state.check_fall_distance_accumulation();
        assert_eq!(state.fall_distance, 12.0);
    }

    #[test]
    fn non_finite_delta_impulses_preserve_existing_velocity() {
        let mut state = SimulationState {
            velocity: Vec3::new(0.25, 0.0, -0.5),
            ..SimulationState::default()
        };
        state.add_delta_movement(Vec3::new(f64::INFINITY, 0.0, 0.0));
        assert_eq!(state.velocity, Vec3::new(0.25, 0.0, -0.5));
        state.add_delta_movement(Vec3::new(0.1, 0.0, 0.2));
        assert_eq!(state.velocity, Vec3::new(0.35, 0.0, -0.3));
    }

    #[test]
    fn flying_entities_ignore_player_stuck_block_multiplier() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::Web,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            velocity: Vec3::new(1.0, 0.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            flying: true,
            is_player: true,
            no_gravity: true,
            fall_distance: 4.0,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.velocity.x > 0.9);
    }

    #[test]
    fn sweet_berry_bush_applies_source_stuck_multiplier() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::SweetBerryBush,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            half_width: 0.3,
            height: 1.8,
            no_gravity: true,
            fall_distance: 4.0,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert_eq!(state.stuck_speed_multiplier, Vec3::new(java_float(0.8), 0.75, java_float(0.8)));
        assert_eq!(state.fall_distance, 0.0);
    }

    #[test]
    fn berry_bush_immunity_skips_source_stuck_multiplier() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::SweetBerryBush,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            velocity: Vec3::new(1.0, 0.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            sweet_berry_bush_immune: true,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.position.x > 1.4);
        assert!(state.velocity.x > 0.9);
    }

    #[test]
    fn soul_sand_applies_block_speed_factor_after_movement() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::SoulSand,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            input: Vec3::new(1.0, 0.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            on_ground: true,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        let ground_drag = java_float(java_float(0.6) * java_float(0.98));
        let moved = java_float(0.98) * java_float(0.1);
        assert!((state.position.x - (0.5 + moved)).abs() < 1.0e-12);
        assert!((state.velocity.x - moved * java_float(0.4) * ground_drag).abs() < 1.0e-12);
    }

    #[test]
    fn soul_speed_enchantment_disables_soul_block_slowdown() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::SoulSoil,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            input: Vec3::new(1.0, 0.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            on_ground: true,
            soul_speed: 1,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        let ground_drag = java_float(java_float(0.6) * java_float(0.98));
        let moved = java_float(0.98) * java_float(0.1);
        assert!((state.position.x - (0.5 + moved)).abs() < 1.0e-12);
        assert!((state.velocity.x - moved * ground_drag).abs() < 1.0e-12);
    }

    #[test]
    fn modern_soul_speed_applies_location_speed_and_efficiency_effects() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::SoulSoil,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let base = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            input: Vec3::new(1.0, 0.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            on_ground: true,
            no_gravity: true,
            ..SimulationState::default()
        };
        let mut without = base;
        let mut with = base;
        with.soul_speed = 1;

        crate::versioned::dispatch("26.2", &mut without, &world, PhysicsConfig::default()).unwrap();
        crate::versioned::dispatch("26.2", &mut with, &world, PhysicsConfig::default()).unwrap();

        assert!(with.velocity.x > without.velocity.x);
        assert!(with.velocity.x > 0.0);
    }

    #[test]
    fn slime_step_on_applies_source_horizontal_damping() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::Slime,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            velocity: Vec3::new(0.05, 0.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            on_ground: true,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        let ground_drag = java_float(java_float(0.6) * java_float(0.98));
        assert!((state.velocity.x - 0.05 * 0.4 * ground_drag).abs() < 1.0e-12);
    }

    #[test]
    fn slime_step_on_skips_damping_when_stepping_carefully() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::Slime,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 1.5, 0.5),
            velocity: Vec3::new(0.05, 0.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            on_ground: true,
            stepping_carefully: true,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        let ground_drag = java_float(java_float(0.6) * java_float(0.98));
        assert!((state.velocity.x - 0.05 * ground_drag).abs() < 1.0e-12);
    }

    #[test]
    fn slime_bounce_uses_living_and_non_living_source_scales() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 1, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::Slime,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut player = SimulationState {
            position: Vec3::new(0.5, 2.0, 0.5),
            velocity: Vec3::new(0.0, -0.2, 0.0),
            half_width: 0.3,
            height: 1.0,
            is_player: true,
            no_gravity: true,
            ..SimulationState::default()
        };
        let mut item = SimulationState {
            is_player: false,
            ..player
        };

        tick(&mut player, &world, PhysicsConfig::default());
        tick(&mut item, &world, PhysicsConfig::default());

        assert!((player.velocity.y - 0.2 * java_float(0.98)).abs() < 1.0e-12);
        assert!((item.velocity.y - 0.2 * 0.8 * java_float(0.98)).abs() < 1.0e-12);
    }

    #[test]
    fn slime_bounce_uses_the_block_landed_on() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::Slime,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 2.5, 0.5),
            velocity: Vec3::new(0.0, -2.0, 0.0),
            half_width: 0.3,
            height: 1.8,
            is_player: true,
            fall_distance: 20.0,
            fall_damage: 7.0,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(!state.on_ground);
        assert!(state.velocity.y > 0.0);
        assert_eq!(state.fall_distance, 0.0);
        assert_eq!(state.fall_damage, 0.0);
    }

    #[test]
    fn honey_block_applies_source_downward_slide_velocity() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (2, 0, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::Honey,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(1.3, 0.5, 0.5),
            velocity: Vec3::new(0.2, -0.2, 0.0),
            half_width: 0.3,
            height: 1.8,
            on_ground: false,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.velocity.y < 0.0);
        assert!(state.velocity.y > -0.2);
        assert_eq!(state.fall_distance, 0.0);
    }

    #[test]
    fn honey_block_does_not_slide_near_block_center() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::Honey,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = SimulationState {
            position: Vec3::new(0.5, 0.5, 0.5),
            velocity: Vec3::new(0.2, -0.2, 0.0),
            half_width: 0.3,
            height: 1.8,
            no_gravity: true,
            ..SimulationState::default()
        };

        tick(&mut state, &world, PhysicsConfig::default());

        assert!(state.velocity.y < -0.1274);
        assert_eq!(state.fall_distance, 0.2);
    }

    #[test]
    fn repeated_ticks_are_deterministic_and_finite() {
        let world = WorldSnapshot::new();
        let initial = SimulationState {
            position: Vec3::new(0.5, 8.0, -2.5),
            velocity: Vec3::new(0.03, 0.0, -0.02),
            input: Vec3::new(0.4, 0.0, 0.7),
            half_width: 0.3,
            height: 1.8,
            ..SimulationState::default()
        };
        let mut first = initial;
        let mut second = initial;
        for _ in 0..200 {
            tick(&mut first, &world, PhysicsConfig::default());
            tick(&mut second, &world, PhysicsConfig::default());
        }

        assert_eq!(first, second);
        assert!(first.position.x.is_finite());
        assert!(first.position.y.is_finite());
        assert!(first.position.z.is_finite());
        assert!(first.velocity.x.is_finite());
        assert!(first.velocity.y.is_finite());
        assert!(first.velocity.z.is_finite());
    }

    #[test]
    fn negligible_velocity_components_are_zeroed_before_tick() {
        let mut state = SimulationState {
            velocity: Vec3::new(0.002, -0.002, 0.004),
            ..SimulationState::default()
        };
        let config = PhysicsConfig {
            gravity: 0.0,
            drag: 1.0,
            negligible_velocity: 0.003,
            ..PhysicsConfig::default()
        };

        tick(&mut state, &WorldSnapshot::new(), config);

        assert_eq!(state.velocity.x, 0.0);
        assert_eq!(state.velocity.y, 0.0);
        assert!(state.velocity.z > 0.0);
    }

    #[test]
    fn entity_gravity_and_step_height_override_version_rules() {
        let mut state = SimulationState {
            position: Vec3::new(0.5, 2.0, 0.5),
            velocity: Vec3::ZERO,
            input: Vec3::new(1.0, 0.0, 0.0),
            gravity: Some(0.02),
            step_height: Some(1.0),
            no_gravity: false,
            ..SimulationState::default()
        };
        let mut world = WorldSnapshot::new();
        world.set_block(
            (1, 0, 0),
            BlockState {
                id: 1,
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );

        tick_with_rules(
            &mut state,
            &world,
            PhysicsConfig::default(),
            VersionPhysicsRules::default(),
        );

        assert!(state.velocity.y > -0.03);
        assert!(state.position.x > 0.5);
    }

    #[test]
    fn runtime_config_overrides_version_defaults() {
        let mut state = SimulationState {
            position: Vec3::new(0.5, 2.0, 0.5),
            velocity: Vec3::ZERO,
            ..SimulationState::default()
        };
        let config = PhysicsConfig {
            gravity: 0.02,
            drag: 0.5,
            step_height: 1.0,
            ..PhysicsConfig::default()
        };

        tick_with_rules(
            &mut state,
            &WorldSnapshot::new(),
            config,
            VersionPhysicsRules::default(),
        );

        assert!((state.velocity.y + 0.02 * java_float(0.98)).abs() < 1e-12);
    }
}
