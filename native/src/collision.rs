use crate::math::{Aabb, Vec3};

pub const VANILLA_EQUAL_EPSILON: f64 = 9.999999747378752e-6;
const COLLISION_EPSILON: f64 = 1.0e-7;

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

impl Axis {
    const fn others(self) -> [Self; 2] {
        match self {
            Self::X => [Self::Y, Self::Z],
            Self::Y => [Self::X, Self::Z],
            Self::Z => [Self::X, Self::Y],
        }
    }
}

/// VoxelShape.collide of one box, with its 1.0E-7 tolerances.
#[must_use]
pub fn clip_axis(entity: Aabb, obstacle: Aabb, delta: f64, axis: Axis) -> f64 {
    if delta.abs() < COLLISION_EPSILON {
        return 0.0;
    }
    let overlaps = |other: Axis| {
        component(entity.min, other) + COLLISION_EPSILON < component(obstacle.max, other)
            && component(entity.max, other) - COLLISION_EPSILON >= component(obstacle.min, other)
    };
    let [first, second] = axis.others();
    if !overlaps(first) || !overlaps(second) {
        return delta;
    }
    if delta > 0.0 {
        let gap = component(obstacle.min, axis) - component(entity.max, axis);
        if component(entity.max, axis) - COLLISION_EPSILON < component(obstacle.min, axis)
            && gap >= -COLLISION_EPSILON
        {
            return delta.min(gap);
        }
    } else {
        let gap = component(obstacle.max, axis) - component(entity.min, axis);
        if component(entity.min, axis) + COLLISION_EPSILON >= component(obstacle.max, axis)
            && gap <= COLLISION_EPSILON
        {
            return delta.max(gap);
        }
    }
    delta
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
        let mut delta = component(desired, axis);
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

fn component(value: Vec3, axis: Axis) -> f64 {
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
    fn pushes_back_an_entity_reaching_less_than_the_epsilon_into_a_box() {
        let entity = Aabb::new(Vec3::new(1.0, 0.0, 0.0), Vec3::new(2.00000005, 1.0, 1.0));
        let obstacle = box_at(2.0, 0.0, 0.0);

        assert_eq!(clip_axis(entity, obstacle, 0.5, Axis::X), 2.0 - 2.00000005);
        let reaching_back = Aabb::new(Vec3::new(-0.00000005, 0.0, 0.0), Vec3::new(1.0, 1.0, 1.0));
        let behind = box_at(-1.0, 0.0, 0.0);
        assert_eq!(clip_axis(reaching_back, behind, -0.5, Axis::X), 0.00000005);
    }

    #[test]
    fn ignores_a_box_overlapped_by_less_than_the_epsilon_on_another_axis() {
        let entity = Aabb::new(Vec3::new(0.0, 0.00000005, 0.0), Vec3::new(1.0, 1.00000005, 1.0));

        assert_eq!(clip_axis(entity, box_at(2.0, 1.0, 0.0), 2.5, Axis::X), 2.5);
        assert_eq!(clip_axis(entity, box_at(2.0, 0.0, 0.0), 2.5, Axis::X), 1.0);
        assert_eq!(clip_axis(entity, box_at(2.0, -1.0, 0.0), 2.5, Axis::X), 2.5);
    }

    #[test]
    fn matches_vanilla_equality_tolerance() {
        assert!(vanilla_equal(1.0, 1.0 + 0.5e-5));
        assert!(!vanilla_equal(1.0, 1.0 + 2.0e-5));
        assert!(vanilla_equal(0.0, 9.9999997e-6));
        assert!(!vanilla_equal(0.0, 9.9999998e-6));
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
