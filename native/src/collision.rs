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

/// How Entity.collide steps up onto what blocks a horizontal movement.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StepUp {
    /// Until 1.20.6: the movement lifted by the step height, or after the highest lift the
    /// swept box allows, then lowered back.
    Lifted,
}

/// Entity.collide: the movement collided with the obstacles, stepping up when a grounded or
/// landing entity runs into something.
#[must_use]
pub fn collide(
    bounds: Aabb,
    movement: Vec3,
    obstacles: &[Aabb],
    on_ground: bool,
    max_step: f32,
    step_up: StepUp,
) -> Vec3 {
    let collided = if movement.length_squared() == 0.0 {
        movement
    } else {
        collide_bounding_box(bounds, movement, obstacles)
    };
    let landing = movement.y != collided.y && movement.y < 0.0;
    let blocked = movement.x != collided.x || movement.z != collided.z;
    if max_step <= 0.0 || !(on_ground || landing) || !blocked {
        return collided;
    }
    match step_up {
        StepUp::Lifted => lifted_step_up(bounds, movement, collided, obstacles, f64::from(max_step)),
    }
}

fn lifted_step_up(
    bounds: Aabb,
    movement: Vec3,
    collided: Vec3,
    obstacles: &[Aabb],
    max_step: f64,
) -> Vec3 {
    let horizontal = Vec3::new(movement.x, 0.0, movement.z);
    let mut stepped =
        collide_bounding_box(bounds, Vec3::new(movement.x, max_step, movement.z), obstacles);
    let lift = collide_bounding_box(
        bounds.expand_towards(horizontal),
        Vec3::new(0.0, max_step, 0.0),
        obstacles,
    );
    if lift.y < max_step {
        let lifted = collide_bounding_box(bounds.translated(lift), horizontal, obstacles) + lift;
        if lifted.horizontal_length_squared() > stepped.horizontal_length_squared() {
            stepped = lifted;
        }
    }
    if stepped.horizontal_length_squared() <= collided.horizontal_length_squared() {
        return collided;
    }
    let lowering = Vec3::new(0.0, -stepped.y + movement.y, 0.0);
    stepped + collide_bounding_box(bounds.translated(stepped), lowering, obstacles)
}

fn collide_bounding_box(bounds: Aabb, movement: Vec3, obstacles: &[Aabb]) -> Vec3 {
    let colliders = colliders_in(obstacles, bounds.expand_towards(movement));
    collide_with_shapes(movement, bounds, &colliders)
}

fn colliders_in(obstacles: &[Aabb], query: Aabb) -> Vec<Aabb> {
    obstacles.iter().copied().filter(|obstacle| obstacle.intersects(query)).collect()
}

fn collide_with_shapes(movement: Vec3, bounds: Aabb, colliders: &[Aabb]) -> Vec3 {
    if colliders.is_empty() {
        return movement;
    }
    let mut entity = bounds;
    let Vec3 { mut x, mut y, mut z } = movement;
    if y != 0.0 {
        y = shapes_collide(Axis::Y, entity, colliders, y);
        if y != 0.0 {
            entity = entity.translated(Vec3::new(0.0, y, 0.0));
        }
    }
    let z_first = x.abs() < z.abs();
    if z_first && z != 0.0 {
        z = shapes_collide(Axis::Z, entity, colliders, z);
        if z != 0.0 {
            entity = entity.translated(Vec3::new(0.0, 0.0, z));
        }
    }
    if x != 0.0 {
        x = shapes_collide(Axis::X, entity, colliders, x);
        if !z_first && x != 0.0 {
            entity = entity.translated(Vec3::new(x, 0.0, 0.0));
        }
    }
    if !z_first && z != 0.0 {
        z = shapes_collide(Axis::Z, entity, colliders, z);
    }
    Vec3::new(x, y, z)
}

fn shapes_collide(axis: Axis, entity: Aabb, colliders: &[Aabb], mut delta: f64) -> f64 {
    for collider in colliders {
        if delta.abs() < COLLISION_EPSILON {
            return 0.0;
        }
        delta = clip_axis(entity, *collider, delta, axis);
    }
    delta
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
    use super::{clip_axis, collide, resolve_motion, vanilla_equal, Axis, StepUp};
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

    fn half_block_step() -> Aabb {
        Aabb::new(Vec3::new(1.0, 0.0, 0.0), Vec3::new(2.0, 0.5, 1.0))
    }

    #[test]
    fn lifted_step_up_climbs_the_obstacle_and_lowers_back_onto_it() {
        let entity = box_at(0.0, 0.0, 0.0);
        let movement = Vec3::new(1.5, 0.0, 0.0);

        let motion = collide(entity, movement, &[half_block_step()], true, 1.0, StepUp::Lifted);

        assert_eq!(motion, Vec3::new(1.5, 0.5, 0.0));
    }

    #[test]
    fn lifted_step_up_of_a_landing_starts_from_the_box_before_the_fall() {
        let entity = Aabb::new(Vec3::new(0.0, 0.1, 0.0), Vec3::new(1.0, 1.1, 1.0));
        let obstacles = [box_at(0.0, -1.0, 0.0), box_at(1.0, -1.0, 0.0), half_block_step()];
        let movement = Vec3::new(0.5, -0.3, 0.0);

        let motion = collide(entity, movement, &obstacles, false, 0.6, StepUp::Lifted);

        let step = f64::from(0.6_f32);
        assert_eq!(motion, Vec3::new(0.5, step + (0.5 - (0.1 + step)), 0.0));
    }

    #[test]
    fn lifted_step_up_keeps_the_straight_lift_when_it_goes_further() {
        let entity = box_at(0.0, 0.0, 0.0);
        let ceiling = Aabb::new(Vec3::new(1.2, 1.3, 0.0), Vec3::new(3.0, 2.3, 1.0));
        let obstacles = [box_at(0.0, -1.0, 0.0), box_at(1.0, -1.0, 0.0), half_block_step(), ceiling];
        let movement = Vec3::new(0.5, -0.0784, 0.0);

        let motion = collide(entity, movement, &obstacles, true, 0.6, StepUp::Lifted);

        let step = f64::from(0.6_f32);
        assert_eq!(motion, Vec3::new(1.2 - 1.0, step + (0.5 - step), 0.0));
    }

    #[test]
    fn keeps_a_negligible_movement_with_no_obstacle_near_the_swept_box() {
        let entity = box_at(0.0, 0.0, 0.0);
        let movement = Vec3::new(0.5e-7, 0.0, 0.0);
        let far = [box_at(5.0, 0.0, 0.0)];
        let near = [box_at(1.0, 0.0, 0.0)];

        assert_eq!(collide(entity, movement, &far, false, 0.6, StepUp::Lifted), movement);
        assert_eq!(collide(entity, movement, &near, false, 0.6, StepUp::Lifted), Vec3::ZERO);
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
