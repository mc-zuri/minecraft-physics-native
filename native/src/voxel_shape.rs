use crate::collision::Axis;
use crate::math::{Aabb, Vec3};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct VoxelShape {
    boxes: Vec<Aabb>,
}

impl VoxelShape {
    #[must_use]
    pub fn empty() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn from_box(bounds: Aabb) -> Self {
        Self {
            boxes: vec![bounds],
        }
    }

    #[must_use]
    pub fn union(shapes: &[Self]) -> Self {
        let mut boxes = Vec::new();
        for shape in shapes {
            for bounds in &shape.boxes {
                if !boxes.contains(bounds) {
                    boxes.push(*bounds);
                }
            }
        }
        Self { boxes }
    }

    #[must_use]
    pub fn boxes(&self) -> &[Aabb] {
        &self.boxes
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.boxes.is_empty()
    }

    #[must_use]
    pub fn bounds(&self) -> Option<Aabb> {
        let first = *self.boxes.first()?;
        let mut min = first.min;
        let mut max = first.max;
        for bounds in self.boxes.iter().skip(1) {
            min.x = min.x.min(bounds.min.x);
            min.y = min.y.min(bounds.min.y);
            min.z = min.z.min(bounds.min.z);
            max.x = max.x.max(bounds.max.x);
            max.y = max.y.max(bounds.max.y);
            max.z = max.z.max(bounds.max.z);
        }
        Some(Aabb::new(min, max))
    }

    #[must_use]
    pub fn collide(&self, axis: Axis, entity: Aabb, mut delta: f64) -> f64 {
        if self.is_empty() || delta.abs() < 1.0e-7 {
            return if self.is_empty() { delta } else { 0.0 };
        }
        for obstacle in &self.boxes {
            delta = crate::collision::clip_axis(entity, *obstacle, delta, axis);
        }
        delta
    }

    #[must_use]
    pub fn translated(&self, offset: Vec3) -> Self {
        Self {
            boxes: self
                .boxes
                .iter()
                .map(|bounds| bounds.translated(offset))
                .collect(),
        }
    }

    #[must_use]
    pub fn rotated_y_quarters(&self, quarters: u8) -> Self {
        self.rotated(quarters, rotate_y_quarter)
    }

    #[must_use]
    pub fn rotated_x_quarters(&self, quarters: u8) -> Self {
        self.rotated(quarters, rotate_x_quarter)
    }

    #[must_use]
    pub fn rotated_z_quarters(&self, quarters: u8) -> Self {
        self.rotated(quarters, rotate_z_quarter)
    }

    fn rotated(&self, quarters: u8, rotate: fn(Aabb) -> Aabb) -> Self {
        let turns = quarters % 4;
        let mut result = self.clone();
        for _ in 0..turns {
            result = Self {
                boxes: result.boxes.iter().map(|bounds| rotate(*bounds)).collect(),
            };
        }
        result
    }
}

fn bounds_from_corners(corners: [Vec3; 8]) -> Aabb {
    let mut min = corners[0];
    let mut max = corners[0];
    for corner in corners.iter().skip(1) {
        min.x = min.x.min(corner.x);
        min.y = min.y.min(corner.y);
        min.z = min.z.min(corner.z);
        max.x = max.x.max(corner.x);
        max.y = max.y.max(corner.y);
        max.z = max.z.max(corner.z);
    }
    Aabb::new(min, max)
}

fn rotate_y_quarter(bounds: Aabb) -> Aabb {
    let corners = [
        Vec3::new(bounds.min.x, bounds.min.y, bounds.min.z),
        Vec3::new(bounds.min.x, bounds.min.y, bounds.max.z),
        Vec3::new(bounds.min.x, bounds.max.y, bounds.min.z),
        Vec3::new(bounds.min.x, bounds.max.y, bounds.max.z),
        Vec3::new(bounds.max.x, bounds.min.y, bounds.min.z),
        Vec3::new(bounds.max.x, bounds.min.y, bounds.max.z),
        Vec3::new(bounds.max.x, bounds.max.y, bounds.min.z),
        Vec3::new(bounds.max.x, bounds.max.y, bounds.max.z),
    ];
    bounds_from_corners(corners.map(|corner| Vec3::new(1.0 - corner.z, corner.y, corner.x)))
}

fn rotate_x_quarter(bounds: Aabb) -> Aabb {
    let corners = [
        Vec3::new(bounds.min.x, bounds.min.y, bounds.min.z),
        Vec3::new(bounds.min.x, bounds.min.y, bounds.max.z),
        Vec3::new(bounds.min.x, bounds.max.y, bounds.min.z),
        Vec3::new(bounds.min.x, bounds.max.y, bounds.max.z),
        Vec3::new(bounds.max.x, bounds.min.y, bounds.min.z),
        Vec3::new(bounds.max.x, bounds.min.y, bounds.max.z),
        Vec3::new(bounds.max.x, bounds.max.y, bounds.min.z),
        Vec3::new(bounds.max.x, bounds.max.y, bounds.max.z),
    ];
    bounds_from_corners(corners.map(|corner| Vec3::new(corner.x, 1.0 - corner.z, corner.y)))
}

fn rotate_z_quarter(bounds: Aabb) -> Aabb {
    let corners = [
        Vec3::new(bounds.min.x, bounds.min.y, bounds.min.z),
        Vec3::new(bounds.min.x, bounds.min.y, bounds.max.z),
        Vec3::new(bounds.min.x, bounds.max.y, bounds.min.z),
        Vec3::new(bounds.min.x, bounds.max.y, bounds.max.z),
        Vec3::new(bounds.max.x, bounds.min.y, bounds.min.z),
        Vec3::new(bounds.max.x, bounds.min.y, bounds.max.z),
        Vec3::new(bounds.max.x, bounds.max.y, bounds.min.z),
        Vec3::new(bounds.max.x, bounds.max.y, bounds.max.z),
    ];
    bounds_from_corners(corners.map(|corner| Vec3::new(corner.y, 1.0 - corner.x, corner.z)))
}

#[cfg(test)]
mod tests {
    use super::VoxelShape;
    use crate::collision::Axis;
    use crate::math::{Aabb, Vec3};

    fn bounds(min: Vec3, max: Vec3) -> Aabb {
        Aabb::new(min, max)
    }

    #[test]
    fn union_preserves_indexed_boxes_and_deduplicates_exact_duplicates() {
        let box_a = bounds(Vec3::ZERO, Vec3::new(0.5, 1.0, 1.0));
        let box_b = bounds(Vec3::new(0.5, 0.0, 0.0), Vec3::new(1.0, 1.0, 1.0));
        let shape = VoxelShape::union(&[
            VoxelShape::from_box(box_a),
            VoxelShape::from_box(box_b),
            VoxelShape::from_box(box_a),
        ]);
        assert_eq!(shape.boxes(), &[box_a, box_b]);
        assert!(!shape.is_empty());
        assert_eq!(
            shape.bounds(),
            Some(bounds(Vec3::ZERO, Vec3::new(1.0, 1.0, 1.0)))
        );
        assert!(VoxelShape::empty().is_empty());
        assert_eq!(VoxelShape::empty().bounds(), None);
    }

    #[test]
    fn quarter_turn_rotates_box_about_block_center() {
        let shape =
            VoxelShape::from_box(bounds(Vec3::new(0.0, 0.0, 0.25), Vec3::new(0.5, 1.0, 0.75)));
        let rotated = shape.rotated_y_quarters(1);
        assert_eq!(
            rotated.boxes(),
            &[bounds(Vec3::new(0.25, 0.0, 0.0), Vec3::new(0.75, 1.0, 0.5))]
        );
    }

    #[test]
    fn x_and_z_quarter_turns_rotate_about_block_center() {
        let shape =
            VoxelShape::from_box(bounds(Vec3::new(0.0, 0.0, 0.25), Vec3::new(0.5, 0.5, 0.75)));
        assert_eq!(
            shape.rotated_x_quarters(1).boxes(),
            &[bounds(Vec3::new(0.0, 0.25, 0.0), Vec3::new(0.5, 0.75, 0.5))]
        );
        assert_eq!(
            shape.rotated_z_quarters(1).boxes(),
            &[bounds(Vec3::new(0.0, 0.5, 0.25), Vec3::new(0.5, 1.0, 0.75))]
        );
    }

    #[test]
    fn collide_applies_each_indexed_box_and_preserves_empty_shape_motion() {
        let entity = bounds(Vec3::ZERO, Vec3::new(1.0, 1.0, 1.0));
        let shape =
            VoxelShape::from_box(bounds(Vec3::new(2.0, 0.0, 0.0), Vec3::new(3.0, 1.0, 1.0)));
        assert_eq!(shape.collide(Axis::X, entity, 2.5), 1.0);
        assert_eq!(VoxelShape::empty().collide(Axis::X, entity, 2.5), 2.5);
    }
}
