use crate::math::{Aabb, Vec3};
use crate::world::WorldSnapshot;

/// The vanilla `ThrowableProjectile.tick` integration from 26.2:
/// gravity, inertia, move-vector hit test, then position update.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectileKind {
    Generic,
    Snowball,
    Egg,
    EnderPearl,
    Potion,
    ExperienceBottle,
    Firework,
    FishingHook,
    SpectralArrow,
    TippedArrow,
    Arrow,
    Trident,
    SmallFireball,
    Fireball,
    WitherSkull,
    DragonFireball,
    LlamaSpit,
    ShulkerBullet,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProjectileState {
    pub position: Vec3,
    pub velocity: Vec3,
    pub gravity: f64,
    pub air_drag: f64,
    pub power: Vec3,
    pub in_water: bool,
    pub first_tick: bool,
    pub kind: ProjectileKind,
    pub horizontal_collision: bool,
    pub shot_at_angle: bool,
}

impl ProjectileState {
    #[must_use]
    pub const fn new(position: Vec3, velocity: Vec3) -> Self {
        Self {
            position,
            velocity,
            gravity: ProjectileKind::Generic.default_gravity(),
            air_drag: ProjectileKind::Generic.default_air_drag(),
            power: Vec3::ZERO,
            in_water: false,
            first_tick: true,
            kind: ProjectileKind::Generic,
            horizontal_collision: false,
            shot_at_angle: false,
        }
    }

    #[must_use]
    pub const fn for_kind(kind: ProjectileKind, position: Vec3, velocity: Vec3) -> Self {
        Self {
            position,
            velocity,
            gravity: kind.default_gravity(),
            air_drag: kind.default_air_drag(),
            power: Vec3::ZERO,
            in_water: false,
            first_tick: true,
            kind,
            horizontal_collision: false,
            shot_at_angle: false,
        }
    }
}

impl ProjectileKind {
    #[must_use]
    pub const fn default_gravity(self) -> f64 {
        match self {
            Self::Generic | Self::Snowball | Self::Egg | Self::EnderPearl => 0.03,
            Self::Potion => 0.05,
            Self::ExperienceBottle => 0.07,
            Self::Firework => 0.0,
            Self::FishingHook => 0.03,
            Self::SpectralArrow | Self::TippedArrow | Self::Arrow | Self::Trident => 0.05,
            Self::SmallFireball | Self::Fireball | Self::WitherSkull | Self::DragonFireball => 0.0,
            Self::LlamaSpit => 0.06,
            Self::ShulkerBullet => 0.04,
        }
    }

    #[must_use]
    pub const fn default_air_drag(self) -> f64 {
        match self {
            Self::Firework | Self::ShulkerBullet => 1.0,
            Self::SmallFireball
            | Self::Fireball
            | Self::WitherSkull
            | Self::DragonFireball => 0.95,
            Self::FishingHook => 0.92,
            _ => 0.99_f32 as f64,
        }
    }

    #[must_use]
    pub fn normalize_name(name: &str) -> String {
        let mut normalized = name.trim().to_ascii_lowercase();
        for prefix in ["minecraft:", "entity:", "minecraft.", "entity."] {
            if normalized.starts_with(prefix) {
                normalized = normalized[prefix.len()..].to_owned();
            }
        }
        normalized = normalized
            .replace(' ', "_")
            .replace('-', "_")
            .replace('.', "_")
            .replace('/', "_")
            .replace('\\', "_")
            .replace(':', "_");
        while normalized.contains("__") {
            normalized = normalized.replace("__", "_");
        }
        normalized = normalized.trim_matches('_').to_owned();
        if normalized.starts_with("entity_") {
            normalized = normalized.strip_prefix("entity_").unwrap().to_owned();
        }
        if normalized.ends_with("_entity") {
            normalized = normalized.strip_suffix("_entity").unwrap().to_owned();
        }
        normalized
    }

    #[must_use]
    pub fn from_name(name: &str) -> Self {
        let key = Self::normalize_name(name);
        match key.as_str() {
            "snowball" | "thrown_snowball" | "thrownsnowball" => Self::Snowball,
            "egg" | "thrown_egg" | "thrownegg" => Self::Egg,
            "ender_pearl" | "enderpearl" | "thrown_ender_pearl" | "thrownenderpearl"
            | "ender_pearl_entity" => Self::EnderPearl,
            "potion" | "thrown_potion" | "thrownpotion" => Self::Potion,
            "experience_bottle" | "experiencebottle" | "xp_bottle" | "xpbottle"
            | "exp_bottle" | "expbottle" | "thrown_experience" | "thrownexperience"
            | "experience_bottle_entity" => Self::ExperienceBottle,
            "firework" | "firework_rocket" | "fireworkrocket" | "firework_rocket_entity"
            | "fireworkrocketentity" => Self::Firework,
            "fishing_hook" | "fishinghook" | "fishing_rod_hook" | "fishingrodhook" => {
                Self::FishingHook
            }
            "spectral_arrow" | "spectralarrow" | "spectral_arrow_entity" => Self::SpectralArrow,
            "tipped_arrow" | "tippedarrow" | "tipped_arrow_entity" => Self::TippedArrow,
            "arrow" | "thrown_arrow" | "thrownarrow" | "arrow_entity" => Self::Arrow,
            "trident" | "thrown_trident" | "throwntrident" | "trident_entity" => Self::Trident,
            "small_fireball" | "smallfireball" | "fire_charge" | "firecharge"
            | "small_fireball_entity" | "fire_charge_entity" => Self::SmallFireball,
            "fireball" | "large_fireball" | "largefireball" | "big_fireball" | "bigfireball"
            | "large_fireball_entity" | "fireball_entity" => Self::Fireball,
            "wither_skull" | "witherskull" | "wither_skull_entity" => Self::WitherSkull,
            "dragon_fireball" | "dragonfireball" | "dragon_fireball_entity" => Self::DragonFireball,
            "llama_spit" | "llamaspit" | "llama_spit_entity" => Self::LlamaSpit,
            "shulker_bullet" | "shulkerbullet" | "shulker_bullet_entity" => Self::ShulkerBullet,
            _ => Self::Generic,
        }
    }

    #[must_use]
    pub fn from_name_checked(name: &str) -> Option<Self> {
        let kind = Self::from_name(name);
        (kind != Self::Generic).then_some(kind)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProjectileTickResult {
    pub position: Vec3,
    pub velocity: Vec3,
    pub block_hit: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ArrowState {
    pub position: Vec3,
    pub velocity: Vec3,
    pub gravity: f64,
    pub air_drag: f64,
    pub water_inertia: f64,
    pub in_water: bool,
    pub in_ground: bool,
    pub life: u16,
    pub in_ground_time: u32,
    pub shake_time: u8,
    pub fall_impulse: Vec3,
    pub last_block_id: Option<u32>,
}

impl ArrowState {
    #[must_use]
    pub const fn new(position: Vec3, velocity: Vec3) -> Self {
        Self {
            position,
            velocity,
            gravity: 0.05,
            air_drag: 0.99_f32 as f64,
            water_inertia: 0.6_f32 as f64,
            in_water: false,
            in_ground: false,
            life: 0,
            in_ground_time: 0,
            shake_time: 0,
            fall_impulse: Vec3::new(0.0, 0.0, 0.0),
            last_block_id: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ArrowTickResult {
    pub position: Vec3,
    pub velocity: Vec3,
    pub block_hit: bool,
    pub in_ground: bool,
    pub discarded: bool,
    pub in_ground_time: u32,
    pub shake_time: u8,
    pub started_falling: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TridentState {
    pub position: Vec3,
    pub velocity: Vec3,
    pub gravity: f64,
    pub air_drag: f64,
    pub water_inertia: f64,
    pub in_water: bool,
    pub dealt_damage: bool,
}

impl TridentState {
    #[must_use]
    pub const fn new(position: Vec3, velocity: Vec3) -> Self {
        Self {
            position,
            velocity,
            gravity: 0.05,
            air_drag: 0.99_f32 as f64,
            water_inertia: 0.99_f32 as f64,
            in_water: false,
            dealt_damage: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TridentTickResult {
    pub position: Vec3,
    pub velocity: Vec3,
    pub block_hit: bool,
}

#[must_use]
pub fn tick_trident(state: &mut TridentState, world: &WorldSnapshot) -> TridentTickResult {
    if state.in_water {
        state.velocity = state.velocity.scale(state.water_inertia);
    }

    state.velocity.y -= state.gravity;
    let inertia = if state.in_water {
        state.water_inertia
    } else {
        state.air_drag
    };
    state.velocity = state.velocity.scale(inertia);

    let start = state.position;
    let end = start + state.velocity;
    let sweep = Aabb::new(
        Vec3::new(start.x.min(end.x), start.y.min(end.y), start.z.min(end.z)),
        Vec3::new(start.x.max(end.x), start.y.max(end.y), start.z.max(end.z)),
    )
    .inflate(Vec3::new(1.0e-7, 1.0e-7, 1.0e-7));

    let mut nearest = None;
    for shape in world.collision_shapes(sweep) {
        if let Some(hit) = shape.clip_segment(start, end) {
            let distance = start.distance_squared(hit);
            if nearest.map_or(true, |(best, _)| distance < best) {
                nearest = Some((distance, hit));
            }
        }
    }

    if let Some((_, hit)) = nearest {
        state.position = hit;
        state.velocity = Vec3::ZERO;
        return TridentTickResult {
            position: hit,
            velocity: state.velocity,
            block_hit: true,
        };
    }

    state.position = end;
    TridentTickResult {
        position: state.position,
        velocity: state.velocity,
        block_hit: false,
    }
}

#[must_use]
pub fn tick_arrow(state: &mut ArrowState, world: &WorldSnapshot) -> ArrowTickResult {
    if state.in_ground {
        let block_position = (
            state.position.x.floor() as i32,
            state.position.y.floor() as i32,
            state.position.z.floor() as i32,
        );
        let current_block = world.block(block_position);
        let point =
            Aabb::new(state.position, state.position).inflate(Vec3::new(1.0e-7, 1.0e-7, 1.0e-7));
        if !world.collision_shapes(point).is_empty()
            && state.last_block_id == Some(current_block.id)
        {
            state.life = state.life.saturating_add(1);
            state.in_ground_time = state.in_ground_time.saturating_add(1);
            state.shake_time = state.shake_time.saturating_sub(1);
            return ArrowTickResult {
                position: state.position,
                velocity: Vec3::ZERO,
                block_hit: false,
                in_ground: true,
                discarded: state.life >= 1200,
                in_ground_time: state.in_ground_time,
                shake_time: state.shake_time,
                started_falling: false,
            };
        }
        state.in_ground = false;
        state.in_ground_time = 0;
        state.life = 0;
        state.velocity = state.velocity.multiply(state.fall_impulse);
        return ArrowTickResult {
            position: state.position,
            velocity: state.velocity,
            block_hit: false,
            in_ground: false,
            discarded: false,
            in_ground_time: state.in_ground_time,
            shake_time: state.shake_time,
            started_falling: true,
        };
    }

    if state.in_water {
        state.velocity = state.velocity.scale(state.water_inertia);
    }

    let start = state.position;
    let end = start + state.velocity;
    let sweep = Aabb::new(
        Vec3::new(start.x.min(end.x), start.y.min(end.y), start.z.min(end.z)),
        Vec3::new(start.x.max(end.x), start.y.max(end.y), start.z.max(end.z)),
    )
    .inflate(Vec3::new(1.0e-7, 1.0e-7, 1.0e-7));

    let mut nearest = None;
    for shape in world.collision_shapes(sweep) {
        if let Some(hit) = shape.clip_segment(start, end) {
            let distance = start.distance_squared(hit);
            if nearest.map_or(true, |(best, _)| distance < best) {
                nearest = Some((distance, hit));
            }
        }
    }

    if let Some((_, hit)) = nearest {
        state.position = hit;
        state.velocity = Vec3::ZERO;
        state.in_ground = true;
        state.in_ground_time = 1;
        state.shake_time = 7;
        state.last_block_id = Some(
            world
                .block((
                    hit.x.floor() as i32,
                    hit.y.floor() as i32,
                    hit.z.floor() as i32,
                ))
                .id,
        );
        return ArrowTickResult {
            position: hit,
            velocity: state.velocity,
            block_hit: true,
            in_ground: true,
            discarded: false,
            in_ground_time: state.in_ground_time,
            shake_time: state.shake_time,
            started_falling: false,
        };
    }

    state.position = end;
    state.in_ground_time = 0;
    state.shake_time = state.shake_time.saturating_sub(1);
    if !state.in_water {
        state.velocity = state.velocity.scale(state.air_drag);
    }
    if !state.in_ground {
        state.velocity.y -= state.gravity;
    }
    ArrowTickResult {
        position: state.position,
        velocity: state.velocity,
        block_hit: false,
        in_ground: false,
        discarded: false,
        in_ground_time: state.in_ground_time,
        shake_time: state.shake_time,
        started_falling: false,
    }
}

/// Advances one generic projectile tick using the source ordering in
/// `net.minecraft.world.entity.projectile.ThrowableProjectile` (26.2).
#[must_use]
pub fn tick_projectile(state: &mut ProjectileState, world: &WorldSnapshot) -> ProjectileTickResult {
    tick_projectile_with_bubble_column(state, world, true)
}

#[must_use]
pub fn tick_projectile_with_bubble_column(
    state: &mut ProjectileState,
    world: &WorldSnapshot,
    supports_first_tick_bubble_column: bool,
) -> ProjectileTickResult {
    let hurting_projectile = matches!(
        state.kind,
        ProjectileKind::SmallFireball
            | ProjectileKind::Fireball
            | ProjectileKind::WitherSkull
            | ProjectileKind::DragonFireball
    );
    if supports_first_tick_bubble_column && state.first_tick {
        let position = (
            state.position.x.floor() as i32,
            state.position.y.floor() as i32,
            state.position.z.floor() as i32,
        );
        let effect = world.effect_at(position);
        if matches!(
            effect,
            crate::world::BlockEffect::BubbleUp | crate::world::BlockEffect::BubbleDown
        ) {
            let above = world.block((position.0, position.1 + 1, position.2));
            let above_is_free =
                above.shape.is_none() && above.fluid == crate::world::FluidState::Empty;
            let drag_down = effect == crate::world::BlockEffect::BubbleDown;
            state.velocity.y = if above_is_free {
                if drag_down {
                    (state.velocity.y - 0.03).max(-0.9)
                } else {
                    (state.velocity.y + 0.1).min(1.8)
                }
            } else if drag_down {
                (state.velocity.y - 0.03).max(-0.3)
            } else {
                (state.velocity.y + 0.06).min(0.7)
            };
        }
    }
    state.first_tick = false;
    if state.kind == ProjectileKind::Firework && !state.shot_at_angle {
        let horizontal_acceleration = if state.horizontal_collision { 1.0 } else { 1.15 };
        state.velocity = state.velocity.multiply(Vec3::new(
            horizontal_acceleration,
            1.0,
            horizontal_acceleration,
        ));
        state.velocity.y += 0.04;
    }
    if !hurting_projectile {
        state.velocity.y -= state.gravity;
        let inertia = if state.in_water {
            0.8_f32 as f64
        } else {
            state.air_drag
        };
        state.velocity = state.velocity.scale(inertia);
    }

    let start = state.position;
    let end = start + state.velocity;
    let sweep = Aabb::new(
        Vec3::new(start.x.min(end.x), start.y.min(end.y), start.z.min(end.z)),
        Vec3::new(start.x.max(end.x), start.y.max(end.y), start.z.max(end.z)),
    )
    .inflate(Vec3::new(1.0e-7, 1.0e-7, 1.0e-7));

    let mut nearest = None;
    for shape in world.collision_shapes(sweep) {
        if let Some(hit) = shape.clip_segment(start, end) {
            let distance = start.distance_squared(hit);
            if nearest.map_or(true, |(best, _)| distance < best) {
                nearest = Some((distance, hit));
            }
        }
    }

    if let Some((_, hit)) = nearest {
        state.position = hit;
        if hurting_projectile {
            let inertia = if state.in_water { 0.8 } else { state.air_drag };
            state.velocity = (state.velocity + state.power).scale(inertia);
        }
        ProjectileTickResult {
            position: hit,
            velocity: state.velocity,
            block_hit: true,
        }
    } else {
        state.position = end;
        if hurting_projectile {
            let inertia = if state.in_water { 0.8 } else { state.air_drag };
            state.velocity = (state.velocity + state.power).scale(inertia);
        }
        ProjectileTickResult {
            position: end,
            velocity: state.velocity,
            block_hit: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        tick_arrow, tick_projectile, tick_projectile_with_bubble_column, tick_trident, ArrowState,
        ProjectileKind, ProjectileState, TridentState,
    };
    use crate::math::{Aabb, Vec3};
    use crate::world::{BlockShape, BlockState, WorldSnapshot};

    fn full_block_world(position: (i32, i32, i32)) -> WorldSnapshot {
        let mut world = WorldSnapshot::new();
        world.set_block(
            position,
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..Default::default()
            },
        );
        world
    }

    #[test]
    fn applies_gravity_and_air_drag_before_move_vector_trace() {
        let mut state = ProjectileState::new(Vec3::ZERO, Vec3::new(1.0, 1.0, 0.0));
        let result = tick_projectile(&mut state, &WorldSnapshot::new());

        assert!((result.position.x - 0.9900000095367432).abs() < 1.0e-12);
        assert!((result.position.y - 0.9603000092506409).abs() < 1.0e-12);
        assert_eq!(result.position, result.velocity);
        assert!(!result.block_hit);
    }

    #[test]
    fn stops_at_nearest_block_hit() {
        let mut world = full_block_world((2, 0, 0));
        world.set_block(
            (4, 0, 0),
            BlockState {
                shape: Some(BlockShape {
                    bounds: Aabb::new(Vec3::ZERO, Vec3::new(1.0, 1.0, 1.0)),
                    ..BlockShape::full_block()
                }),
                ..Default::default()
            },
        );
        let mut state = ProjectileState {
            position: Vec3::new(0.5, 0.5, 0.5),
            velocity: Vec3::new(5.0, 0.0, 0.0),
            gravity: 0.0,
            air_drag: 1.0,
            power: Vec3::ZERO,
            in_water: false,
            first_tick: false,
            kind: ProjectileKind::Generic,
            horizontal_collision: false,
            shot_at_angle: false,
        };

        let result = tick_projectile(&mut state, &world);

        assert!(result.block_hit);
        assert_eq!(result.position, Vec3::new(2.0, 0.5, 0.5));
        assert_eq!(state.position, result.position);
    }

    #[test]
    fn projectile_kind_aliases_cover_common_thrown_entity_families() {
        assert_eq!(ProjectileKind::from_name("snowball"), ProjectileKind::Snowball);
        assert_eq!(ProjectileKind::from_name("ender_pearl"), ProjectileKind::EnderPearl);
        assert_eq!(ProjectileKind::from_name("thrown_ender_pearl"), ProjectileKind::EnderPearl);
        assert_eq!(ProjectileKind::from_name("fishing_hook"), ProjectileKind::FishingHook);
        assert_eq!(ProjectileKind::from_name("small_fireball"), ProjectileKind::SmallFireball);
        assert_eq!(ProjectileKind::from_name("minecraft:small_fireball"), ProjectileKind::SmallFireball);
        assert_eq!(ProjectileKind::from_name("entity:small_fireball"), ProjectileKind::SmallFireball);
        assert_eq!(ProjectileKind::from_name("fire_charge"), ProjectileKind::SmallFireball);
        assert_eq!(ProjectileKind::from_name("large_fireball"), ProjectileKind::Fireball);
        assert_eq!(ProjectileKind::from_name("big_fireball"), ProjectileKind::Fireball);
        assert_eq!(ProjectileKind::from_name("wither_skull"), ProjectileKind::WitherSkull);
        assert_eq!(ProjectileKind::from_name("entity:wither_skull"), ProjectileKind::WitherSkull);
        assert_eq!(ProjectileKind::from_name("experience_bottle"), ProjectileKind::ExperienceBottle);
        assert_eq!(ProjectileKind::from_name("exp_bottle"), ProjectileKind::ExperienceBottle);
        assert_eq!(ProjectileKind::from_name("thrown_experience"), ProjectileKind::ExperienceBottle);
        assert_eq!(ProjectileKind::from_name("llama_spit"), ProjectileKind::LlamaSpit);
        assert_eq!(ProjectileKind::from_name("minecraft:llama_spit"), ProjectileKind::LlamaSpit);
        assert_eq!(ProjectileKind::from_name("shulker_bullet"), ProjectileKind::ShulkerBullet);
        assert_eq!(ProjectileKind::from_name("minecraft:firework_rocket"), ProjectileKind::Firework);
        assert_eq!(ProjectileKind::from_name("minecraft:dragon_fireball"), ProjectileKind::DragonFireball);
        assert_eq!(ProjectileKind::from_name("entity:firework_rocket"), ProjectileKind::Firework);
        assert_eq!(ProjectileKind::from_name("trident"), ProjectileKind::Trident);
        assert_eq!(ProjectileKind::from_name("thrown_trident"), ProjectileKind::Trident);
        assert_eq!(ProjectileKind::from_name_checked("unknown_projectile"), None);
        assert_eq!(ProjectileKind::from_name_checked("generic"), None);
    }

    #[test]
    fn projectile_kind_source_defaults_match_java_reference_gravity() {
        assert_eq!(ProjectileKind::Generic.default_gravity(), 0.03);
        assert_eq!(ProjectileKind::Potion.default_gravity(), 0.05);
        assert_eq!(ProjectileKind::ExperienceBottle.default_gravity(), 0.07);
        assert_eq!(ProjectileKind::Firework.default_gravity(), 0.0);
        assert_eq!(ProjectileKind::FishingHook.default_gravity(), 0.03);
        assert_eq!(ProjectileKind::Fireball.default_gravity(), 0.0);
        assert_eq!(ProjectileKind::Firework.default_air_drag(), 1.0);
        assert_eq!(ProjectileKind::Fireball.default_air_drag(), 0.95);
        assert_eq!(ProjectileKind::FishingHook.default_air_drag(), 0.92);
        assert_eq!(ProjectileKind::LlamaSpit.default_gravity(), 0.06);
        assert_eq!(ProjectileKind::ShulkerBullet.default_gravity(), 0.04);
        let state = ProjectileState::for_kind(
            ProjectileKind::LlamaSpit,
            Vec3::ZERO,
            Vec3::new(1.0, 0.0, 0.0),
        );
        assert_eq!(state.gravity, 0.06);
        assert_eq!(state.air_drag, 0.99_f32 as f64);
    }

    #[test]
    fn uses_vanilla_water_inertia_instead_of_air_drag() {
        let mut state = ProjectileState {
            position: Vec3::ZERO,
            velocity: Vec3::new(1.0, 0.0, 0.0),
            gravity: 0.0,
            air_drag: 0.99,
            power: Vec3::ZERO,
            in_water: true,
            first_tick: false,
            kind: crate::projectile::ProjectileKind::Generic,
            horizontal_collision: false,
            shot_at_angle: false,
        };

        let result = tick_projectile(&mut state, &WorldSnapshot::new());

        assert_eq!(result.velocity.x, 0.8_f32 as f64);
    }

    #[test]
    fn arrow_applies_water_drag_before_move_and_gravity_after_air_drag() {
        let mut state = ArrowState {
            position: Vec3::ZERO,
            velocity: Vec3::new(1.0, 1.0, 0.0),
            gravity: 0.05,
            air_drag: 0.99,
            water_inertia: 0.6,
            in_water: false,
            in_ground: false,
            life: 0,
            in_ground_time: 0,
            shake_time: 0,
            fall_impulse: Vec3::ZERO,
            last_block_id: None,
        };

        let result = tick_arrow(&mut state, &WorldSnapshot::new());

        assert_eq!(result.position, Vec3::new(1.0, 1.0, 0.0));
        assert!((result.velocity.x - 0.99).abs() < 1.0e-12);
        assert!((result.velocity.y - 0.94).abs() < 1.0e-12);
    }

    #[test]
    fn arrow_uses_water_inertia_before_move_without_air_drag() {
        let mut state = ArrowState {
            position: Vec3::ZERO,
            velocity: Vec3::new(1.0, 1.0, 0.0),
            gravity: 0.05,
            air_drag: 0.99,
            water_inertia: 0.6,
            in_water: true,
            in_ground: false,
            life: 0,
            in_ground_time: 0,
            shake_time: 0,
            fall_impulse: Vec3::ZERO,
            last_block_id: None,
        };

        let result = tick_arrow(&mut state, &WorldSnapshot::new());

        assert_eq!(result.position, Vec3::new(0.6, 0.6, 0.0));
        assert!((result.velocity.x - 0.6).abs() < 1.0e-12);
        assert!((result.velocity.y - 0.55).abs() < 1.0e-12);
    }

    #[test]
    fn arrow_enters_and_stays_in_ground_at_block_hit() {
        let world = full_block_world((1, 0, 0));
        let mut state = ArrowState {
            position: Vec3::new(0.5, 0.5, 0.5),
            velocity: Vec3::new(2.0, 0.0, 0.0),
            gravity: 0.0,
            air_drag: 1.0,
            water_inertia: 0.8,
            in_water: false,
            in_ground: false,
            life: 0,
            in_ground_time: 0,
            shake_time: 0,
            fall_impulse: Vec3::ZERO,
            last_block_id: None,
        };

        let hit = tick_arrow(&mut state, &world);
        assert!(hit.block_hit);
        assert!(hit.in_ground);
        assert!(!hit.started_falling);
        assert_eq!(hit.position, Vec3::new(1.0, 0.5, 0.5));

        let resting = tick_arrow(&mut state, &world);
        assert!(!resting.block_hit);
        assert!(resting.in_ground);
        assert_eq!(resting.velocity, Vec3::ZERO);
    }

    #[test]
    fn arrow_despawns_after_1200_ground_ticks() {
        let world = full_block_world((1, 0, 0));
        let mut state = ArrowState {
            position: Vec3::new(1.0, 0.5, 0.5),
            velocity: Vec3::ZERO,
            gravity: 0.0,
            air_drag: 1.0,
            water_inertia: 0.8,
            in_water: false,
            in_ground: true,
            life: 1199,
            in_ground_time: 1199,
            shake_time: 2,
            fall_impulse: Vec3::ZERO,
            last_block_id: Some(0),
        };

        let result = tick_arrow(&mut state, &world);

        assert_eq!(state.life, 1200);
        assert!(result.discarded);
        assert_eq!(result.in_ground_time, 1200);
        assert_eq!(result.shake_time, 1);
    }

    #[test]
    fn arrow_starts_falling_without_advancing_when_supporting_block_disappears() {
        let mut state = ArrowState {
            position: Vec3::new(1.0, 0.5, 0.5),
            velocity: Vec3::new(1.0, 2.0, 3.0),
            gravity: 0.05,
            air_drag: 0.99,
            water_inertia: 0.8,
            in_water: false,
            in_ground: true,
            life: 55,
            in_ground_time: 12,
            shake_time: 3,
            fall_impulse: Vec3::new(0.1, 0.2, 0.3),
            last_block_id: None,
        };

        let result = tick_arrow(&mut state, &WorldSnapshot::new());

        assert!(result.started_falling);
        assert!(!result.in_ground);
        assert_eq!(result.position, state.position);
        assert!((result.velocity.x - 0.1).abs() < 1.0e-12);
        assert!((result.velocity.y - 0.4).abs() < 1.0e-12);
        assert!((result.velocity.z - 0.9).abs() < 1.0e-12);
        assert_eq!(state.life, 0);
    }

    #[test]
    fn arrow_starts_falling_when_supporting_block_state_changes() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (1, 0, 0),
            BlockState {
                id: 11,
                shape: Some(BlockShape::full_block()),
                ..Default::default()
            },
        );
        let mut state = ArrowState {
            position: Vec3::new(0.5, 0.5, 0.5),
            velocity: Vec3::new(2.0, 0.0, 0.0),
            gravity: 0.0,
            air_drag: 1.0,
            water_inertia: 0.6,
            in_water: false,
            in_ground: false,
            life: 0,
            in_ground_time: 0,
            shake_time: 0,
            fall_impulse: Vec3::new(0.5, 0.5, 0.5),
            last_block_id: None,
        };

        let hit = tick_arrow(&mut state, &world);
        assert!(hit.block_hit);
        world.set_block(
            (1, 0, 0),
            BlockState {
                id: 12,
                shape: Some(BlockShape::full_block()),
                ..Default::default()
            },
        );

        let result = tick_arrow(&mut state, &world);

        assert!(result.started_falling);
        assert!(!result.in_ground);
        assert_eq!(state.life, 0);
    }

    #[test]
    fn trident_uses_99_percent_water_inertia_and_arrow_gravity() {
        let mut state = TridentState::new(Vec3::ZERO, Vec3::new(1.0, 1.0, 0.0));
        state.in_water = true;
        let result = tick_trident(&mut state, &WorldSnapshot::new());

        assert!((result.position.x - 0.9801).abs() < 1.0e-7);
        assert!((result.position.y - 0.9306).abs() < 1.0e-7);
        assert!((result.velocity.x - 0.9801).abs() < 1.0e-7);
        assert!((result.velocity.y - 0.9306).abs() < 1.0e-7);
        assert!(!result.block_hit);
    }

    #[test]
    fn firework_rocket_scales_horizontal_velocity_and_adds_upward_boost() {
        let mut state = ProjectileState {
            position: Vec3::ZERO,
            velocity: Vec3::new(1.0, 0.0, 1.0),
            gravity: 0.0,
            air_drag: 1.0,
            power: Vec3::ZERO,
            in_water: false,
            first_tick: false,
            kind: ProjectileKind::Firework,
            horizontal_collision: false,
            shot_at_angle: false,
        };

        let result = tick_projectile(&mut state, &WorldSnapshot::new());

        assert_eq!(result.velocity.x, 1.15);
        assert_eq!(result.velocity.z, 1.15);
        assert_eq!(result.velocity.y, 0.04);
    }

    #[test]
    fn firework_rocket_respects_horizontal_collision_and_shot_at_angle_flags() {
        let mut collided = ProjectileState {
            position: Vec3::ZERO,
            velocity: Vec3::new(1.0, 0.0, 1.0),
            gravity: 0.0,
            air_drag: 1.0,
            power: Vec3::ZERO,
            in_water: false,
            first_tick: false,
            kind: ProjectileKind::Firework,
            horizontal_collision: true,
            shot_at_angle: false,
        };
        let collided_result = tick_projectile(&mut collided, &WorldSnapshot::new());
        assert_eq!(collided_result.velocity.x, 1.0);
        assert_eq!(collided_result.velocity.z, 1.0);

        let mut angled = ProjectileState {
            position: Vec3::ZERO,
            velocity: Vec3::new(1.0, 0.0, 1.0),
            gravity: 0.0,
            air_drag: 1.0,
            power: Vec3::ZERO,
            in_water: false,
            first_tick: false,
            kind: ProjectileKind::Firework,
            horizontal_collision: false,
            shot_at_angle: true,
        };
        let angled_result = tick_projectile(&mut angled, &WorldSnapshot::new());
        assert_eq!(angled_result.velocity.x, 1.0);
        assert_eq!(angled_result.velocity.z, 1.0);
        assert_eq!(angled_result.velocity.y, 0.0);
    }

    #[test]
    fn hurting_projectile_applies_persistent_power_after_move() {
        let mut state = ProjectileState {
            position: Vec3::ZERO,
            velocity: Vec3::new(1.0, 0.0, 0.0),
            gravity: 0.05,
            air_drag: 0.95,
            power: Vec3::new(0.1, 0.0, 0.0),
            in_water: false,
            first_tick: false,
            kind: ProjectileKind::Fireball,
            horizontal_collision: false,
            shot_at_angle: false,
        };

        let result = tick_projectile(&mut state, &WorldSnapshot::new());

        assert_eq!(result.position, Vec3::new(1.0, 0.0, 0.0));
        assert!((result.velocity.x - 1.045).abs() < 1.0e-12);
        assert_eq!(result.velocity.y, 0.0);
    }

    #[test]
    fn first_tick_applies_bubble_column_effect_before_gravity() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::BubbleUp,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = ProjectileState {
            position: Vec3::new(0.5, 0.1, 0.5),
            velocity: Vec3::ZERO,
            gravity: 0.03,
            air_drag: 1.0,
            power: Vec3::ZERO,
            in_water: false,
            first_tick: true,
            kind: ProjectileKind::Generic,
            horizontal_collision: false,
            shot_at_angle: false,
        };

        let _ = tick_projectile(&mut state, &world);

        assert!((state.velocity.y - 0.06999999999999999).abs() < 1.0e-12);
        assert!(!state.first_tick);
    }

    #[test]
    fn legacy_projectile_versions_do_not_apply_modern_first_tick_bubble_column_effect() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::BubbleUp,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = ProjectileState {
            position: Vec3::new(0.5, 0.1, 0.5),
            velocity: Vec3::ZERO,
            gravity: 0.03,
            air_drag: 1.0,
            power: Vec3::ZERO,
            in_water: false,
            first_tick: true,
            kind: ProjectileKind::Generic,
            horizontal_collision: false,
            shot_at_angle: false,
        };

        let _ = tick_projectile_with_bubble_column(&mut state, &world, false);

        assert_eq!(state.velocity.y, -0.03);
        assert!(!state.first_tick);
    }

    #[test]
    fn first_tick_inside_downward_bubble_column_uses_inside_limit() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::BubbleDown,
                    ..BlockShape::full_block()
                }),
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
        let mut state = ProjectileState {
            position: Vec3::new(0.5, 0.1, 0.5),
            velocity: Vec3::new(0.0, -0.29, 0.0),
            gravity: 0.0,
            air_drag: 1.0,
            power: Vec3::ZERO,
            in_water: false,
            first_tick: true,
            kind: ProjectileKind::Generic,
            horizontal_collision: false,
            shot_at_angle: false,
        };
        let _ = tick_projectile(&mut state, &world);

        assert!((state.velocity.y + 0.3).abs() < 1.0e-12);
    }
}
