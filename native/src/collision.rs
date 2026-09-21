use crate::math::{Aabb, Vec3};

pub const VANILLA_EQUAL_EPSILON: f64 = 1.0e-5;

#[must_use]
pub fn vanilla_equal(left: f64, right: f64) -> bool {
    (left - right).abs() < VANILLA_EQUAL_EPSILON
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Axis {
    X,
    Y,
    Z,
}

#[must_use]
pub fn clip_axis(entity: Aabb, obstacle: Aabb, delta: f64, axis: Axis) -> f64 {
    if delta.abs() < 1.0e-7 {
        return 0.0;
    }

    let overlaps = match axis {
        Axis::X => {
            entity.max.y > obstacle.min.y
                && entity.min.y < obstacle.max.y
                && entity.max.z > obstacle.min.z
                && entity.min.z < obstacle.max.z
        }
        Axis::Y => {
            entity.max.x > obstacle.min.x
                && entity.min.x < obstacle.max.x
                && entity.max.z > obstacle.min.z
                && entity.min.z < obstacle.max.z
        }
        Axis::Z => {
            entity.max.x > obstacle.min.x
                && entity.min.x < obstacle.max.x
                && entity.max.y > obstacle.min.y
                && entity.min.y < obstacle.max.y
        }
    };

    if !overlaps {
        return delta;
    }

    match axis {
        Axis::X if delta > 0.0 && entity.max.x <= obstacle.min.x => {
            delta.min(obstacle.min.x - entity.max.x)
        }
        Axis::X if delta < 0.0 && entity.min.x >= obstacle.max.x => {
            delta.max(obstacle.max.x - entity.min.x)
        }
        Axis::Y if delta > 0.0 && entity.max.y <= obstacle.min.y => {
            delta.min(obstacle.min.y - entity.max.y)
        }
        Axis::Y if delta < 0.0 && entity.min.y >= obstacle.max.y => {
            delta.max(obstacle.max.y - entity.min.y)
        }
        Axis::Z if delta > 0.0 && entity.max.z <= obstacle.min.z => {
            delta.min(obstacle.min.z - entity.max.z)
        }
        Axis::Z if delta < 0.0 && entity.min.z >= obstacle.max.z => {
            delta.max(obstacle.max.z - entity.min.z)
        }
        _ => delta,
    }
}

#[must_use]
pub fn resolve_motion(entity: Aabb, desired: Vec3, obstacles: &[Aabb]) -> (Vec3, [bool; 3]) {
    let mut resolved = Vec3::ZERO;
    let mut collided = [false; 3];
    let axes = if desired.x.abs() < desired.z.abs() {
        [Axis::Y, Axis::Z, Axis::X]
    } else {
        [Axis::Y, Axis::X, Axis::Z]
    };

    for axis in axes {
        let mut delta = resolved_component(desired, axis);
        for obstacle in obstacles {
            let clipped = clip_axis(entity.translated(resolved), *obstacle, delta, axis);
            if clipped != delta {
                collided[axis_index(axis)] = true;
                delta = clipped;
            }
        }
        resolved = set_component(resolved, axis, delta);
    }

    (resolved, collided)
}

#[must_use]
pub fn resolve_step_motion(
    entity: Aabb,
    desired: Vec3,
    max_step: f64,
    obstacles: &[Aabb],
    normal: Vec3,
    normal_collisions: [bool; 3],
) -> (Vec3, [bool; 3]) {
    let raised = resolve_motion(entity, Vec3::new(desired.x, max_step, desired.z), obstacles).0;
    let expanded = entity.expand_towards(Vec3::new(desired.x, 0.0, desired.z));
    let step = resolve_motion(expanded, Vec3::new(0.0, max_step, 0.0), obstacles).0;
    let candidate = if step.y < max_step {
        let lowered = resolve_motion(
            entity.translated(step),
            Vec3::new(desired.x, 0.0, desired.z),
            obstacles,
        )
        .0;
        step + lowered
    } else {
        raised
    };
    if candidate.x * candidate.x + candidate.z * candidate.z
        <= normal.x * normal.x + normal.z * normal.z
    {
        return (normal, normal_collisions);
    }

    let final_vertical = resolve_motion(
        entity.translated(candidate),
        Vec3::new(0.0, -candidate.y + desired.y, 0.0),
        obstacles,
    )
    .0;
    let resolved = candidate + final_vertical;
    (
        resolved,
        [
            !vanilla_equal(desired.x, resolved.x),
            !vanilla_equal(desired.y, resolved.y),
            !vanilla_equal(desired.z, resolved.z),
        ],
    )
}

fn axis_index(axis: Axis) -> usize {
    match axis {
        Axis::X => 0,
        Axis::Y => 1,
        Axis::Z => 2,
    }
}

fn resolved_component(value: Vec3, axis: Axis) -> f64 {
    match axis {
        Axis::X => value.x,
        Axis::Y => value.y,
        Axis::Z => value.z,
    }
}

fn set_component(value: Vec3, axis: Axis, component: f64) -> Vec3 {
    match axis {
        Axis::X => Vec3::new(component, value.y, value.z),
        Axis::Y => Vec3::new(value.x, component, value.z),
        Axis::Z => Vec3::new(value.x, value.y, component),
    }
}

#[cfg(test)]
mod tests {
    use super::{clip_axis, resolve_motion, resolve_step_motion, vanilla_equal, Axis};
    use crate::math::{Aabb, Vec3};

    fn box_at(x: f64, y: f64, z: f64) -> Aabb {
        Aabb::new(Vec3::new(x, y, z), Vec3::new(x + 1.0, y + 1.0, z + 1.0))
    }

    #[test]
    fn clips_positive_motion_at_contact() {
        let entity = box_at(0.0, 0.0, 0.0);
        let obstacle = box_at(2.0, 0.0, 0.0);

        assert_eq!(clip_axis(entity, obstacle, 2.5, Axis::X), 1.0);
    }

    #[test]
    fn clips_negative_motion_at_contact() {
        let entity = box_at(2.0, 0.0, 0.0);
        let obstacle = box_at(0.0, 0.0, 0.0);

        assert_eq!(clip_axis(entity, obstacle, -2.5, Axis::X), -1.0);
    }

    #[test]
    fn resolves_multiple_axes_in_order() {
        let entity = box_at(0.0, 0.0, 0.0);
        let obstacle = box_at(2.0, 0.0, 2.0);
        let (motion, collided) = resolve_motion(entity, Vec3::new(2.5, 0.0, 2.5), &[obstacle]);

        assert_eq!(motion, Vec3::new(2.5, 0.0, 1.0));
        assert_eq!(collided, [false, false, true]);
    }

    #[test]
    fn follows_vanilla_axis_order_when_z_dominates() {
        let entity = box_at(0.0, 0.0, 0.0);
        let obstacle = box_at(0.0, 0.0, 2.0);
        let (motion, collided) = resolve_motion(entity, Vec3::new(1.0, 0.0, 2.5), &[obstacle]);

        assert_eq!(motion, Vec3::new(1.0, 0.0, 1.0));
        assert_eq!(collided, [false, false, true]);
    }

    #[test]
    fn step_motion_uses_raised_candidate_then_final_vertical_correction() {
        let entity = box_at(0.0, 0.0, 0.0);
        let obstacle = Aabb::new(Vec3::new(1.0, 0.0, 0.0), Vec3::new(2.0, 0.5, 1.0));
        let (motion, collided) = resolve_step_motion(
            entity,
            Vec3::new(1.5, 0.0, 0.0),
            1.0,
            &[obstacle],
            Vec3::ZERO,
            [true, false, false],
        );

        assert_eq!(motion, Vec3::new(1.5, 0.5, 0.0));
        assert_eq!(collided, [false, true, false]);
    }

    #[test]
    fn allows_motion_when_only_touching_other_axes() {
        let entity = box_at(0.0, 1.0, 0.0);
        let obstacle = box_at(2.0, 0.0, 0.0);

        assert_eq!(clip_axis(entity, obstacle, 2.5, Axis::X), 2.5);
    }

    #[test]
    fn matches_vanilla_equality_tolerance() {
        assert!(vanilla_equal(1.0, 1.0 + 0.5e-5));
        assert!(!vanilla_equal(1.0, 1.0 + 2.0e-5));
    }

    #[test]
    fn rejects_sub_epsilon_motion_like_vanilla_shapes_collide() {
        let entity = box_at(0.0, 0.0, 0.0);
        let obstacle = box_at(2.0, 0.0, 0.0);

        assert_eq!(clip_axis(entity, obstacle, 0.5e-7, Axis::X), 0.0);
        assert_eq!(clip_axis(entity, obstacle, -0.5e-7, Axis::X), 0.0);
    }

    #[test]
    fn reports_collision_when_vanilla_resolves_sub_epsilon_motion_to_zero() {
        let entity = box_at(0.0, 0.0, 0.0);
        let obstacle = box_at(1.0, 0.0, 0.0);
        let (motion, collided) = resolve_motion(entity, Vec3::new(0.5e-7, 0.0, 0.0), &[obstacle]);

        assert_eq!(motion.x, 0.0);
        assert!(collided[0]);
    }
}
