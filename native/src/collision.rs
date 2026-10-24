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
    /// From 1.21: the movement lifted to each height of a collider's faces within the step,
    /// lowest first, until one goes further.
    CandidateHeights,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CollisionRules {
    pub step_up: StepUp,
    /// Until 1.17 the world border's shape is a collider wherever the entity is inside it, so
    /// a movement always meets a collider, even one that sweeps no block.
    pub border_always_collides: bool,
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
    rules: CollisionRules,
) -> Vec3 {
    let border = rules.border_always_collides;
    let collided = if movement.length_squared() == 0.0 {
        movement
    } else {
        collide_bounding_box(bounds, movement, obstacles, border)
    };
    let landing = movement.y != collided.y && movement.y < 0.0;
    let blocked = movement.x != collided.x || movement.z != collided.z;
    if max_step <= 0.0 || !(on_ground || landing) || !blocked {
        return collided;
    }
    match rules.step_up {
        StepUp::Lifted => {
            let colliders = |bounds: Aabb, movement: Vec3| {
                collide_bounding_box(bounds, movement, obstacles, border)
            };
            lifted_step_up(bounds, movement, collided, colliders, f64::from(max_step))
        }
        StepUp::CandidateHeights => {
            candidate_step_up(bounds, movement, collided, landing, obstacles, max_step)
        }
    }
}

fn lifted_step_up(
    bounds: Aabb,
    movement: Vec3,
    collided: Vec3,
    collide_bounding_box: impl Fn(Aabb, Vec3) -> Vec3,
    max_step: f64,
) -> Vec3 {
    let horizontal = Vec3::new(movement.x, 0.0, movement.z);
    let mut stepped = collide_bounding_box(bounds, Vec3::new(movement.x, max_step, movement.z));
    let lift = collide_bounding_box(
        bounds.expand_towards(horizontal),
        Vec3::new(0.0, max_step, 0.0),
    );
    if lift.y < max_step {
        let lifted = collide_bounding_box(bounds.translated(lift), horizontal) + lift;
        if lifted.horizontal_length_squared() > stepped.horizontal_length_squared() {
            stepped = lifted;
        }
    }
    if stepped.horizontal_length_squared() <= collided.horizontal_length_squared() {
        return collided;
    }
    let lowering = Vec3::new(0.0, -stepped.y + movement.y, 0.0);
    stepped + collide_bounding_box(bounds.translated(stepped), lowering)
}

fn candidate_step_up(
    bounds: Aabb,
    movement: Vec3,
    collided: Vec3,
    landing: bool,
    obstacles: &[Aabb],
    max_step: f32,
) -> Vec3 {
    let grounded = if landing {
        bounds.translated(Vec3::new(0.0, collided.y, 0.0))
    } else {
        bounds
    };
    let mut query = grounded.expand_towards(Vec3::new(movement.x, f64::from(max_step), movement.z));
    if !landing {
        query = query.expand_towards(Vec3::new(0.0, -9.999999747378752e-6, 0.0));
    }
    let colliders = block_shapes_in(obstacles, query);
    for height in candidate_step_heights(grounded, &colliders, max_step, collided.y as f32) {
        let lifted = Vec3::new(movement.x, f64::from(height), movement.z);
        let stepped = collide_with_shapes(lifted, grounded, &colliders, false);
        if stepped.horizontal_length_squared() > collided.horizontal_length_squared() {
            let distance_to_ground = bounds.min.y - grounded.min.y;
            return stepped + Vec3::new(0.0, -distance_to_ground, 0.0);
        }
    }
    collided
}

fn candidate_step_heights(
    grounded: Aabb,
    colliders: &[Aabb],
    max_step: f32,
    skipped: f32,
) -> Vec<f32> {
    let mut heights: Vec<f32> = Vec::new();
    for collider in colliders {
        for coordinate in y_coordinates(*collider) {
            let height = (coordinate - grounded.min.y) as f32;
            if height < 0.0 || height == skipped {
                continue;
            }
            if height > max_step {
                break;
            }
            if !heights.contains(&height) {
                heights.push(height);
            }
        }
    }
    heights.sort_by(f32::total_cmp);
    heights
}

/// VoxelShape.getCoords(Y) of a block's box: the grid lines of a box aligned to eighths of its
/// block (Shapes.create), else its bottom and top.
fn y_coordinates(collider: Aabb) -> Vec<f64> {
    let origin = block_origin(collider);
    let local = Aabb::new(collider.min - origin, collider.max - origin);
    let aligned = [
        grid_bits(local.min.x, local.max.x),
        grid_bits(local.min.y, local.max.y),
        grid_bits(local.min.z, local.max.z),
    ];
    match aligned {
        [Some(_), Some(bits), Some(_)] => {
            let parts = 1_u32 << bits;
            (0..=parts)
                .map(|line| f64::from(line) / f64::from(parts) + origin.y)
                .collect()
        }
        _ => vec![collider.min.y, collider.max.y],
    }
}

fn grid_bits(min: f64, max: f64) -> Option<u32> {
    if min < -1.0e-7 || max > 1.0000001 {
        return None;
    }
    (0..=3).find(|bits| {
        let parts = f64::from(1_u32 << bits);
        let aligned = |value: f64| {
            let scaled = value * parts;
            (scaled - scaled.round()).abs() < 1.0e-7 * parts
        };
        aligned(min) && aligned(max)
    })
}

fn block_origin(collider: Aabb) -> Vec3 {
    Vec3::new(
        collider.min.x.floor(),
        collider.min.y.floor(),
        collider.min.z.floor(),
    )
}

/// BlockCollisions: the whole shape of every block with a box meeting the query.
fn block_shapes_in(obstacles: &[Aabb], query: Aabb) -> Vec<Aabb> {
    let blocks: Vec<Vec3> = obstacles
        .iter()
        .filter(|obstacle| obstacle.intersects(query))
        .map(|obstacle| block_origin(*obstacle))
        .collect();
    obstacles
        .iter()
        .copied()
        .filter(|obstacle| blocks.contains(&block_origin(*obstacle)))
        .collect()
}

fn collide_bounding_box(bounds: Aabb, movement: Vec3, obstacles: &[Aabb], border: bool) -> Vec3 {
    let colliders = colliders_in(obstacles, bounds.expand_towards(movement));
    collide_with_shapes(movement, bounds, &colliders, border)
}

fn colliders_in(obstacles: &[Aabb], query: Aabb) -> Vec<Aabb> {
    obstacles
        .iter()
        .copied()
        .filter(|obstacle| obstacle.intersects(query))
        .collect()
}

fn collide_with_shapes(movement: Vec3, bounds: Aabb, colliders: &[Aabb], border: bool) -> Vec3 {
    if colliders.is_empty() && !border {
        return movement;
    }
    let mut entity = bounds;
    let Vec3 {
        mut x,
        mut y,
        mut z,
    } = movement;
    if y != 0.0 {
        y = shapes_collide(Axis::Y, entity, colliders, border, y);
        if y != 0.0 {
            entity = entity.translated(Vec3::new(0.0, y, 0.0));
        }
    }
    let z_first = x.abs() < z.abs();
    if z_first && z != 0.0 {
        z = shapes_collide(Axis::Z, entity, colliders, border, z);
        if z != 0.0 {
            entity = entity.translated(Vec3::new(0.0, 0.0, z));
        }
    }
    if x != 0.0 {
        x = shapes_collide(Axis::X, entity, colliders, border, x);
        if !z_first && x != 0.0 {
            entity = entity.translated(Vec3::new(x, 0.0, 0.0));
        }
    }
    if !z_first && z != 0.0 {
        z = shapes_collide(Axis::Z, entity, colliders, border, z);
    }
    Vec3::new(x, y, z)
}

fn shapes_collide(
    axis: Axis,
    entity: Aabb,
    colliders: &[Aabb],
    border: bool,
    mut delta: f64,
) -> f64 {
    if border && delta.abs() < COLLISION_EPSILON {
        return 0.0;
    }
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
    use super::{
        block_shapes_in, clip_axis, collide, resolve_motion, vanilla_equal, y_coordinates, Axis,
        CollisionRules, StepUp,
    };
    use crate::math::{Aabb, Vec3};

    const LIFTED: CollisionRules = CollisionRules {
        step_up: StepUp::Lifted,
        border_always_collides: false,
    };
    const CANDIDATE_HEIGHTS: CollisionRules = CollisionRules {
        step_up: StepUp::CandidateHeights,
        border_always_collides: false,
    };

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

        let motion = collide(entity, movement, &[half_block_step()], true, 1.0, LIFTED);

        assert_eq!(motion, Vec3::new(1.5, 0.5, 0.0));
    }

    #[test]
    fn lifted_step_up_of_a_landing_starts_from_the_box_before_the_fall() {
        let entity = Aabb::new(Vec3::new(0.0, 0.1, 0.0), Vec3::new(1.0, 1.1, 1.0));
        let obstacles = [
            box_at(0.0, -1.0, 0.0),
            box_at(1.0, -1.0, 0.0),
            half_block_step(),
        ];
        let movement = Vec3::new(0.5, -0.3, 0.0);

        let motion = collide(entity, movement, &obstacles, false, 0.6, LIFTED);

        let step = f64::from(0.6_f32);
        assert_eq!(motion, Vec3::new(0.5, step + (0.5 - (0.1 + step)), 0.0));
    }

    #[test]
    fn lifted_step_up_keeps_the_straight_lift_when_it_goes_further() {
        let entity = box_at(0.0, 0.0, 0.0);
        let ceiling = Aabb::new(Vec3::new(1.2, 1.3, 0.0), Vec3::new(3.0, 2.3, 1.0));
        let obstacles = [
            box_at(0.0, -1.0, 0.0),
            box_at(1.0, -1.0, 0.0),
            half_block_step(),
            ceiling,
        ];
        let movement = Vec3::new(0.5, -0.0784, 0.0);

        let motion = collide(entity, movement, &obstacles, true, 0.6, LIFTED);

        let step = f64::from(0.6_f32);
        assert_eq!(motion, Vec3::new(1.2 - 1.0, step + (0.5 - step), 0.0));
    }

    #[test]
    fn candidate_step_up_lifts_to_the_lowest_face_that_clears_the_way() {
        let entity = box_at(0.0, 0.0, 0.0);
        let step = Aabb::new(Vec3::new(1.0, 0.0, 0.0), Vec3::new(2.0, 0.125, 1.0));
        let ceiling = Aabb::new(Vec3::new(1.0, 1.2, 0.0), Vec3::new(2.0, 2.2, 1.0));
        let obstacles = [
            box_at(0.0, -1.0, 0.0),
            box_at(1.0, -1.0, 0.0),
            step,
            ceiling,
        ];
        let jump = Vec3::new(0.3, 0.42, 0.0);

        let modern = collide(entity, jump, &obstacles, true, 0.6, CANDIDATE_HEIGHTS);
        let legacy = collide(entity, jump, &obstacles, true, 0.6, LIFTED);

        assert_eq!(modern, Vec3::new(0.3, 0.125, 0.0));
        assert!(legacy.y > 0.19);
    }

    #[test]
    fn candidate_step_up_of_a_landing_counts_from_the_ground() {
        let entity = Aabb::new(Vec3::new(0.0, 0.05, 0.0), Vec3::new(1.0, 1.05, 1.0));
        let obstacles = [
            box_at(0.0, -1.0, 0.0),
            box_at(1.0, -1.0, 0.0),
            half_block_step(),
        ];
        let movement = Vec3::new(0.3, -0.1, 0.0);

        let motion = collide(entity, movement, &obstacles, false, 0.6, CANDIDATE_HEIGHTS);

        assert_eq!(motion, Vec3::new(0.3, 0.5 + -(0.05 - (0.05 + -0.05)), 0.0));
    }

    #[test]
    fn step_heights_come_from_the_voxel_grid_of_a_block_box() {
        let slab = Aabb::new(Vec3::new(3.0, 64.0, 5.0), Vec3::new(4.0, 64.5, 6.0));
        let fence = Aabb::new(Vec3::new(3.375, 64.0, 5.375), Vec3::new(3.625, 65.5, 5.625));
        let carpet = Aabb::new(Vec3::new(3.0, 64.0, 5.0), Vec3::new(4.0, 64.0625, 6.0));

        assert_eq!(y_coordinates(slab), vec![64.0, 64.5, 65.0]);
        assert_eq!(y_coordinates(fence), vec![64.0, 65.5]);
        assert_eq!(y_coordinates(carpet), vec![64.0, 64.0625]);
    }

    #[test]
    fn a_block_meeting_the_query_brings_its_whole_shape() {
        let floor = Aabb::new(Vec3::new(3.0, 64.0, 5.0), Vec3::new(4.0, 64.125, 6.0));
        let wall = Aabb::new(Vec3::new(3.0, 64.0, 5.0), Vec3::new(3.125, 65.0, 6.0));
        let elsewhere = box_at(7.0, 64.0, 5.0);
        let query = Aabb::new(Vec3::new(2.5, 64.5, 5.0), Vec3::new(3.1, 65.5, 6.0));

        assert_eq!(
            block_shapes_in(&[floor, wall, elsewhere], query),
            vec![floor, wall]
        );
    }

    #[test]
    fn keeps_a_negligible_movement_with_no_obstacle_near_the_swept_box() {
        let entity = box_at(0.0, 0.0, 0.0);
        let movement = Vec3::new(0.5e-7, 0.0, 0.0);
        let far = [box_at(5.0, 0.0, 0.0)];
        let near = [box_at(1.0, 0.0, 0.0)];

        assert_eq!(
            collide(entity, movement, &far, false, 0.6, LIFTED),
            movement
        );
        assert_eq!(
            collide(entity, movement, &near, false, 0.6, LIFTED),
            Vec3::ZERO
        );
    }

    #[test]
    fn the_world_border_drops_a_negligible_movement_until_1_18() {
        let entity = box_at(0.0, 0.0, 0.0);
        let movement = Vec3::new(0.5e-7, 0.0, 0.0);
        let bordered = CollisionRules {
            border_always_collides: true,
            ..LIFTED
        };

        assert_eq!(
            collide(entity, movement, &[], false, 0.6, bordered),
            Vec3::ZERO
        );
        assert_eq!(collide(entity, movement, &[], false, 0.6, LIFTED), movement);
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
        let entity = Aabb::new(
            Vec3::new(0.0, 0.00000005, 0.0),
            Vec3::new(1.0, 1.00000005, 1.0),
        );

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
