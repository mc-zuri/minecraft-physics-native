use crate::block_traversal::{blocks_visited, Movement};
use crate::math::{ceil_i32_for, floor_i32_for, frac_f64_for, java_float, Aabb, HitFace, Vec3};
use crate::legacy_fluid;
use crate::projectile_hits::{
    return_to_owner, Found, HitScene, ProjectileBlockHit, ProjectileHitReport, ProjectileHitState,
    ProjectileOwner, ProjectileTarget, RocketHolder,
};
use crate::ridden::view_vector;
use crate::vehicle::lava_flow_scale;
use crate::simulation::{
    blocks_inside, entity_fluid_contact, position_of_bounding_box, push_by_fluid, water_contact,
    SimulationState,
};
use crate::vehicle::{is_water, move_vehicle, water_height, MoveRules};
use crate::version::MinecraftVersion;
use crate::world::{BlockEffect, FluidState, WorldSnapshot};

/// The release the unversioned projectile ticks follow.
const UNVERSIONED_RELEASE: MinecraftVersion = MinecraftVersion::new(26, 2, 0);

/// EntityType's 0.25F x 0.25F box of the thrown items, the fishing hook, llama spit and the
/// firework rocket.
const PROJECTILE_SIZE: f32 = 0.25;

/// What Entity.move collides a fishing hook or a firework rocket with: no step, and from 26.2
/// Entity's restitution (no gravity, 0.98F air drag, no bounciness).
const PROJECTILE_MOVE: MoveRules = MoveRules {
    living: false,
    max_step: 0.0,
    gravity: 0.0,
    air_drag: 0.98_f32 as f64,
    bounciness: 0.0,
    stands_on_lava: false,
    checks_inside_at_fall: false,
    rails_keep_speed: false,
    ignored: [None, None],
};

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
    /// AbstractWindCharge (WindCharge from 1.20.3, BreezeWindCharge from 1.20.5).
    WindCharge,
    LlamaSpit,
    ShulkerBullet,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProjectileState {
    pub position: Vec3,
    pub velocity: Vec3,
    pub gravity: f64,
    pub air_drag: f64,
    /// AbstractHurtingProjectile's xPower/yPower/zPower, added to the motion before 1.21.
    pub power: Vec3,
    /// AbstractHurtingProjectile.accelerationPower (1.21+), added along the motion's direction.
    pub acceleration_power: f64,
    pub in_water: bool,
    /// The dimension is ultrawarm: lava pushes at 0.007.
    pub ultra_warm: bool,
    pub first_tick: bool,
    pub kind: ProjectileKind,
    pub horizontal_collision: bool,
    pub on_ground: bool,
    pub shot_at_angle: bool,
    /// A fishing hook in FishingHook's BOBBING state (FLYING otherwise).
    pub bobbing: bool,
    /// The fishing hook's random.nextFloat() for this tick's bobbing pull.
    pub bob_random: f32,
    /// Entity.noPhysics, as Entity.move and the firework rocket's hit test read it.
    pub no_physics: bool,
    /// The box a rocket or hook keeps from tick to tick before 1.17, which its Entity.move goes by
    /// and its position follows (None: from the position).
    pub bounding_box: Option<Aabb>,
}

impl ProjectileState {
    #[must_use]
    pub const fn new(position: Vec3, velocity: Vec3) -> Self {
        Self::for_kind(ProjectileKind::Generic, position, velocity)
    }

    #[must_use]
    pub const fn for_kind(kind: ProjectileKind, position: Vec3, velocity: Vec3) -> Self {
        Self {
            position,
            velocity,
            gravity: kind.default_gravity(),
            air_drag: kind.default_air_drag(),
            power: Vec3::ZERO,
            acceleration_power: kind.default_acceleration_power(),
            in_water: false,
            ultra_warm: false,
            first_tick: true,
            kind,
            horizontal_collision: false,
            on_ground: false,
            shot_at_angle: false,
            bobbing: false,
            bob_random: 0.0,
            no_physics: false,
            bounding_box: None,
        }
    }

    /// `for_kind` with the gravity `release` gives the family.
    #[must_use]
    pub fn for_kind_in_release(
        kind: ProjectileKind,
        position: Vec3,
        velocity: Vec3,
        release: MinecraftVersion,
    ) -> Self {
        Self {
            gravity: kind.default_gravity_in(release),
            ..Self::for_kind(kind, position, velocity)
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
            Self::SmallFireball
            | Self::Fireball
            | Self::WitherSkull
            | Self::DragonFireball
            | Self::WindCharge => 0.0,
            Self::LlamaSpit => 0.06,
            Self::ShulkerBullet => 0.04,
        }
    }

    /// The gravity of `release`: before 1.20.5 getGravity returns a float (0.03F, the potion's
    /// 0.05F, the experience bottle's 0.07F, LlamaSpit's 0.06F) widened to double
    /// (ThrownEntity.java:96 in 1.20.4, :93 in 1.20.5); the shulker bullet subtracts a double
    /// literal in every release, and the fishing hook until 26.2 (26.2 FishingHook.java:227), when
    /// 26.3's getDefaultGravity gives the float's value (26.3 FishingHook.java:468-470).
    #[must_use]
    pub fn default_gravity_in(self, release: MinecraftVersion) -> f64 {
        let gravity = self.default_gravity();
        let double = match self {
            Self::FishingHook => !release.at_least(26, 3, 0),
            Self::ShulkerBullet => true,
            _ => release.at_least(1, 20, 5),
        };
        if double {
            gravity
        } else {
            java_float(gravity)
        }
    }

    #[must_use]
    pub const fn default_air_drag(self) -> f64 {
        match self {
            // AbstractWindCharge.getInertia: 1.0F
            Self::Firework | Self::ShulkerBullet | Self::WindCharge => 1.0,
            // AbstractHurtingProjectile.getInertia (getDrag before 1.21.2): 0.95F
            Self::SmallFireball
            | Self::Fireball
            | Self::WitherSkull
            | Self::DragonFireball => 0.95_f32 as f64,
            Self::FishingHook => 0.92,
            _ => 0.99_f32 as f64,
        }
    }

    /// AbstractHurtingProjectile.accelerationPower (1.21+): 0.1, and 0.0 for the wind charges
    /// (1.21 AbstractWindChargeEntity.java:35-46).
    #[must_use]
    pub const fn default_acceleration_power(self) -> f64 {
        match self {
            Self::WindCharge => 0.0,
            _ => 0.1,
        }
    }

    #[must_use]
    pub const fn is_arrow(self) -> bool {
        matches!(
            self,
            Self::Arrow | Self::SpectralArrow | Self::TippedArrow | Self::Trident
        )
    }

    /// Whether the family's tick moves before its base tick from 1.21.2 (`base_tick_opens`): the
    /// throwables, the hurting projectiles and the arrows. FireworkRocketEntity, FishingHook,
    /// LlamaSpit and ShulkerBullet open with `super.tick()` in every release (1.8.9
    /// FireworkRocketEntity.java:86, FishingBobberEntity.java:177, 1.16.5 LlamaSpitEntity.java:48,
    /// ShulkerBulletEntity.java:200; 26.3 FireworkRocketEntity.java:108, FishingHook.java:146,
    /// LlamaSpit.java:38, ShulkerBullet.java:185).
    const fn moves_before_base_tick(self) -> bool {
        !matches!(
            self,
            Self::Firework | Self::FishingHook | Self::LlamaSpit | Self::ShulkerBullet
        )
    }

    /// The thrown items, on ThrowableProjectile's tick.
    #[must_use]
    pub(crate) const fn is_thrown(self) -> bool {
        matches!(
            self,
            Self::Generic
                | Self::Snowball
                | Self::Egg
                | Self::EnderPearl
                | Self::Potion
                | Self::ExperienceBottle
        )
    }

    /// Entity.getBoundingBox at `position`: EntityDimensions.makeBoundingBox of `size`, and for a
    /// wind charge 0.15F below its position (1.20.4 WindChargeEntity.java:37-42, 26.3
    /// AbstractWindCharge.java:47-52).
    pub(crate) fn bounding_box(self, position: Vec3) -> Aabb {
        let size = self.size();
        let half_width = f64::from(size / 2.0);
        let bottom = if self == Self::WindCharge {
            position.y - f64::from(0.15_f32)
        } else {
            position.y
        };
        Aabb::new(
            Vec3::new(position.x - half_width, bottom, position.z - half_width),
            Vec3::new(position.x + half_width, bottom + f64::from(size), position.z + half_width),
        )
    }

    /// EntityType.sized: width and height (1.21.5 EntityType.java).
    fn size(self) -> f32 {
        match self {
            Self::Arrow | Self::SpectralArrow | Self::TippedArrow | Self::Trident => 0.5,
            Self::Fireball | Self::DragonFireball => 1.0,
            Self::SmallFireball | Self::WitherSkull | Self::WindCharge | Self::ShulkerBullet => 0.3125,
            _ => PROJECTILE_SIZE,
        }
    }

    #[must_use]
    pub const fn is_hurting(self) -> bool {
        matches!(
            self,
            Self::SmallFireball
                | Self::Fireball
                | Self::WitherSkull
                | Self::DragonFireball
                | Self::WindCharge
        )
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
            // splash_potion and lingering_potion from 1.21.5 (1.21.5 EntityType.java:759, 767)
            "potion" | "thrown_potion" | "thrownpotion" | "splash_potion" | "lingering_potion" => {
                Self::Potion
            }
            // 1.8.9 EntityList ThrownExpBottle (EntityList.java:240)
            "experience_bottle" | "experiencebottle" | "xp_bottle" | "xpbottle"
            | "exp_bottle" | "expbottle" | "thrown_experience" | "thrownexperience"
            | "thrownexpbottle" | "experience_bottle_entity" => Self::ExperienceBottle,
            // fireworks_rocket in 1.11-1.12 (1.12.2 EntityType.java:210), 1.8.9
            // FireworksRocketEntity (EntityList.java:245)
            "firework" | "firework_rocket" | "fireworkrocket" | "firework_rocket_entity"
            | "fireworkrocketentity" | "fireworks_rocket" | "fireworksrocketentity" => {
                Self::Firework
            }
            // fishing_bobber from 1.13 (1.21.11 EntityType.java)
            "fishing_hook" | "fishinghook" | "fishing_rod_hook" | "fishingrodhook"
            | "fishing_bobber" | "fishingbobber" => Self::FishingHook,
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
            // wind_charge from 1.20.3, breeze_wind_charge from 1.20.5 (1.20.5 EntityType.java:247, 928)
            "wind_charge" | "windcharge" | "breeze_wind_charge" | "breezewindcharge" => {
                Self::WindCharge
            }
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

    /// The name and first release of a kind that is not of 1.8's (1.8.9 EntityType.java:228-243): the shulker
    /// bullet and dragon fireball are 1.9's (1.9.4 EntityType.java:254-255), the llama's spit 1.11's (1.11.2
    /// EntityType.java:251), and the wind charge 1.20.3's (1.20.3 EntityType "wind_charge").
    #[must_use]
    pub fn first_release(self) -> Option<(&'static str, MinecraftVersion)> {
        match self {
            Self::ShulkerBullet => Some(("shulker bullet", MinecraftVersion::new(1, 9, 0))),
            Self::DragonFireball => Some(("dragon fireball", MinecraftVersion::new(1, 9, 0))),
            Self::LlamaSpit => Some(("llama spit", MinecraftVersion::new(1, 11, 0))),
            Self::WindCharge => Some(("wind charge", MinecraftVersion::new(1, 20, 3))),
            _ => None,
        }
    }
}


#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProjectileTickResult {
    pub position: Vec3,
    pub velocity: Vec3,
    pub block_hit: bool,
    pub horizontal_collision: bool,
    pub on_ground: bool,
    pub bobbing: bool,
    /// The client removed the projectile this tick (llama spit in water or inside blocks).
    pub discarded: bool,
}

impl ProjectileTickResult {
    fn of(state: &ProjectileState, block_hit: bool, discarded: bool) -> Self {
        Self {
            position: state.position,
            velocity: state.velocity,
            block_hit,
            horizontal_collision: state.horizontal_collision,
            on_ground: state.on_ground,
            bobbing: state.bobbing,
            discarded,
        }
    }
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
    /// The state id of the block the arrow hit (lastState, inBlockState).
    pub last_block_id: Option<u32>,
    /// The block the arrow hit (xTile/yTile/zTile), whose state the in-ground test reads until
    /// 1.13.2.
    pub last_block_position: Option<(i32, i32, i32)>,
    /// AbstractArrow.isNoPhysics (a returning trident), from 1.13.
    pub no_physics: bool,
    /// The dimension is ultrawarm: lava pushes at 0.007.
    pub ultra_warm: bool,
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
            last_block_position: None,
            no_physics: false,
            ultra_warm: false,
        }
    }

    /// `new` with the gravity of `release`: AbstractArrow's 0.05F before 1.20.5 (1.20.4
    /// PersistentProjectileEntity.java:244), 0.05 from 1.20.5 (1.20.5 :265-266).
    #[must_use]
    pub fn new_in_release(position: Vec3, velocity: Vec3, release: MinecraftVersion) -> Self {
        Self {
            gravity: ProjectileKind::Arrow.default_gravity_in(release),
            ..Self::new(position, velocity)
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
    /// AbstractArrow's embedded state, which a trident shares (`ArrowState`).
    pub in_ground: bool,
    pub life: u16,
    pub in_ground_time: u32,
    pub shake_time: u8,
    pub fall_impulse: Vec3,
    pub last_block_id: Option<u32>,
    pub last_block_position: Option<(i32, i32, i32)>,
    pub no_physics: bool,
    pub ultra_warm: bool,
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
            in_ground: false,
            life: 0,
            in_ground_time: 0,
            shake_time: 0,
            fall_impulse: Vec3::ZERO,
            last_block_id: None,
            last_block_position: None,
            no_physics: false,
            ultra_warm: false,
        }
    }

    fn arrow(&self) -> ArrowState {
        ArrowState {
            position: self.position,
            velocity: self.velocity,
            gravity: self.gravity,
            air_drag: self.air_drag,
            water_inertia: self.water_inertia,
            in_water: self.in_water,
            in_ground: self.in_ground,
            life: self.life,
            in_ground_time: self.in_ground_time,
            shake_time: self.shake_time,
            fall_impulse: self.fall_impulse,
            last_block_id: self.last_block_id,
            last_block_position: self.last_block_position,
            no_physics: self.no_physics,
            ultra_warm: self.ultra_warm,
        }
    }

    fn take_arrow(&mut self, arrow: ArrowState) {
        self.position = arrow.position;
        self.velocity = arrow.velocity;
        self.in_water = arrow.in_water;
        self.in_ground = arrow.in_ground;
        self.life = arrow.life;
        self.in_ground_time = arrow.in_ground_time;
        self.shake_time = arrow.shake_time;
        self.last_block_id = arrow.last_block_id;
        self.last_block_position = arrow.last_block_position;
    }

    /// `new` with the AbstractArrow gravity of `release` (0.05F before 1.20.5).
    #[must_use]
    pub fn new_in_release(position: Vec3, velocity: Vec3, release: MinecraftVersion) -> Self {
        Self {
            gravity: ProjectileKind::Trident.default_gravity_in(release),
            ..Self::new(position, velocity)
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TridentTickResult {
    pub position: Vec3,
    pub velocity: Vec3,
    pub block_hit: bool,
    pub in_ground: bool,
    pub discarded: bool,
    pub in_ground_time: u32,
    pub shake_time: u8,
    pub started_falling: bool,
    pub dealt_damage: bool,
}

/// AbstractArrow.tick for a ThrownTrident as the unversioned release (26.2) runs it.
#[must_use]
pub fn tick_trident(state: &mut TridentState, world: &WorldSnapshot) -> TridentTickResult {
    tick_trident_in_release(state, world, UNVERSIONED_RELEASE)
}

/// ThrownTrident.tick of `release` (1.13+): AbstractArrow.tick, the embedded state included, with
/// the trident's 0.99F water inertia (1.13.2 TridentEntity.java:57-92, 193; 26.3
/// ThrownTrident.java:62-99), after a stay of more than four ticks in the ground setting
/// dealtDamage. Loyalty's return needs an owner: `tick_trident_with_targets`.
#[must_use]
pub fn tick_trident_in_release(
    state: &mut TridentState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> TridentTickResult {
    if state.in_ground_time > 4 {
        state.dealt_damage = true;
    }
    let mut arrow = state.arrow();
    let mut hits = ProjectileHitState::default();
    let mut scene = HitScene::new(&[], None, &mut hits);
    scene.trident = true;
    let result = arrow_tick(&mut arrow, world, release, &mut scene);
    state.take_arrow(arrow);
    trident_result(result, state)
}

fn trident_result(result: ArrowTickResult, state: &TridentState) -> TridentTickResult {
    TridentTickResult {
        position: state.position,
        velocity: state.velocity,
        block_hit: result.block_hit,
        in_ground: result.in_ground,
        discarded: result.discarded,
        in_ground_time: result.in_ground_time,
        shake_time: result.shake_time,
        started_falling: result.started_falling,
        dealt_damage: state.dealt_damage,
    }
}

/// Entity.baseTick's fluids: whether the box is in water, and, when `pushed`, the currents' push
/// (updateInWaterStateAndDoFluidPushing; handleWaterMovement before 1.13, 1.12.2
/// Entity.java:1048-1063). Lava's follows water's from 1.16, 0.007 in an ultrawarm dimension
/// (1.16.5 Entity.java:1067-1072, 26.3 :1698-1707); before it no current of lava moves them.
#[allow(clippy::too_many_arguments)]
fn update_in_water(
    position: Vec3,
    velocity: &mut Vec3,
    in_water: &mut bool,
    size: f32,
    pushed: bool,
    ultra_warm: bool,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) {
    let mut body = SimulationState {
        position,
        velocity: *velocity,
        half_width: f64::from(size / 2.0),
        height: f64::from(size),
        in_water: *in_water,
        ..SimulationState::default()
    };
    if legacy_fluid::applies(release) {
        legacy_fluid::handle_water_movement(&mut body, world, pushed, release);
    } else {
        let water = water_contact(world, body.bounds(), release);
        body.in_water = water.touching;
        if water.touching && pushed {
            push_by_fluid(&mut body, water, 0.014, release);
        }
        if pushed && release.at_least(1, 16, 0) {
            let lava = entity_fluid_contact(&body, world, FluidState::Lava, release);
            if lava.touching {
                push_by_fluid(&mut body, lava, lava_flow_scale(ultra_warm), release);
            }
        }
    }
    *velocity = body.velocity;
    *in_water = body.in_water;
}

/// Whether Entity.tick's base tick comes first in the projectile's tick: `super.tick()` opens it up
/// to 1.21.1 (1.8.9 AbstractArrowEntity.java:149, 1.20.4 ThrownEntity.java:46, 1.21.1
/// ThrowableProjectile.java:39-41) and follows the move from 1.21.2 (1.21.3 ThrownEntity.java:62,
/// PersistentProjectileEntity.java:244; 26.3 ThrowableProjectile.java:56, AbstractArrow.java:251).
const fn base_tick_opens(release: MinecraftVersion) -> bool {
    !release.at_least(1, 21, 2)
}

/// Entity.checkBelowWorld, in the base tick on either side: 64 blocks below the world the entity
/// discards itself, and the tick goes on to its end. The bottom is 0 until 1.16.5, written as
/// `y < -64.0` (1.8.9 Entity.java:413, 1.16.5 :526), and the level's from 1.17 (1.17 Entity.java:459-461,
/// 26.3 :626-629). LivingEntity overrides it to hurt instead (26.3 LivingEntity.java:2118).
fn below_world(y: f64, world: &WorldSnapshot, release: MinecraftVersion) -> bool {
    let bottom = if release.at_least(1, 17, 0) { world.min_build_height() } else { 0 };
    y < f64::from(bottom - 64)
}

/// `tick_projectile_in_release` of a projectile in its world from tick to tick: isInWater and the
/// current's push are the base tick's, at the family's place for it.
pub fn tick_projectile_in_world(
    state: &mut ProjectileState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> ProjectileTickResult {
    let opens = base_tick_opens(release) || !state.kind.moves_before_base_tick();
    let size = state.kind.size();
    let mut void = false;
    if opens {
        let position = state.position;
        update_in_water(position, &mut state.velocity, &mut state.in_water, size, true, state.ultra_warm, world, release);
        void = below_world(position.y, world, release);
    }
    let mut result = tick_projectile_in_release(state, world, release);
    if !opens {
        let position = state.position;
        update_in_water(position, &mut state.velocity, &mut state.in_water, size, true, state.ultra_warm, world, release);
        result.velocity = state.velocity;
        void = below_world(position.y, world, release);
    }
    result.discarded |= void;
    result
}

/// `tick_projectile_in_world` as the server runs it, among `targets` in the order Level.getEntities
/// gives them: the family's query, reaction and removal. `owner` is what Projectile.getOwner gives,
/// and the owner and what it rides belong in `targets` while they are near. Projectile.tick's
/// left-owner test keeps the base tick's place: at the end of the move for the thrown items and the
/// hurting projectiles from 1.21.2 (1.21.3 ThrownEntity tick, 26.3 ThrowableProjectile.java:56),
/// otherwise first (1.21 ThrownEntity tick, 26.3 FireworkRocketEntity.java:108, FishingHook.java:146,
/// LlamaSpit.java:38, ShulkerBullet.java:185). The hit of those moved first comes last, after the
/// base tick (26.3 ThrowableProjectile.java:57-59, AbstractHurtingProjectile.java:89-91).
pub fn tick_projectile_with_targets(
    state: &mut ProjectileState,
    hits: &mut ProjectileHitState,
    targets: &[ProjectileTarget],
    owner: Option<ProjectileOwner>,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> (ProjectileTickResult, ProjectileHitReport) {
    let mut scene = HitScene::new(targets, owner, hits);
    scene.kind = state.kind;
    scene.live = true;
    scene.hits.tick_count = scene.hits.tick_count.wrapping_add(1);
    let gone_first = pearl_lost(state, &scene) || wind_charge_too_high(state, world, release);
    if gone_first {
        return (ProjectileTickResult::of(state, false, true), scene.report);
    }
    let opens = base_tick_opens(release) || !state.kind.moves_before_base_tick();
    let size = state.kind.size();
    if opens {
        scene.check_left_owner(state.position, state.velocity, release);
        let position = state.position;
        update_in_water(position, &mut state.velocity, &mut state.in_water, size, true, state.ultra_warm, world, release);
    }
    let mut result = tick_family(state, world, release, &mut scene);
    if !opens {
        scene.check_left_owner(state.position, state.velocity, release);
        let position = state.position;
        update_in_water(position, &mut state.velocity, &mut state.in_water, size, true, state.ultra_warm, world, release);
    }
    if let Some(hit) = scene.pending.take() {
        scene.hit_flight(hit, state, release);
    }
    result.velocity = state.velocity;
    result.discarded |= scene.removed;
    (result, scene.report)
}

/// ThrownEnderpearl.tick: a pearl does not outlive a player who threw it (1.8.9
/// EnderPearlEntity.java tick, 26.3 ThrownEnderpearl.java), unless the game rule says so.
fn pearl_lost(state: &ProjectileState, scene: &HitScene<'_>) -> bool {
    state.kind == ProjectileKind::EnderPearl
        && !scene.hits.pearl_outlives_owner
        && scene.owner.is_some_and(|owner| owner.player && !owner.alive)
}

/// AbstractWindCharge.tick, from 1.20.5: too far above the level, it bursts. The top is getTopY,
/// the first height past the level, until 1.21 and the last height in it from 1.21.2 (1.20.5
/// AbstractWindChargeEntity.java:127-134, 1.21 :143-150, 1.21.3 :143-150, 26.3 :161-168).
fn wind_charge_too_high(
    state: &ProjectileState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> bool {
    // (a world told no height has no such limit to go by)
    if state.kind != ProjectileKind::WindCharge || !release.at_least(1, 20, 5) || world.top_y() == 0 {
        return false;
    }
    let top = world.top_y() - i32::from(release.at_least(1, 21, 2));
    state.position.y.floor() as i32 > top + 30
}

/// `tick_arrow_in_release` of an arrow in its world from tick to tick. Until 1.21.1 the base tick
/// opens every tick, in the ground too (1.21 PersistentProjectileEntity.java:154). From 1.21.2 it
/// closes the flying branch only, the tick of a hit included, and the in-ground branch has none
/// (26.3 AbstractArrow.java:192-212, 251; 1.21.3 PersistentProjectileEntity.java:191-204, 244).
/// From 1.21.5 an embedded arrow is not pushed (1.21.5 AbstractArrow.java:319-321, 26.3 :344-346);
/// before, Entity's isPushedByFluid holds (1.21.4 Entity.java:2898).
pub fn tick_arrow_in_world(
    state: &mut ArrowState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> ArrowTickResult {
    let mut hits = ProjectileHitState::default();
    arrow_tick_in_world(state, world, release, &mut HitScene::new(&[], None, &mut hits))
}

/// `tick_arrow_in_world` among `targets`, in the order Level.getEntities gives them: the tick also
/// meets them, and reports what it hit. `owner` is what Projectile.getOwner gives, and the owner
/// and what it rides belong in `targets` for as long as they are near.
pub fn tick_arrow_with_targets(
    state: &mut ArrowState,
    hits: &mut ProjectileHitState,
    targets: &[ProjectileTarget],
    owner: Option<ProjectileOwner>,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> (ArrowTickResult, ProjectileHitReport) {
    let mut scene = HitScene::new(targets, owner, hits);
    let result = arrow_tick_in_world(state, world, release, &mut scene);
    (result, scene.report)
}

/// ServerLevel.tickNonPassenger counts the entity's tick before Entity.tick runs it.
fn arrow_tick_in_world(
    state: &mut ArrowState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    scene: &mut HitScene<'_>,
) -> ArrowTickResult {
    scene.hits.tick_count = scene.hits.tick_count.wrapping_add(1);
    // Projectile.tick opens AbstractArrow.tick, before Entity.tick's base tick, until 1.21.1
    // (1.16.5 ProjectileEntity.java:88-94, 1.21 PersistentProjectileEntity.java:154)
    if !release.at_least(1, 21, 2) {
        scene.check_left_owner(state.position, state.velocity, release);
    }
    let size = ProjectileKind::Arrow.size();
    let mut void = false;
    if base_tick_opens(release) {
        let position = state.position;
        update_in_water(position, &mut state.velocity, &mut state.in_water, size, true, state.ultra_warm, world, release);
        void = below_world(position.y, world, release);
    }
    let mut result = arrow_tick(state, world, release, scene);
    // only the in-ground branch counts inGroundTime, and the flying one resets it
    if !base_tick_opens(release) && result.in_ground_time == 0 {
        let position = state.position;
        let pushed = !(state.in_ground && release.at_least(1, 21, 5));
        update_in_water(position, &mut state.velocity, &mut state.in_water, size, pushed, state.ultra_warm, world, release);
        result.velocity = state.velocity;
        void = below_world(position.y, world, release);
    }
    result.discarded |= void;
    result
}

/// `tick_trident_in_release` of a trident in its world from tick to tick.
pub fn tick_trident_in_world(
    state: &mut TridentState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> TridentTickResult {
    if state.in_ground_time > 4 {
        state.dealt_damage = true;
    }
    tick_trident_with_targets(state, &mut ProjectileHitState::default(), &[], None, world, release).0
}

/// `tick_trident_in_world` among `targets`, as `tick_arrow_with_targets`. A trident with
/// `hits.loyalty` returns to `owner` once it has dealt its damage or is returning: with no owner it
/// stays where it is, and a dead or spectating owner loses it.
pub fn tick_trident_with_targets(
    state: &mut TridentState,
    hits: &mut ProjectileHitState,
    targets: &[ProjectileTarget],
    owner: Option<ProjectileOwner>,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> (TridentTickResult, ProjectileHitReport) {
    if state.in_ground_time > 4 {
        state.dealt_damage = true;
    }
    let mut scene = HitScene::new(targets, owner, hits);
    scene.trident = true;
    scene.dealt_damage = state.dealt_damage;
    let (mut position, mut velocity, mut no_physics) =
        (state.position, state.velocity, state.no_physics);
    let gone = return_to_owner(
        &mut position,
        &mut velocity,
        &mut no_physics,
        state.dealt_damage,
        &scene,
        release,
    );
    if gone {
        scene.hits.tick_count = scene.hits.tick_count.wrapping_add(1);
        let result = ArrowTickResult {
            position,
            velocity,
            block_hit: false,
            in_ground: state.in_ground,
            discarded: true,
            in_ground_time: state.in_ground_time,
            shake_time: state.shake_time,
            started_falling: false,
        };
        return (trident_result(result, state), scene.report);
    }
    (state.position, state.velocity, state.no_physics) = (position, velocity, no_physics);
    let mut arrow = state.arrow();
    let result = arrow_tick_in_world(&mut arrow, world, release, &mut scene);
    state.take_arrow(arrow);
    state.dealt_damage = scene.dealt_damage;
    (trident_result(result, state), scene.report)
}

/// AbstractArrow.tick as the unversioned release (26.2) runs it.
#[must_use]
pub fn tick_arrow(state: &mut ArrowState, world: &WorldSnapshot) -> ArrowTickResult {
    tick_arrow_in_release(state, world, UNVERSIONED_RELEASE)
}

/// AbstractArrow.tick of `release` (1.21.11 AbstractArrow.java:160-250, 1.21
/// PersistentProjectileEntity.java:153-280, 1.15 ProjectileEntity.java, 1.13.2
/// AbstractArrowEntity.java, 1.9.4 AbstractArrowEntity.java:165-195, 1.8.9 EntityArrow.java:145-357). shakeTime counts down at the top of every tick. An arrow in the
/// ground counts inGroundTime up, and falls (its motion scaled by `fall_impulse`, the
/// random.nextFloat() * 0.2F of each axis) when the block state it reads is not the one it hit
/// and, from 1.11, no block collides with the test box: until 1.13.2 the hit block's own state and
/// the arrow's box inflated by 0.05, in 1.14-1.15 the state at the arrow's block and its box
/// inflated by 0.06, from 1.16 the arrow's point inflated by 0.06. Otherwise it ages towards the
/// 1200-tick despawn. From 1.21.2 the fall and the despawn run on the server only; this models the
/// server. A flying arrow resets inGroundTime and flies by `arrow_flight`; a block hit sets the
/// seven-tick shake and remembers the hit block.
#[must_use]
pub fn tick_arrow_in_release(
    state: &mut ArrowState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> ArrowTickResult {
    let mut hits = ProjectileHitState::default();
    arrow_tick(state, world, release, &mut HitScene::new(&[], None, &mut hits))
}

fn arrow_tick(
    state: &mut ArrowState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    scene: &mut HitScene<'_>,
) -> ArrowTickResult {
    let arrow_block = (
        floor_i32_for(release, state.position.x),
        floor_i32_for(release, state.position.y),
        floor_i32_for(release, state.position.z),
    );
    // the shape around the arrow embeds it before anything else: the block at the arrow from 1.14
    // (1.14 ProjectileEntity.java:164-174), before it the block of the last hit, -1, -1, -1 at first
    // (1.8.9 AbstractArrowEntity.java:157-165, 1.13.2 :165-176); from 1.21.5 the motion stops too
    // (1.21.5 AbstractArrow.java:172-175, 1.21.4 PersistentProjectileEntity.java:177-178, 26.3
    // AbstractArrow.java:176). Box.contains takes the lower faces in from 1.13 (1.12.2 Box.java:274-278,
    // 1.13.2 :217-222).
    let contained_in = if release.at_least(1, 14, 0) {
        arrow_block
    } else {
        state.last_block_position.unwrap_or((-1, -1, -1))
    };
    // isNoPhysics, from 1.13 (1.13.2 AbstractArrowEntity.java:156, 26.3 AbstractArrow.java:165)
    let no_physics = state.no_physics && release.at_least(1, 13, 0);
    let contained = !no_physics && world.block_collision_boxes(contained_in).iter().any(|shape| {
        let at = state.position;
        if release.at_least(1, 13, 0) {
            shape.contains(at)
        } else {
            at.x > shape.min.x
                && at.x < shape.max.x
                && at.y > shape.min.y
                && at.y < shape.max.y
                && at.z > shape.min.z
                && at.z < shape.max.z
        }
    });
    if contained {
        state.in_ground = true;
        if release.at_least(1, 21, 5) {
            state.velocity = Vec3::ZERO;
        }
    }
    state.shake_time = state.shake_time.saturating_sub(1);
    if state.in_ground && !no_physics {
        let read_block = if release.at_least(1, 14, 0) {
            arrow_block
        } else {
            state.last_block_position.unwrap_or(arrow_block)
        };
        let changed = state.last_block_id != Some(world.block(read_block).id);
        let falls = changed
            && if !release.at_least(1, 11, 0) {
                true
            } else if !release.at_least(1, 14, 0) {
                no_block_collision(
                    world,
                    arrow_box(state.position).inflate(Vec3::new(0.05, 0.05, 0.05)),
                    release,
                )
            } else if !release.at_least(1, 16, 0) {
                no_block_collision(
                    world,
                    arrow_box(state.position).inflate(Vec3::new(0.06, 0.06, 0.06)),
                    release,
                )
            } else {
                no_block_collision(
                    world,
                    Aabb::new(state.position, state.position).inflate(Vec3::new(0.06, 0.06, 0.06)),
                    release,
                )
            };
        // a loyal trident that may be picked up never ages (1.13.2 TridentEntity.java:185-190,
        // 26.3 ThrownTrident.java:221-226)
        let ages = !(scene.trident && scene.hits.pickup_allowed && scene.hits.loyalty > 0);
        if falls {
            state.in_ground = false;
            state.velocity = state.velocity.multiply(state.fall_impulse);
            state.life = 0;
            scene.hits.flying_ticks = 0;
        } else if ages {
            state.life = state.life.saturating_add(1);
        }
        state.in_ground_time = state.in_ground_time.saturating_add(1);
        return ArrowTickResult {
            position: state.position,
            velocity: state.velocity,
            block_hit: false,
            in_ground: state.in_ground,
            discarded: !falls && ages && state.life >= 1200,
            in_ground_time: state.in_ground_time,
            shake_time: state.shake_time,
            started_falling: falls,
        };
    }

    state.in_ground_time = 0;
    scene.hits.flying_ticks = scene.hits.flying_ticks.wrapping_add(1);
    // inside the flying branch from 1.21.9, before the ray (1.21.9 AbstractArrow.java:228)
    if release.at_least(1, 21, 9) {
        scene.check_left_owner(state.position, state.velocity, release);
    }
    if no_physics {
        // no ray and no gravity; the move is always the motion the tick began with (1.16.5
        // PersistentProjectileEntity.java:211-240, 26.3 AbstractArrow.java:212-239)
        let inertia = if state.in_water {
            state.water_inertia
        } else {
            state.air_drag
        };
        state.position = state.position + state.velocity;
        state.velocity = state.velocity.scale(inertia);
        end_of_flight(state, scene, release);
        return ArrowTickResult {
            position: state.position,
            velocity: state.velocity,
            block_hit: false,
            in_ground: state.in_ground,
            discarded: false,
            in_ground_time: state.in_ground_time,
            shake_time: state.shake_time,
            started_falling: false,
        };
    }
    let hit = arrow_flight(
        &mut state.position,
        &mut state.velocity,
        ArrowMotion {
            gravity: state.gravity,
            air_drag: state.air_drag,
            water_inertia: state.water_inertia,
            in_water: state.in_water,
        },
        world,
        release,
        scene,
    );
    if let Some(hit) = hit {
        scene.report.block_hit = Some(hit.report());
    }
    if let Some(hit) = hit.filter(|hit| !hit.bounced) {
        state.in_ground = true;
        state.shake_time = 7;
        state.last_block_id = Some(world.block(hit.block).id);
        state.last_block_position = Some(hit.block);
        // onHitBlock clears the pierce (1.14 ProjectileEntity.java, 26.3 AbstractArrow.java:530-532)
        scene.hits.pierce_level = 0;
        scene.hits.pierced.clear();
    }
    end_of_flight(state, scene, release);
    ArrowTickResult {
        position: state.position,
        velocity: state.velocity,
        block_hit: hit.is_some_and(|hit| !hit.bounced),
        in_ground: state.in_ground,
        discarded: scene.removed,
        in_ground_time: state.in_ground_time,
        shake_time: state.shake_time,
        started_falling: false,
    }
}

/// Projectile.tick closes the flying branch from 1.21.2; until 1.21.8 that is the left-owner test,
/// at the moved arrow (1.21.3 PersistentProjectileEntity.java:244, ProjectileEntity.java:130-133).
fn end_of_flight(state: &ArrowState, scene: &mut HitScene<'_>, release: MinecraftVersion) {
    if release.at_least(1, 21, 2) && !release.at_least(1, 21, 9) {
        scene.check_left_owner(state.position, state.velocity, release);
    }
}

/// The inertia and gravity of an AbstractArrow's flight.
#[derive(Clone, Copy, Debug)]
struct ArrowMotion {
    gravity: f64,
    air_drag: f64,
    water_inertia: f64,
    in_water: bool,
}

impl ArrowMotion {
    const WATER_INERTIA: f64 = 0.6_f32 as f64;
    const TRIDENT_WATER_INERTIA: f64 = 0.99_f32 as f64;
}

/// The flight of an AbstractArrow tick, returning its block hit.
///
/// From 1.21.2 (1.21.11 AbstractArrow.java:205-247, onHitBlock :497-516; 1.21.3
/// PersistentProjectileEntity.java tick, onBlockHit :466-471): in water the water inertia first
/// (from 1.21.4; 1.21.2-1.21.3 apply it after the move, which comes to the same), then the clip and
/// the move by the motion from the start of the tick; a hit moves the arrow to the hit, back by
/// 0.05F against the sign of each axis of its motion, and stops it; otherwise the air inertia out
/// of water and the gravity.
///
/// Before (1.21 PersistentProjectileEntity.java:198-277, onBlockHit :431-449): a hit sets the
/// motion to the hit's offset and moves the arrow back by 0.05F along it (from 1.14 by
/// Vec3.normalize; until 1.13.2 the offset is cast to float, 1.13.2 divides by MathHelper.sqrt *
/// 20.0F, 1.8.9-1.12.2 divide by MathHelper.sqrt and multiply by 0.05F: 1.13.2
/// AbstractArrowEntity.java:324-330, 1.12.2 :370-376, 1.8.9 EntityArrow.java:292-297); then the
/// arrow moves by that motion, which takes the water or the air inertia and the gravity, also on
/// the hit tick.
fn arrow_flight(
    position: &mut Vec3,
    velocity: &mut Vec3,
    motion: ArrowMotion,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    scene: &mut HitScene<'_>,
) -> Option<BlockHit> {
    let start = *position;
    if release.at_least(1, 21, 2) {
        return arrow_step_flight(position, velocity, motion, world, release, scene);
    }

    let mut hit = clip_blocks(world, start, *velocity, release, ClipShape::Collider);
    let to = hit.map_or(start + *velocity, |hit| hit.location);
    // The entity on the ray replaces the block, and is hit where the arrow is: an arrow does not
    // move to it. With pierce it looks again, and the block is forgotten. A target the owner may
    // not harm drops the hit, block included (1.8.9 EntityArrow.java:221-231, 1.14
    // ProjectileEntity.java:214-243, 1.20.5 PersistentProjectileEntity.java:188-205).
    while let Some(found) = scene.find_hits(start, to, *velocity, world, release).first().copied() {
        hit = None;
        let target = scene.targets[found.0];
        if target.friendly || (target.invulnerable_player && !release.at_least(1, 9, 0)) {
            break;
        }
        let deflected = scene.hit(found, velocity, release);
        if scene.removed || deflected || scene.pierce_level(release) == 0 {
            break;
        }
    }
    if scene.removed {
        return None;
    }
    if let Some(hit) = hit {
        if release.at_least(1, 14, 0) {
            let offset = hit.location - start;
            *velocity = offset;
            let back = offset.normalized(release).scale(f64::from(0.05_f32));
            *position = start - back;
        } else {
            let offset = Vec3::new(
                java_float(hit.location.x - start.x),
                java_float(hit.location.y - start.y),
                java_float(hit.location.z - start.z),
            );
            *velocity = offset;
            let length =
                (offset.x * offset.x + offset.y * offset.y + offset.z * offset.z).sqrt() as f32;
            *position = if release.at_least(1, 13, 0) {
                let divisor = f64::from(length * 20.0_f32);
                Vec3::new(
                    start.x - offset.x / divisor,
                    start.y - offset.y / divisor,
                    start.z - offset.z / divisor,
                )
            } else {
                let length = f64::from(length);
                let back = f64::from(0.05_f32);
                Vec3::new(
                    start.x - offset.x / length * back,
                    start.y - offset.y / length * back,
                    start.z - offset.z / length * back,
                )
            };
        }
    }
    *position = *position + *velocity;
    let inertia = if motion.in_water {
        motion.water_inertia
    } else {
        motion.air_drag
    };
    *velocity = velocity.scale(inertia);
    apply_arrow_gravity(velocity, motion.gravity, release);
    hit
}

/// The gravity of an arrow, a thrown item, a spit or a shulker bullet: y - 0.05F until 1.20.4 (1.20.4 PersistentProjectileEntity.java:244); from
/// 1.20.5 Entity.applyGravity adds (0, -gravity, 0) when there is gravity, which makes a -0 of the
/// other axes +0 (1.20.5 Entity.java:1116-1121, 26.3 :1567-1573).
fn apply_arrow_gravity(velocity: &mut Vec3, gravity: f64, release: MinecraftVersion) {
    if !release.at_least(1, 20, 5) {
        velocity.y -= gravity;
    } else if gravity != 0.0 {
        *velocity = *velocity + Vec3::new(0.0, -gravity, 0.0);
    }
}

/// AbstractArrow.stepMoveAndHit, from 1.21.2: the arrow moves to each hit in turn and ends on the
/// block's hit or at the end of the ray (client1.21.2 AbstractArrow.java:185-215, 1.21.5 :253-279,
/// 1.21.11 :253-285, 26.3 :258-292). Before 1.21.4 the water's inertia follows the move, which a
/// deflection's and the search box's motion can see.
fn arrow_step_flight(
    position: &mut Vec3,
    velocity: &mut Vec3,
    motion: ArrowMotion,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    scene: &mut HitScene<'_>,
) -> Option<BlockHit> {
    let start = *position;
    let movement = *velocity;
    let water_first = release.at_least(1, 21, 4);
    if motion.in_water && water_first {
        *velocity = velocity.scale(motion.water_inertia);
    }
    let block = clip_blocks(world, start, movement, release, ClipShape::Collider);
    let end = block.map_or(start + movement, |hit| hit.location);
    let mut result = None;
    loop {
        let here = *position;
        let found = scene.find_hits(here, end, *velocity, world, release);
        *position = found.first().map_or(end, |hit| hit.1);
        if found.is_empty() {
            let Some(hit) = block else { break };
            // a border hit reverses the arrow, which flies on (client1.21.2 Projectile.java:232-237,
            // AbstractArrow.java:765-767; 1.21.4 ProjectileEntity.java:254-259,
            // PersistentProjectileEntity.java:714-716; 26.3 Projectile.java:262-265,
            // AbstractArrow.java:776-778)
            if hit.border {
                *velocity = border_bounce(*velocity, release);
                result = Some(BlockHit {
                    bounced: true,
                    ..hit
                });
                break;
            }
            let offset_direction = Vec3::new(
                java_signum(velocity.x),
                java_signum(velocity.y),
                java_signum(velocity.z),
            );
            *position = hit.location - offset_direction.scale(f64::from(0.05_f32));
            *velocity = Vec3::ZERO;
            return Some(hit);
        }
        // hitTargetsOrDeflectSelf: every hit of the step, until one removes or deflects the arrow
        let mut deflected = false;
        for hit in found {
            deflected = scene.hit(hit, velocity, release);
            if scene.removed || deflected {
                break;
            }
        }
        if scene.removed {
            return None;
        }
        if scene.pierce_level(release) == 0 || deflected {
            break;
        }
    }
    if !motion.in_water {
        *velocity = velocity.scale(motion.air_drag);
    } else if !water_first {
        *velocity = velocity.scale(motion.water_inertia);
    }
    apply_arrow_gravity(velocity, motion.gravity, release);
    result
}

/// ProjectileDeflection.REVERSE by the border's 0.2: -0.5, then 0.2 (1.21.5 ProjectileDeflection.java:
/// 11-13, Projectile.java:235-238), and -power * 0.5 at once in 26.3 (26.3
/// ProjectileDeflection.java:12-14, Projectile.java:262-265).
pub(crate) fn border_bounce(velocity: Vec3, release: MinecraftVersion) -> Vec3 {
    if release.at_least(26, 3, 0) {
        velocity.scale(-0.2 * 0.5)
    } else {
        velocity.scale(-0.5).scale(0.2)
    }
}

/// EntityType.ARROW's 0.5F x 0.5F box, which the in-ground test inflates until 1.15 (1.15
/// ProjectileEntity tick, 1.13.2 AbstractArrowEntity tick).
pub(crate) fn arrow_box(position: Vec3) -> Aabb {
    let half_width = f64::from(0.5_f32 / 2.0);
    Aabb::new(
        Vec3::new(position.x - half_width, position.y, position.z - half_width),
        Vec3::new(
            position.x + half_width,
            position.y + f64::from(0.5_f32),
            position.z + half_width,
        ),
    )
}

/// Advances one projectile tick as the unversioned release (26.2) runs it.
#[must_use]
pub fn tick_projectile(state: &mut ProjectileState, world: &WorldSnapshot) -> ProjectileTickResult {
    tick_projectile_in_release(state, world, UNVERSIONED_RELEASE)
}

/// Advances one projectile tick of `release` by its family's own tick: ThrowableProjectile's for
/// the thrown items (and an unknown family), AbstractHurtingProjectile's for the fireballs and
/// the wither skull, and FireworkRocketEntity's, FishingHook's (from 1.11), LlamaSpit's and
/// ShulkerBullet's as the client runs them.
#[must_use]
pub fn tick_projectile_in_release(
    state: &mut ProjectileState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> ProjectileTickResult {
    let mut hits = ProjectileHitState::default();
    tick_family(state, world, release, &mut HitScene::new(&[], None, &mut hits))
}

/// The family's tick. A live scene makes it the server's (`tick_projectile_with_targets`).
fn tick_family(
    state: &mut ProjectileState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    scene: &mut HitScene<'_>,
) -> ProjectileTickResult {
    let result = match state.kind {
        kind if kind.is_hurting() => tick_hurting_projectile(state, world, release, scene),
        ProjectileKind::Firework => tick_firework(state, world, release, scene),
        ProjectileKind::FishingHook => tick_fishing_hook(state, world, release, scene),
        ProjectileKind::LlamaSpit => tick_llama_spit(state, world, release, scene),
        ProjectileKind::ShulkerBullet => tick_shulker_bullet(state, world, release, scene),
        kind if kind.is_arrow() => tick_arrow_flight(state, world, release),
        _ => tick_throwable(state, world, release, scene),
    };
    state.first_tick = false;
    result
}

/// An arrow or trident without its embedded state, which `tick_arrow_in_release` keeps: the flight
/// alone, by AbstractArrow's water inertia (0.6F, a trident's 0.99F).
fn tick_arrow_flight(
    state: &mut ProjectileState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> ProjectileTickResult {
    let water_inertia = if state.kind == ProjectileKind::Trident {
        ArrowMotion::TRIDENT_WATER_INERTIA
    } else {
        ArrowMotion::WATER_INERTIA
    };
    let hit = arrow_flight(
        &mut state.position,
        &mut state.velocity,
        ArrowMotion {
            gravity: state.gravity,
            air_drag: state.air_drag,
            water_inertia,
            in_water: state.in_water,
        },
        world,
        release,
        &mut HitScene::new(&[], None, &mut ProjectileHitState::default()),
    );
    ProjectileTickResult::of(state, hit.is_some_and(|hit| !hit.bounced), false)
}

/// ThrowableProjectile.tick. From 1.21.2 (1.21.2 ThrowableProjectile.java:43-62): the first
/// tick's bubble columns, gravity, inertia, then the hit test and the move by the new motion,
/// stopping at the hit, and the bubble columns along that move (applyEffectsFromBlocks). Before
/// (1.21.1 :39-66, 1.20.4 ThrownEntity.java:66-95, 1.8.9 EntityThrowable.java:188-230): the hit
/// test, from 1.16.2 the bubble columns of the box (checkBlockCollision/checkInsideBlocks, 1.16.5
/// ThrownEntity.java:71, 1.21.1 ThrowableProjectile.java:45; not in 1.16.1's), and the move by
/// the motion they leave, the full move even on a hit, then inertia and gravity.
fn tick_throwable(
    state: &mut ProjectileState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    scene: &mut HitScene<'_>,
) -> ProjectileTickResult {
    let inertia = if state.in_water {
        f64::from(0.8_f32)
    } else {
        state.air_drag
    };
    let shape = flight_clip_shape(state.kind, release);
    if release.at_least(1, 21, 2) {
        if state.first_tick {
            handle_first_tick_bubble_column(state, world, release);
        }
        apply_arrow_gravity(&mut state.velocity, state.gravity, release);
        state.velocity = state.velocity.scale(inertia);
        let start = state.position;
        let block = clip_blocks(world, start, state.velocity, release, shape);
        let hit = scene.flight_hit(start, state.velocity, block, false, release);
        state.position = hit.map_or(start + state.velocity, FlightHit::location);
        let body = projectile_body(state.position);
        let movements = [Movement {
            from: start,
            to: state.position,
            axis_order: None,
        }];
        let inside = blocks_visited(
            &movements,
            body.bounds(),
            body.half_width,
            body.height,
            release,
        );
        for (cell, precise) in inside {
            if precise {
                push_by_bubble_column(state, world, cell, release);
            }
        }
        scene.pending = hit;
        return ProjectileTickResult::of(state, hit.is_some_and(FlightHit::is_block), false);
    }
    scene.hits.flying_ticks = scene.hits.flying_ticks.wrapping_add(1);
    let block = clip_blocks(world, state.position, state.velocity, release, shape);
    let hit = scene.flight_hit(state.position, state.velocity, block, false, release);
    if let Some(hit) = hit {
        scene.hit_flight(hit, state, release);
    }
    if release.at_least(1, 16, 2) {
        for cell in blocks_inside(&projectile_body(state.position), release) {
            push_by_bubble_column(state, world, cell, release);
        }
    }
    let movement = state.velocity;
    state.position = state.position + movement;
    state.velocity = movement.scale(inertia);
    apply_arrow_gravity(&mut state.velocity, state.gravity, release);
    ProjectileTickResult::of(state, hit.is_some_and(FlightHit::is_block), false)
}

/// ThrowableProjectile.handleFirstTickBubbleColumn (1.21.2+, 1.21.2 ThrowableProjectile.java:83-95):
/// each bubble column cell of the box pushes the projectile (BlockPos.betweenClosed, z outer and
/// x fastest; from 26.3 Level.findBlocksIn, chunk sections x then z then y, and in a section y
/// outer and x fastest, 26.3 ThrowableProjectile.java:85-87, BlockScanUtils.java:27-101).
fn handle_first_tick_bubble_column(
    state: &mut ProjectileState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) {
    let bounds = projectile_box(state.position);
    let min = (
        floor_i32_for(release, bounds.min.x),
        floor_i32_for(release, bounds.min.y),
        floor_i32_for(release, bounds.min.z),
    );
    let max = (
        floor_i32_for(release, bounds.max.x),
        floor_i32_for(release, bounds.max.y),
        floor_i32_for(release, bounds.max.z),
    );
    let mut cells = Vec::new();
    if release.at_least(26, 3, 0) {
        let section = |value: i32| value >> 4;
        let low = |section: i32, min: i32| (section << 4).max(min);
        let high = |section: i32, max: i32| ((section << 4) + 15).min(max);
        for section_x in section(min.0)..=section(max.0) {
            for section_z in section(min.2)..=section(max.2) {
                for section_y in section(min.1)..=section(max.1) {
                    for y in low(section_y, min.1)..=high(section_y, max.1) {
                        for z in low(section_z, min.2)..=high(section_z, max.2) {
                            for x in low(section_x, min.0)..=high(section_x, max.0) {
                                cells.push((x, y, z));
                            }
                        }
                    }
                }
            }
        }
    } else {
        for z in min.2..=max.2 {
            for y in min.1..=max.1 {
                for x in min.0..=max.0 {
                    cells.push((x, y, z));
                }
            }
        }
    }
    for cell in cells {
        push_by_bubble_column(state, world, cell, release);
    }
}

/// BubbleColumnBlock.entityInside for a thrown item when `cell` is a bubble column: with nothing
/// above (air until 1.21.4; no collision shape and no fluid from 1.21.5) the surface push,
/// otherwise the inside push. Until 1.21.4 these are Entity's clamped
/// onBubbleColumnSurfaceCollision/onBubbleColumnCollision (1.21.4 Entity.java:2517-2540); from
/// 1.21.5 Projectile's unclamped onAboveBubbleColumn and onInsideBubbleColumn (1.21.5
/// Projectile.java:172-182), except the ender pearl's, which call Entity's clamped
/// handleOnAboveBubbleColumn/handleOnInsideBubbleColumn (1.21.5 ThrownEnderpearl.java:246-252,
/// Entity.java:2536-2547, 2563-2574; 26.3 ThrownEnderpearl.java:244-250).
fn push_by_bubble_column(
    state: &mut ProjectileState,
    world: &WorldSnapshot,
    (x, y, z): (i32, i32, i32),
    release: MinecraftVersion,
) {
    let drag_down = match world.effect_at((x, y, z)) {
        BlockEffect::BubbleDown => true,
        BlockEffect::BubbleUp => false,
        _ => return,
    };
    let above = (x, y + 1, z);
    let nothing_above = if release.at_least(1, 21, 5) {
        !world.has_collision_shape(above) && world.fluid_at(above) == FluidState::Empty
    } else {
        world.is_air_at(above)
    };
    let unclamped = release.at_least(1, 21, 5) && state.kind != ProjectileKind::EnderPearl;
    let velocity_y = state.velocity.y;
    state.velocity.y = match (unclamped, nothing_above, drag_down) {
        (true, _, true) => velocity_y + -0.03,
        (true, true, false) => velocity_y + 0.1,
        (true, false, false) => velocity_y + 0.06,
        (false, true, true) => (velocity_y - 0.03).max(-0.9),
        (false, true, false) => (velocity_y + 0.1).min(1.8),
        (false, false, true) => (velocity_y - 0.03).max(-0.3),
        (false, false, false) => (velocity_y + 0.06).min(0.7),
    };
}

/// AbstractHurtingProjectile.tick. From 1.21.2 the inertia comes first and the hit test and the
/// move take the new motion, stopping at the hit (1.21.2 AbstractHurtingProjectile.java:69-113);
/// before, the hit test and the full move take the old motion and the inertia follows (1.21.1
/// :66-108, 1.8.9 EntityFireball). The inertia adds the power, from 1.21 accelerationPower along
/// the motion's direction (1.21 ExplosiveProjectileEntity.java:99), before it the xPower vector
/// (1.20.6 :100), and scales by 0.8F in water or the air inertia (0.95F, WitherSkull's dangerous
/// 0.73F). A wind charge's liquid inertia is its 1.0F air inertia, and in 1.20.3-1.20.4 it clips
/// the outline shapes (1.21.11 AbstractWindCharge.java:128-135, 1.20.4 WindChargeEntity.java:112-130).
fn tick_hurting_projectile(
    state: &mut ProjectileState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    scene: &mut HitScene<'_>,
) -> ProjectileTickResult {
    // gone with its owner or out of the loaded level (1.8.9 ExplosiveProjectileEntity tick, 26.3
    // AbstractHurtingProjectile.java:69), after the inertia from 1.21.2
    let lost = scene.live
        && (scene.hits.chunk_unloaded || scene.owner.is_some_and(|owner| owner.removed));
    let wind_charge = state.kind == ProjectileKind::WindCharge;
    let inertia = if state.in_water && !wind_charge {
        f64::from(0.8_f32)
    } else {
        state.air_drag
    };
    let clip_shape = flight_clip_shape(state.kind, release);
    let accelerated = |state: &ProjectileState| {
        let push = if release.at_least(1, 21, 0) {
            state.velocity.normalized(release).scale(state.acceleration_power)
        } else {
            state.power
        };
        (state.velocity + push).scale(inertia)
    };
    if release.at_least(1, 21, 2) {
        state.velocity = accelerated(state);
        if lost {
            return ProjectileTickResult::of(state, false, true);
        }
        let (block, stuck) = flight_block(state, world, release, clip_shape, scene);
        let hit = scene.flight_hit(state.position, state.velocity, block, stuck, release);
        state.position = hit.map_or(state.position + state.velocity, FlightHit::location);
        scene.pending = hit;
        return ProjectileTickResult::of(state, hit.is_some_and(FlightHit::is_block), false);
    }
    if lost {
        return ProjectileTickResult::of(state, false, true);
    }
    scene.hits.flying_ticks = scene.hits.flying_ticks.wrapping_add(1);
    let (block, stuck) = flight_block(state, world, release, clip_shape, scene);
    let hit = scene.flight_hit(state.position, state.velocity, block, stuck, release);
    if let Some(hit) = hit {
        scene.hit_flight(hit, state, release);
    }
    state.position = state.position + state.velocity;
    state.velocity = accelerated(state);
    ProjectileTickResult::of(state, hit.is_some_and(FlightHit::is_block), false)
}

/// FireworkRocketEntity.tick for a rocket attached to a holder (from 1.11): it stands at it, at
/// the hand of a gliding player from 1.18.2 (Entity.getHandHoldingItemAngle, 1.18.1 has none, 1.19
/// Entity.java:1854-1862, 26.3 :2691-2699), and takes its motion (26.3 FireworkRocketEntity.java:119-137).
fn stay_with_holder(state: &mut ProjectileState, holder: RocketHolder, release: MinecraftVersion) {
    let hand = if holder.gliding && holder.player && release.at_least(1, 18, 2) {
        let side = if holder.left_hand { -80.0 } else { 80.0 };
        view_vector(0.0, holder.yaw_degrees + side, release).scale(0.5)
    } else {
        Vec3::ZERO
    };
    state.position = holder.position + hand;
    state.velocity = holder.velocity;
}

/// FireworkRocketEntity.tick for a rocket attached to no one: the boost (from 1.14 not for a
/// rocket shot at an angle, from 1.16.2 none along a horizontal collision), then Entity.move with
/// its collisions; from 1.16 the motion is put back as it was before the move (1.21.11
/// FireworkRocketEntity.java:139-149, 1.16 :29-35, 1.14 FireworkEntity, 1.8.9). The hit test
/// runs before the move from 1.21.2 and after it from 1.14, and moves nothing; a noPhysics
/// rocket acts on no hit (1.14 FireworkEntity.java:164, 1.20.4 :140, 1.21.3 :151, 26.3 :152).
/// A rocket has no hit test until 1.14 (1.13.2 FireworkRocketEntity tick). On a block in 1.14 and
/// 1.15 it acts only when the move collided, and at its own cell if the ray missed (1.14
/// FireworkEntity.java:220-236); from 1.16 on any block hit. It bursts at the end of its life
/// (26.3 FireworkRocketEntity.java:174-180, 1.8.9 tick).
fn tick_firework(
    state: &mut ProjectileState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    scene: &mut HitScene<'_>,
) -> ProjectileTickResult {
    // (an attached rocket only follows, and never flies again: 26.3 FireworkRocketEntity.java:108-138)
    let attached = scene.hits.attached && release.at_least(1, 11, 0);
    if attached {
        if let Some(holder) = scene.hits.holder {
            stay_with_holder(state, holder, release);
        }
    } else if !(state.shot_at_angle && release.at_least(1, 14, 0)) {
        let acceleration = if state.horizontal_collision && release.at_least(1, 16, 2) {
            1.0
        } else {
            1.15
        };
        state.velocity = state
            .velocity
            .multiply(Vec3::new(acceleration, 1.0, acceleration))
            + Vec3::new(0.0, 0.04, 0.0);
    }
    let movement = state.velocity;
    let query = |state: &ProjectileState, scene: &mut HitScene<'_>| {
        let block = clip_blocks(world, state.position, state.velocity, release, ClipShape::Collider);
        scene.flight_hit(state.position, state.velocity, block, false, release)
    };
    let mut hit = None;
    if release.at_least(1, 21, 2) {
        hit = query(state, scene);
    }
    let mut collided = false;
    if !attached {
        move_projectile(state, world, release, scene.live);
        collided = state.horizontal_collision || state.velocity.y != movement.y;
        if release.at_least(1, 16, 0) {
            state.velocity = movement;
        }
    }
    if release.at_least(1, 14, 0) && !release.at_least(1, 21, 2) {
        hit = query(state, scene);
    }
    let block_hit = hit.is_some_and(FlightHit::is_block) && !state.no_physics;
    if let Some(hit) = hit.filter(|_| !state.no_physics) {
        if release.at_least(1, 16, 0) || !hit.is_block() || collided {
            scene.hit_flight(hit, state, release);
        }
    } else if scene.live
        && !state.no_physics
        && collided
        && scene.hits.explodes
        && release.at_least(1, 14, 0)
        && !release.at_least(1, 16, 0)
    {
        scene.removed = true;
    }
    if scene.live {
        scene.hits.life = scene.hits.life.wrapping_add(1);
        scene.removed |= scene.hits.life_time.is_some_and(|life_time| scene.hits.life > life_time);
    }
    ProjectileTickResult::of(state, block_hit, false)
}

/// FishingHook.tick on the client for a hook in no entity (FLYING or BOBBING), from 1.11. A
/// flying hook that reaches water (FluidState.getHeight above 0 where it is) slows to
/// (0.3, 0.2, 0.3) and starts bobbing without moving. Otherwise: from 1.16 the hit test, whose
/// block hit sets the motion along its direction by the squared distance to the hit
/// (onHitBlock), and from 1.21.2 a border hit bounces it; before 1.16 a grounded or collided flying hook stops; a bobbing hook is pulled
/// towards the surface by `bob_random` (in 1.13 the water's own height, FluidState.getHeight
/// with no world until 1.14); -0.03 out of water (from 1.21.6 only off the ground, 1.21.6
/// FishingHook.java:228, 1.21.5 :218); Entity.move; from 1.16 a grounded or collided flying
/// hook stops; then 0.92 (1.21.11 FishingHook.java:149-247, 1.16.5 FishingBobberEntity.java,
/// 1.12.2 FishingBobberEntity.java).
/// The bite's pull uses the server-synced random and is left out.
///
/// As the server runs it (a live scene): a hook without a player owner, or one the owner stopped, is
/// gone; on the ground it counts to 1200 (1.11.2 FishingBobberEntity.java tick, 1.16 onGround, 26.3
/// FishingHook.java:147-162). From 1.16 the query is both sides', and only the server hooks; before,
/// the query is the server's, and a block sets inGround, which stops the hook as the ground does.
/// A hook with a target stops for a tick, then rides it at 0.8 of its height until it is removed,
/// from 1.21.9 until it cannot interact with the level either (1.8.9 and 1.11.2 minY + height * 0.8,
/// 26.3 getY(0.8); 1.21.9 FishingHook.java:192), when it flies again. From 1.21.6 a hooked hook
/// takes no gravity on the tick of its hit (1.21.6 FishingHook.java:234).
fn tick_fishing_hook(
    state: &mut ProjectileState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    scene: &mut HitScene<'_>,
) -> ProjectileTickResult {
    if scene.live && !release.at_least(1, 11, 0) {
        return tick_fishing_hook_before_1_11(state, world, release, scene);
    }
    if scene.live {
        if scene.hits.stop_fishing || !scene.owner.is_some_and(|owner| owner.player) {
            return ProjectileTickResult::of(state, false, true);
        }
        let grounded = if release.at_least(1, 16, 0) {
            state.on_ground
        } else {
            scene.hits.in_ground
        };
        if grounded {
            scene.hits.life = scene.hits.life.wrapping_add(1);
            if scene.hits.life >= 1200 {
                return ProjectileTickResult::of(state, false, true);
            }
        } else if release.at_least(1, 16, 0) {
            scene.hits.life = 0;
        }
    }
    let block = (
        floor_i32_for(release, state.position.x),
        floor_i32_for(release, state.position.y),
        floor_i32_for(release, state.position.z),
    );
    let in_water = is_water(world.fluid_at(block));
    let height = if in_water {
        water_height(world, block, release)
    } else {
        0.0
    };
    let modern = release.at_least(1, 16, 0);
    let mut hit = None;
    if !state.bobbing {
        if scene.live && !scene.hits.hook_settled && scene.hits.hooked.is_some() {
            state.velocity = Vec3::ZERO;
            scene.hits.hook_settled = true;
            return ProjectileTickResult::of(state, false, false);
        }
        if scene.live && scene.hits.hook_settled {
            let hooked = scene.hits.hooked;
            let rode = scene.targets.iter().find(|target| {
                Some(target.id) == hooked
                    && (!release.at_least(1, 21, 9) || (target.alive && !target.spectator))
            });
            if let Some(target) = rode {
                let height = f64::from((target.bounding_box.max.y - target.bounding_box.min.y) as f32);
                state.position = Vec3::new(
                    target.position.x,
                    target.bounding_box.min.y + height * 0.8,
                    target.position.z,
                );
            } else if hooked.is_some() {
                scene.hits.hooked = None;
                scene.hits.hook_settled = false;
            }
            return ProjectileTickResult::of(state, false, false);
        }
        if height > 0.0 {
            state.velocity = state.velocity.multiply(Vec3::new(0.3, 0.2, 0.3));
            state.bobbing = true;
            return ProjectileTickResult::of(state, false, false);
        }
        if modern {
            hit = clip_blocks(world, state.position, state.velocity, release, ClipShape::Collider);
            let found = scene.flight_hit(state.position, state.velocity, hit, false, release);
            if let Some(FlightHit::Entity(_)) = found {
                hit = None;
            }
            if let Some(found) = found {
                scene.hit_flight(found, state, release);
            }
            match hit {
                // a border hit bounces instead (client1.21.2 FishingHook.java:112-114, 26.3 :119-121),
                // which moves a client's hook until 26.2 and not in 26.3 (26.2 Projectile.java:229-237,
                // 26.3 :278-284)
                Some(hit) if hit.border => {
                    if !release.at_least(26, 3, 0) {
                        state.velocity = border_bounce(state.velocity, release);
                    }
                }
                Some(hit) => {
                    state.velocity = state.velocity.normalized(release)
                        .scale(hit.location.distance_squared(state.position));
                }
                None => {}
            }
        } else {
            if scene.live {
                let block = clip_blocks(world, state.position, state.velocity, release, ClipShape::Collider);
                match scene.flight_hit(state.position, state.velocity, block, false, release) {
                    Some(FlightHit::Block(block)) => {
                        scene.hits.in_ground = true;
                        scene.hit_flight(FlightHit::Block(block), state, release);
                    }
                    Some(found) => scene.hit_flight(found, state, release),
                    None => {}
                }
            }
            if scene.hits.in_ground || state.on_ground || state.horizontal_collision {
                scene.hits.flying_ticks = 0;
                state.velocity = Vec3::ZERO;
            } else {
                scene.hits.flying_ticks = scene.hits.flying_ticks.wrapping_add(1);
            }
        }
    } else {
        let mut distance =
            state.position.y + state.velocity.y - f64::from(block.1) - f64::from(height);
        if distance.abs() < 0.01 {
            distance += java_signum(distance) * 0.1;
        }
        state.velocity = Vec3::new(
            state.velocity.x * 0.9,
            state.velocity.y - distance * f64::from(state.bob_random) * 0.2,
            state.velocity.z * 0.9,
        );
    }
    let settled = release.at_least(1, 21, 6) && (state.on_ground || scene.hits.hooked.is_some());
    if !in_water && !settled {
        // (a Vec3's add from 1.14, 1.14 FishHookEntity tick, which makes +0 of a -0)
        state.velocity = if release.at_least(1, 14, 0) {
            state.velocity + Vec3::new(0.0, -state.gravity, 0.0)
        } else {
            Vec3::new(state.velocity.x, state.velocity.y - state.gravity, state.velocity.z)
        };
    }
    move_projectile(state, world, release, scene.live);
    if modern && !state.bobbing && (state.on_ground || state.horizontal_collision) {
        state.velocity = Vec3::ZERO;
    }
    state.velocity = state.velocity.scale(state.air_drag);
    ProjectileTickResult::of(state, hit.is_some_and(|hit| !hit.border), false)
}

/// EntityFishHook.onUpdate on the server before 1.11 (1.8.9 FishingBobberEntity.java tick, 1.9.4 and
/// 1.10.2 tick), another tick than the state machine of 1.11: a hook rides what it hit at once, in
/// 1.8 only if Entity.hurt accepted it. One that hit a block stands for a tick and comes free the
/// next, as its in-block test compares the block at (-1, -1, -1) with a block it never set: each
/// axis keeps random.nextFloat() * 0.2F (`ground_release`, the server's random), and the count of
/// its flight starts again. In the air it falls by 0.04F and keeps 0.92F of its motion, 0.5F against
/// a block; the five slices of its box in water lift it and slow it. Its bite's pulls are the
/// server's random, which no one sees and this leaves out.
fn tick_fishing_hook_before_1_11(
    state: &mut ProjectileState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    scene: &mut HitScene<'_>,
) -> ProjectileTickResult {
    if scene.hits.stop_fishing || !scene.owner.is_some_and(|owner| owner.player) {
        return ProjectileTickResult::of(state, false, true);
    }
    if let Some(id) = scene.hits.hooked {
        if let Some(target) = scene.targets.iter().find(|target| target.id == id) {
            let height = f64::from((target.bounding_box.max.y - target.bounding_box.min.y) as f32);
            state.position = Vec3::new(
                target.position.x,
                target.bounding_box.min.y + height * 0.8,
                target.position.z,
            );
            return ProjectileTickResult::of(state, false, false);
        }
        scene.hits.hooked = None;
    }
    if scene.hits.in_ground {
        scene.hits.in_ground = false;
        state.velocity = state.velocity.multiply(scene.hits.ground_release.unwrap_or(Vec3::ZERO));
        scene.hits.flying_ticks = 0;
    } else {
        scene.hits.flying_ticks = scene.hits.flying_ticks.wrapping_add(1);
    }
    let block = clip_blocks(world, state.position, state.velocity, release, ClipShape::Outline);
    let hit = scene.flight_hit(state.position, state.velocity, block, false, release);
    let mut block_hit = false;
    if let Some(hit) = hit {
        block_hit = hit.is_block();
        scene.hits.in_ground = block_hit;
        scene.hit_flight(hit, state, release);
    }
    if scene.hits.in_ground {
        return ProjectileTickResult::of(state, block_hit, false);
    }
    move_projectile(state, world, release, true);
    let mut inertia = if state.on_ground || state.horizontal_collision {
        0.5_f32
    } else {
        0.92_f32
    };
    let bounds = projectile_box(state.position);
    let height = bounds.max.y - bounds.min.y;
    let mut wet = 0.0;
    for slice in 0..5 {
        let low = bounds.min.y + height * f64::from(slice) / 5.0;
        let high = bounds.min.y + height * f64::from(slice + 1) / 5.0;
        let mut water = false;
        for x in bounds.min.x.floor() as i32..bounds.max.x.ceil() as i32 {
            for y in low.floor() as i32..high.ceil() as i32 {
                for z in bounds.min.z.floor() as i32..bounds.max.z.ceil() as i32 {
                    water |= is_water(world.fluid_at((x, y, z)));
                }
            }
        }
        if water {
            wet += 1.0 / 5.0;
        }
    }
    state.velocity.y += f64::from(0.04_f32) * (wet * 2.0 - 1.0);
    if wet > 0.0 {
        inertia = (f64::from(inertia) * 0.9) as f32;
        state.velocity.y *= 0.8;
    }
    state.velocity = state.velocity.scale(f64::from(inertia));
    ProjectileTickResult::of(state, block_hit, false)
}

/// LlamaSpit.tick (1.11+): the hit test and the move take the old motion; a spit in water (from
/// 1.13 until 1.21.4 also one whose block is a bubble column, isInsideWaterOrBubbleColumn), or
/// whose box has no air in it, is removed; otherwise 0.99F and gravity (1.21.11
/// LlamaSpit.java:36-54, 1.21.4 LlamaSpitEntity.java:54, 1.13.2 :121, 1.11.2 LlamaSpitEntity).
/// Before 1.15 the position is advanced before the removal (1.14 :79, 1.15 :79-81 only reads
/// it), and until 1.16 the box's cells run floor..ceil (World.containsMaterial); from 1.16
/// floor..=floor (BlockPos.betweenClosed).
///
/// As the server runs it, a hit comes between the query and the removals, and the spit goes on by
/// the motion from before it, so that a deflection only counts against the deflector (1.21
/// LlamaSpitEntity tick, 26.3 LlamaSpit.java:40-54).
fn tick_llama_spit(
    state: &mut ProjectileState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    scene: &mut HitScene<'_>,
) -> ProjectileTickResult {
    let movement = state.velocity;
    let block = clip_blocks(world, state.position, movement, release, flight_clip_shape(state.kind, release));
    let hit = scene.flight_hit(state.position, movement, block, false, release);
    if let Some(hit) = hit {
        scene.hit_flight(hit, state, release);
    }
    let block_hit = hit.is_some_and(FlightHit::is_block);
    let target = state.position + movement;
    let bounds = projectile_box(state.position);
    let modern = release.at_least(1, 16, 0);
    if !release.at_least(1, 15, 0) {
        state.position = target;
    }
    let cells = |min: f64, max: f64| {
        let low = floor_i32_for(release, min);
        if modern {
            low..floor_i32_for(release, max).wrapping_add(1)
        } else {
            low..ceil_i32_for(release, max)
        }
    };
    let mut has_air = false;
    for x in cells(bounds.min.x, bounds.max.x) {
        for y in cells(bounds.min.y, bounds.max.y) {
            for z in cells(bounds.min.z, bounds.max.z) {
                has_air |= world.is_air_at((x, y, z));
            }
        }
    }
    let in_bubble_column = release.at_least(1, 13, 0)
        && !release.at_least(1, 21, 5)
        && matches!(
            world.effect_at((
                floor_i32_for(release, state.position.x),
                floor_i32_for(release, state.position.y),
                floor_i32_for(release, state.position.z),
            )),
            BlockEffect::BubbleUp | BlockEffect::BubbleDown
        );
    if !has_air || state.in_water || in_bubble_column {
        return ProjectileTickResult::of(state, block_hit, true);
    }
    state.velocity = movement.scale(state.air_drag);
    apply_arrow_gravity(&mut state.velocity, state.gravity, release);
    state.position = target;
    ProjectileTickResult::of(state, block_hit, false)
}

/// ShulkerBullet.tick on the client: the steering, gravity and hit test run on the server only;
/// the bullet moves by its motion (1.21.11 ShulkerBullet.java:184-207, 1.9.4 ShulkerBulletEntity).
///
/// As the server runs it (a live scene): towards `bullet_delta`, each axis clamped to 1 after
/// growing by 1.025, a fifth of the way each tick; without one, by gravity. The query comes next,
/// and the move: after a hit until 1.21.1, before it from 1.21.2 (1.9.4 ShulkerBulletEntity tick,
/// 1.21 tick, 1.21.3 tick, 26.3 ShulkerBullet.java:187-219).
fn tick_shulker_bullet(
    state: &mut ProjectileState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    scene: &mut HitScene<'_>,
) -> ProjectileTickResult {
    if !scene.live {
        state.position = state.position + state.velocity;
        return ProjectileTickResult::of(state, false, false);
    }
    if scene.hits.peaceful {
        return ProjectileTickResult::of(state, false, true);
    }
    match scene.hits.bullet_delta {
        Some(delta) => {
            let grown = |value: f64| (value * 1.025).clamp(-1.0, 1.0);
            let delta = Vec3::new(grown(delta.x), grown(delta.y), grown(delta.z));
            let motion = state.velocity;
            state.velocity = Vec3::new(
                motion.x + (delta.x - motion.x) * 0.2,
                motion.y + (delta.y - motion.y) * 0.2,
                motion.z + (delta.z - motion.z) * 0.2,
            );
            scene.hits.bullet_delta = Some(delta);
        }
        None => apply_arrow_gravity(&mut state.velocity, state.gravity, release),
    }
    let (block, stuck) = flight_block(state, world, release, ClipShape::Collider, scene);
    let hit = scene.flight_hit(state.position, state.velocity, block, stuck, release);
    let moves_first = release.at_least(1, 21, 2);
    if !moves_first {
        if let Some(hit) = hit {
            scene.hit_flight(hit, state, release);
        }
    }
    state.position = state.position + state.velocity;
    if moves_first {
        if let Some(hit) = hit {
            scene.hit_flight(hit, state, release);
        }
    }
    ProjectileTickResult::of(state, hit.is_some_and(FlightHit::is_block), false)
}

/// Entity.move(SELF) of a 0.25-wide projectile by its motion, with the collision flags it leaves.
/// From 1.21.4 a move with no vertical part leaves onGround as it was on the client, where no
/// one controls the projectile, and clears it on the server, which is the authority on its own
/// entities (1.21.4 Entity.java:707, 1.21.5 :694-697). `server` is that side.
fn move_projectile(
    state: &mut ProjectileState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    server: bool,
) {
    if state.no_physics {
        // Entity.move's noPhysics branch keeps the flags until 1.21.9 clears the collisions, the
        // ground never (1.21.8 Entity.java:670-671, 1.21.9 :677-682); before 1.17 the box moves
        // and the entity follows it (1.13.2 Entity.java:565-566, 1.16.5 :607-609)
        state.position = if release.at_least(1, 17, 0) {
            state.position + state.velocity
        } else {
            position_of_bounding_box(projectile_box(state.position).translated(state.velocity))
        };
        if release.at_least(1, 21, 9) {
            state.horizontal_collision = false;
        }
        return;
    }
    let keeps_on_ground = !server && release.at_least(1, 21, 4) && state.velocity.y == 0.0;
    let on_ground = state.on_ground;
    let mut body = SimulationState {
        position: state.position,
        velocity: state.velocity,
        half_width: f64::from(PROJECTILE_SIZE / 2.0),
        height: f64::from(PROJECTILE_SIZE),
        on_ground: state.on_ground,
        collided_horizontally: state.horizontal_collision,
        controlled_by_local_instance: true,
        bounding_box: (!release.at_least(1, 17, 0))
            .then(|| state.bounding_box.unwrap_or_else(|| projectile_box(state.position))),
        ..SimulationState::default()
    };
    let movement = body.velocity;
    let _ = move_vehicle(
        &mut body,
        world,
        release,
        movement,
        PROJECTILE_MOVE,
        |_, _| {},
    );
    state.position = body.position;
    state.bounding_box = body.bounding_box;
    state.velocity = body.velocity;
    state.on_ground = if keeps_on_ground {
        on_ground
    } else {
        body.on_ground
    };
    state.horizontal_collision = body.collided_horizontally;
}

/// A 0.25F x 0.25F projectile as the block-effect queries see it.
fn projectile_body(position: Vec3) -> SimulationState {
    SimulationState {
        position,
        half_width: f64::from(PROJECTILE_SIZE / 2.0),
        height: f64::from(PROJECTILE_SIZE),
        ..SimulationState::default()
    }
}

/// EntityDimensions.makeBoundingBox of the 0.25F x 0.25F projectiles.
fn projectile_box(position: Vec3) -> Aabb {
    let half_width = f64::from(PROJECTILE_SIZE / 2.0);
    Aabb::new(
        Vec3::new(position.x - half_width, position.y, position.z - half_width),
        Vec3::new(
            position.x + half_width,
            position.y + f64::from(PROJECTILE_SIZE),
            position.z + half_width,
        ),
    )
}

/// The block shapes a clip tests: ClipContext.Block.COLLIDER, or OUTLINE (the 1.20.3 and 1.20.4
/// wind charge); or Entity.move's FALLDAMAGE_RESETTING with ClipContext.Fluid.WATER, where every
/// #fall_damage_resetting block is a full cube, from 1.21.9 the end gateway and end portal too for a
/// player (1.19 RaycastContext.java:72, 1.21.9 ClipContext.java:59-73), and the water's fluid shape
/// counts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ClipShape {
    Collider,
    Outline,
    FallDamageResetting { player: bool },
}

/// A block hit of a projectile's clip: where, and the block whose shape it hit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct BlockHit {
    pub(crate) location: Vec3,
    pub(crate) block: (i32, i32, i32),
    pub(crate) face: HitFace,
    /// BlockHitResult.isWorldBorderHit (from 1.21.2).
    pub(crate) border: bool,
    /// The border turned the arrow back, which is no hit.
    pub(crate) bounced: bool,
}

impl BlockHit {
    pub(crate) fn report(&self) -> ProjectileBlockHit {
        ProjectileBlockHit {
            block: self.block,
            face: self.face,
            location: self.location,
            border: self.border,
        }
    }
}

/// What a family's query found.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum FlightHit {
    Entity(Found),
    Block(BlockHit),
}

impl FlightHit {
    /// HitResult.getLocation: where a moved projectile stops.
    pub(crate) fn location(self) -> Vec3 {
        match self {
            Self::Entity((_, point)) => point,
            Self::Block(hit) => hit.location,
        }
    }

    pub(crate) const fn is_block(self) -> bool {
        matches!(self, Self::Block(_))
    }
}

/// The block shapes a family clips. The thrown items and llama spit clipped outlines until 1.16.1,
/// which a torch or tall grass stops (1.8.9 World.rayTrace(a, b) with nothing ignored, 1.15
/// ThrownEntity and LlamaSpitEntity with ShapeType.OUTLINE, 1.16 ThrownEntity.java:50, LlamaSpitEntity),
/// and colliders from 1.16.2 (1.16.5 ProjectileUtil.java:59-63). So did the 1.8 fireball (1.8.9
/// ExplosiveProjectileEntity), and ProjectileUtil's colliders hold from 1.9 (1.12.2
/// ProjectileUtil.java:27), but for the outlines of the wind charge of 1.20.3 and 1.20.4 (1.20.4
/// WindChargeEntity.getRaycastShapeType, gone in 1.20.5).
fn flight_clip_shape(kind: ProjectileKind, release: MinecraftVersion) -> ClipShape {
    let outline = match kind {
        ProjectileKind::WindCharge => !release.at_least(1, 20, 5),
        ProjectileKind::LlamaSpit => !release.at_least(1, 16, 2),
        _ if kind.is_thrown() => !release.at_least(1, 16, 2),
        _ if kind.is_hurting() => !release.at_least(1, 9, 0),
        _ => false,
    };
    if outline {
        ClipShape::Outline
    } else {
        ClipShape::Collider
    }
}

/// What a hurting projectile or shulker bullet's clip gives, and whether it is the test of 1.13 to
/// 1.15 that the projectile's box lies in a block: that answers with the projectile's own cell and
/// its own position, before any clip (1.13.2 ProjectileUtil.java:27-30, 1.15 ProjectileUtil.java:
/// 100-103; gone in 1.16). The test also meets hard entities, which are not modelled here.
fn flight_block(
    state: &ProjectileState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    shape: ClipShape,
    scene: &HitScene<'_>,
) -> (Option<BlockHit>, bool) {
    let tests_box = scene.live && release.at_least(1, 13, 0) && !release.at_least(1, 16, 0);
    if tests_box && !no_block_collision(world, state.kind.bounding_box(state.position), release) {
        let position = state.position;
        let v = state.velocity;
        let hit = BlockHit {
            location: position,
            block: (position.x.floor() as i32, position.y.floor() as i32, position.z.floor() as i32),
            face: HitFace::nearest(v.x as f32, v.y as f32, v.z as f32),
            border: false,
            bounced: false,
        };
        return (Some(hit), true);
    }
    (clip_blocks(world, state.position, state.velocity, release, shape), false)
}

/// BlockGetter.clip with ClipContext.Fluid.NONE: BlockGetter.traverseBlocks visits the cells along
/// the segment, from the start nudged back by 1.0E-7 of the segment, and the first cell whose shape
/// the segment hits gives the hit (26.2 BlockGetter.java:63-80, :110-163; 1.14 BlockView). From
/// 1.21.2 clipIncludingBorder: a clip starting inside the border that ends outside it, on a block
/// or at its end, hits the border at the clamped end (1.21.2 CollisionGetter.java:119-130,
/// ProjectileUtil.java:51; 1.21.1 ProjectileUtil.java has the plain clip; 26.3 CollisionGetter.java:
/// 114-125, ProjectileUtil.java:67, AbstractArrow.java:236).
pub(crate) fn clip_blocks(
    world: &WorldSnapshot,
    from: Vec3,
    movement: Vec3,
    release: MinecraftVersion,
    shape: ClipShape,
) -> Option<BlockHit> {
    let to = from + movement;
    let hit = clip_blocks_between(world, from, to, release, shape);
    if !release.at_least(1, 21, 2) {
        return hit;
    }
    let end = hit.map_or(to, |hit| hit.location);
    if world.is_inside_world_border(from, release) && !world.is_inside_world_border(end, release) {
        let location = world.clamp_to_world_border(end, release);
        let block = (
            floor_i32_for(release, location.x),
            floor_i32_for(release, location.y),
            floor_i32_for(release, location.z),
        );
        // Direction.getApproximateNearest of the way there (26.3 CollisionGetter.java:118)
        let delta = end - from;
        return Some(BlockHit {
            location,
            block,
            face: HitFace::nearest(delta.x as f32, delta.y as f32, delta.z as f32),
            border: true,
            bounced: false,
        });
    }
    hit
}

/// Whether BlockGetter.clip from `from` to `to` hits a block (or, for FALLDAMAGE_RESETTING, water).
pub(crate) fn clip_hits(
    world: &WorldSnapshot,
    from: Vec3,
    to: Vec3,
    release: MinecraftVersion,
    shape: ClipShape,
) -> bool {
    clip_blocks_between(world, from, to, release, shape).is_some()
}

fn clip_blocks_between(
    world: &WorldSnapshot,
    from: Vec3,
    to: Vec3,
    release: MinecraftVersion,
    shape: ClipShape,
) -> Option<BlockHit> {
    if from == to {
        return None;
    }
    if !release.at_least(1, 13, 0) {
        return clip_blocks_legacy(world, from, to, release, shape);
    }
    let lerp = |delta: f64, start: f64, end: f64| start + delta * (end - start);
    let end = Vec3::new(
        lerp(-1.0e-7, to.x, from.x),
        lerp(-1.0e-7, to.y, from.y),
        lerp(-1.0e-7, to.z, from.z),
    );
    let start = Vec3::new(
        lerp(-1.0e-7, from.x, to.x),
        lerp(-1.0e-7, from.y, to.y),
        lerp(-1.0e-7, from.z, to.z),
    );
    let mut block = (
        floor_i32_for(release, start.x),
        floor_i32_for(release, start.y),
        floor_i32_for(release, start.z),
    );
    if let Some((location, face)) = clip_block(world, block, from, to, release, shape) {
        return Some(BlockHit {
            location,
            block,
            face,
            border: false,
            bounced: false,
        });
    }
    let sign = |value: f64| {
        if value > 0.0 {
            1
        } else if value < 0.0 {
            -1
        } else {
            0
        }
    };
    let frac = |value: f64| frac_f64_for(release, value);
    let delta = end - start;
    let (step_x, step_y, step_z) = (sign(delta.x), sign(delta.y), sign(delta.z));
    let advance = |step: i32, delta: f64| {
        if step == 0 {
            f64::MAX
        } else {
            f64::from(step) / delta
        }
    };
    let (advance_x, advance_y, advance_z) = (
        advance(step_x, delta.x),
        advance(step_y, delta.y),
        advance(step_z, delta.z),
    );
    let next = |step: i32, advance: f64, start: f64| {
        advance * if step > 0 { 1.0 - frac(start) } else { frac(start) }
    };
    let mut next_x = next(step_x, advance_x, start.x);
    let mut next_y = next(step_y, advance_y, start.y);
    let mut next_z = next(step_z, advance_z, start.z);
    while next_x <= 1.0 || next_y <= 1.0 || next_z <= 1.0 {
        if next_x < next_y {
            if next_x < next_z {
                block.0 += step_x;
                next_x += advance_x;
            } else {
                block.2 += step_z;
                next_z += advance_z;
            }
        } else if next_y < next_z {
            block.1 += step_y;
            next_y += advance_y;
        } else {
            block.2 += step_z;
            next_z += advance_z;
        }
        if let Some((location, face)) = clip_block(world, block, from, to, release, shape) {
            return Some(BlockHit {
                location,
                block,
                face,
                border: false,
                bounced: false,
            });
        }
    }
    None
}

/// World.rayTrace before 1.13 (1.8.9 World.java:811-935, 1.12.2 the same on this side): each step
/// moves the ray's start to the cell's edge, and each block clips what is left of the ray, whose
/// last sliver a Vec3d's per-axis cutoff can miss. Up to 201 steps.
fn clip_blocks_legacy(
    world: &WorldSnapshot,
    from: Vec3,
    to: Vec3,
    release: MinecraftVersion,
    shape: ClipShape,
) -> Option<BlockHit> {
    let end = (to.x.floor() as i32, to.y.floor() as i32, to.z.floor() as i32);
    let mut start = from;
    let mut block = (from.x.floor() as i32, from.y.floor() as i32, from.z.floor() as i32);
    let hit_at = |block: (i32, i32, i32), start: Vec3| {
        clip_block(world, block, start, to, release, shape).map(|(location, face)| BlockHit {
            location,
            block,
            face,
            border: false,
            bounced: false,
        })
    };
    if let Some(hit) = hit_at(block, start) {
        return Some(hit);
    }
    let plane = |target: i32, at: i32| match target.cmp(&at) {
        std::cmp::Ordering::Greater => Some(f64::from(at) + 1.0),
        std::cmp::Ordering::Less => Some(f64::from(at)),
        std::cmp::Ordering::Equal => None,
    };
    for _ in 0..=200 {
        if block == end {
            return None;
        }
        let delta = to - start;
        let along = |edge: Option<f64>, at: f64, step: f64| {
            let part = edge.map_or(999.0, |edge| (edge - at) / step);
            // (a -0.0 means a start on the edge, going back)
            if part == 0.0 && part.is_sign_negative() {
                -1.0e-4
            } else {
                part
            }
        };
        let (edge_x, edge_y, edge_z) = (plane(end.0, block.0), plane(end.1, block.1), plane(end.2, block.2));
        let (x, y, z) = (along(edge_x, start.x, delta.x), along(edge_y, start.y, delta.y), along(edge_z, start.z, delta.z));
        let (mut west_low, mut down_low, mut north_low) = (0, 0, 0);
        if x < y && x < z {
            west_low = i32::from(end.0 <= block.0);
            start = Vec3::new(edge_x.unwrap_or(999.0), start.y + delta.y * x, start.z + delta.z * x);
        } else if y < z {
            down_low = i32::from(end.1 <= block.1);
            start = Vec3::new(start.x + delta.x * y, edge_y.unwrap_or(999.0), start.z + delta.z * y);
        } else {
            north_low = i32::from(end.2 <= block.2);
            start = Vec3::new(start.x + delta.x * z, start.y + delta.y * z, edge_z.unwrap_or(999.0));
        }
        block = (
            start.x.floor() as i32 - west_low,
            start.y.floor() as i32 - down_low,
            start.z.floor() as i32 - north_low,
        );
        if let Some(hit) = hit_at(block, start) {
            return Some(hit);
        }
    }
    None
}

/// VoxelShape.clip of the block at `block` (26.2 VoxelShape.java:119-131, 1.13.2 rayTrace:150-165):
/// from 1.13 a segment shorter than sqrt(1.0E-7) hits nothing, and one whose point 0.001 of the
/// way along is inside the shape hits there; otherwise AABB.clip, the nearest entering face of the
/// boxes. Before 1.13 the block clips six faces in local coordinates instead.
/// An unloaded chunk is air on the client. This does not replace the shared cell
/// walker with legacy World.rayTrace or model block-specific multi-box selectors.
pub(crate) fn clip_block(
    world: &WorldSnapshot,
    block: (i32, i32, i32),
    from: Vec3,
    to: Vec3,
    release: MinecraftVersion,
    shape: ClipShape,
) -> Option<(Vec3, HitFace)> {
    if !world.is_chunk_loaded(block.0.div_euclid(16), block.2.div_euclid(16)) {
        return None;
    }
    if !release.at_least(1, 13, 0) {
        return clip_block_legacy(world, block, from, to, shape);
    }
    let boxes = match shape {
        ClipShape::Collider => world.block_collision_boxes(block),
        ClipShape::Outline => world.block_outline_boxes(block),
        ClipShape::FallDamageResetting { player } => {
            fall_damage_resetting_boxes(world, block, player, release)
        }
    };
    if boxes.is_empty() {
        return None;
    }
    if release.at_least(1, 13, 0) {
        let delta = to - from;
        if delta.length_squared() < 1.0e-7 {
            return None;
        }
        let inside = from + delta.scale(0.001);
        if boxes.iter().any(|bounds| bounds.contains(inside)) {
            let face = HitFace::nearest(delta.x as f32, delta.y as f32, delta.z as f32);
            return Some((inside, face.opposite()));
        }
    }
    let delta = to - from;
    let mut best = 1.0;
    let mut hit = None;
    for bounds in boxes {
        bounds.clip_faces(from, delta, &mut best, &mut hit);
    }
    hit.map(|face| (from + delta.scale(best), face))
}

/// Block.method_11559 (1.9.4 Block.java:492-496, 1.12.2 :520-524) subtracts
/// the cell before clipping, then adds it back. Translating the box into world
/// coordinates instead changes rounding, particularly at large coordinates.
fn clip_block_legacy(
    world: &WorldSnapshot,
    block: (i32, i32, i32),
    from: Vec3,
    to: Vec3,
    shape: ClipShape,
) -> Option<(Vec3, HitFace)> {
    let (collision, outline, _) = world.block_geometry(block);
    let boxes = match shape {
        ClipShape::Collider => collision,
        ClipShape::Outline => outline,
        // This query is only used by the 1.21.2+ fall-distance reset path.
        ClipShape::FallDamageResetting { .. } => return None,
    };
    let offset = Vec3::new(f64::from(block.0), f64::from(block.1), f64::from(block.2));
    // Every subtract/add here constructs a legacy Vec3d, including zero normalization.
    let vector = |value: Vec3| {
        let zero = |coordinate: f64| if coordinate == 0.0 { 0.0 } else { coordinate };
        Vec3::new(zero(value.x), zero(value.y), zero(value.z))
    };
    let local_from = vector(from - offset);
    let local_to = vector(to - offset);
    let mut nearest = None;
    for shape in boxes {
        let bounds = shape.bounds;
        if bounds.x_size() <= 0.0 || bounds.y_size() <= 0.0 || bounds.z_size() <= 0.0 {
            continue;
        }
        if let Some((local_hit, face)) = bounds.clip_segment_legacy_face(local_from, local_to) {
            let hit = vector(local_hit + offset);
            let distance = from.distance_squared(hit);
            // Retain the shared nearest-box selection. Legacy per-block selectors,
            // such as StairsBlock's farthest-from-end rule, are a separate contract.
            if nearest.map_or(true, |(best, _, _)| distance < best) {
                nearest = Some((distance, hit, face));
            }
        }
    }
    nearest.map(|(_, hit, face)| (hit, face))
}

/// The shapes FALLDAMAGE_RESETTING and Fluid.WATER give the cell: a full cube for a resetting
/// block, and the water's FluidState.getShape, a box up to its height (BlockGetter.clip takes the
/// nearer of the block and fluid hits, so either one hits).
fn fall_damage_resetting_boxes(
    world: &WorldSnapshot,
    block: (i32, i32, i32),
    player: bool,
    release: MinecraftVersion,
) -> Vec<Aabb> {
    let state = world.block(block);
    let origin = Vec3::new(f64::from(block.0), f64::from(block.1), f64::from(block.2));
    let mut boxes = Vec::new();
    if state.fall_damage_resetting
        || (player && release.at_least(1, 21, 9) && state.player_fall_damage_resetting)
    {
        boxes.push(Aabb::new(origin, origin + Vec3::new(1.0, 1.0, 1.0)));
    }
    if is_water(state.fluid) {
        let height = world.fluid_height_at(block);
        boxes.push(Aabb::new(origin, origin + Vec3::new(1.0, height, 1.0)));
    }
    boxes
}

/// Whether no block collision box overlaps `query` (Level.noCollision for the blocks).
fn no_block_collision(world: &WorldSnapshot, query: Aabb, release: MinecraftVersion) -> bool {
    !world
        .collision_shapes(query, release)
        .iter()
        .any(|bounds| bounds.intersects(query))
}

/// Math.signum: zero stays zero.
fn java_signum(value: f64) -> f64 {
    if value > 0.0 {
        1.0
    } else if value < 0.0 {
        -1.0
    } else {
        value
    }
}

/// The block collider the segment from `start` along `movement` meets first.
#[cfg(test)]
fn nearest_block_hit(
    world: &WorldSnapshot,
    start: Vec3,
    movement: Vec3,
    release: MinecraftVersion,
) -> Option<Vec3> {
    clip_blocks(world, start, movement, release, ClipShape::Collider).map(|hit| hit.location)
}

#[cfg(test)]
mod tests {
    use super::{
        tick_arrow, tick_arrow_in_release, tick_arrow_in_world, tick_projectile,
        tick_projectile_in_release, tick_projectile_in_world,
        clip_blocks, clip_hits, tick_trident, tick_trident_in_release, tick_trident_in_world,
        ArrowState, ClipShape, ProjectileKind, ProjectileState,
        TridentState,
    };
    use crate::math::{Aabb, Vec3};
    use crate::version::MinecraftVersion;
    use crate::world::{BlockEffect, BlockShape, BlockState, FluidState, WorldSnapshot};

    fn full_block_world(position: (i32, i32, i32)) -> WorldSnapshot {
        let mut world = WorldSnapshot::new();
        world.set_block(
            position,
            BlockState {
                shape: Some(BlockShape::full_block()),
                outline_shape: Some(BlockShape::full_block()),
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
            ultra_warm: false,
            first_tick: false,
            kind: ProjectileKind::Generic,
            horizontal_collision: false,
            shot_at_angle: false,
            ..ProjectileState::new(Vec3::ZERO, Vec3::ZERO)
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
        // ExplosiveProjectileEntity.getDrag returns 0.95F (1.20.4 :131-132)
        assert_eq!(ProjectileKind::Fireball.default_air_drag(), f64::from(0.95_f32));
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
            ..ProjectileState::new(Vec3::ZERO, Vec3::ZERO)
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
            last_block_position: None,
            no_physics: false,
            ultra_warm: false,
        };

        let result = tick_arrow(&mut state, &WorldSnapshot::new());

        assert_eq!(result.position, Vec3::new(1.0, 1.0, 0.0));
        assert!((result.velocity.x - 0.99).abs() < 1.0e-12);
        assert!((result.velocity.y - 0.94).abs() < 1.0e-12);
    }

    #[test]
    fn arrow_in_water_moves_by_the_motion_from_the_start_of_the_tick() {
        // 26.2 AbstractArrow.java:212-243: the water inertia scales the motion, the clip and the
        // move take the movement captured before it (1.21.1 :239-277 moves, then drags)
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
            last_block_position: None,
            no_physics: false,
            ultra_warm: false,
        };

        let result = tick_arrow(&mut state, &WorldSnapshot::new());

        assert_eq!(result.position, Vec3::new(1.0, 1.0, 0.0));
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
            last_block_position: None,
            no_physics: false,
            ultra_warm: false,
        };

        // 26.2 AbstractArrow.java:536-554 (1.21.11 :497-516): the hit position less
        // signum(v) * 0.05F, v = 0; inGroundTime stays 0 on the hit tick (:205-206), shake is 7
        let hit = tick_arrow(&mut state, &world);
        assert!(hit.block_hit);
        assert!(hit.in_ground);
        assert!(!hit.started_falling);
        assert_eq!(hit.position, Vec3::new(1.0 - 0.05000000074505806, 0.5, 0.5));
        assert_eq!(hit.velocity, Vec3::ZERO);
        assert_eq!(hit.in_ground_time, 0);
        assert_eq!(hit.shake_time, 7);
        assert_eq!(state.last_block_position, Some((1, 0, 0)));

        // 1.21.11 AbstractArrow.java:180-197: shakeTime counts down first, inGroundTime counts up
        let resting = tick_arrow(&mut state, &world);
        assert!(!resting.block_hit);
        assert!(resting.in_ground);
        assert_eq!(resting.velocity, Vec3::ZERO);
        assert_eq!(resting.in_ground_time, 1);
        assert_eq!(resting.shake_time, 6);
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
            last_block_position: None,
            no_physics: false,
            ultra_warm: false,
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
            last_block_position: None,
            no_physics: false,
            ultra_warm: false,
        };

        let result = tick_arrow(&mut state, &WorldSnapshot::new());

        assert!(result.started_falling);
        assert!(!result.in_ground);
        assert_eq!(result.position, state.position);
        assert!((result.velocity.x - 0.1).abs() < 1.0e-12);
        assert!((result.velocity.y - 0.4).abs() < 1.0e-12);
        assert!((result.velocity.z - 0.9).abs() < 1.0e-12);
        assert_eq!(state.life, 0);
        // 1.21.11 AbstractArrow.java:180-197: the startFalling tick still runs inGroundTime++
        assert_eq!(result.in_ground_time, 13);
        assert_eq!(result.shake_time, 2);
    }

    #[test]
    fn arrow_stays_when_its_block_is_replaced_by_another_solid_block() {
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
            last_block_position: None,
            no_physics: false,
            ultra_warm: false,
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

        // 1.21.11 AbstractArrow.java:190 and :312-314: it falls only when the state differs AND
        // nothing collides with its point inflated by 0.06; the pulled-back point is 0.05 from
        // the replacement block
        let result = tick_arrow(&mut state, &world);

        assert_eq!(state.last_block_id, Some(11));
        assert!(!result.started_falling);
        assert!(result.in_ground);
        assert_eq!(state.life, 1);

        world.set_block((1, 0, 0), BlockState::default());
        let removed = tick_arrow(&mut state, &world);
        assert!(removed.started_falling);
        assert!(!removed.in_ground);
        assert_eq!(state.life, 0);
    }

    #[test]
    fn trident_uses_99_percent_water_inertia_and_arrow_gravity() {
        let mut state = TridentState::new(Vec3::ZERO, Vec3::new(1.0, 1.0, 0.0));
        state.in_water = true;
        let result = tick_trident(&mut state, &WorldSnapshot::new());

        // 26.2 AbstractArrow.java:166-253 with ThrownTrident's 0.99F water inertia: the move by
        // the motion from the start of the tick, one 0.99F, then the 0.05 gravity
        assert_eq!(result.position, Vec3::new(1.0, 1.0, 0.0));
        assert_eq!(result.velocity.x, f64::from(0.99_f32));
        assert_eq!(result.velocity.y, f64::from(0.99_f32) - 0.05);
        assert!(!result.block_hit);
    }

    #[test]
    fn trident_hit_pulls_back_by_0_05_and_stops() {
        // 26.2 AbstractArrow.java:536-554: pos - signum(v) * 0.05000000074505806, v = 0
        let world = full_block_world((1, 0, 0));
        let mut state = TridentState::new(Vec3::new(0.5, 0.5, 0.5), Vec3::new(2.0, 0.0, 0.0));
        let result = tick_trident(&mut state, &world);

        assert!(result.block_hit);
        assert_eq!(
            result.position,
            Vec3::new(1.0 - 0.05000000074505806, 0.5, 0.5)
        );
        assert_eq!(result.velocity, Vec3::ZERO);
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
            ultra_warm: false,
            first_tick: false,
            kind: ProjectileKind::Firework,
            horizontal_collision: false,
            shot_at_angle: false,
            ..ProjectileState::new(Vec3::ZERO, Vec3::ZERO)
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
            ultra_warm: false,
            first_tick: false,
            kind: ProjectileKind::Firework,
            horizontal_collision: true,
            shot_at_angle: false,
            ..ProjectileState::new(Vec3::ZERO, Vec3::ZERO)
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
            ultra_warm: false,
            first_tick: false,
            kind: ProjectileKind::Firework,
            horizontal_collision: false,
            shot_at_angle: true,
            ..ProjectileState::new(Vec3::ZERO, Vec3::ZERO)
        };
        let angled_result = tick_projectile(&mut angled, &WorldSnapshot::new());
        assert_eq!(angled_result.velocity.x, 1.0);
        assert_eq!(angled_result.velocity.z, 1.0);
        assert_eq!(angled_result.velocity.y, 0.0);
    }

    #[test]
    fn hurting_projectile_applies_inertia_before_the_move() {
        // 26.2 AbstractHurtingProjectile.java:96-144: applyInertia (v + normalize(v) *
        // accelerationPower) * inertia, then the move by the new motion; the power vector is
        // pre-1.21 only and the gravity is not used
        let mut state = ProjectileState {
            position: Vec3::ZERO,
            velocity: Vec3::new(1.0, 0.0, 0.0),
            gravity: 0.05,
            air_drag: 0.95,
            power: Vec3::new(0.1, 0.0, 0.0),
            in_water: false,
            ultra_warm: false,
            first_tick: false,
            kind: ProjectileKind::Fireball,
            horizontal_collision: false,
            shot_at_angle: false,
            ..ProjectileState::new(Vec3::ZERO, Vec3::ZERO)
        };

        let result = tick_projectile(&mut state, &WorldSnapshot::new());

        assert_eq!(result.velocity.x, (1.0 + 0.1) * 0.95);
        assert_eq!(result.position, Vec3::new((1.0 + 0.1) * 0.95, 0.0, 0.0));
        assert_eq!(result.velocity.y, 0.0);
    }

    #[test]
    fn first_tick_applies_bubble_column_effect_before_gravity() {
        // 1.21.2 ThrowableProjectile.java:43-57 (26.2 the same): the first tick's column under air
        // (+0.1), the gravity, the move to y 0.17, then applyEffectsFromBlocks pushes again
        let mut world = WorldSnapshot::new();
        world.set_block((0, 0, 0), bubble_column(false));
        let mut state = ProjectileState {
            position: Vec3::new(0.5, 0.1, 0.5),
            velocity: Vec3::ZERO,
            gravity: 0.03,
            air_drag: 1.0,
            power: Vec3::ZERO,
            in_water: false,
            ultra_warm: false,
            first_tick: true,
            kind: ProjectileKind::Generic,
            horizontal_collision: false,
            shot_at_angle: false,
            ..ProjectileState::new(Vec3::ZERO, Vec3::ZERO)
        };

        let _ = tick_projectile(&mut state, &world);

        assert_eq!(state.position.y, 0.1 + (0.0 + 0.1 - 0.03));
        assert_eq!(state.velocity.y, 0.0 + 0.1 - 0.03 + 0.1);
        assert!(!state.first_tick);

        // and every tick after, not only the first (1.21.2 ThrowableProjectile.java:56)
        let _ = tick_projectile(&mut state, &world);
        assert_eq!(state.velocity.y, 0.0 + 0.1 - 0.03 + 0.1 - 0.03 + 0.1);
    }

    #[test]
    fn legacy_throwable_takes_the_box_bubble_columns_before_the_move_from_1_16_2() {
        // 1.21.1 ThrowableProjectile.java:45 (1.20.5 ThrownEntity.java tick, 1.16.5 :71):
        // checkInsideBlocks after the hit test, before the motion is read for the move; the
        // column under air is Entity.onBubbleColumnSurfaceCollision's min(1.8, v + 0.1) (1.20.5
        // Entity.java:2305-2316, BubbleColumnBlock.java:46-49). 1.16.1 ThrowableProjectile.tick
        // and 1.16 ThrownEntity.tick have no such call
        let mut world = WorldSnapshot::new();
        world.set_block((0, 0, 0), bubble_column(false));
        let start = ProjectileState {
            position: Vec3::new(0.5, 0.1, 0.5),
            velocity: Vec3::ZERO,
            gravity: 0.03,
            air_drag: 1.0,
            first_tick: true,
            ..ProjectileState::new(Vec3::ZERO, Vec3::ZERO)
        };

        for version in [release(1, 16, 2), release(1, 21, 1)] {
            let mut state = start;
            let _ = tick_projectile_in_release(&mut state, &world, version);
            assert_eq!(state.position.y, 0.1 + 0.1);
            assert_eq!(state.velocity.y, 0.1 - 0.03);
            assert!(!state.first_tick);
        }

        let mut state = start;
        let _ = tick_projectile_in_release(&mut state, &world, release(1, 16, 1));
        assert_eq!(state.position.y, 0.1);
        assert_eq!(state.velocity.y, -0.03);
    }

    #[test]
    fn first_tick_inside_downward_bubble_column_uses_inside_limit() {
        let mut world = WorldSnapshot::new();
        world.set_block((0, 0, 0), bubble_column(true));
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
            ultra_warm: false,
            first_tick: true,
            kind: ProjectileKind::Generic,
            horizontal_collision: false,
            shot_at_angle: false,
            ..ProjectileState::new(Vec3::ZERO, Vec3::ZERO)
        };
        let mut clamped = state;
        let _ = tick_projectile(&mut state, &world);
        let _ = tick_projectile_in_release(&mut clamped, &world, release(1, 21, 4));

        // Projectile.onInsideBubbleColumn adds -0.03 unclamped from 1.21.5 (1.21.5
        // Projectile.java:178-182), on the first tick and again in applyEffectsFromBlocks after the
        // move (1.21.5 ThrowableProjectile.java:57); Entity.onBubbleColumnCollision clamps it at
        // -0.3 until 1.21.4 (1.21.4 Entity.java:2529-2540)
        assert_eq!(state.velocity.y, -0.29 + -0.03 + -0.03);
        assert_eq!(clamped.velocity.y, -0.3);
    }

    fn release(major: u16, minor: u16, patch: u16) -> MinecraftVersion {
        MinecraftVersion::new(major, minor, patch)
    }

    fn thrown(kind: ProjectileKind, position: Vec3, velocity: Vec3) -> ProjectileState {
        ProjectileState {
            first_tick: false,
            ..ProjectileState::for_kind(kind, position, velocity)
        }
    }

    fn bubble_column(drag_down: bool) -> BlockState {
        BlockState {
            id: 13,
            shape: Some(BlockShape {
                bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                effect: if drag_down {
                    BlockEffect::BubbleDown
                } else {
                    BlockEffect::BubbleUp
                },
                ..BlockShape::full_block()
            }),
            fluid: FluidState::Water,
            ..BlockState::default()
        }
    }

    #[test]
    fn throwable_before_1_21_2_moves_by_the_old_motion_then_drags_and_falls() {
        // 1.21.1 ThrownEntity.java:44-72: the move takes the old motion, then 0.99F and the
        // gravity; 1.20.4 :96 and 1.8.9 EntityThrowable.java:245 return 0.03F
        let mut state = ProjectileState::for_kind_in_release(
            ProjectileKind::Snowball,
            Vec3::ZERO,
            Vec3::new(1.0, 1.0, 0.0),
            release(1, 20, 4),
        );
        assert_eq!(state.gravity, f64::from(0.03_f32));

        let result =
            tick_projectile_in_release(&mut state, &WorldSnapshot::new(), release(1, 20, 4));

        assert_eq!(result.position, Vec3::new(1.0, 1.0, 0.0));
        assert_eq!(result.velocity.x, f64::from(0.99_f32));
        assert_eq!(result.velocity.y, f64::from(0.99_f32) - f64::from(0.03_f32));
        assert_eq!(
            ProjectileKind::ExperienceBottle.default_gravity_in(release(1, 8, 8)),
            f64::from(0.07_f32)
        );
        assert_eq!(
            ProjectileKind::Potion.default_gravity_in(release(1, 20, 5)),
            0.05
        );
    }

    #[test]
    fn throwable_before_1_21_2_moves_the_full_motion_through_a_hit() {
        // 1.21.1 ThrownEntity.java:46-71: the hit is handled, the move still goes to pos + v
        let world = full_block_world((2, 0, 0));
        let mut state = ProjectileState {
            gravity: 0.0,
            air_drag: 1.0,
            ..thrown(
                ProjectileKind::Snowball,
                Vec3::new(0.5, 0.5, 0.5),
                Vec3::new(5.0, 0.0, 0.0),
            )
        };

        let result = tick_projectile_in_release(&mut state, &world, release(1, 21, 1));

        assert!(result.block_hit);
        assert_eq!(result.position, Vec3::new(5.5, 0.5, 0.5));
    }

    #[test]
    fn first_tick_bubble_columns_push_from_1_21_2_for_every_cell_of_the_box() {
        // 1.21.2 ThrowableProjectile.java:83-95: each bubble column cell of the 0.25 box; the
        // lower cell has the column above it (inside: +0.06), the upper one air (surface: +0.1)
        let mut world = WorldSnapshot::new();
        world.set_block((0, 0, 0), bubble_column(false));
        world.set_block((0, 1, 0), bubble_column(false));
        for version in [release(1, 21, 2), release(26, 2, 0)] {
            let mut state = ProjectileState {
                gravity: 0.03,
                air_drag: 1.0,
                ..ProjectileState::new(Vec3::new(0.5, 0.9, 0.5), Vec3::ZERO)
            };
            let _ = tick_projectile_in_release(&mut state, &world, version);
            // then the move to y 1.03 and applyEffectsFromBlocks over the box there, in the upper
            // cell alone (1.21.2 ThrowableProjectile.java:56)
            assert_eq!(state.position.y, 0.9 + (0.0 + 0.06 + 0.1 - 0.03));
            assert_eq!(state.velocity.y, 0.0 + 0.06 + 0.1 - 0.03 + 0.1);
        }

        // 1.21.1 ThrowableProjectile.java:45: checkInsideBlocks over the same two cells (x, y, z
        // order, Entity.java checkInsideBlocks) before the move, which takes the pushed motion
        let mut legacy = ProjectileState {
            gravity: 0.03,
            air_drag: 1.0,
            ..ProjectileState::new(Vec3::new(0.5, 0.9, 0.5), Vec3::ZERO)
        };
        let _ = tick_projectile_in_release(&mut legacy, &world, release(1, 21, 1));
        assert_eq!(legacy.position.y, 0.9 + (0.0 + 0.06 + 0.1));
        assert_eq!(legacy.velocity.y, 0.0 + 0.06 + 0.1 - 0.03);
    }

    #[test]
    fn ender_pearl_bubble_columns_stay_clamped_from_1_21_5() {
        // 1.21.5 ThrownEnderpearl.java:246-252 overrides Projectile's unclamped pushes with
        // Entity.handleOnInsideBubbleColumn's max(-0.3, v - 0.03) (1.21.5 Entity.java:2563-2574;
        // 26.3 ThrownEnderpearl.java:244-250)
        let mut world = WorldSnapshot::new();
        world.set_block((0, 0, 0), bubble_column(true));
        world.set_block((0, 1, 0), bubble_column(true));
        for version in [release(1, 21, 5), release(26, 3, 0)] {
            let mut pearl = ProjectileState {
                kind: ProjectileKind::EnderPearl,
                gravity: 0.0,
                air_drag: 1.0,
                ..ProjectileState::new(Vec3::new(0.5, 0.1, 0.5), Vec3::new(0.0, -1.5, 0.0))
            };
            super::handle_first_tick_bubble_column(&mut pearl, &world, version);
            assert_eq!(pearl.velocity.y, -0.3);

            let mut snowball = ProjectileState {
                kind: ProjectileKind::Snowball,
                ..pearl
            };
            snowball.velocity.y = -1.5;
            super::handle_first_tick_bubble_column(&mut snowball, &world, version);
            assert_eq!(snowball.velocity.y, -1.5 + -0.03);
        }
    }

    #[test]
    fn first_tick_bubble_columns_run_y_outer_from_26_3() {
        // 26.3 ThrowableProjectile.java:85-87: Level.findBlocksIn, in a chunk section y outer, then
        // z, x fastest (BlockScanUtils.java:83-99); before, BlockPos.betweenClosed, z outer (26.2
        // ThrowableProjectile.java). The unclamped double additions round differently
        let mut world = WorldSnapshot::new();
        for z in 0..=1 {
            world.set_block((0, 0, z), bubble_column(false));
            world.set_block((0, 1, z), bubble_column(false));
        }
        let start = ProjectileState {
            gravity: 0.0,
            air_drag: 1.0,
            ..ProjectileState::new(Vec3::new(0.5, 0.9, 0.9), Vec3::new(0.0, -1.0, 0.0))
        };
        let mut modern = start;
        super::handle_first_tick_bubble_column(&mut modern, &world, release(26, 3, 0));
        assert_eq!(modern.velocity.y, -1.0 + 0.06 + 0.06 + 0.1 + 0.1);

        let mut before = start;
        super::handle_first_tick_bubble_column(&mut before, &world, release(26, 2, 0));
        assert_eq!(before.velocity.y, -1.0 + 0.06 + 0.1 + 0.06 + 0.1);
        assert_ne!(modern.velocity.y, before.velocity.y);
    }

    #[test]
    fn hurting_projectile_before_1_21_moves_then_adds_the_power_vector() {
        // 1.20.4 ExplosiveProjectileEntity.java:85-110: move by the old motion, then
        // (v + power) * 0.95F
        let mut state = ProjectileState {
            power: Vec3::new(0.1, 0.0, 0.0),
            ..thrown(
                ProjectileKind::Fireball,
                Vec3::ZERO,
                Vec3::new(1.0, 0.0, 0.0),
            )
        };

        let result =
            tick_projectile_in_release(&mut state, &WorldSnapshot::new(), release(1, 20, 4));

        assert_eq!(result.position, Vec3::new(1.0, 0.0, 0.0));
        assert_eq!(result.velocity.x, (1.0 + 0.1) * f64::from(0.95_f32));
    }

    #[test]
    fn hurting_projectile_from_1_21_pushes_along_its_direction_by_acceleration_power() {
        // 1.21 ExplosiveProjectileEntity.java:99: v + normalize(v) * accelerationPower (0.1),
        // after the move until 1.21.1; 1.21.2 AbstractHurtingProjectile.java:69-113 first
        let velocity = Vec3::new(3.0, 4.0, 0.0);
        let mut legacy = thrown(ProjectileKind::SmallFireball, Vec3::ZERO, velocity);
        let legacy_result =
            tick_projectile_in_release(&mut legacy, &WorldSnapshot::new(), release(1, 21, 1));
        let expected = Vec3::new(
            (3.0 + 3.0 / 5.0 * 0.1) * f64::from(0.95_f32),
            (4.0 + 4.0 / 5.0 * 0.1) * f64::from(0.95_f32),
            0.0,
        );
        assert_eq!(legacy_result.position, velocity);
        assert_eq!(legacy_result.velocity, expected);

        let mut modern = thrown(ProjectileKind::SmallFireball, Vec3::ZERO, velocity);
        let modern_result =
            tick_projectile_in_release(&mut modern, &WorldSnapshot::new(), release(1, 21, 2));
        assert_eq!(modern_result.velocity, expected);
        assert_eq!(modern_result.position, expected);

        let mut in_water = ProjectileState {
            in_water: true,
            ..thrown(
                ProjectileKind::WitherSkull,
                Vec3::ZERO,
                Vec3::new(1.0, 0.0, 0.0),
            )
        };
        let _ = tick_projectile_in_release(&mut in_water, &WorldSnapshot::new(), release(26, 2, 0));
        assert_eq!(in_water.velocity.x, (1.0 + 0.1) * f64::from(0.8_f32));
    }

    #[test]
    fn llama_spit_moves_by_the_old_motion_and_is_removed_in_water() {
        // 1.21.11 LlamaSpit.java:36-54
        let mut state = thrown(
            ProjectileKind::LlamaSpit,
            Vec3::new(0.5, 0.5, 0.5),
            Vec3::new(1.0, 0.0, 0.0),
        );
        let result =
            tick_projectile_in_release(&mut state, &WorldSnapshot::new(), release(1, 21, 11));
        assert_eq!(result.position, Vec3::new(1.5, 0.5, 0.5));
        assert_eq!(result.velocity, Vec3::new(f64::from(0.99_f32), -0.06, 0.0));
        assert!(!result.discarded);

        // before 1.20.5 the gravity is 0.06F (1.20.4 LlamaSpitEntity.java)
        assert_eq!(
            ProjectileKind::LlamaSpit.default_gravity_in(release(1, 20, 4)),
            f64::from(0.06_f32)
        );

        let mut wet = ProjectileState {
            in_water: true,
            ..thrown(
                ProjectileKind::LlamaSpit,
                Vec3::new(0.5, 0.5, 0.5),
                Vec3::new(1.0, 0.0, 0.0),
            )
        };
        let removed =
            tick_projectile_in_release(&mut wet, &WorldSnapshot::new(), release(1, 21, 11));
        assert!(removed.discarded);
        assert_eq!(removed.position, Vec3::new(0.5, 0.5, 0.5));
    }

    #[test]
    fn shulker_bullet_moves_without_gravity_on_the_client() {
        // 1.21.11 ShulkerBullet.java: gravity and steering are server-side; setPos(pos + v)
        let mut state = thrown(
            ProjectileKind::ShulkerBullet,
            Vec3::ZERO,
            Vec3::new(0.2, 0.1, 0.0),
        );
        let result = tick_projectile(&mut state, &WorldSnapshot::new());
        assert_eq!(result.position, Vec3::new(0.2, 0.1, 0.0));
        assert_eq!(result.velocity, Vec3::new(0.2, 0.1, 0.0));
    }

    #[test]
    fn firework_rocket_slides_along_blocks_and_keeps_its_motion_from_1_16() {
        // 1.21.11 FireworkRocketEntity.java:139-149: move(SELF), then the motion is put back;
        // before 1.16 Entity.move's stop on the collided axis stays (1.13.2
        // FireworkRocketEntity.java)
        let world = full_block_world((1, 0, 0));
        let start = Vec3::new(0.5, 0.25, 0.5);
        let mut modern = thrown(ProjectileKind::Firework, start, Vec3::new(1.0, 0.0, 0.0));
        let result = tick_projectile_in_release(&mut modern, &world, release(1, 21, 11));
        assert_eq!(result.position.x, 1.0 - 0.125);
        assert_eq!(result.position.y, 0.25 + 0.04);
        assert!(result.horizontal_collision);
        assert_eq!(result.velocity, Vec3::new(1.15, 0.04, 0.0));

        // the next tick's boost has no horizontal factor along the collision (1.16.4+)
        let next = tick_projectile_in_release(&mut modern, &world, release(1, 21, 11));
        assert_eq!(next.velocity.x, 1.15);
        // 1.16 FireworkRocketEntity.java:29-30 boosts by 1.15 along a collision too
        let mut collided = ProjectileState {
            horizontal_collision: true,
            ..thrown(ProjectileKind::Firework, start, Vec3::new(1.0, 0.0, 0.0))
        };
        let early =
            tick_projectile_in_release(&mut collided, &WorldSnapshot::new(), release(1, 16, 0));
        assert_eq!(early.velocity.x, 1.15);

        let mut legacy = thrown(ProjectileKind::Firework, start, Vec3::new(1.0, 0.0, 0.0));
        let legacy_result = tick_projectile_in_release(&mut legacy, &world, release(1, 13, 2));
        assert_eq!(legacy_result.position.x, 1.0 - 0.125);
        assert_eq!(legacy_result.velocity.x, 0.0);
        assert_eq!(legacy_result.velocity.y, 0.04);

        // in water a rocket keeps its speed: no drag nor water inertia
        let mut wet = ProjectileState {
            in_water: true,
            ..thrown(ProjectileKind::Firework, start, Vec3::new(0.0, 0.5, 0.0))
        };
        let wet_result = tick_projectile(&mut wet, &WorldSnapshot::new());
        assert_eq!(wet_result.velocity.y, 0.5 + 0.04);
    }

    #[test]
    fn a_no_physics_rocket_passes_through_and_hits_nothing() {
        // the same hit test, its result unused (1.14 FireworkEntity.java:157-164, 1.20.4
        // FireworkRocketEntity.java:139-141, 1.21.3 :145-151, 26.3 :146-152), and Entity.move's
        // noPhysics branch (1.13.2 Entity.java:565-566, 1.16.5 :607-609, 1.21.8 :670-671)
        let world = full_block_world((1, 0, 0));
        // 1.14 tests from where the move left it with the motion that left, so it starts further
        // back: a stop on the wall would leave no motion to test along
        for (version, x, hits) in [
            ("1.13.2", 0.5, false),
            ("1.14", -0.6, true),
            ("1.20.4", 0.5, true),
            ("1.21.1", 0.5, true),
            ("1.21.2", 0.5, true),
            ("26.3", 0.5, true),
        ] {
            let release = MinecraftVersion::parse(version).unwrap();
            let boosted = Vec3::new(1.15, 0.04, 0.0);
            let start = Vec3::new(x, 0.25, 0.5);
            let mut solid = thrown(ProjectileKind::Firework, start, Vec3::new(1.0, 0.0, 0.0));
            let blocked = tick_projectile_in_release(&mut solid, &world, release);
            assert_eq!(blocked.block_hit, hits, "{version}");

            let mut ghost = ProjectileState {
                no_physics: true,
                ..thrown(ProjectileKind::Firework, start, Vec3::new(1.0, 0.0, 0.0))
            };
            let passed = tick_projectile_in_release(&mut ghost, &world, release);
            assert!(!passed.block_hit, "{version}");
            assert!(!passed.horizontal_collision, "{version}");
            assert_eq!(passed.position.x, start.x + boosted.x, "{version}");
            assert_eq!(passed.position.y, start.y + boosted.y, "{version}");
            assert_eq!(passed.velocity, boosted, "{version}");
        }

        // the collision flag of an earlier move outlives a noPhysics move until 1.21.9, and the
        // ground in every release (1.21.8 Entity.java:670-671, 1.21.9 :677-682, 26.3 :766-772)
        let start = Vec3::new(0.5, 0.25, 0.5);
        for (version, kept) in [("1.21.8", true), ("1.21.9", false), ("26.3", false)] {
            let release = MinecraftVersion::parse(version).unwrap();
            let mut ghost = ProjectileState {
                no_physics: true,
                horizontal_collision: true,
                on_ground: true,
                ..thrown(ProjectileKind::Firework, start, Vec3::new(1.0, 0.0, 0.0))
            };
            let result = tick_projectile_in_release(&mut ghost, &world, release);
            assert_eq!(result.horizontal_collision, kept, "{version}");
            assert_eq!(ghost.horizontal_collision, kept, "{version}");
            assert!(result.on_ground, "{version}");
            // its own boost read the old flag, as the tick's first step (26.3 :141)
            assert_eq!(result.velocity.x, 1.0, "{version}");
        }
    }

    #[test]
    fn fishing_hook_falls_moves_then_drags() {
        // 1.21.11 FishingHook.java:233-246: -0.03 off the ground out of water, move(SELF),
        // then 0.92
        let mut state = thrown(
            ProjectileKind::FishingHook,
            Vec3::new(0.5, 5.0, 0.5),
            Vec3::new(0.1, 0.0, 0.0),
        );
        let result =
            tick_projectile_in_release(&mut state, &WorldSnapshot::new(), release(1, 21, 11));
        assert_eq!(result.position, Vec3::new(0.6, 5.0 - 0.03, 0.5));
        assert_eq!(result.velocity, Vec3::new(0.1 * 0.92, -0.03 * 0.92, 0.0));
    }

    #[test]
    fn fishing_hook_skips_gravity_on_the_ground_from_1_21_6() {
        // 1.21.5 FishingHook.java:218 tests the water alone; 1.21.6 :228 adds !onGround (1.16
        // FishingBobberEntity.java:231 the same as 1.21.5). A hook whose onGround is still set
        // with nothing under it falls by -0.03 until 1.21.5
        let start = ProjectileState {
            on_ground: true,
            ..thrown(
                ProjectileKind::FishingHook,
                Vec3::new(0.5, 5.0, 0.5),
                Vec3::ZERO,
            )
        };
        for version in [release(1, 16, 0), release(1, 21, 5)] {
            let mut state = start;
            let result = tick_projectile_in_release(&mut state, &WorldSnapshot::new(), version);
            assert_eq!(result.position.y, 5.0 - 0.03);
            assert_eq!(result.velocity.y, -0.03 * 0.92);
            assert!(!state.on_ground);
        }

        // 1.21.6: no gravity, a move with no vertical part keeps onGround on the client (1.21.6
        // Entity.java:746, isLocalInstanceAuthoritative is false for a hook) and the hook rests
        let mut state = start;
        for _ in 0..2 {
            let result =
                tick_projectile_in_release(&mut state, &WorldSnapshot::new(), release(1, 21, 6));
            assert_eq!(result.position.y, 5.0);
            assert_eq!(result.velocity, Vec3::ZERO);
            assert!(state.on_ground);
        }
    }

    #[test]
    fn bobbing_hook_pulls_to_the_water_own_height_in_1_13() {
        // 1.13.2 FishingBobberEntity.java:159-161: FluidState.method_17810, level / 9
        // (FlowableFluid.java:434), with no look above; 1.14 FishHookEntity.java:155
        // getHeight(world, pos) is 1 under water
        let mut world = WorldSnapshot::new();
        for y in 0..=1 {
            world.set_block(
                (0, y, 0),
                BlockState {
                    fluid: FluidState::Water,
                    fluid_source: true,
                    ..BlockState::default()
                },
            );
        }
        let pull = |height: f64| -(0.5 - height) * f64::from(1.0_f32) * 0.2;
        for (version, height) in [
            (release(1, 13, 2), f64::from(8.0_f32 / 9.0)),
            (release(1, 14, 4), 1.0),
        ] {
            let mut state = ProjectileState {
                bobbing: true,
                bob_random: 1.0,
                ..thrown(
                    ProjectileKind::FishingHook,
                    Vec3::new(0.5, 0.5, 0.5),
                    Vec3::ZERO,
                )
            };
            let result = tick_projectile_in_release(&mut state, &world, version);
            assert_eq!(result.velocity.y, pull(height) * state.air_drag);
        }
    }

    #[test]
    fn llama_spit_moves_before_the_removal_only_until_1_14() {
        // 1.14 LlamaSpitEntity.java:79 assigns this.x before the removal; 1.15 :79-81 reads the
        // target and setPosition runs only when the spit stays (:116)
        for (version, x) in [(release(1, 14, 4), 1.5), (release(1, 15, 0), 0.5)] {
            let mut wet = ProjectileState {
                in_water: true,
                ..thrown(
                    ProjectileKind::LlamaSpit,
                    Vec3::new(0.5, 0.5, 0.5),
                    Vec3::new(1.0, 0.0, 0.0),
                )
            };
            let result = tick_projectile_in_release(&mut wet, &WorldSnapshot::new(), version);
            assert!(result.discarded);
            assert_eq!(result.position.x, x);
        }
    }

    #[test]
    fn llama_spit_in_a_bubble_column_is_removed_from_1_13_until_1_21_4() {
        // 1.20.5 LlamaSpitEntity.java:50 isInsideWaterOrBubbleColumn (Entity.java:1176-1190, the
        // block at the position; 1.13.2 :121 method_15575); 1.21.5 LlamaSpit.java:54 isInWater
        let mut world = WorldSnapshot::new();
        world.set_block((0, 0, 0), bubble_column(false));
        for (version, removed) in [
            (release(1, 12, 2), false),
            (release(1, 13, 2), true),
            (release(1, 21, 4), true),
            (release(1, 21, 5), false),
        ] {
            let mut state = thrown(
                ProjectileKind::LlamaSpit,
                Vec3::new(0.5, 0.9, 0.5),
                Vec3::new(0.1, 0.0, 0.0),
            );
            let result = tick_projectile_in_release(&mut state, &world, version);
            assert_eq!(result.discarded, removed);
        }
    }

    #[test]
    fn fishing_hook_stops_at_a_block_hit_by_its_squared_distance() {
        // 1.21.11 FishingHook.java:284-287: v = normalize(v) * hit.distanceTo (squared)
        let world = full_block_world((1, 0, 0));
        let mut state = thrown(
            ProjectileKind::FishingHook,
            Vec3::new(0.5, 0.5, 0.5),
            Vec3::new(2.0, 0.0, 0.0),
        );
        let result = tick_projectile_in_release(&mut state, &world, release(1, 21, 11));
        assert!(result.block_hit);
        assert_eq!(result.position.x, 0.5 + 0.25);
        assert_eq!(result.velocity, Vec3::new(0.25 * 0.92, -0.03 * 0.92, 0.0));
    }

    #[test]
    fn fishing_hook_reaching_water_slows_and_starts_bobbing() {
        // 1.21.11 FishingHook.java:178-182 (1.12.2 FishingBobberEntity.java:30-35)
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 0, 0),
            BlockState {
                fluid: FluidState::Water,
                fluid_source: true,
                ..BlockState::default()
            },
        );
        for version in [release(1, 11, 2), release(1, 21, 11)] {
            let mut state = thrown(
                ProjectileKind::FishingHook,
                Vec3::new(0.5, 0.5, 0.5),
                Vec3::new(1.0, -1.0, 1.0),
            );
            let result = tick_projectile_in_release(&mut state, &world, version);
            assert!(result.bobbing);
            assert_eq!(result.position, Vec3::new(0.5, 0.5, 0.5));
            assert_eq!(result.velocity, Vec3::new(0.3, -0.2, 0.3));
        }
    }

    fn arrow(position: Vec3, velocity: Vec3, release: MinecraftVersion) -> ArrowState {
        ArrowState::new_in_release(position, velocity, release)
    }

    #[test]
    fn arrow_hit_before_1_21_2_pulls_back_along_the_offset_then_moves_drags_and_falls() {
        // 1.21 PersistentProjectileEntity.java:431-449 (onBlockHit): v = hit - pos, pos -=
        // normalize(v) * 0.05F; then the tick moves by v, scales by 0.99F and takes the gravity
        // (:250-277), also on the hit tick
        let world = full_block_world((1, 0, 0));
        let mut state = arrow(
            Vec3::new(0.5, 0.5, 0.5),
            Vec3::new(2.0, 0.0, 0.0),
            release(1, 21, 1),
        );
        let result = tick_arrow_in_release(&mut state, &world, release(1, 21, 1));

        assert!(result.block_hit);
        assert!(result.in_ground);
        assert_eq!(result.position.x, (0.5 - 0.05000000074505806) + 0.5);
        assert_eq!(result.velocity, Vec3::new(0.5 * f64::from(0.99_f32), -0.05, 0.0));

        // the in-ground ticks keep that motion (1.21 :165-176 leaves it alone)
        let resting = tick_arrow_in_release(&mut state, &world, release(1, 21, 1));
        assert!(resting.in_ground);
        assert_eq!(resting.velocity, result.velocity);
        assert_eq!(resting.position, result.position);
    }

    #[test]
    fn arrow_hit_until_1_13_2_casts_the_offset_to_float() {
        let world = full_block_world((1, 0, 0));
        let offset = f64::from(0.7_f32);
        let length = (offset * offset).sqrt() as f32;

        // 1.13.2 AbstractArrowEntity.java:324-330: v = (float)(hit - pos), pos -= v /
        // (MathHelper.sqrt(v.v) * 20.0F)
        let mut modern = arrow(Vec3::new(0.3, 0.5, 0.5), Vec3::new(2.0, 0.0, 0.0), release(1, 13, 2));
        let result = tick_arrow_in_release(&mut modern, &world, release(1, 13, 2));
        assert!(result.block_hit);
        assert_eq!(result.position.x, (0.3 - offset / f64::from(length * 20.0_f32)) + offset);
        assert_eq!(result.velocity.x, offset * f64::from(0.99_f32));
        // gravity 0.05F before 1.20.5 (1.13.2 :296)
        assert_eq!(result.velocity.y, -f64::from(0.05_f32));

        // 1.12.2 AbstractArrowEntity.java:370-376 (1.8.9 EntityArrow.java:292-297): pos -= v /
        // MathHelper.sqrt(v.v) * 0.05F
        let mut legacy = arrow(Vec3::new(0.3, 0.5, 0.5), Vec3::new(2.0, 0.0, 0.0), release(1, 12, 2));
        let result = tick_arrow_in_release(&mut legacy, &world, release(1, 12, 2));
        assert!(result.block_hit);
        assert_eq!(
            result.position.x,
            (0.3 - offset / f64::from(length) * f64::from(0.05_f32)) + offset
        );
    }

    #[test]
    fn arrow_gravity_is_0_05f_before_1_20_5() {
        // 1.20.4 PersistentProjectileEntity.java:244: y - 0.05F; 1.20.5 :265-266: 0.05
        let mut old = arrow(Vec3::ZERO, Vec3::new(1.0, 0.0, 0.0), release(1, 20, 4));
        let result = tick_arrow_in_release(&mut old, &WorldSnapshot::new(), release(1, 20, 4));
        assert_eq!(result.velocity.y, -0.05000000074505806);
        let mut new = arrow(Vec3::ZERO, Vec3::new(1.0, 0.0, 0.0), release(1, 20, 5));
        let result = tick_arrow_in_release(&mut new, &WorldSnapshot::new(), release(1, 20, 5));
        assert_eq!(result.velocity.y, -0.05);
    }

    #[test]
    fn arrow_in_water_before_1_21_2_moves_then_takes_the_water_inertia() {
        // 1.21 PersistentProjectileEntity.java:261-277: the move by v, then v * 0.6F, then gravity
        let mut state = arrow(Vec3::ZERO, Vec3::new(1.0, 1.0, 0.0), release(1, 21, 1));
        state.in_water = true;
        let result = tick_arrow_in_release(&mut state, &WorldSnapshot::new(), release(1, 21, 1));
        assert_eq!(result.position, Vec3::new(1.0, 1.0, 0.0));
        assert_eq!(result.velocity.x, f64::from(0.6_f32));
        assert_eq!(result.velocity.y, f64::from(0.6_f32) - 0.05);
    }

    fn arrow_in_ground(position: Vec3, block: (i32, i32, i32), block_id: u32) -> ArrowState {
        ArrowState {
            in_ground: true,
            last_block_id: Some(block_id),
            last_block_position: Some(block),
            fall_impulse: Vec3::new(0.5, 0.5, 0.5),
            ..ArrowState::new(position, Vec3::new(0.1, 0.0, 0.0))
        }
    }

    fn solid(id: u32) -> BlockState {
        BlockState {
            id,
            shape: Some(BlockShape::full_block()),
            ..Default::default()
        }
    }

    #[test]
    fn arrow_fall_test_follows_the_release() {
        let resting = Vec3::new(0.95, 0.5, 0.5);
        let mut replaced = WorldSnapshot::new();
        replaced.set_block((1, 0, 0), solid(12));

        // 1.9.4 AbstractArrowEntity.java:175-188 (1.8.9 EntityArrow.java:167-180, 1.10.2): any
        // change of the hit block's state drops the arrow
        let mut state = arrow_in_ground(resting, (1, 0, 0), 11);
        assert!(tick_arrow_in_release(&mut state, &replaced, release(1, 10, 2)).started_falling);

        // 1.12.2 AbstractArrowEntity.java:179 (1.11.2, 1.13.2 :222 with the same 0.05): a
        // replacement whose shape meets the box inflated by 0.05 keeps it
        let mut state = arrow_in_ground(resting, (1, 0, 0), 11);
        assert!(!tick_arrow_in_release(&mut state, &replaced, release(1, 11, 2)).started_falling);
        let mut state = arrow_in_ground(resting, (1, 0, 0), 11);
        assert!(!tick_arrow_in_release(&mut state, &replaced, release(1, 13, 2)).started_falling);

        // until 1.13.2 the state is read at the hit block, from 1.14 at the arrow's own block
        // (1.13.2 :195-196, 1.14 ProjectileEntity.java:174-175): the unchanged hit block keeps
        // a 1.13.2 arrow whatever its own cell holds
        let mut unchanged = WorldSnapshot::new();
        unchanged.set_block((1, 0, 0), solid(11));
        let mut state = arrow_in_ground(Vec3::new(5.5, 5.5, 5.5), (1, 0, 0), 11);
        assert!(!tick_arrow_in_release(&mut state, &unchanged, release(1, 13, 2)).started_falling);
        let mut state = arrow_in_ground(Vec3::new(5.5, 5.5, 5.5), (1, 0, 0), 11);
        assert!(tick_arrow_in_release(&mut state, &unchanged, release(1, 14, 4)).started_falling);

        // 1.15 ProjectileEntity tick: the 0.5 box inflated by 0.06 reaches a block above the
        // arrow; from 1.16 (PersistentProjectileEntity.java:245-247) only the point is tested
        let mut above = WorldSnapshot::new();
        above.set_block((0, 1, 0), solid(5));
        let mut state = arrow_in_ground(resting, (1, 0, 0), 11);
        assert!(!tick_arrow_in_release(&mut state, &above, release(1, 15, 2)).started_falling);
        let mut state = arrow_in_ground(resting, (1, 0, 0), 11);
        let result = tick_arrow_in_release(&mut state, &above, release(1, 16, 0));
        assert!(result.started_falling);
        assert_eq!(result.velocity, Vec3::new(0.05, 0.0, 0.0));
    }

    #[test]
    fn trident_before_1_21_2_keeps_the_offset_motion_after_a_hit() {
        // 1.20.4 PersistentProjectileEntity.java:410-417 and :236-249 with TridentEntity's
        // 0.99F water inertia (TridentEntity.java:195)
        let world = full_block_world((1, 0, 0));
        let mut state = TridentState::new_in_release(
            Vec3::new(0.5, 0.5, 0.5),
            Vec3::new(2.0, 0.0, 0.0),
            release(1, 20, 4),
        );
        state.in_water = true;
        let result = tick_trident_in_release(&mut state, &world, release(1, 20, 4));
        assert!(result.block_hit);
        assert_eq!(result.position.x, (0.5 - 0.05000000074505806) + 0.5);
        assert_eq!(
            result.velocity,
            Vec3::new(0.5 * f64::from(0.99_f32), -0.05000000074505806, 0.0)
        );
    }

    fn snowball(position: Vec3, velocity: Vec3) -> ProjectileState {
        ProjectileState {
            gravity: 0.0,
            air_drag: 1.0,
            first_tick: false,
            ..ProjectileState::for_kind(ProjectileKind::Snowball, position, velocity)
        }
    }

    #[test]
    fn clip_starting_inside_a_shape_hits_a_thousandth_along_the_ray_from_1_13() {
        // 26.2 VoxelShape.java:119-131 (1.13.2 VoxelShape.java:150-165): from + 0.001 * d inside
        // the shape is the hit
        let world = full_block_world((1, 0, 0));
        for version in [release(1, 13, 2), release(26, 2, 0)] {
            assert_eq!(
                super::nearest_block_hit(&world, Vec3::new(1.5, 0.5, 0.5), Vec3::new(1.0, 0.0, 0.0), version),
                Some(Vec3::new(1.5 + 0.001, 0.5, 0.5))
            );
            let mut state = snowball(Vec3::new(1.5, 0.5, 0.5), Vec3::new(1.0, 0.0, 0.0));
            let result = tick_projectile_in_release(&mut state, &world, version);
            assert!(result.block_hit);
            // Before 1.21.2 the throwable still moves its full velocity after onCollision
            // (1.13.2 ThrowableEntity.java:177-187); a clip location is not its final position.
            let x = if version.at_least(1, 21, 2) { 1.5 + 0.001 } else { 2.5 };
            assert_eq!(result.position, Vec3::new(x, 0.5, 0.5));
        }
        // Before 1.13 vanilla tests all six faces (1.12.2 Box.java:294-327).
        // The registered 1.8.8 path uses the supplied 1.8.9 source as a stand-in.
        for version in [
            release(1, 8, 8), release(1, 9, 4), release(1, 10, 2),
            release(1, 11, 2), release(1, 12, 2),
        ] {
            assert_eq!(
                super::nearest_block_hit(&world, Vec3::new(1.5, 0.5, 0.5), Vec3::new(1.0, 0.0, 0.0), version),
                Some(Vec3::new(2.0, 0.5, 0.5)), "{version}"
            );
            let mut state = snowball(Vec3::new(1.5, 0.5, 0.5), Vec3::new(1.0, 0.0, 0.0));
            let result = tick_projectile_in_release(&mut state, &world, version);
            assert!(result.block_hit, "{version}");
            assert_eq!(result.position, Vec3::new(2.5, 0.5, 0.5), "{version}");
        }
    }

    #[test]
    fn clip_shorter_than_the_1e_7_square_hits_nothing_from_1_13() {
        // 26.2 VoxelShape.java:124-127: d.lengthSqr() < 1.0E-7 is no hit
        let world = full_block_world((1, 0, 0));
        let mut state = snowball(Vec3::new(0.9999, 0.5, 0.5), Vec3::new(3.0e-4, 0.0, 0.0));
        let result = tick_projectile_in_release(&mut state, &world, release(26, 2, 0));
        assert!(!result.block_hit);
        assert_eq!(result.position.x, 0.9999 + 3.0e-4);

        let mut state = snowball(Vec3::new(0.9999, 0.5, 0.5), Vec3::new(3.0e-4, 0.0, 0.0));
        let result = tick_projectile_in_release(&mut state, &world, release(1, 12, 2));
        // Legacy Vec3d's squared-axis cutoff also rejects this short axis.
        assert!(!result.block_hit);
    }

    #[test]
    fn legacy_clip_uses_per_axis_cutoff_instead_of_total_segment_length() {
        let world = full_block_world((0, 0, 0));
        let start = Vec3::new(0.5, 0.5, 0.5);
        let movement = Vec3::new(0.00025, 0.00025, 0.00025);
        let mut legacy = snowball(start, movement);
        let legacy_result = tick_projectile_in_release(&mut legacy, &world, release(1, 12, 2));
        assert!(!legacy_result.block_hit);
        assert_eq!(legacy_result.position, start + movement);
        let mut modern = snowball(start, movement);
        let modern_result = tick_projectile_in_release(&mut modern, &world, release(1, 13, 2));
        assert!(modern_result.block_hit);
        assert_eq!(modern_result.position, start + movement);
        assert_eq!(
            super::nearest_block_hit(&world, start, movement, release(1, 13, 2)),
            Some(start + movement.scale(0.001))
        );
    }

    #[test]
    fn legacy_clip_keeps_block_local_arithmetic_for_partial_shapes() {
        // Block.method_11559 subtracts the cell before clipping and adds it back.
        // Moving the decimal 0.6 face to world X first changes Y and Z's last bits.
        for origin in [-30_000_000, 30_000_000] {
            let mut world = WorldSnapshot::new();
            world.set_block(
                (origin, 0, 0),
                BlockState {
                    shape: Some(BlockShape {
                        bounds: Aabb::new(Vec3::new(0.1, 0.1, 0.1), Vec3::new(0.6, 0.8, 0.8)),
                        ..BlockShape::full_block()
                    }),
                    ..Default::default()
                },
            );
            let x = f64::from(origin);
            let hit = super::clip_block(
                &world, (origin, 0, 0),
                Vec3::new(x + 0.2, 0.3, 0.4), Vec3::new(x + 1.2, 0.9, 0.8),
                release(1, 12, 2), super::ClipShape::Collider,
            );
            assert_eq!(hit.map(|hit| hit.0), Some(Vec3::new(x + 0.6, 0.5400000004470349, 0.5600000002980232)));
        }
    }

    #[test]
    fn legacy_clip_selects_the_nearest_of_supplied_partial_boxes() {
        let mut world = WorldSnapshot::new();
        let box_at = |min, max| BlockShape {
            bounds: Aabb::new(Vec3::new(min, 0.0, 0.0), Vec3::new(max, 1.0, 1.0)),
            ..BlockShape::full_block()
        };
        // Supply the farther box first: traversal must not return the first component.
        world.set_block_shapes((0, 0, 0), BlockState::default(), vec![box_at(0.75, 1.0), box_at(0.0, 0.25)]);
        let hit = super::clip_block(
            &world, (0, 0, 0), Vec3::new(-1.0, 0.5, 0.5), Vec3::new(2.0, 0.5, 0.5),
            release(1, 12, 2), super::ClipShape::Collider,
        );
        assert_eq!(hit, Some((Vec3::new(0.0, 0.5, 0.5), crate::math::HitFace::West)));
    }

    #[test]
    fn clip_tests_only_the_cells_the_ray_passes() {
        // 26.2 BlockGetter.java:110-163: traverseBlocks visits the cells along the ray, so the
        // part of a fence's 1.5-high shape above its cell is not hit by a ray over the cell
        let mut world = WorldSnapshot::new();
        world.set_block(
            (1, 0, 0),
            BlockState {
                shape: Some(BlockShape {
                    bounds: Aabb::new(Vec3::new(0.375, 0.0, 0.375), Vec3::new(0.625, 1.5, 0.625)),
                    ..BlockShape::full_block()
                }),
                ..Default::default()
            },
        );
        let mut state = snowball(Vec3::new(0.5, 1.2, 0.5), Vec3::new(2.0, 0.0, 0.0));
        let result = tick_projectile_in_release(&mut state, &world, release(26, 2, 0));
        assert!(!result.block_hit);

        let mut state = snowball(Vec3::new(0.5, 0.8, 0.5), Vec3::new(2.0, 0.0, 0.0));
        let result = tick_projectile_in_release(&mut state, &world, release(26, 2, 0));
        assert!(result.block_hit);
        assert_eq!(result.position, Vec3::new(1.375, 0.8, 0.5));
    }

    #[test]
    fn wind_charge_keeps_its_motion_in_air_and_water() {
        // 1.21.11 AbstractWindCharge.java:36-47 (accelerationPower 0) and :128-135 (inertia 1.0F,
        // liquid inertia the same)
        let state = ProjectileState::for_kind(ProjectileKind::WindCharge, Vec3::ZERO, Vec3::ZERO);
        assert_eq!(state.acceleration_power, 0.0);
        assert_eq!(state.gravity, 0.0);
        assert_eq!(state.air_drag, 1.0);
        let mut state = ProjectileState {
            in_water: true,
            ..ProjectileState::for_kind(
                ProjectileKind::WindCharge,
                Vec3::ZERO,
                Vec3::new(1.0, 0.0, 0.0),
            )
        };
        let result = tick_projectile_in_release(&mut state, &WorldSnapshot::new(), release(1, 21, 11));
        assert_eq!(result.velocity, Vec3::new(1.0, 0.0, 0.0));
        assert_eq!(result.position, Vec3::new(1.0, 0.0, 0.0));
    }

    #[test]
    fn wind_charge_clips_outline_shapes_in_1_20_4() {
        // 1.20.4 WindChargeEntity.java:127-130: RaycastContext.ShapeType.OUTLINE; COLLIDER from
        // 1.20.5 (AbstractHurtingProjectile.getClipType)
        let mut world = WorldSnapshot::new();
        world.set_block(
            (1, 0, 0),
            BlockState {
                outline_shape: Some(BlockShape::full_block()),
                ..Default::default()
            },
        );
        let charge = || ProjectileState::for_kind(
            ProjectileKind::WindCharge,
            Vec3::new(0.5, 0.5, 0.5),
            Vec3::new(2.0, 0.0, 0.0),
        );
        let mut state = charge();
        assert!(tick_projectile_in_release(&mut state, &world, release(1, 20, 4)).block_hit);
        let mut state = charge();
        assert!(!tick_projectile_in_release(&mut state, &world, release(1, 20, 5)).block_hit);
    }

    #[test]
    fn projectile_kind_resolves_the_registry_ids_of_every_release() {
        // 1.21.11 EntityType.java: fishing_bobber, splash_potion and lingering_potion (1.21.5+),
        // wind_charge and breeze_wind_charge; 1.12.2 EntityType.java:205-210 xp_bottle and
        // fireworks_rocket; 1.8.9 EntityList.java:239-245 ThrownPotion, ThrownExpBottle and
        // FireworksRocketEntity
        assert_eq!(ProjectileKind::from_name("minecraft:fishing_bobber"), ProjectileKind::FishingHook);
        assert_eq!(ProjectileKind::from_name("minecraft:splash_potion"), ProjectileKind::Potion);
        assert_eq!(ProjectileKind::from_name("minecraft:lingering_potion"), ProjectileKind::Potion);
        assert_eq!(ProjectileKind::from_name("minecraft:wind_charge"), ProjectileKind::WindCharge);
        assert_eq!(
            ProjectileKind::from_name("minecraft:breeze_wind_charge"),
            ProjectileKind::WindCharge
        );
        assert_eq!(ProjectileKind::from_name("minecraft:xp_bottle"), ProjectileKind::ExperienceBottle);
        assert_eq!(ProjectileKind::from_name("minecraft:fireworks_rocket"), ProjectileKind::Firework);
        assert_eq!(ProjectileKind::from_name("ThrownPotion"), ProjectileKind::Potion);
        assert_eq!(ProjectileKind::from_name("ThrownExpBottle"), ProjectileKind::ExperienceBottle);
        assert_eq!(ProjectileKind::from_name("FireworksRocketEntity"), ProjectileKind::Firework);
    }

    fn wall(position: (i32, i32, i32)) -> WorldSnapshot {
        full_block_world(position)
    }

    #[test]
    fn a_trident_stays_in_the_block_it_hit() {
        // ThrownTrident.tick calls AbstractArrow.tick, whose inGround holds it (1.13.2
        // TridentEntity.java:57-92, 26.3 ThrownTrident.java:62-99, AbstractArrow.java:192-210, 539-547)
        for release in [
            MinecraftVersion::new(1, 13, 2),
            MinecraftVersion::new(1, 21, 4),
            MinecraftVersion::new(26, 3, 0),
        ] {
            let world = wall((1, 100, 0));
            let mut state =
                TridentState::new_in_release(Vec3::new(0.5, 100.5, 0.5), Vec3::new(2.0, 0.0, 0.0), release);
            let first = tick_trident_in_release(&mut state, &world, release);
            assert!(first.block_hit && first.in_ground, "{release}");
            let embedded = state.position;
            for tick in 1..=6 {
                let result = tick_trident_in_release(&mut state, &world, release);
                assert_eq!(result.position, embedded, "{release}");
                assert!(result.in_ground && !result.block_hit, "{release}");
                // dealtDamage after more than four ticks in the ground, read at the tick's top
                assert_eq!(result.dealt_damage, tick > 5, "{release}");
            }
            assert_eq!(state.in_ground_time, 6);
        }
    }

    #[test]
    fn an_embedded_trident_falls_when_its_block_goes() {
        let release = MinecraftVersion::new(1, 21, 4);
        let world = wall((1, 100, 0));
        let mut state =
            TridentState::new_in_release(Vec3::new(0.5, 100.5, 0.5), Vec3::new(2.0, 0.0, 0.0), release);
        let _ = tick_trident_in_release(&mut state, &world, release);
        state.last_block_id = Some(99);
        let result = tick_trident_in_release(&mut state, &WorldSnapshot::new(), release);
        assert!(result.started_falling && !result.in_ground);
    }

    #[test]
    fn an_arrow_without_its_state_flies_as_an_arrow() {
        // the same arrow by both ticks (1.21.4 PersistentProjectileEntity.java:166-250 against
        // ThrownEntity.java:47-62): (1, 101), not the throwable's (0.99, 100.9405)
        let release = MinecraftVersion::new(1, 21, 4);
        let world = WorldSnapshot::new();
        let (from, by) = (Vec3::new(0.0, 100.0, 0.0), Vec3::new(1.0, 1.0, 0.0));
        let mut generic = ProjectileState::for_kind_in_release(ProjectileKind::Arrow, from, by, release);
        let mut arrow = ArrowState::new_in_release(from, by, release);
        let result = tick_projectile_in_release(&mut generic, &world, release);
        let _ = tick_arrow_in_release(&mut arrow, &world, release);
        assert_eq!(result.position, Vec3::new(1.0, 101.0, 0.0));
        assert_eq!(generic.position, arrow.position);
        assert_eq!(generic.velocity, arrow.velocity);
    }

    #[test]
    fn a_projectile_hits_the_world_border_from_1_21_2() {
        // ProjectileUtil's clipIncludingBorder (1.21.2 :51, CollisionGetter.java:119-130); 1.21.1
        // has the plain clip (ProjectileUtil.java:49)
        let mut world = WorldSnapshot::new();
        world.set_world_bounds(-64, 320, 0.0, 0.0, 10.0);
        let snowball = |release| {
            let mut state = ProjectileState::for_kind_in_release(
                ProjectileKind::Snowball,
                Vec3::new(4.5, 100.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                release,
            );
            state.gravity = 0.0;
            state.air_drag = 1.0;
            state.first_tick = false;
            let result = tick_projectile_in_release(&mut state, &world, release);
            (result.position.x, result.block_hit)
        };
        assert_eq!(snowball(MinecraftVersion::new(1, 21, 1)), (5.5, false));
        for release in [MinecraftVersion::new(1, 21, 2), MinecraftVersion::new(26, 3, 0)] {
            assert_eq!(snowball(release), (5.0 - f64::from(1.0e-5_f32), true));
        }
        // a ray starting outside passes (the start-inside test)
        let release = MinecraftVersion::new(1, 21, 4);
        let mut outside = ProjectileState::for_kind_in_release(
            ProjectileKind::Snowball,
            Vec3::new(6.0, 100.0, 0.0),
            Vec3::new(1.0, 0.0, 0.0),
            release,
        );
        outside.gravity = 0.0;
        outside.air_drag = 1.0;
        outside.first_tick = false;
        let result = tick_projectile_in_release(&mut outside, &world, release);
        assert!(!result.block_hit);
        assert_eq!(result.position.x, 7.0);
    }

    #[test]
    fn a_batch_refreshes_the_water_at_the_familys_base_tick() {
        // Entity.baseTick's flag: after the move from 1.21.2 (1.21.3 ThrownEntity.java:62), before
        // it until then (1.20.4 ThrownEntity.java:46); the snowball from air takes water's 0.8F on
        // the tick after it enters
        let release = MinecraftVersion::new(1, 21, 4);
        let mut world = WorldSnapshot::new();
        for x in 1..=8 {
            for y in 100..=102 {
                for z in -1..=1 {
                    world.set_block(
                        (x, y, z),
                        BlockState {
                            fluid: FluidState::Water,
                            fluid_source: true,
                            ..BlockState::default()
                        },
                    );
                }
            }
        }
        for release in [release, MinecraftVersion::new(1, 20, 4)] {
            let mut state = ProjectileState::for_kind_in_release(
                ProjectileKind::Snowball,
                Vec3::new(0.5, 101.0, 0.5),
                Vec3::new(1.0, 0.0, 0.0),
                release,
            );
            state.gravity = 0.0;
            state.first_tick = false;
            let _ = tick_projectile_in_world(&mut state, &world, release);
            let air_drag = f64::from(0.99_f32);
            let vx = state.velocity.x;
            assert!((vx - air_drag).abs() < 1.0e-9, "{release}");
            let _ = tick_projectile_in_world(&mut state, &world, release);
            assert!(state.in_water, "{release}");
            assert!((state.velocity.x - vx * f64::from(0.8_f32)).abs() < 1.0e-9, "{release}");
        }
        // leaving the water the air's drag comes back
        let release = MinecraftVersion::new(1, 21, 4);
        let mut arrow =
            ArrowState::new_in_release(Vec3::new(7.5, 101.0, 0.5), Vec3::new(2.0, 0.0, 0.0), release);
        arrow.in_water = true;
        arrow.gravity = 0.0;
        let _ = tick_arrow_in_world(&mut arrow, &world, release);
        assert!(!arrow.in_water);
    }

    #[test]
    fn a_no_physics_arrow_flies_through_blocks_without_gravity() {
        // AbstractArrow.isNoPhysics, from 1.13 (1.13.2 AbstractArrowEntity.java:156-167, 187, 298;
        // 1.16.5 PersistentProjectileEntity.java:121; 26.3 AbstractArrow.java:165-233): no
        // containment, no in-ground branch, no ray, no gravity; the inertia stays
        let world = wall((0, 100, 0));
        let at = Vec3::new(0.5, 100.5, 0.5);
        let shot = Vec3::new(0.25, 0.0, 0.0);
        let drag = f64::from(0.99_f32);
        for release in [
            MinecraftVersion::new(1, 13, 2),
            MinecraftVersion::new(1, 16, 5),
            MinecraftVersion::new(1, 21, 1),
            MinecraftVersion::new(1, 21, 5),
            MinecraftVersion::new(26, 3, 0),
        ] {
            let mut arrow = ArrowState::new_in_release(at, shot, release);
            arrow.no_physics = true;
            let result = tick_arrow_in_release(&mut arrow, &world, release);
            assert!(!result.in_ground && !result.block_hit, "{release}");
            assert_eq!(arrow.position, at + shot, "{release}");
            assert_eq!(arrow.velocity, shot.scale(drag), "{release}");
            // an embedded one leaves the block with in_ground kept, as vanilla's flag stays set
            let mut embedded = ArrowState::new_in_release(at, shot, release);
            embedded.no_physics = true;
            embedded.in_ground = true;
            embedded.in_ground_time = 3;
            let result = tick_arrow_in_release(&mut embedded, &world, release);
            assert!(result.in_ground, "{release}");
            assert_eq!(result.in_ground_time, 0, "{release}");
            assert_eq!(embedded.position, at + shot, "{release}");
            // water takes the place of the air's drag
            let mut wet = ArrowState::new_in_release(at, shot, release);
            wet.no_physics = true;
            wet.in_water = true;
            let _ = tick_arrow_in_release(&mut wet, &world, release);
            assert_eq!(wet.position, at + shot, "{release}");
            assert_eq!(wet.velocity, shot.scale(wet.water_inertia), "{release}");
        }
        // the flag does not exist before 1.13
        let release = MinecraftVersion::new(1, 12, 2);
        let mut arrow = ArrowState::new_in_release(at, shot, release);
        arrow.no_physics = true;
        let plain = {
            let mut plain = ArrowState::new_in_release(at, shot, release);
            let _ = tick_arrow_in_release(&mut plain, &world, release);
            plain
        };
        let _ = tick_arrow_in_release(&mut arrow, &world, release);
        assert_eq!(arrow.position, plain.position);
        assert_eq!(arrow.velocity, plain.velocity);
    }

    #[test]
    fn containment_reads_the_exact_shape_and_the_release_faces() {
        let slab = {
            let mut world = WorldSnapshot::new();
            world.set_block(
                (0, 100, 0),
                BlockState {
                    shape: Some(BlockShape {
                        bounds: Aabb::new(Vec3::ZERO, Vec3::new(1.0, 0.5, 1.0)),
                        ..BlockShape::full_block()
                    }),
                    ..BlockState::default()
                },
            );
            world
        };
        let release = MinecraftVersion::new(26, 3, 0);
        let embeds = |world: &WorldSnapshot, at: Vec3, release: MinecraftVersion| {
            let mut arrow = ArrowState::new_in_release(at, Vec3::ZERO, release);
            if !release.at_least(1, 14, 0) {
                arrow.last_block_position = Some((0, 100, 0));
                arrow.last_block_id = Some(world.block((0, 100, 0)).id);
            }
            tick_arrow_in_release(&mut arrow, world, release).in_ground
        };
        assert!(embeds(&slab, Vec3::new(0.5, 100.25, 0.5), release));
        assert!(!embeds(&slab, Vec3::new(0.5, 100.75, 0.5), release));
        // the top face is outside
        assert!(!embeds(&slab, Vec3::new(0.5, 100.5, 0.5), release));
        // the lower faces are in from 1.13 (1.13.2 Box.java:217-222), out before (1.12.2 :274-278)
        let block = wall((0, 100, 0));
        let face = Vec3::new(0.0, 100.0, 0.0);
        assert!(embeds(&block, face, release));
        assert!(embeds(&block, face, MinecraftVersion::new(1, 13, 2)));
        assert!(!embeds(&block, face, MinecraftVersion::new(1, 12, 2)));
    }

    #[test]
    fn a_block_placed_around_a_flying_arrow_embeds_it_on_the_next_tick() {
        let at = Vec3::new(0.5, 100.5, 0.5);
        for release in [MinecraftVersion::new(1, 14, 4), MinecraftVersion::new(26, 3, 0)] {
            let mut arrow = ArrowState::new_in_release(at, Vec3::ZERO, release);
            arrow.gravity = 0.0;
            assert!(!tick_arrow_in_release(&mut arrow, &WorldSnapshot::new(), release).in_ground);
            let result = tick_arrow_in_release(&mut arrow, &wall((0, 100, 0)), release);
            assert!(result.in_ground, "{release}");
            assert_eq!(arrow.position, at, "{release}");
        }
    }

    #[test]
    fn a_block_around_a_stationary_arrow_embeds_it() {
        // the containing block's shape before the flight (1.14 ProjectileEntity.java:164-174, 1.21.4
        // PersistentProjectileEntity.java:166-185), the motion stopped too from 1.21.5 (1.21.5
        // AbstractArrow.java:172-175); until 1.13.2 only the block of the last hit counts
        let world = wall((0, 100, 0));
        let at = Vec3::new(0.5, 100.5, 0.5);
        let shot = Vec3::new(0.25, 0.0, 0.0);
        for (release, keeps) in [
            (MinecraftVersion::new(1, 14, 4), true),
            (MinecraftVersion::new(1, 21, 4), true),
            (MinecraftVersion::new(1, 21, 5), false),
            (MinecraftVersion::new(26, 3, 0), false),
        ] {
            let mut arrow = ArrowState::new_in_release(at, shot, release);
            let result = tick_arrow_in_release(&mut arrow, &world, release);
            assert!(result.in_ground, "{release}");
            assert_eq!(arrow.position, at, "{release}");
            assert_eq!(arrow.velocity, if keeps { shot } else { Vec3::ZERO }, "{release}");
        }
        for release in [MinecraftVersion::new(1, 9, 4), MinecraftVersion::new(1, 13, 2)] {
            let mut stray = ArrowState::new_in_release(at, Vec3::ZERO, release);
            assert!(!tick_arrow_in_release(&mut stray, &world, release).in_ground, "{release}");
            let mut remembered = ArrowState::new_in_release(at, Vec3::ZERO, release);
            remembered.last_block_position = Some((0, 100, 0));
            remembered.last_block_id = Some(world.block((0, 100, 0)).id);
            assert!(tick_arrow_in_release(&mut remembered, &world, release).in_ground, "{release}");
        }
    }

    #[test]
    fn a_replaced_block_keeps_a_trident_and_its_arrow_only_while_something_holds_them() {
        // lastState against the block read, then shouldFall's test (26.3 AbstractArrow.java:192-199,
        // 1.21.4 PersistentProjectileEntity.java:195-199, 1.16.5 :156-160, 246; 1.14
        // ProjectileEntity.java:187; 1.13.2 AbstractArrowEntity.java:188), which ThrownTrident.tick inherits (26.3
        // ThrownTrident.java:62-99, 1.13.2 TridentEntity.java:57-92): another solid block holds both,
        // a block short of them or none drops both, and the remembered hit is the first block's
        let wall = (1, 100, 0);
        let impulse = Vec3::new(0.5, 0.5, 0.5);
        let low_slab = BlockState {
            id: 13,
            shape: Some(BlockShape {
                bounds: Aabb::new(Vec3::ZERO, Vec3::new(1.0, 0.25, 1.0)),
                ..BlockShape::full_block()
            }),
            ..BlockState::default()
        };
        for release in [
            MinecraftVersion::new(1, 13, 2),
            MinecraftVersion::new(1, 14, 4),
            MinecraftVersion::new(1, 16, 5),
            MinecraftVersion::new(1, 21, 1),
            MinecraftVersion::new(1, 21, 4),
            MinecraftVersion::new(26, 3, 0),
        ] {
            for replacement in [None, Some(low_slab.clone())] {
                let mut world = WorldSnapshot::new();
                world.set_block(wall, solid(11));
                let (from, by) = (Vec3::new(0.5, 100.5, 0.5), Vec3::new(2.0, 0.0, 0.0));
                let mut trident = TridentState::new_in_release(from, by, release);
                trident.fall_impulse = impulse;
                let mut arrow = ArrowState::new_in_release(from, by, release);
                arrow.fall_impulse = impulse;
                let step = |trident: &mut TridentState, arrow: &mut ArrowState, world: &WorldSnapshot| {
                    let result = tick_trident_in_world(trident, world, release);
                    let control = tick_arrow_in_world(arrow, world, release);
                    // the arrow control, tick by tick
                    assert_eq!(
                        (result.position, result.velocity, result.block_hit, result.in_ground),
                        (control.position, control.velocity, control.block_hit, control.in_ground),
                        "{release}"
                    );
                    assert_eq!(
                        (result.discarded, result.in_ground_time, result.shake_time, result.started_falling),
                        (control.discarded, control.in_ground_time, control.shake_time, control.started_falling),
                        "{release}"
                    );
                    assert_eq!(trident.life, arrow.life, "{release}");
                    assert_eq!(
                        (trident.last_block_id, trident.last_block_position),
                        (arrow.last_block_id, arrow.last_block_position),
                        "{release}"
                    );
                    result
                };

                let hit = step(&mut trident, &mut arrow, &world);
                assert!(hit.block_hit && hit.in_ground, "{release}");
                assert_eq!(hit.shake_time, 7, "{release}");
                assert_eq!(trident.last_block_id, Some(11), "{release}");
                assert_eq!(trident.last_block_position, Some(wall), "{release}");
                let embedded = trident.position;

                world.set_block(wall, solid(12));
                let held = step(&mut trident, &mut arrow, &world);
                assert!(held.in_ground && !held.started_falling, "{release}");
                assert_eq!(held.position, embedded, "{release}");
                assert_eq!((trident.life, held.in_ground_time), (1, 1), "{release}");
                assert_eq!(trident.last_block_id, Some(11), "{release}");
                assert_eq!(trident.last_block_position, Some(wall), "{release}");

                match replacement.clone() {
                    Some(block) => world.set_block(wall, block),
                    None => world.remove_block(wall),
                }
                let resting = trident.velocity;
                let dropped = step(&mut trident, &mut arrow, &world);
                assert!(dropped.started_falling && !dropped.in_ground, "{release}");
                // startFalling: the motion by the random impulse, life 0, no move on this tick
                assert_eq!(dropped.position, embedded, "{release}");
                assert_eq!(dropped.velocity, resting.multiply(impulse), "{release}");
                assert_eq!((trident.life, dropped.in_ground_time), (0, 2), "{release}");

                let flying = step(&mut trident, &mut arrow, &world);
                assert!(!flying.in_ground && !flying.started_falling, "{release}");
                assert_eq!(flying.in_ground_time, 0, "{release}");
            }
        }
    }

    #[test]
    fn an_embedded_trident_despawns_like_an_arrow_without_loyalty() {
        // ThrownTrident.tickDespawn without loyalty is AbstractArrow's ++life >= 1200 (26.3
        // ThrownTrident.java:213-219, AbstractArrow.java:356-362); loyalty is not modelled
        let release = MinecraftVersion::new(1, 21, 4);
        let world = wall((1, 100, 0));
        let mut state =
            TridentState::new_in_release(Vec3::new(0.5, 100.5, 0.5), Vec3::new(2.0, 0.0, 0.0), release);
        let _ = tick_trident_in_world(&mut state, &world, release);
        state.life = 1198;
        assert!(!tick_trident_in_world(&mut state, &world, release).discarded);
        assert_eq!(state.life, 1199);
        assert!(tick_trident_in_world(&mut state, &world, release).discarded);
    }

    #[test]
    fn every_arrow_alias_names_an_abstract_arrow_family() {
        for (name, kind) in [
            ("arrow", ProjectileKind::Arrow),
            ("minecraft:arrow", ProjectileKind::Arrow),
            ("Arrow", ProjectileKind::Arrow),
            ("thrown_arrow", ProjectileKind::Arrow),
            ("spectral_arrow", ProjectileKind::SpectralArrow),
            ("SpectralArrow", ProjectileKind::SpectralArrow),
            ("minecraft:spectral_arrow", ProjectileKind::SpectralArrow),
            ("tipped_arrow", ProjectileKind::TippedArrow),
            ("TippedArrow", ProjectileKind::TippedArrow),
            ("entity:tipped_arrow", ProjectileKind::TippedArrow),
            ("trident", ProjectileKind::Trident),
            ("ThrownTrident", ProjectileKind::Trident),
            ("minecraft:trident", ProjectileKind::Trident),
        ] {
            assert_eq!(ProjectileKind::from_name_checked(name), Some(kind), "{name}");
            assert!(kind.is_arrow(), "{name}");
        }
    }

    #[test]
    fn an_arrow_family_without_its_state_flies_as_its_specialized_tick_in_air_and_water() {
        // AbstractArrow's order on both sides of 1.21.2 (1.21.4 PersistentProjectileEntity.java:
        // 166-250, 1.21 :153-277): not ThrowableProjectile's 0.8F water and gravity first (1.21.4
        // ThrownEntity.java:47-62); a trident's water inertia is its own 0.99F (26.3
        // ThrownTrident.java:221-223, 1.13.2 TridentEntity.java:193)
        let world = WorldSnapshot::new();
        let (from, by) = (Vec3::new(0.0, 100.0, 0.0), Vec3::new(1.0, 1.0, 0.0));
        for release in [
            MinecraftVersion::new(1, 20, 4),
            MinecraftVersion::new(1, 21, 1),
            MinecraftVersion::new(1, 21, 2),
            MinecraftVersion::new(1, 21, 4),
            MinecraftVersion::new(26, 3, 0),
        ] {
            for in_water in [false, true] {
                for kind in [
                    ProjectileKind::Arrow,
                    ProjectileKind::SpectralArrow,
                    ProjectileKind::TippedArrow,
                ] {
                    let mut generic = ProjectileState::for_kind_in_release(kind, from, by, release);
                    generic.in_water = in_water;
                    let mut arrow = ArrowState::new_in_release(from, by, release);
                    arrow.in_water = in_water;
                    for _ in 0..3 {
                        let result = tick_projectile_in_release(&mut generic, &world, release);
                        let control = tick_arrow_in_release(&mut arrow, &world, release);
                        assert_eq!(result.position, control.position, "{release} {kind:?}");
                        assert_eq!(result.velocity, control.velocity, "{release} {kind:?}");
                    }
                }
                let mut generic =
                    ProjectileState::for_kind_in_release(ProjectileKind::Trident, from, by, release);
                generic.in_water = in_water;
                let mut trident = TridentState::new_in_release(from, by, release);
                trident.in_water = in_water;
                for _ in 0..3 {
                    let result = tick_projectile_in_release(&mut generic, &world, release);
                    let control = tick_trident_in_release(&mut trident, &world, release);
                    assert_eq!(result.position, control.position, "{release}");
                    assert_eq!(result.velocity, control.velocity, "{release}");
                }
            }
        }
        // the water tick by hand: the whole old motion moves it, then 0.6F and gravity
        let modern = MinecraftVersion::new(1, 21, 4);
        let mut state =
            ProjectileState::for_kind_in_release(ProjectileKind::TippedArrow, from, by, modern);
        state.in_water = true;
        let result = tick_projectile_in_release(&mut state, &world, modern);
        assert_eq!(result.position, Vec3::new(1.0, 101.0, 0.0));
        assert_eq!(result.velocity.x, f64::from(0.6_f32));
        assert_eq!(result.velocity.y, f64::from(0.6_f32) - 0.05);
    }

    #[test]
    fn genuine_throwables_keep_their_own_integration() {
        // 1.21.4 ThrownEntity.java:47-62: gravity, then 0.99F, then the move; 1.20.4 :46-96: the
        // move, then 0.99F, then 0.03F
        let world = WorldSnapshot::new();
        let (from, by) = (Vec3::new(0.0, 100.0, 0.0), Vec3::new(1.0, 1.0, 0.0));
        let drag = f64::from(0.99_f32);
        let modern = MinecraftVersion::new(1, 21, 4);
        let mut state = ProjectileState::for_kind_in_release(ProjectileKind::Snowball, from, by, modern);
        let result = tick_projectile_in_release(&mut state, &world, modern);
        assert_eq!(result.velocity, Vec3::new(drag, (1.0 - 0.03) * drag, 0.0));
        assert_eq!(result.position, from + result.velocity);
        let old = MinecraftVersion::new(1, 20, 4);
        let mut state = ProjectileState::for_kind_in_release(ProjectileKind::Snowball, from, by, old);
        let result = tick_projectile_in_release(&mut state, &world, old);
        assert_eq!(result.position, from + by);
        assert_eq!(result.velocity, Vec3::new(drag, drag - f64::from(0.03_f32), 0.0));
    }

    const BORDER_EAST: f64 = 5.0 - 9.999999747378752e-6;

    fn ten_wide_border() -> WorldSnapshot {
        let mut world = WorldSnapshot::new();
        world.set_world_bounds(-64, 320, 0.0, 0.0, 10.0);
        world
    }

    /// A snowball without gravity or drag: where it stops, and whether it hit.
    fn thrown_through(
        world: &WorldSnapshot,
        from: Vec3,
        by: Vec3,
        release: MinecraftVersion,
    ) -> (Vec3, bool) {
        let mut state =
            ProjectileState::for_kind_in_release(ProjectileKind::Snowball, from, by, release);
        state.gravity = 0.0;
        state.air_drag = 1.0;
        state.first_tick = false;
        let result = tick_projectile_in_release(&mut state, world, release);
        (result.position, result.block_hit)
    }

    #[test]
    fn every_face_of_the_border_clamps_the_end_of_the_ray_from_1_21_2() {
        // clipIncludingBorder clamps the clip's end, not the crossing, and keeps its y
        // (client1.21.2 CollisionGetter.java:119-130, 26.3 :114-125): clampVec3ToBound holds x and z
        // to [min, max - 1.0E-5F] (26.3 WorldBorder.java:99-101); 1.21.1 has the plain clip
        // (1.21 ProjectileUtil.java:49, 1.21.1 ProjectileUtil.java:49)
        let world = ten_wide_border();
        let cases = [
            (Vec3::new(4.5, 100.0, 0.0), Vec3::new(1.0, 0.0, 0.0), Vec3::new(BORDER_EAST, 100.0, 0.0)),
            (Vec3::new(-4.5, 100.0, 0.0), Vec3::new(-1.0, 0.0, 0.0), Vec3::new(-5.0, 100.0, 0.0)),
            (Vec3::new(0.0, 100.0, 4.5), Vec3::new(0.0, 0.0, 1.0), Vec3::new(0.0, 100.0, BORDER_EAST)),
            (Vec3::new(0.0, 100.0, -4.5), Vec3::new(0.0, 0.0, -1.0), Vec3::new(0.0, 100.0, -5.0)),
            // the far end held to the face: not where the ray crossed it (x 5 at y 100.25)
            (Vec3::new(4.5, 100.0, -1.0), Vec3::new(1.0, 0.5, 0.25), Vec3::new(BORDER_EAST, 100.5, -0.75)),
            // past two faces
            (Vec3::new(4.5, 100.0, 4.5), Vec3::new(1.0, 0.0, 1.0), Vec3::new(BORDER_EAST, 100.0, BORDER_EAST)),
            (Vec3::new(-4.5, 100.0, -4.5), Vec3::new(-1.0, 0.0, -1.0), Vec3::new(-5.0, 100.0, -5.0)),
        ];
        for (from, by, clamped) in cases {
            for release in [MinecraftVersion::new(1, 21, 2), MinecraftVersion::new(26, 3, 0)] {
                assert_eq!(thrown_through(&world, from, by, release), (clamped, true), "{release}");
            }
            assert_eq!(
                thrown_through(&world, from, by, MinecraftVersion::new(1, 21, 1)),
                (from + by, false)
            );
        }
    }

    #[test]
    fn a_ray_on_the_border_takes_the_half_open_bounds() {
        // isWithinBounds: min <= x < max (26.3 WorldBorder.java:79-81), so the east and south
        // faces are outside and the west and north ones inside; a clip starting outside is plain,
        // one ending inside too
        let world = ten_wide_border();
        for release in [MinecraftVersion::new(1, 21, 2), MinecraftVersion::new(26, 3, 0)] {
            let at = |x: f64, z: f64| Vec3::new(x, 100.0, z);
            let along = |x: f64, z: f64| Vec3::new(x, 0.0, z);
            // starting on the east and south faces: outside, whichever way it goes
            assert_eq!(thrown_through(&world, at(5.0, 0.0), along(1.0, 0.0), release), (at(6.0, 0.0), false));
            assert_eq!(thrown_through(&world, at(5.0, 0.0), along(-1.0, 0.0), release), (at(4.0, 0.0), false));
            assert_eq!(thrown_through(&world, at(0.0, 5.0), along(0.0, 1.0), release), (at(0.0, 6.0), false));
            // starting on the west and north faces: inside, so leaving hits at once
            assert_eq!(thrown_through(&world, at(-5.0, 0.0), along(-1.0, 0.0), release), (at(-5.0, 0.0), true));
            assert_eq!(thrown_through(&world, at(0.0, -5.0), along(0.0, -1.0), release), (at(0.0, -5.0), true));
            // ending on a face: the east one is out, the west one is in
            assert_eq!(thrown_through(&world, at(4.0, 0.0), along(1.0, 0.0), release), (at(BORDER_EAST, 0.0), true));
            assert_eq!(thrown_through(&world, at(-4.0, 0.0), along(-1.0, 0.0), release), (at(-5.0, 0.0), false));
            // starting outside, the way in or on out
            assert_eq!(thrown_through(&world, at(6.0, 0.0), along(1.0, 0.0), release), (at(7.0, 0.0), false));
            assert_eq!(thrown_through(&world, at(6.0, 0.0), along(-2.0, 0.0), release), (at(4.0, 0.0), false));
        }
    }

    #[test]
    fn the_nearer_block_wins_and_a_block_past_the_border_does_not() {
        // the clip's own location decides (client1.21.2 CollisionGetter.java:119-130): a block
        // inside stays the hit, a hit outside becomes the border's at BlockPos.containing(hit)
        let release = MinecraftVersion::new(1, 21, 2);
        let mut nearer = ten_wide_border();
        nearer.set_block((4, 100, 0), solid(21));
        let from = Vec3::new(3.5, 100.5, 0.5);
        let hit = clip_blocks(&nearer, from, Vec3::new(3.0, 0.0, 0.0), release, ClipShape::Collider).unwrap();
        assert_eq!(hit.location, Vec3::new(4.0, 100.5, 0.5));
        assert_eq!(hit.block, (4, 100, 0));
        assert!(!hit.border);

        for wall_x in [5, 6] {
            let mut past = ten_wide_border();
            past.set_block((wall_x, 100, 0), solid(21));
            let from = Vec3::new(4.5, 100.5, 0.5);
            let hit = clip_blocks(&past, from, Vec3::new(3.0, 0.0, 0.0), release, ClipShape::Collider).unwrap();
            assert_eq!(hit.location, Vec3::new(BORDER_EAST, 100.5, 0.5));
            assert_eq!(hit.block, (4, 100, 0));
            assert!(hit.border);
            // the plain clip of 1.21.1 reaches the block
            let plain = clip_blocks(&past, from, Vec3::new(3.0, 0.0, 0.0), MinecraftVersion::new(1, 21, 1), ClipShape::Collider).unwrap();
            assert_eq!(plain.location, Vec3::new(f64::from(wall_x), 100.5, 0.5));
            assert_eq!(plain.block, (wall_x, 100, 0));
            assert!(!plain.border);
        }

        let west = clip_blocks(&ten_wide_border(), Vec3::new(-4.5, 100.0, 0.0), Vec3::new(-1.0, 0.0, 0.0), release, ClipShape::Collider).unwrap();
        assert_eq!(west.block, (-5, 100, 0));
        assert!(west.border);
    }

    #[test]
    fn a_zero_move_never_meets_the_border() {
        // from equal to to misses at to (26.3 BlockGetter.java:102-104), which is where it began
        let mut world = ten_wide_border();
        world.set_block((0, 100, 0), solid(21));
        let release = MinecraftVersion::new(1, 21, 2);
        for from in [
            Vec3::new(4.5, 100.0, 0.0),
            Vec3::new(5.0, 100.0, 0.0),
            Vec3::new(-5.0, 100.0, 0.0),
            Vec3::new(7.0, 100.0, 0.0),
            // inside a solid block too
            Vec3::new(0.5, 100.5, 0.5),
        ] {
            assert_eq!(clip_blocks(&world, from, Vec3::ZERO, release, ClipShape::Collider), None);
            assert_eq!(thrown_through(&world, from, Vec3::ZERO, release), (from, false));
        }
    }

    #[test]
    fn a_rocket_reports_the_border_hit_from_1_21_2_and_is_stopped_by_entity_move_on_both_sides() {
        // the hit test takes the boosted motion before the move from 1.21.2 (1.21.3
        // FireworkRocketEntity.java:143-153, getCollision at :145, 26.3 :145-147) and moves nothing;
        // Entity.move holds the box at the border in both (26.3 CollisionGetter.java:110-113)
        let world = ten_wide_border();
        let shot = |world: &WorldSnapshot, from: Vec3, release| {
            let mut state = ProjectileState::for_kind_in_release(
                ProjectileKind::Firework,
                from,
                Vec3::new(1.0, 0.0, 0.0),
                release,
            );
            state.shot_at_angle = true;
            let result = tick_projectile_in_release(&mut state, world, release);
            (result.position.x, result.block_hit, result.velocity.x)
        };
        let from = Vec3::new(4.5, 100.0, 0.0);
        // box half width 0.125: x 5 less that, and the motion comes back after the move
        assert_eq!(shot(&world, from, MinecraftVersion::new(1, 21, 1)), (4.875, false, 1.0));
        assert_eq!(shot(&world, from, MinecraftVersion::new(1, 21, 2)), (4.875, true, 1.0));
        assert_eq!(shot(&world, from, MinecraftVersion::new(26, 3, 0)), (4.875, true, 1.0));
        // a block short of the border is an ordinary hit on both sides
        let mut walled = ten_wide_border();
        walled.set_block((3, 100, 0), solid(21));
        let near = Vec3::new(2.5, 100.0, 0.0);
        assert_eq!(shot(&walled, near, MinecraftVersion::new(1, 21, 1)), (2.875, true, 1.0));
        assert_eq!(shot(&walled, near, MinecraftVersion::new(1, 21, 2)), (2.875, true, 1.0));
    }

    #[test]
    fn a_fireball_stops_at_the_border_from_1_21_2() {
        // AbstractHurtingProjectile's getHitResultOnMoveVector, no bounce (1.21.5 Projectile.java:
        // 247-249), and the hit's location is the new position (26.3
        // AbstractHurtingProjectile.java:70-78)
        let world = ten_wide_border();
        let shot = |release| {
            let mut state = ProjectileState::for_kind_in_release(
                ProjectileKind::Fireball,
                Vec3::new(4.5, 100.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                release,
            );
            state.air_drag = 1.0;
            state.acceleration_power = 0.0;
            let result = tick_projectile_in_release(&mut state, &world, release);
            (result.position.x, result.block_hit)
        };
        assert_eq!(shot(MinecraftVersion::new(1, 21, 1)), (5.5, false));
        assert_eq!(shot(MinecraftVersion::new(1, 21, 2)), (BORDER_EAST, true));
    }

    #[test]
    fn an_arrow_and_a_trident_turn_back_from_the_border_from_1_21_2() {
        // AbstractArrow's clipIncludingBorder (1.21.3 PersistentProjectileEntity.java:229-233, 26.3
        // AbstractArrow.java:236; 1.21 :201 has the plain raycast) and the bounce that comes with it:
        // client1.21.2 Projectile.java:232-237, AbstractArrow.java:765-767; 1.21.4
        // ProjectileEntity.java:254-259, PersistentProjectileEntity.java:714-716, ProjectileDeflection
        // SIMPLE's -0.5, then 0.2; 26.3 Projectile.java:262-265 by power 0.2. It is no hit, so
        // no embedding and no shake; the air inertia and the gravity still follow
        let world = ten_wide_border();
        let (from, by) = (Vec3::new(4.5, 100.0, 0.0), Vec3::new(1.0, 0.0, 0.0));
        let flown = tick_arrow_in_release(
            &mut ArrowState::new_in_release(from, by, MinecraftVersion::new(1, 21, 1)),
            &world,
            MinecraftVersion::new(1, 21, 1),
        );
        assert_eq!(flown.position, from + by);
        assert!(!flown.block_hit && !flown.in_ground);
        for release in [
            MinecraftVersion::new(1, 21, 2),
            MinecraftVersion::new(1, 21, 4),
            MinecraftVersion::new(1, 21, 5),
            MinecraftVersion::new(26, 3, 0),
        ] {
            let mut arrow = ArrowState::new_in_release(from, by, release);
            let result = tick_arrow_in_release(&mut arrow, &world, release);
            assert_eq!(result.position, Vec3::new(BORDER_EAST, 100.0, 0.0), "{release}");
            assert_eq!(result.velocity.x, -0.1 * f64::from(0.99_f32), "{release}");
            assert_eq!(result.velocity.y, -0.05, "{release}");
            assert!(!result.block_hit && !result.in_ground, "{release}");
            assert_eq!(result.shake_time, 0, "{release}");
            assert_eq!(arrow.last_block_position, None, "{release}");
            // it flies on, back inside
            let next = tick_arrow_in_release(&mut arrow, &world, release);
            assert!(next.position.x < BORDER_EAST && !next.in_ground, "{release}");

            let mut trident = TridentState::new_in_release(from, by, release);
            trident.in_water = true;
            let result = tick_trident_in_release(&mut trident, &world, release);
            assert!(!result.block_hit && !result.in_ground, "{release}");
            assert_eq!(result.velocity.x, -0.1 * f64::from(0.99_f32), "{release}");
        }
        // 26.3's REVERSE takes -power * 0.5 at once; before, -0.5 then 0.2 (26.3
        // ProjectileDeflection.java:12-14; 1.21.5 :11-13, Projectile.java:235-238)
        let bounced = |release| {
            let by = Vec3::new(0.7, 0.0, 0.0);
            let mut arrow = ArrowState::new_in_release(Vec3::new(4.5, 100.0, 0.0), by, release);
            arrow.air_drag = 1.0;
            tick_arrow_in_release(&mut arrow, &world, release).velocity.x
        };
        assert_eq!(bounced(MinecraftVersion::new(26, 2, 0)), 0.7 * -0.5 * 0.2);
        assert_eq!(bounced(MinecraftVersion::new(26, 3, 0)), 0.7 * (-0.2 * 0.5));
    }

    #[test]
    fn a_fishing_hook_turns_back_from_the_border_on_the_client_until_26_3() {
        // FishingHook.shouldBounceOnWorldBorder (client1.21.2 FishingHook.java:112-114, 26.3
        // :119-121): the bounce, not onHitBlock's motion to the hit. deflect moves it on both sides
        // until 26.2 (26.2 Projectile.java:229-237), on the server only in 26.3 (26.3
        // Projectile.java:278-284), and the client's hook keeps its motion. Then -0.03, the move and
        // 0.92 (26.3 FishingHook.java:224-241)
        let world = ten_wide_border();
        let shot = |release| {
            let mut state = ProjectileState::for_kind_in_release(
                ProjectileKind::FishingHook,
                Vec3::new(4.5, 100.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                release,
            );
            let result = tick_projectile_in_release(&mut state, &world, release);
            (result.position.x, result.velocity.x, result.block_hit)
        };
        let collided = (4.875, 0.0, false);
        assert_eq!(shot(MinecraftVersion::new(1, 21, 1)), collided);
        for release in [
            MinecraftVersion::new(1, 21, 2),
            MinecraftVersion::new(1, 21, 11),
            MinecraftVersion::new(26, 2, 0),
        ] {
            assert_eq!(shot(release), (4.5 + -0.5 * 0.2, -0.5 * 0.2 * 0.92, false), "{release}");
        }
        assert_eq!(shot(MinecraftVersion::new(26, 3, 0)), collided);
    }

    #[test]
    fn rays_other_than_a_projectiles_stay_plain_clips() {
        // Entity's fall-damage ray and Entity.pick are BlockGetter.clip (26.3 Entity.java:799, 2066);
        // only the projectile paths take clipIncludingBorder (26.3 ProjectileUtil.java:67, 82, 188,
        // AbstractArrow.java:236), so the border hits nothing here and hides no block past it
        let mut world = ten_wide_border();
        let release = MinecraftVersion::new(26, 3, 0);
        let (from, past) = (Vec3::new(4.5, 100.5, 0.5), Vec3::new(5.5, 100.5, 0.5));
        let fall = ClipShape::FallDamageResetting { player: true };
        assert!(!clip_hits(&world, from, past, release, fall));
        assert!(!clip_hits(&world, from, past, release, ClipShape::Collider));
        world.set_block((5, 100, 0), solid(21));
        assert!(clip_hits(&world, from, past, release, ClipShape::Collider));
    }

    /// A world whose chunks around the origin are loaded, as EntityFluidInteraction asks from 26.1.
    fn loaded_world() -> WorldSnapshot {
        let mut world = WorldSnapshot::new();
        for chunk_x in -1..=1 {
            for chunk_z in -1..=1 {
                world.set_chunk_loaded(chunk_x, chunk_z, true);
            }
        }
        world
    }

    fn water_flowing(flow: Vec3) -> BlockState {
        BlockState {
            fluid: FluidState::Water,
            fluid_source: true,
            fluid_flow: flow,
            ..BlockState::default()
        }
    }

    /// Water filling the columns `xs`, from y 99 to 102 and z -1 to 1.
    fn flood(world: &mut WorldSnapshot, xs: std::ops::RangeInclusive<i32>, flow: Vec3) {
        for x in xs {
            for y in 99..=102 {
                for z in -1..=1 {
                    world.set_block((x, y, z), water_flowing(flow));
                }
            }
        }
    }

    /// A thrown item without gravity, between ticks.
    fn in_flight(position: Vec3, velocity: Vec3, release: MinecraftVersion) -> ProjectileState {
        let mut state =
            ProjectileState::for_kind_in_release(ProjectileKind::Snowball, position, velocity, release);
        state.gravity = 0.0;
        state.first_tick = false;
        state
    }

    const BASE_TICK_FIRST: [MinecraftVersion; 3] = [
        MinecraftVersion::new(1, 12, 2),
        MinecraftVersion::new(1, 20, 4),
        MinecraftVersion::new(1, 21, 1),
    ];
    const BASE_TICK_AFTER_THE_MOVE: [MinecraftVersion; 3] = [
        MinecraftVersion::new(1, 21, 2),
        MinecraftVersion::new(1, 21, 4),
        MinecraftVersion::new(26, 3, 0),
    ];

    #[test]
    fn a_thrown_item_leaving_the_water_takes_the_air_inertia_at_its_base_tick() {
        // isInWater is the last base tick's: after the move from 1.21.2 (client1.21.2
        // ThrowableProjectile.java:43-62, 26.3 :41-60), before it until 1.21.1 (1.21.1 :39-66)
        let mut world = loaded_world();
        flood(&mut world, 1..=3, Vec3::ZERO);
        let (water, air) = (f64::from(0.8_f32), f64::from(0.99_f32));
        let from = Vec3::new(3.5, 100.0, 0.5);
        for release in BASE_TICK_AFTER_THE_MOVE {
            let mut state = in_flight(from, Vec3::new(1.0, 0.0, 0.0), release);
            state.in_water = true;
            let result = tick_projectile_in_world(&mut state, &world, release);
            assert_eq!(result.velocity.x, water, "{release}");
            assert!(!state.in_water, "{release}");
            let result = tick_projectile_in_world(&mut state, &world, release);
            assert_eq!(result.velocity.x, water * air, "{release}");
        }
        for release in BASE_TICK_FIRST {
            let mut state = in_flight(from, Vec3::new(1.0, 0.0, 0.0), release);
            state.in_water = true;
            let result = tick_projectile_in_world(&mut state, &world, release);
            assert_eq!(result.velocity.x, water, "{release}");
            assert!(state.in_water, "{release}");
            let result = tick_projectile_in_world(&mut state, &world, release);
            assert_eq!(result.velocity.x, water * air, "{release}");
            assert!(!state.in_water, "{release}");
        }
    }

    #[test]
    fn the_first_tick_reads_the_water_of_the_base_tick_before_it() {
        // a new entity's wasTouchingWater is false: from 1.21.2 the first tick is in the air's
        // inertia, whatever it started in; until 1.21.1 the base tick has already found the water.
        // firstTick itself only silences the splash (26.3 Entity.java:1692-1694)
        let mut world = loaded_world();
        flood(&mut world, -1..=3, Vec3::ZERO);
        let from = Vec3::new(0.5, 100.0, 0.5);
        for release in BASE_TICK_AFTER_THE_MOVE {
            let mut state = in_flight(from, Vec3::new(1.0, 0.0, 0.0), release);
            state.first_tick = true;
            let result = tick_projectile_in_world(&mut state, &world, release);
            assert_eq!(result.velocity.x, f64::from(0.99_f32), "{release}");
            assert!(state.in_water && !state.first_tick, "{release}");
        }
        for release in BASE_TICK_FIRST {
            let mut state = in_flight(from, Vec3::new(1.0, 0.0, 0.0), release);
            state.first_tick = true;
            let result = tick_projectile_in_world(&mut state, &world, release);
            assert_eq!(result.velocity.x, f64::from(0.8_f32), "{release}");
            assert!(state.in_water && !state.first_tick, "{release}");
        }
    }

    #[test]
    fn shallow_water_counts_by_the_release_box() {
        // a level seven flow is 1/9 of a block. From 1.14 the box deflated by 0.001 touches a fluid
        // whose top is at or above its bottom (1.21.4 Entity.java:3297-3318, 26.3
        // EntityFluidInteraction.java:44-85). Before 1.13 the box shrunk by 0.4F turns over and
        // reaches 0.15 below the entity and 0.15 above its top, and any water cell of it counts up to
        // the ceiling of that box (1.12.2 Entity.java:1051, World.java:1635)
        let mut world = loaded_world();
        world.set_block(
            (0, 100, 0),
            BlockState {
                fluid: FluidState::Water,
                fluid_level: 7,
                ..BlockState::default()
            },
        );
        let touches = |y: f64, release| {
            let mut state = in_flight(Vec3::new(0.5, y, 0.5), Vec3::ZERO, release);
            let _ = tick_projectile_in_world(&mut state, &world, release);
            state.in_water
        };
        for release in [
            MinecraftVersion::new(1, 14, 4),
            MinecraftVersion::new(1, 20, 4),
            MinecraftVersion::new(1, 21, 4),
            MinecraftVersion::new(26, 3, 0),
        ] {
            assert!(touches(100.1, release), "{release}");
            assert!(!touches(100.12, release), "{release}");
        }
        assert!(touches(100.6, MinecraftVersion::new(1, 12, 2)));
        assert!(!touches(100.6, MinecraftVersion::new(1, 20, 4)));
    }

    #[test]
    fn a_lava_current_pushes_projectiles_from_1_16_at_the_dimensions_scale() {
        // 1.16.5 Entity.java:1067-1072, 26.3 :1702-1705: 0.0023333333333333335, 0.007 where lava
        // is fast. Lava is no water: the air's inertia stays. None before 1.16 (1.15 Entity.java
        // has no lava current).
        let lava = |flow: Vec3| BlockState {
            fluid: FluidState::Lava,
            fluid_source: true,
            fluid_flow: flow,
            ..BlockState::default()
        };
        let throw = |flow: Vec3, ultra_warm, release| {
            let mut world = loaded_world();
            for x in -1..=4 {
                for y in 99..=102 {
                    for z in -1..=1 {
                        world.set_block((x, y, z), lava(flow));
                    }
                }
            }
            let mut state = in_flight(Vec3::new(0.5, 100.0, 0.5), Vec3::new(0.5, 0.0, 0.0), release);
            state.air_drag = 1.0;
            state.ultra_warm = ultra_warm;
            let first = tick_projectile_in_world(&mut state, &world, release);
            (first.position.x, state.velocity.x, state.in_water)
        };
        let east = Vec3::new(1.0, 0.0, 0.0);
        for release in [
            MinecraftVersion::new(1, 21, 2),
            MinecraftVersion::new(1, 21, 11),
            MinecraftVersion::new(26, 3, 0),
        ] {
            // the push follows the move
            assert_eq!(throw(Vec3::ZERO, false, release), (1.0, 0.5, false), "{release}");
            assert_eq!(throw(east, false, release), (1.0, 0.5 + 0.0023333333333333335, false), "{release}");
            assert_eq!(throw(east, true, release), (1.0, 0.5 + 0.007, false), "{release}");
        }
        for release in [MinecraftVersion::new(1, 16, 5), MinecraftVersion::new(1, 21, 1)] {
            // the push opens the tick and moves it at once
            let push = 0.5 + 0.0023333333333333335;
            assert_eq!(throw(east, false, release), (0.5 + push, push, false), "{release}");
            assert_eq!(throw(Vec3::ZERO, true, release).0, 1.0, "{release}");
        }
        let release = MinecraftVersion::new(1, 15, 2);
        assert_eq!(throw(east, true, release).0, 1.0);
    }

    #[test]
    fn a_lava_current_moves_an_arrow_until_it_is_embedded_from_1_21_5() {
        let mut world = loaded_world();
        for x in -1..=4 {
            for y in 99..=102 {
                for z in -1..=1 {
                    world.set_block(
                        (x, y, z),
                        BlockState {
                            fluid: FluidState::Lava,
                            fluid_source: true,
                            fluid_flow: Vec3::new(1.0, 0.0, 0.0),
                            ..BlockState::default()
                        },
                    );
                }
            }
        }
        let release = MinecraftVersion::new(26, 3, 0);
        let mut arrow = ArrowState::new_in_release(Vec3::new(0.5, 100.0, 0.5), Vec3::ZERO, release);
        arrow.gravity = 0.0;
        let _ = tick_arrow_in_world(&mut arrow, &world, release);
        assert!(arrow.velocity.x > 0.0);
        // isPushedByFluid is !isInGround from 1.21.5 (1.21.5 AbstractArrow.java:319-321): a noPhysics
        // arrow reaches the flying branch's base tick still in the ground, and is pushed only before
        for (release, pushed) in [
            (MinecraftVersion::new(1, 21, 4), true),
            (MinecraftVersion::new(1, 21, 5), false),
        ] {
            let mut embedded =
                ArrowState::new_in_release(Vec3::new(0.5, 100.0, 0.5), Vec3::ZERO, release);
            embedded.in_ground = true;
            embedded.no_physics = true;
            let _ = tick_arrow_in_world(&mut embedded, &world, release);
            assert_eq!(embedded.velocity.x > 0.0, pushed, "{release}");
        }
    }

    #[test]
    fn a_current_pushes_by_0_014_and_the_water_only_drags() {
        // the same throw in still and flowing water: the drag is the same 0.8F, and the current's
        // normalized 0.014 is the whole difference (1.21.4 Entity.java:3336-3352, 26.3
        // EntityFluidInteraction.java:243-260, 26.3 Entity.java:1698-1701, 1.12.2 World.java:1635,
        // Entity.java:1051). From 1.21.2 the push follows the move and only the next tick
        // moves by it; until 1.21.1 it opens the tick and moves the projectile at once
        let throw = |flow: Vec3, release| {
            let mut world = loaded_world();
            flood(&mut world, -1..=4, flow);
            let mut state = in_flight(Vec3::new(0.5, 100.0, 0.5), Vec3::new(0.5, 0.0, 0.0), release);
            state.air_drag = 1.0;
            let first = tick_projectile_in_world(&mut state, &world, release);
            let second = tick_projectile_in_world(&mut state, &world, release);
            (first, second, state.in_water)
        };
        let drag = f64::from(0.8_f32);
        let east = Vec3::new(1.0, 0.0, 0.0);
        for release in BASE_TICK_AFTER_THE_MOVE {
            let (first, second, in_water) = throw(Vec3::ZERO, release);
            assert_eq!((first.position.x, first.velocity.x), (1.0, 0.5), "{release}");
            assert_eq!(second.velocity.x, 0.5 * drag, "{release}");
            assert_eq!(second.position.x, 1.0 + 0.5 * drag, "{release}");
            assert!(in_water, "{release}");

            let (first, second, in_water) = throw(east, release);
            assert_eq!((first.position.x, first.velocity.x), (1.0, 0.5 + 0.014), "{release}");
            assert_eq!(second.position.x, 1.0 + (0.5 + 0.014) * drag, "{release}");
            assert_eq!(second.velocity.x, (0.5 + 0.014) * drag + 0.014, "{release}");
            assert!(in_water, "{release}");
        }
        for release in BASE_TICK_FIRST {
            let (first, second, in_water) = throw(Vec3::ZERO, release);
            assert_eq!((first.position.x, first.velocity.x), (1.0, 0.5 * drag), "{release}");
            assert_eq!(second.position.x, 1.0 + 0.5 * drag, "{release}");
            assert!(in_water, "{release}");

            let (first, second, in_water) = throw(east, release);
            assert_eq!(first.position.x, 0.5 + (0.5 + 0.014), "{release}");
            assert_eq!(first.velocity.x, (0.5 + 0.014) * drag, "{release}");
            let pushed = (0.5 + 0.014) * drag + 0.014;
            assert_eq!(second.position.x, 0.5 + (0.5 + 0.014) + pushed, "{release}");
            assert_eq!(second.velocity.x, pushed * drag, "{release}");
            assert!(in_water, "{release}");
        }
    }

    #[test]
    fn hurting_projectiles_take_the_water_at_their_base_tick() {
        // after the move from 1.21.2 (26.3 AbstractHurtingProjectile.java:66-92, 1.21.2 :69-113),
        // before it until 1.21.1 (1.21.1 :66-108); 0.8F in water, 0.95F in the air
        let mut world = loaded_world();
        flood(&mut world, 2..=6, Vec3::ZERO);
        let (air, water) = (f64::from(0.95_f32), f64::from(0.8_f32));
        let shot = |release| {
            let mut state = ProjectileState::for_kind_in_release(
                ProjectileKind::SmallFireball,
                Vec3::new(0.5, 100.0, 0.5),
                Vec3::new(2.0, 0.0, 0.0),
                release,
            );
            state.acceleration_power = 0.0;
            state
        };
        let modern = MinecraftVersion::new(1, 21, 4);
        let mut state = shot(modern);
        assert_eq!(tick_projectile_in_world(&mut state, &world, modern).velocity.x, 2.0 * air);
        assert!(state.in_water);
        assert_eq!(tick_projectile_in_world(&mut state, &world, modern).velocity.x, 2.0 * air * water);
        let old = MinecraftVersion::new(1, 20, 4);
        let mut state = shot(old);
        assert_eq!(tick_projectile_in_world(&mut state, &world, old).velocity.x, 2.0 * air);
        assert!(!state.in_water);
        assert_eq!(tick_projectile_in_world(&mut state, &world, old).velocity.x, 2.0 * air * water);
        assert!(state.in_water);
    }

    #[test]
    fn an_arrow_and_a_trident_take_their_own_water_inertia_at_the_base_tick() {
        // the flag from the base tick after the move from 1.21.2 (26.3 AbstractArrow.java:251,
        // 1.21.3 PersistentProjectileEntity.java:244), before all of it until 1.21.1 (1.21
        // PersistentProjectileEntity.java:154); 0.6F, a trident's 0.99F
        let mut world = loaded_world();
        flood(&mut world, 1..=8, Vec3::ZERO);
        let air = f64::from(0.99_f32);
        let (from, by) = (Vec3::new(0.5, 100.5, 0.5), Vec3::new(1.0, 0.0, 0.0));
        for (release, entered_on_tick_one) in [
            (MinecraftVersion::new(1, 20, 4), false),
            (MinecraftVersion::new(1, 21, 1), false),
            (MinecraftVersion::new(1, 21, 2), true),
            (MinecraftVersion::new(1, 21, 4), true),
            (MinecraftVersion::new(26, 3, 0), true),
        ] {
            let mut arrow = ArrowState::new_in_release(from, by, release);
            arrow.gravity = 0.0;
            let mut trident = TridentState::new_in_release(from, by, release);
            trident.gravity = 0.0;
            let result = tick_arrow_in_world(&mut arrow, &world, release);
            let _ = tick_trident_in_world(&mut trident, &world, release);
            assert_eq!(result.velocity.x, air, "{release}");
            assert_eq!(arrow.in_water, entered_on_tick_one, "{release}");
            assert_eq!(trident.in_water, entered_on_tick_one, "{release}");
            let result = tick_arrow_in_world(&mut arrow, &world, release);
            assert_eq!(result.position.x, from.x + 1.0 + air, "{release}");
            assert_eq!(result.velocity.x, air * f64::from(0.6_f32), "{release}");
            assert!(arrow.in_water, "{release}");
            let result = tick_trident_in_world(&mut trident, &world, release);
            assert_eq!(result.velocity.x, air * f64::from(0.99_f32), "{release}");
            assert!(trident.in_water, "{release}");
        }
    }

    /// An arrow fired from the air at a wall behind water: the water is at x 1, the wall at x 2.
    fn walled_water(flow: Vec3) -> WorldSnapshot {
        let mut world = loaded_world();
        flood(&mut world, 1..=1, flow);
        world.set_block((2, 100, 0), solid(11));
        world
    }

    #[test]
    fn the_tick_that_embeds_an_arrow_still_runs_its_base_tick() {
        // super.tick() closes the flying branch whatever stepMoveAndHit did (26.3
        // AbstractArrow.java:225-251, 1.21.3 PersistentProjectileEntity.java:213-246), and until
        // 1.21.1 it opens every tick, in the ground too (1.21 :154, 1.20.4 PersistentProjectileEntity
        // tick), so an arrow that hits under water knows it
        let world = walled_water(Vec3::ZERO);
        let (from, by) = (Vec3::new(0.5, 100.5, 0.5), Vec3::new(2.0, 0.0, 0.0));
        for release in [
            MinecraftVersion::new(1, 21, 2),
            MinecraftVersion::new(1, 21, 4),
            MinecraftVersion::new(26, 3, 0),
        ] {
            let mut arrow = ArrowState::new_in_release(from, by, release);
            let result = tick_arrow_in_world(&mut arrow, &world, release);
            assert!(result.in_ground && arrow.in_water, "{release}");
            let mut trident = TridentState::new_in_release(from, by, release);
            let result = tick_trident_in_world(&mut trident, &world, release);
            assert!(result.in_ground && trident.in_water, "{release}");
        }
        let release = MinecraftVersion::new(1, 20, 4);
        let mut arrow = ArrowState::new_in_release(from, by, release);
        let result = tick_arrow_in_world(&mut arrow, &world, release);
        assert!(result.in_ground && !arrow.in_water);
        let result = tick_arrow_in_world(&mut arrow, &world, release);
        assert!(result.in_ground && arrow.in_water);
    }

    #[test]
    fn the_ground_branch_runs_no_base_tick_from_1_21_2() {
        // AbstractArrow.tick's in-ground branch has no super.tick() (26.3 AbstractArrow.java:192-212,
        // 1.21.3 PersistentProjectileEntity.java:191-204), on the tick it falls either: isInWater
        // stays what the last flying tick left. Until 1.21.1 it opens that tick too.
        let release = MinecraftVersion::new(1, 21, 4);
        let dry = wall((5, 100, 5));
        let mut arrow = ArrowState {
            in_ground: true,
            in_water: true,
            last_block_id: Some(11),
            ..ArrowState::new_in_release(Vec3::new(0.5, 100.5, 0.5), Vec3::ZERO, release)
        };
        let result = tick_arrow_in_world(&mut arrow, &dry, release);
        assert!(result.started_falling);
        assert!(arrow.in_water);
        let release = MinecraftVersion::new(1, 20, 4);
        let mut arrow = ArrowState {
            in_ground: true,
            in_water: true,
            last_block_id: Some(11),
            ..ArrowState::new_in_release(Vec3::new(0.5, 100.5, 0.5), Vec3::ZERO, release)
        };
        let result = tick_arrow_in_world(&mut arrow, &dry, release);
        assert!(result.started_falling);
        assert!(!arrow.in_water);
    }

    #[test]
    fn a_current_pushes_an_embedded_arrow_until_1_21_5() {
        // isPushedByFluid is !isInGround from 1.21.5 (1.21.5 AbstractArrow.java:319-321, 26.3 :344-346);
        // 1.21.4 AbstractArrow has no override of Entity's true (1.21.4 Entity.java:2898, 3305). So the
        // hit tick's closing base tick pushes the stopped arrow up to 1.21.4, and until 1.21.1 each
        // tick's opening one pushes it in the ground; its position stays
        let south = Vec3::new(0.0, 0.0, 1.0);
        let world = walled_water(south);
        let (from, by) = (Vec3::new(0.5, 100.5, 0.5), Vec3::new(2.0, 0.0, 0.0));

        let release = MinecraftVersion::new(1, 21, 5);
        let mut arrow = ArrowState::new_in_release(from, by, release);
        assert_eq!(tick_arrow_in_world(&mut arrow, &world, release).velocity, Vec3::ZERO);
        assert_eq!(tick_arrow_in_world(&mut arrow, &world, release).velocity, Vec3::ZERO);

        for release in [MinecraftVersion::new(1, 21, 2), MinecraftVersion::new(1, 21, 4)] {
            let mut arrow = ArrowState::new_in_release(from, by, release);
            let pushed = Vec3::new(0.0, 0.0, 0.014);
            let result = tick_arrow_in_world(&mut arrow, &world, release);
            assert!(result.in_ground, "{release}");
            assert_eq!(result.velocity, pushed, "{release}");
            assert_eq!(tick_arrow_in_world(&mut arrow, &world, release).velocity, pushed, "{release}");
        }

        let release = MinecraftVersion::new(1, 20, 4);
        let mut arrow = ArrowState::new_in_release(from, by, release);
        let _ = tick_arrow_in_world(&mut arrow, &world, release);
        let embedded = tick_arrow_in_world(&mut arrow, &world, release);
        assert!(embedded.in_ground);
        let later = tick_arrow_in_world(&mut arrow, &world, release);
        assert!(later.in_ground);
        assert_eq!(later.position, embedded.position);
        assert_eq!(later.velocity.z, embedded.velocity.z + 0.014);
    }

    #[test]
    fn the_other_families_open_with_the_base_tick_in_every_release() {
        // super.tick() is the first thing in FireworkRocketEntity.tick, FishingHook.tick, LlamaSpit.tick
        // and ShulkerBullet.tick, before and after 1.21.2 (1.21.3 FireworkRocketEntity.java:105,
        // FishingBobberEntity.java:147; 26.3 FireworkRocketEntity.java:108, FishingHook.java:146,
        // LlamaSpit.java:38, ShulkerBullet.java:185; 1.16.5 LlamaSpitEntity.java:48,
        // ShulkerBulletEntity.java:200, FireworkRocketEntity.java:132, FishingBobberEntity.java:150):
        // a current pushes them all, before the tick reads the motion
        let south = Vec3::new(0.0, 0.0, 1.0);
        let mut world = loaded_world();
        flood(&mut world, -1..=3, south);
        let at = Vec3::new(0.5, 100.0, 0.5);
        for release in [
            MinecraftVersion::new(1, 16, 5),
            MinecraftVersion::new(1, 21, 4),
            MinecraftVersion::new(26, 3, 0),
        ] {
            let mut bullet =
                ProjectileState::for_kind_in_release(ProjectileKind::ShulkerBullet, at, Vec3::ZERO, release);
            let result = tick_projectile_in_world(&mut bullet, &world, release);
            assert_eq!(result.position, at + Vec3::new(0.0, 0.0, 0.014), "{release}");
            assert!(bullet.in_water, "{release}");

            let mut rocket =
                ProjectileState::for_kind_in_release(ProjectileKind::Firework, at, Vec3::ZERO, release);
            rocket.shot_at_angle = true;
            let result = tick_projectile_in_world(&mut rocket, &world, release);
            assert_eq!(result.position, at + Vec3::new(0.0, 0.0, 0.014), "{release}");
            assert_eq!(result.velocity, Vec3::new(0.0, 0.0, 0.014), "{release}");

            // reaching water slows the pushed motion and starts it bobbing, without moving it
            let mut hook =
                ProjectileState::for_kind_in_release(ProjectileKind::FishingHook, at, Vec3::ZERO, release);
            let result = tick_projectile_in_world(&mut hook, &world, release);
            assert_eq!(result.position, at, "{release}");
            assert_eq!(result.velocity, Vec3::new(0.0, 0.0, 0.014 * 0.3), "{release}");
            assert!(result.bobbing, "{release}");
        }
    }

    #[test]
    fn llama_spit_meets_the_water_of_its_base_tick_in_a_batch() {
        // LlamaSpit.tick: super.tick(), then the removal in water (26.3 LlamaSpit.java:38-50). The
        // box half out of a source's 8/9 surface has air in it, so only isInWater removes it
        let mut world = loaded_world();
        for x in -1..=1 {
            for z in -1..=1 {
                world.set_block((x, 100, z), water_flowing(Vec3::ZERO));
            }
        }
        for release in [MinecraftVersion::new(1, 16, 5), MinecraftVersion::new(1, 21, 4), MinecraftVersion::new(26, 3, 0)] {
            let mut spit = ProjectileState::for_kind_in_release(
                ProjectileKind::LlamaSpit,
                Vec3::new(0.5, 100.8, 0.5),
                Vec3::new(0.1, 0.0, 0.0),
                release,
            );
            assert!(tick_projectile_in_world(&mut spit, &world, release).discarded, "{release}");
        }
    }

    #[test]
    fn a_shulker_bullet_touches_water_by_its_own_box() {
        // sized(0.3125F, 0.3125F) (1.21.5 EntityType.java:800): x 0.85 reaches 1.00625, into the
        // water at x 1 that a 0.25 box would miss
        let mut world = loaded_world();
        flood(&mut world, 1..=1, Vec3::ZERO);
        let release = MinecraftVersion::new(1, 21, 4);
        let at = Vec3::new(0.85, 100.0, 0.5);
        let mut bullet =
            ProjectileState::for_kind_in_release(ProjectileKind::ShulkerBullet, at, Vec3::ZERO, release);
        let _ = tick_projectile_in_world(&mut bullet, &world, release);
        assert!(bullet.in_water);
    }

    #[test]
    fn a_projectile_discards_itself_64_blocks_below_the_world() {
        // Entity.checkBelowWorld, as literal -64.0 until 1.16.5 and the level's getMinY - 64 from 1.17
        // (1.16.5 Entity.java:526, 1.17 :459-461, 26.3 :626-629). The moving first releases read the
        // position after the move (1.21.3 ThrownEntity.java:62, 26.3 ThrowableProjectile.java:56); a
        // bullet's base tick opens its tick (26.3 ShulkerBullet.java:185). The tick runs to its end.
        let mut world = WorldSnapshot::new();
        world.set_world_bounds(-64, 320, 0.0, 0.0, 1000.0);
        let down = Vec3::new(0.0, -1.0, 0.0);
        for (release, bottom, moved_first) in [
            (MinecraftVersion::new(1, 8, 8), -64.0, false),
            (MinecraftVersion::new(1, 16, 5), -64.0, false),
            (MinecraftVersion::new(1, 17, 0), -128.0, false),
            (MinecraftVersion::new(1, 21, 1), -128.0, false),
            (MinecraftVersion::new(1, 21, 2), -128.0, true),
            (MinecraftVersion::new(26, 3, 0), -128.0, true),
        ] {
            let snowball_from = |y: f64| {
                let mut state = ProjectileState::for_kind_in_release(
                    ProjectileKind::Snowball,
                    Vec3::new(0.5, y, 0.5),
                    down,
                    release,
                );
                state.gravity = 0.0;
                state.air_drag = 1.0;
                state.first_tick = false;
                tick_projectile_in_world(&mut state, &world, release)
            };
            // half a block above the line: the move crosses it
            let crossing = snowball_from(bottom + 0.5);
            assert_eq!(crossing.discarded, moved_first, "{release:?}");
            assert_eq!(crossing.position.y, bottom - 0.5, "{release:?}");
            // exactly on it: the comparison is strict
            assert!(!snowball_from(bottom + 1.0).discarded, "{release:?}");
            // under it the tick still moves it
            let under = snowball_from(bottom - 0.5);
            assert!(under.discarded, "{release:?}");
            assert_eq!(under.position.y, bottom - 1.5, "{release:?}");

            let mut flying = arrow(Vec3::new(0.5, bottom + 0.5, 0.5), down, release);
            let result = tick_arrow_in_world(&mut flying, &world, release);
            assert_eq!(result.discarded, moved_first, "{release:?}");
            let mut bullet = ProjectileState::for_kind_in_release(
                ProjectileKind::ShulkerBullet,
                Vec3::new(0.5, bottom - 0.5, 0.5),
                Vec3::ZERO,
                release,
            );
            assert!(tick_projectile_in_world(&mut bullet, &world, release).discarded, "{release:?}");
        }
    }

    #[test]
    fn a_level_with_its_own_bottom_moves_the_void_from_1_17() {
        // 1.17's level height decides; a default world keeps the bottom of 0
        let mut nether = WorldSnapshot::new();
        nether.set_world_bounds(0, 256, 0.0, 0.0, 1000.0);
        let mut deep = WorldSnapshot::new();
        deep.set_world_bounds(-2032, 2032, 0.0, 0.0, 1000.0);
        let modern = MinecraftVersion::new(1, 20, 4);
        assert!(super::below_world(-64.5, &nether, modern));
        assert!(!super::below_world(-64.5, &deep, modern));
        assert!(super::below_world(-2096.5, &deep, modern));
        assert!(super::below_world(-64.5, &WorldSnapshot::new(), modern));
        assert!(super::below_world(-64.5, &deep, MinecraftVersion::new(1, 16, 5)));
    }

    #[test]
    fn nothing_solid_stands_at_the_limits_of_the_world() {
        // the limits are no walls: only cells collide, a move across a limit finds nothing in its
        // empty cells, and a block in the last cell still stops it
        let mut world = WorldSnapshot::new();
        world.set_world_bounds(-64, 320, 0.0, 0.0, 1000.0);
        let release = MinecraftVersion::new(26, 3, 0);
        for (from, by) in [
            (Vec3::new(0.5, -63.5, 0.5), Vec3::new(0.0, -2.0, 0.0)),
            (Vec3::new(0.5, 319.5, 0.5), Vec3::new(0.0, 2.0, 0.0)),
        ] {
            let (to, hit) = thrown_through(&world, from, by, release);
            assert_eq!((to, hit), (from + by, false));
        }
        world.set_block(
            (0, -64, 0),
            BlockState { shape: Some(BlockShape::full_block()), ..BlockState::default() },
        );
        assert!(thrown_through(&world, Vec3::new(0.5, -62.5, 0.5), Vec3::new(0.0, -2.0, 0.0), release).1);
    }
}
