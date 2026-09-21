use crate::math::{abs_max, Aabb, Vec3};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Dimensions {
    pub half_width: f64,
    pub height: f64,
}

impl Dimensions {
    #[must_use]
    pub const fn new(half_width: f64, height: f64) -> Self {
        Self { half_width, height }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct EntityFlags {
    pub on_ground: bool,
    pub horizontal_collision: bool,
    pub vertical_collision: bool,
    pub vertical_collision_below: bool,
    pub in_water: bool,
    pub in_lava: bool,
    pub climbing: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EntityState {
    pub position: Vec3,
    pub velocity: Vec3,
    pub dimensions: Dimensions,
    pub flags: EntityFlags,
}

impl EntityState {
    #[must_use]
    pub fn bounds(self) -> Aabb {
        Aabb::new(
            Vec3::new(
                self.position.x - self.dimensions.half_width,
                self.position.y,
                self.position.z - self.dimensions.half_width,
            ),
            Vec3::new(
                self.position.x + self.dimensions.half_width,
                self.position.y + self.dimensions.height,
                self.position.z + self.dimensions.half_width,
            ),
        )
    }
}

#[must_use]
pub fn entity_push_impulses(
    left_position: Vec3,
    right_position: Vec3,
    left_no_physics: bool,
    right_no_physics: bool,
    passenger_of_same_vehicle: bool,
    left_vehicle: bool,
    right_vehicle: bool,
    left_pushable: bool,
    right_pushable: bool,
) -> (Vec3, Vec3) {
    entity_push_impulses_with_pushthrough(
        left_position,
        right_position,
        left_no_physics,
        right_no_physics,
        passenger_of_same_vehicle,
        left_vehicle,
        right_vehicle,
        left_pushable,
        right_pushable,
        0.0,
        0.0,
    )
}

#[must_use]
pub fn entity_push_impulses_with_pushthrough(
    left_position: Vec3,
    right_position: Vec3,
    left_no_physics: bool,
    right_no_physics: bool,
    passenger_of_same_vehicle: bool,
    left_vehicle: bool,
    right_vehicle: bool,
    left_pushable: bool,
    right_pushable: bool,
    left_pushthrough: f64,
    right_pushthrough: f64,
) -> (Vec3, Vec3) {
    // Entity.push(Entity) skips entities that are passengers of the same vehicle.
    if passenger_of_same_vehicle
        || left_no_physics
        || right_no_physics
        || !left_position.is_finite()
        || !right_position.is_finite()
    {
        return (Vec3::ZERO, Vec3::ZERO);
    }
    let mut x = right_position.x - left_position.x;
    let mut z = right_position.z - left_position.z;
    let distance = abs_max(x, z);
    if distance < 0.01 || !distance.is_finite() {
        return (Vec3::ZERO, Vec3::ZERO);
    }
    let distance = distance.sqrt();
    let scale = (1.0 / distance).min(1.0);
    x = (x / distance) * scale * 0.05_f32 as f64;
    z = (z / distance) * scale * 0.05_f32 as f64;
    let left_pushthrough_scale = 1.0 - left_pushthrough;
    let right_pushthrough_scale = 1.0 - right_pushthrough;
    let left_impulse = if !left_vehicle && left_pushable {
        Vec3::new(-x * left_pushthrough_scale, 0.0, -z * left_pushthrough_scale)
    } else {
        Vec3::ZERO
    };
    let right_impulse = if !right_vehicle && right_pushable {
        Vec3::new(x * right_pushthrough_scale, 0.0, z * right_pushthrough_scale)
    } else {
        Vec3::ZERO
    };
    (left_impulse, right_impulse)
}

#[cfg(test)]
mod tests {
    use super::{
        entity_push_impulses, entity_push_impulses_with_pushthrough, Dimensions, EntityState,
    };
    use crate::math::Vec3;

    #[test]
    fn computes_entity_bounds_from_position() {
        let entity = EntityState {
            position: Vec3::new(2.0, 3.0, 4.0),
            velocity: Vec3::ZERO,
            dimensions: Dimensions::new(0.3, 1.8),
            flags: Default::default(),
        };

        assert_eq!(entity.bounds().min, Vec3::new(1.7, 3.0, 3.7));
        assert_eq!(entity.bounds().max, Vec3::new(2.3, 4.8, 4.3));
    }

    #[test]
    fn entity_push_matches_vanilla_horizontal_impulse() {
        let (left, right) = entity_push_impulses(
            Vec3::ZERO,
            Vec3::new(1.0, 4.0, 0.0),
            false,
            false,
            false,
            false,
            false,
            true,
            true,
        );
        assert_eq!(left, Vec3::new(-0.05_f32 as f64, 0.0, -0.0));
        assert_eq!(right, Vec3::new(0.05_f32 as f64, 0.0, 0.0));
    }

    #[test]
    fn entity_push_respects_threshold_and_gates() {
        assert_eq!(
            entity_push_impulses(
                Vec3::ZERO,
                Vec3::new(0.009, 0.0, 0.0),
                false,
                false,
                false,
                false,
                false,
                true,
                true,
            ),
            (Vec3::ZERO, Vec3::ZERO)
        );
        assert_eq!(
            entity_push_impulses(
                Vec3::ZERO,
                Vec3::new(1.0, 0.0, 0.0),
                true,
                false,
                false,
                false,
                false,
                true,
                true,
            ),
            (Vec3::ZERO, Vec3::ZERO)
        );
    }

    #[test]
    fn entity_push_skips_passengers_of_same_vehicle() {
        assert_eq!(
            entity_push_impulses(
                Vec3::ZERO,
                Vec3::new(1.0, 0.0, 0.0),
                false,
                false,
                true,
                false,
                false,
                true,
                true,
            ),
            (Vec3::ZERO, Vec3::ZERO)
        );
    }

    #[test]
    fn entity_push_preserves_vanilla_double_precision_after_float_impulse_constant() {
        let (left, right) = entity_push_impulses(
            Vec3::ZERO,
            Vec3::new(3.0, 0.0, 4.0),
            false,
            false,
            false,
            false,
            false,
            true,
            true,
        );
        let impulse = 0.05_f32 as f64;
        assert_eq!(left, Vec3::new(-0.75 * impulse, 0.0, -1.0 * impulse));
        assert_eq!(right, Vec3::new(0.75 * impulse, 0.0, 1.0 * impulse));
    }

    #[test]
    fn entity_push_applies_source_pushthrough_to_both_impulses() {
        let (left, right) = entity_push_impulses_with_pushthrough(
            Vec3::ZERO,
            Vec3::new(1.0, 0.0, 0.0),
            false,
            false,
            false,
            false,
            false,
            true,
            true,
            0.4,
            0.2,
        );
        let left_impulse = 0.05_f32 as f64 * 0.6;
        let right_impulse = 0.05_f32 as f64 * 0.8;
        assert_eq!(left, Vec3::new(-left_impulse, 0.0, 0.0));
        assert_eq!(right, Vec3::new(right_impulse, 0.0, 0.0));
    }

    #[test]
    fn entity_push_uses_independent_pushthrough_on_each_side() {
        let (left, right) = entity_push_impulses_with_pushthrough(
            Vec3::ZERO,
            Vec3::new(1.0, 0.0, 0.0),
            false,
            false,
            false,
            false,
            false,
            true,
            true,
            0.75,
            0.25,
        );
        let left_impulse = 0.05_f32 as f64 * 0.25;
        let right_impulse = 0.05_f32 as f64 * 0.75;
        assert_eq!(left, Vec3::new(-left_impulse, 0.0, 0.0));
        assert_eq!(right, Vec3::new(right_impulse, 0.0, 0.0));
    }
}
