//! Minecarts. The rail movement is the server's: AbstractMinecart.tick moves a cart only where the
//! level is not a client's (1.8.9 AbstractMinecartEntity.java:291-306, 1.20.4 :240-250, 26.3
//! OldMinecartBehavior.java:50 and NewMinecartBehavior.java:50). A client interpolates to what the
//! server sends, and what it does is kept apart here, in `tick_client_linear` and
//! `tick_client_weighted`: neither reads a rail.
//!
//! Which server path a cart takes is the level's enabled features, not its release: 26.3
//! AbstractMinecart.java:67-71, 536-538. `MinecartRules::new` is given that selection explicitly.
//!
//! Evidence for the old path, by what breaks where (every side read):
//! * 1.8.9 - 1.9.4: the rider's forward input (LivingEntity), NoGravity not read, the 0.04F gravity.
//! * 1.10: NoGravity is read and the cart picks riders up in its own tick (1.10.2 :337, :376).
//! * 1.13: a rider's input counts for a player alone (1.13.2 :473).
//! * 1.14: the player's velocity replaces its input, and the double constants the float ones
//!   (1.14 :279, :358, :363, :416-420, :525).
//! * 1.15.2: a furnace cart's push turns along its motion (1.16 FurnaceMinecartEntity.java; no
//!   source of 1.15.1 or 1.15.2 here: mc_furnace_lit recorded on both places it).
//! * 1.16: a rail keeps the speed factor of the block under it out (1.16 :309).
//! * 1.17: water halves the speed, slows gravity and drags (1.17 :308, :383, :419, :571).
//! * 1.21.2: AbstractMinecart splits into the behaviours, the rider's move intent replaces its
//!   velocity, and the furnace cart's speed and push are worked anew (26.3 is the same code).
//!
//! What a tick does besides moving the cart is the server's too. What the world does not hold
//! comes in on the state, never as a guess: `random_seed` (Entity.random, whose draws decide a TNT
//! cart's fuse and blast), `inventory` (what a hopper cart holds) and, on the scene, the item
//! entities and containers it can take from. The server's results come out on `MinecartTick`. A
//! client runs none of it: `tick_client_effects` is what its tick of the same code does.

use crate::block_traversal::Movement;
use crate::entity::entity_push_impulses;
use crate::legacy_fluid;
use crate::math::{
    atan2_vanilla, clamp_f64_for, floor_i32_for, java_float, wrap_degrees_f32, Aabb, Vec3,
};
use crate::simulation::{
    apply_block_effects, apply_inside_block_effects, blocks_inside, blocks_inside_moves,
    fire_or_lava_block, landing_position, mth_cos, mth_sin, push_by_fluid, water_contact,
    SimulationState,
};
use crate::vehicle::{
    apply_effects_inside, lava_flow_scale, move_vehicle_among, MoveRules, VehicleMove,
};
use crate::version::MinecraftVersion;
use crate::world::{BlockEffect, FluidState, WorldSnapshot};

type BlockPosition = (i32, i32, i32);

/// `BlockState.tags`, as NativeWorldSync sets them: BlockTags.RAILS.
pub const TAG_RAIL: u32 = 1;
/// Blocks.POWERED_RAIL (`golden_rail` before 1.13).
pub const TAG_POWERED_RAIL: u32 = 1 << 1;
/// Blocks.ACTIVATOR_RAIL.
pub const TAG_ACTIVATOR_RAIL: u32 = 1 << 2;
/// BlockState.isRedstoneConductor (before 1.9 Block.isFullCube; isSolidBlock in Yarn).
pub const TAG_REDSTONE_CONDUCTOR: u32 = 1 << 3;

/// AbstractMinecart's dimensions: 0.98F by 0.7F (1.8.9 AbstractMinecartEntity.java:122, 26.3
/// EntityType.java).
const HALF_WIDTH: f32 = 0.98 / 2.0;
const HEIGHT: f32 = 0.7;
/// 1.0E-5F as a double (26.3 NewMinecartBehavior and Vec3.normalize).
const TINY: f64 = 9.999999747378752e-6;

/// AbstractMinecart's subclass: what decides its drag, speed and riders.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum MinecartVariant {
    #[default]
    Rideable,
    Chest,
    Hopper,
    Furnace,
    Tnt,
    Spawner,
    CommandBlock,
}

impl MinecartVariant {
    /// The entity's registry name in any release, or None for what is no minecart.
    #[must_use]
    pub fn from_entity_name(name: &str) -> Option<Self> {
        Some(match name {
            "minecart" => Self::Rideable,
            "chest_minecart" => Self::Chest,
            "hopper_minecart" => Self::Hopper,
            "furnace_minecart" => Self::Furnace,
            "tnt_minecart" => Self::Tnt,
            "spawner_minecart" => Self::Spawner,
            "command_block_minecart" | "commandblock_minecart" => Self::CommandBlock,
            _ => return None,
        })
    }

    fn holds_items(self) -> bool {
        matches!(self, Self::Chest | Self::Hopper)
    }
}

/// Which AbstractMinecart.behavior a level gives its carts: OldMinecartBehavior, or
/// NewMinecartBehavior under the minecart_improvements feature.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MinecartBehavior {
    Old,
    Improved,
}

/// What a level tells its carts: its release, the behaviour its enabled features select and, under
/// the improvements, GameRules.MAX_MINECART_SPEED in blocks a second.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MinecartRules {
    pub release: MinecraftVersion,
    pub behavior: MinecartBehavior,
    pub max_minecart_speed: i32,
    /// Level.getMinY: a cart 64 under it is gone. 0 before 1.18 (and in a dimension that starts there).
    pub min_y: i32,
    /// GameRules.TNT_EXPLODES, from 1.21.5 (1.21.5 MinecartTNT.java).
    pub tnt_explodes: bool,
    /// Whether a nether portal has somewhere to take a cart: Entity.getPortalRect finds one or finds
    /// nothing, as only a player's makes one (1.20.4 Entity.java getTeleportTarget). A level's own.
    pub nether_exit: bool,
}

impl MinecartRules {
    /// `improvements` is whether the level has minecart_improvements enabled. A release before
    /// 1.21.2 has no such feature; with it, the speed rule (1..1000, 26.3 GameRules.java:218) has
    /// to be given.
    pub fn new(
        release: MinecraftVersion,
        improvements: bool,
        max_minecart_speed: Option<i32>,
    ) -> Result<Self, String> {
        if improvements && !release.at_least(1, 21, 2) {
            return Err(format!("minecart: the improvements feature does not exist in {release}"));
        }
        let max_minecart_speed = match (improvements, max_minecart_speed) {
            (true, None) => {
                return Err("minecart: the improvements need the maxMinecartSpeed game rule".to_owned())
            }
            (true, Some(speed)) if !(1..=1000).contains(&speed) => {
                return Err(format!("minecart: maxMinecartSpeed {speed} is outside 1..1000"))
            }
            (true, Some(speed)) => speed,
            (false, _) => 8,
        };
        Ok(Self {
            release,
            behavior: if improvements { MinecartBehavior::Improved } else { MinecartBehavior::Old },
            max_minecart_speed,
            min_y: 0,
            tnt_explodes: true,
            nether_exit: true,
        })
    }

    /// The level's Level.getMinY and GameRules.TNT_EXPLODES.
    #[must_use]
    pub fn in_level(self, min_y: i32, tnt_explodes: bool) -> Self {
        Self { min_y, tnt_explodes, ..self }
    }
}

/// A stack in an inventory or an item entity: what ItemStack.isSameItemSameComponents and its
/// getMaxStackSize say, the item as a number the caller gives each kind of stack. Empty at 0.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct MinecartStack {
    pub item: u32,
    pub count: i32,
    pub max_stack: i32,
}

/// An ItemEntity near a hopper cart, in the level's order: a pickup leaves what is left of it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MinecartItem {
    pub bounds: Aabb,
    pub stack: MinecartStack,
}

/// A block's Container a hopper cart can take from, given with what it holds in the slots
/// getSlots(container, DOWN) lists, in order. Whose it is (a chest, a furnace, a double chest) and
/// what canTakeItemFromContainer refuses is the caller's: no client can see into it.
#[derive(Clone, Debug, PartialEq)]
pub struct MinecartContainer {
    pub position: BlockPosition,
    pub slots: Vec<MinecartStack>,
}

/// The portals that take a cart out of its level.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MinecartPortal {
    Nether,
    End,
}

/// Why a cart left its level.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MinecartRemoval {
    /// VehicleEntity.destroy: broken, and what it dropped is the server's.
    Destroyed,
    /// A creative player's hit: VehicleEntity.hurtServer's discard, without drops.
    Discarded,
    /// MinecartTNT.explode.
    Exploded,
    /// Entity.onBelowWorld.
    BelowWorld,
    /// It changed dimension: where it comes out is the server's.
    Portal(MinecartPortal),
}

/// What hurts a cart that it is not itself touching: what VehicleEntity.hurtServer and MinecartTNT
/// ask of the damage source.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MinecartDamage {
    Plain,
    /// DamageTypeTags.IS_FIRE.
    Fire,
    /// DamageTypeTags.IS_EXPLOSION.
    Explosion,
}

/// An attack on a cart from outside its tick (a player's hit, an arrow, an explosion).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MinecartHurt {
    pub kind: MinecartDamage,
    pub amount: f32,
    /// The attacker is a player in creative mode.
    pub creative: bool,
    /// The direct entity is a burning arrow, with its velocity's lengthSqr.
    pub burning_arrow: Option<f64>,
}

/// java.util.Random and LegacyRandomSource: Entity.random, by its raw 48 bits (26.3
/// BitRandomSource.java and LegacyRandomSource.java draw as java.util.Random does).
#[derive(Clone, Copy, Debug)]
struct EntityRandom(u64);

impl EntityRandom {
    fn next(&mut self, bits: u32) -> i32 {
        self.0 = self.0.wrapping_mul(25_214_903_917).wrapping_add(11) & ((1 << 48) - 1);
        (self.0 >> (48 - bits)) as i64 as i32
    }

    /// Only ever drawn with a bound that is no power of two.
    fn next_int(&mut self, bound: i32) -> i32 {
        loop {
            let sample = self.next(31);
            let modulo = sample % bound;
            if sample.wrapping_sub(modulo).wrapping_add(bound - 1) >= 0 {
                return modulo;
            }
        }
    }

    fn next_float(&mut self) -> f32 {
        self.next(24) as f32 * 5.960_464_5e-8_f32
    }

    fn next_double(&mut self) -> f64 {
        let upper = i64::from(self.next(26));
        let lower = i64::from(self.next(27));
        ((upper << 27) + lower) as f64 * 1.110_223_024_625_156_5e-16
    }
}

/// What a cart's first passenger gives its tick. Which field counts depends on the release: its
/// forward input and yaw (`forward`, `yaw`) before 1.14, its velocity to 1.21.1, its move intent
/// (ServerPlayer.getLastClientMoveIntent) from 1.21.2.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MinecartRider {
    pub player: bool,
    /// LivingEntity: before 1.13 any living rider's forward input counts.
    pub living: bool,
    pub forward: f32,
    pub yaw: f32,
    pub velocity: Vec3,
    pub move_intent: Vec3,
}

/// A cart between two ticks, as the server keeps it. The fields a tick cannot find in the world
/// are given: `flipped` (AbstractMinecart.flipped, never sent to a client), `in_water`
/// (Entity.isInWater, the end of the tick before), the furnace's `fuel` and `push`, the
/// `comparator_signal` of what a chest or hopper cart holds (AbstractContainerMenu's), and whether
/// it `has_loot_table` still to roll (1.9+), and what the side effects read: `random_seed` is the
/// raw state of Entity.random, `inventory` a hopper cart's five slots.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MinecartState {
    pub variant: MinecartVariant,
    pub position: Vec3,
    pub velocity: Vec3,
    pub y_rot: f32,
    pub x_rot: f32,
    pub flipped: bool,
    pub on_rails: bool,
    pub on_ground: bool,
    /// AbstractMinecart.firstTick: the improved path sets a new cart onto its rail.
    pub first_tick: bool,
    pub in_water: bool,
    pub collided_horizontally: bool,
    pub collided_vertically: bool,
    pub stuck_speed_multiplier: Vec3,
    pub no_gravity: bool,
    /// Its dimension's FAST_LAVA.
    pub ultra_warm: bool,
    pub fall_distance: f64,
    /// The box it keeps before 1.17; else its position's.
    pub bounding_box: Option<Aabb>,
    pub rider: Option<MinecartRider>,
    pub fuel: i32,
    pub push: Vec3,
    pub comparator_signal: i32,
    pub has_loot_table: bool,
    /// Entity.tickCount, which a command block cart's activation delay counts.
    pub tick_count: i32,
    /// VehicleEntity's synced hurt time, hurt direction and damage.
    pub hurt_time: i32,
    pub hurt_dir: i32,
    pub damage: f32,
    /// Entity.invulnerable.
    pub invulnerable: bool,
    /// MinecartTNT.fuse: -1 until it is primed.
    pub fuse: i32,
    pub explosion_power_base: f32,
    pub explosion_speed_factor: f32,
    /// Entity.random's raw 48 bits.
    pub random_seed: u64,
    /// MinecartHopper.enabled.
    pub enabled: bool,
    pub inventory: [MinecartStack; 5],
    /// MinecartCommandBlock.lastActivated.
    pub last_activated: i32,
    /// The portal it is in, whether it was this tick, its time there, its cooldown.
    pub portal: Option<MinecartPortal>,
    pub inside_portal: bool,
    pub portal_time: i32,
    pub portal_cooldown: i32,
    /// Why it has gone, once it has.
    pub removed: Option<MinecartRemoval>,
    /// A move past MAX_WALKED_CELLS did not run, and the bindings refuse the tick (`move_vehicle`).
    pub move_out_of_range: bool,
}

impl Default for MinecartState {
    fn default() -> Self {
        Self {
            variant: MinecartVariant::default(),
            position: Vec3::ZERO,
            velocity: Vec3::ZERO,
            y_rot: 0.0,
            x_rot: 0.0,
            flipped: false,
            on_rails: false,
            on_ground: false,
            first_tick: false,
            in_water: false,
            collided_horizontally: false,
            collided_vertically: false,
            stuck_speed_multiplier: Vec3::ZERO,
            no_gravity: false,
            ultra_warm: false,
            fall_distance: 0.0,
            bounding_box: None,
            rider: None,
            fuel: 0,
            push: Vec3::ZERO,
            comparator_signal: 0,
            has_loot_table: false,
            tick_count: 0,
            hurt_time: 0,
            hurt_dir: 1,
            damage: 0.0,
            invulnerable: false,
            fuse: -1,
            explosion_power_base: 4.0,
            explosion_speed_factor: 1.0,
            random_seed: 0,
            enabled: true,
            inventory: [MinecartStack::default(); 5],
            last_activated: 0,
            portal: None,
            inside_portal: false,
            portal_time: 0,
            portal_cooldown: 0,
            removed: None,
            move_out_of_range: false,
        }
    }
}

/// An entity near a cart that is not a cart the scene ticks: what the move collides with
/// (canBeCollidedWith or isPushable, 26.3 AbstractBoat.java:115-117), pushes and picks up.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MinecartOther {
    pub position: Vec3,
    pub bounds: Aabb,
    pub velocity: Vec3,
    pub pushable: bool,
    /// Entity.canBeCollidedWith: a boat or a shulker, solid to a cart though not pushed.
    pub solid: bool,
    pub player: bool,
    pub iron_golem: bool,
    /// LivingEntity: before 1.10 a cart picks up only those it is pushed by.
    pub living: bool,
    /// Entity.isPassenger.
    pub passenger: bool,
    pub has_passengers: bool,
    /// The tick the cart at this index picked it up.
    pub rides: Option<usize>,
    /// AbstractBoat: what its tick's end does to a cart is Boat.push (`boat_push_carts`).
    pub boat: bool,
    /// Where its own tick leaves it, when that is not where a cart ticking ahead of it finds it.
    pub tick_place: Option<(Vec3, Aabb)>,
    /// How many of the scene's carts the level ticks ahead of it (spawn order); `None` is all of them.
    pub ticks_after: Option<usize>,
    /// Player.rideTick has it leave its cart this tick, after the cart's tick and before its own turn.
    pub gets_off: bool,
}

impl Default for MinecartOther {
    fn default() -> Self {
        Self {
            position: Vec3::ZERO,
            bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
            velocity: Vec3::ZERO,
            pushable: false,
            solid: false,
            player: false,
            iron_golem: false,
            living: false,
            passenger: false,
            has_passengers: false,
            rides: None,
            boat: false,
            tick_place: None,
            ticks_after: None,
            gets_off: false,
        }
    }
}

/// NewMinecartBehavior.MinecartStep: where a client is to take a cart, of the weight of the way.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MinecartStep {
    pub position: Vec3,
    pub movement: Vec3,
    pub y_rot: f32,
    pub x_rot: f32,
    pub weight: f32,
}

/// What a tick of a cart leaves besides the cart.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MinecartTick {
    /// The activator rail it passed, with its powered state (AbstractMinecart.activateMinecart).
    pub activator: Option<bool>,
    /// The steps the improved path sends the clients (NewMinecartBehavior.lerpSteps).
    pub steps: Vec<MinecartStep>,
    /// The tick primed its fuse: the entity event a client hears (MinecartTNT.primeFuse).
    pub primed: bool,
    /// The blasts of Level.explode, its position and float power. What one does to the blocks and
    /// entities around it is the server's, and a client's comes in the explosion packet.
    pub explosions: Vec<MinecartExplosion>,
    /// The activator rail ran a command block cart's command (BaseCommandBlock.performCommand).
    pub command_ran: bool,
}

/// A Level.explode of a TNT cart.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MinecartExplosion {
    pub position: Vec3,
    pub power: f32,
}

/// RailShape, in its order (1.8.9 EnumRailDirection, 26.3 RailShape.java).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RailShape {
    NorthSouth,
    EastWest,
    AscendingEast,
    AscendingWest,
    AscendingNorth,
    AscendingSouth,
    SouthEast,
    SouthWest,
    NorthWest,
    NorthEast,
}

impl RailShape {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "north_south" => Self::NorthSouth,
            "east_west" => Self::EastWest,
            "ascending_east" => Self::AscendingEast,
            "ascending_west" => Self::AscendingWest,
            "ascending_north" => Self::AscendingNorth,
            "ascending_south" => Self::AscendingSouth,
            "south_east" => Self::SouthEast,
            "south_west" => Self::SouthWest,
            "north_west" => Self::NorthWest,
            "north_east" => Self::NorthEast,
            _ => return None,
        })
    }

    fn is_slope(self) -> bool {
        matches!(
            self,
            Self::AscendingEast | Self::AscendingWest | Self::AscendingNorth | Self::AscendingSouth
        )
    }

    /// AbstractMinecart.exits (26.3 AbstractMinecart.java:554-564; 1.8.9
    /// AbstractMinecartEntity.java:37-48 lists the same, in this order).
    fn exits(self) -> (BlockPosition, BlockPosition) {
        const WEST: BlockPosition = (-1, 0, 0);
        const EAST: BlockPosition = (1, 0, 0);
        const NORTH: BlockPosition = (0, 0, -1);
        const SOUTH: BlockPosition = (0, 0, 1);
        const fn below((x, y, z): BlockPosition) -> BlockPosition {
            (x, y - 1, z)
        }
        match self {
            Self::NorthSouth => (NORTH, SOUTH),
            Self::EastWest => (WEST, EAST),
            Self::AscendingEast => (below(WEST), EAST),
            Self::AscendingWest => (WEST, below(EAST)),
            Self::AscendingNorth => (NORTH, below(SOUTH)),
            Self::AscendingSouth => (below(NORTH), SOUTH),
            Self::SouthEast => (SOUTH, EAST),
            Self::SouthWest => (SOUTH, WEST),
            Self::NorthWest => (NORTH, WEST),
            Self::NorthEast => (NORTH, EAST),
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct Rail {
    shape: RailShape,
    powered_rail: bool,
    activator: bool,
    powered: bool,
}

/// BlockTags.RAILS.
pub(crate) fn is_rail(world: &WorldSnapshot, position: BlockPosition) -> bool {
    world.block(position).tags & TAG_RAIL != 0
}

/// BaseRailBlock.isRail and the properties of its state.
fn rail_at(world: &WorldSnapshot, position: BlockPosition) -> Option<Rail> {
    let tags = world.block(position).tags;
    if tags & TAG_RAIL == 0 {
        return None;
    }
    let properties = world.block_properties(position);
    let value = |name: &str| properties.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str());
    Some(Rail {
        shape: value("shape").and_then(RailShape::parse)?,
        powered_rail: tags & TAG_POWERED_RAIL != 0,
        activator: tags & TAG_ACTIVATOR_RAIL != 0,
        powered: value("powered") == Some("true"),
    })
}

fn conductor(world: &WorldSnapshot, position: BlockPosition) -> bool {
    world.block(position).tags & TAG_REDSTONE_CONDUCTOR != 0
}

fn offset((x, y, z): BlockPosition, (dx, dy, dz): BlockPosition) -> BlockPosition {
    (x + dx, y + dy, z + dz)
}

fn box_at(position: Vec3) -> Aabb {
    let half = f64::from(HALF_WIDTH);
    Aabb::new(
        Vec3::new(position.x - half, position.y, position.z - half),
        Vec3::new(position.x + half, position.y + f64::from(HEIGHT), position.z + half),
    )
}

fn bounds_of(cart: &MinecartState) -> Aabb {
    cart.bounding_box.unwrap_or_else(|| box_at(cart.position))
}

/// Vec3.normalize as the improved path's release has it.
fn normalized(vector: Vec3) -> Vec3 {
    let length = vector.length();
    if length < TINY {
        Vec3::ZERO
    } else {
        Vec3::new(vector.x / length, vector.y / length, vector.z / length)
    }
}

/// Vec3.atBottomCenterOf.
fn bottom_center((x, y, z): BlockPosition) -> Vec3 {
    Vec3::new(f64::from(x) + 0.5, f64::from(y), f64::from(z) + 0.5)
}

fn half_exit((x, y, z): BlockPosition) -> Vec3 {
    Vec3::new(f64::from(x) * 0.5, f64::from(y) * 0.5, f64::from(z) * 0.5)
}

/// Mth.rotLerp of floats.
fn rot_lerp(alpha: f32, from: f32, to: f32) -> f32 {
    from + alpha * wrap_degrees_f32(to - from)
}

/// One tick of a level's carts, in its tick order: each ticks as the ones before it left it, so a
/// cart pushed by another starts its tick from that push.
pub fn tick_minecarts(
    carts: &mut [MinecartState],
    others: &mut [MinecartOther],
    world: &WorldSnapshot,
    rules: MinecartRules,
) -> Vec<MinecartTick> {
    tick_minecarts_among(carts, others, &mut [], &mut [], world, rules)
}

/// `tick_minecarts` with what a hopper cart can take from.
pub fn tick_minecarts_among(
    carts: &mut [MinecartState],
    others: &mut [MinecartOther],
    items: &mut [MinecartItem],
    containers: &mut [MinecartContainer],
    world: &WorldSnapshot,
    rules: MinecartRules,
) -> Vec<MinecartTick> {
    // Before 1.9 a player ticks in the handling of its move packet, ahead of the level (1.8.9
    // ServerPlayNetworkHandler.java:228-293); from 1.9 in the connection's tick, after it (1.9.4 :165).
    let players_first = !rules.release.at_least(1, 9, 0);
    if players_first {
        players_push_carts(carts, others, rules.release);
    }
    let ticks = (0..carts.len())
        .map(|current| {
            others_tick(carts, others, rules.release, |ahead| ahead == Some(current));
            if carts[current].removed.is_some() {
                return MinecartTick::default();
            }
            let mut scene = Scene {
                world,
                rules,
                carts: &mut *carts,
                others: &mut *others,
                items: &mut *items,
                containers: &mut *containers,
                current,
                support: None,
                recorded: Vec::new(),
                old_position: Vec3::ZERO,
                old_y_rot: 0.0,
                consumed_item: false,
                tick: MinecartTick::default(),
            };
            scene.tick();
            scene.tick
        })
        .collect();
    let last = carts.len();
    others_tick(carts, others, rules.release, |ahead| ahead.is_none_or(|carts_ahead| carts_ahead >= last));
    if !players_first {
        players_push_carts(carts, others, rules.release);
    }
    ticks
}

/// The turn in the level's order of what is neither a cart nor a player, for those `turn` says it is: the end of each
/// one's tick, from where the tick leaves it.
fn others_tick(carts: &mut [MinecartState], others: &mut [MinecartOther], release: MinecraftVersion, turn: impl Fn(Option<usize>) -> bool) {
    for other in others.iter_mut().filter(|other| !other.player && turn(other.ticks_after)) {
        if let Some((position, bounds)) = other.tick_place.take() {
            other.position = position;
            other.bounds = bounds;
        }
        if other.boat {
            boat_push_carts(carts, other, release);
        } else if other.living {
            living_push_cart(carts, other, release);
        }
    }
}

/// The players' turn (`tick_minecarts_among`). A player's server tick travels by its velocity and pushes from there, and
/// the connection then snaps it back to where its packets put it (26.3 ServerGamePacketListenerImpl.java:327-328, 1.20.4
/// ServerPlayNetworkHandler.java:253-254): `tick_place` is that place.
fn players_push_carts(carts: &mut [MinecartState], others: &mut [MinecartOther], release: MinecraftVersion) {
    for other in others.iter_mut().filter(|other| other.living && other.player) {
        if other.gets_off {
            // (before 1.9 the player's turn is ahead of the level, and what throws it off is the cart's tick to come: an
            // activator rail, 1.8.9 MinecartEntity.java:33-37. It rides through the tick, and pushes on its next turn.)
            if !release.at_least(1, 9, 0) {
                continue;
            }
            // (the rider that got off pushes the cart it just left, from where it landed)
            if let Some(cart) = other.rides.take().and_then(|index| carts.get_mut(index)) {
                cart.rider = None;
            }
            other.passenger = false;
            other.gets_off = false;
        }
        if let Some((position, bounds)) = other.tick_place.take() {
            other.position = position;
            other.bounds = bounds;
        }
        living_push_cart(carts, other, release);
    }
}

/// The end of Boat.tick from 1.9 (1.9.4 BoatEntity.java:277-293, 1.13.2 :322-338, 1.20.4 :333-348, 26.3 AbstractBoat.java:259-268):
/// `this.push(cart)` with the boat as `this`, so Boat.push's gate (1.9.4 :185-193, 26.3 :168-176) and then Entity.push, not the
/// cart's AbstractMinecart.push: a whole 0.05F along the longer axis. A ridden boat does it too, wherever the client has put it.
/// Up to 1.8 the loop pushes boats alone (1.8.9 BoatEntity.java:356).
fn boat_push_carts(carts: &mut [MinecartState], boat: &mut MinecartOther, release: MinecraftVersion) {
    if !release.at_least(1, 9, 0) {
        return;
    }
    let reach = boat.bounds.inflate(Vec3::new(f64::from(0.2_f32), f64::from(-0.01_f32), f64::from(0.2_f32)));
    for (index, cart) in carts.iter_mut().enumerate() {
        let bounds = bounds_of(cart);
        if cart.removed.is_some() || boat.rides == Some(index) || !bounds.intersects(reach) || bounds.min.y > boat.bounds.min.y {
            continue;
        }
        let (to_boat, to_cart) = entity_push_impulses(boat.position, cart.position, false, false, false, boat.has_passengers, cart.rider.is_some(), boat.pushable, true, release);
        boat.velocity = boat.velocity + to_boat;
        cart.velocity = cart.velocity + to_cart;
    }
}

/// LivingEntity.pushEntities of a living thing that meets a cart, which the cart takes in AbstractMinecart.push. Before 1.9
/// its box reaches 0.2F further (1.8.9 LivingEntity.java:1484, 1.9.4 :1766), and before 1.10 the push is also where a
/// rideable cart going fast picks a mob up (1.8.9 AbstractMinecartEntity.java:672-682).
fn living_push_cart(carts: &mut [MinecartState], other: &mut MinecartOther, release: MinecraftVersion) {
    let reach = if release.at_least(1, 9, 0) { 0.0 } else { f64::from(0.2_f32) };
    let hitbox = other.bounds.inflate(Vec3::new(reach, 0.0, reach));
    for (index, cart) in carts.iter_mut().enumerate() {
        if cart.removed.is_some() || other.rides == Some(index) || !bounds_of(cart).intersects(hitbox) {
            continue;
        }
        if !release.at_least(1, 10, 0)
            && cart.variant == MinecartVariant::Rideable
            && !other.player
            && !other.iron_golem
            && cart.velocity.horizontal_length_squared() > 0.01
            && cart.rider.is_none()
            && !other.passenger
        {
            other.rides = Some(index);
            other.passenger = true;
            cart.rider = Some(MinecartRider { living: true, ..MinecartRider::default() });
        }
        push_minecart(cart, other, release);
    }
}

/// VehicleEntity.hurtServer of what comes from outside a cart's tick: the same hurt its tick's own
/// fire and lava take, with what it leaves.
pub fn hurt_minecart(cart: &mut MinecartState, others: &mut [MinecartOther], hurt: MinecartHurt, world: &WorldSnapshot, rules: MinecartRules) -> MinecartTick {
    let mut scene = Scene {
        world,
        rules,
        carts: std::slice::from_mut(cart),
        others,
        items: &mut [],
        containers: &mut [],
        current: 0,
        support: None,
        recorded: Vec::new(),
        old_position: Vec3::ZERO,
        old_y_rot: 0.0,
        consumed_item: false,
        tick: MinecartTick::default(),
    };
    scene.attack(hurt);
    scene.tick
}

/// One server tick of a cart alone.
pub fn tick_minecart(state: &mut MinecartState, world: &WorldSnapshot, rules: MinecartRules) -> MinecartTick {
    tick_minecarts(std::slice::from_mut(state), &mut [], world, rules)
        .pop()
        .unwrap_or_default()
}

/// AbstractMinecart.push(Entity): what a cart takes from an entity that pushes it (a mob's or
/// player's LivingEntity.pushEntities; another cart goes through `tick_minecarts`). Gives what it
/// pushes back on `other`.
pub fn push_minecart(cart: &mut MinecartState, other: &mut MinecartOther, release: MinecraftVersion) {
    let Some((xa, za)) = minecart_push_impulse(cart.position, other.position, release) else {
        return;
    };
    cart.velocity = cart.velocity.add_components(-xa, 0.0, -za);
    other.velocity = other.velocity.add_components(xa / 4.0, 0.0, za / 4.0);
}

/// AbstractMinecart.push(Entity) up to its use of the push: nothing nearer than 1.0E-4F, the
/// float square root before 1.17 (1.8.9 AbstractMinecartEntity.java:689, 1.16.5 :708, 1.17 :698),
/// 0.1F and the half, and from 1.21.2 the same (26.3 AbstractMinecart.java:439-456).
fn minecart_push_impulse(this: Vec3, entity: Vec3, release: MinecraftVersion) -> Option<(f64, f64)> {
    let mut xa = entity.x - this.x;
    let mut za = entity.z - this.z;
    let mut distance = xa * xa + za * za;
    if distance < f64::from(1.0e-4_f32) {
        return None;
    }
    distance = if release.at_least(1, 17, 0) { distance.sqrt() } else { java_float(distance.sqrt()) };
    xa /= distance;
    za /= distance;
    let pow = (1.0 / distance).min(1.0);
    xa *= pow;
    za *= pow;
    let tenth = f64::from(0.1_f32);
    xa *= tenth;
    za *= tenth;
    // (the release's 1.0F - pushSpeedReduction, nothing for a cart, goes here before 1.17)
    Some((xa * 0.5, za * 0.5))
}

struct Scene<'a> {
    world: &'a WorldSnapshot,
    rules: MinecartRules,
    carts: &'a mut [MinecartState],
    others: &'a mut [MinecartOther],
    items: &'a mut [MinecartItem],
    containers: &'a mut [MinecartContainer],
    current: usize,
    /// The block the last move stands on (Entity.mainSupportingBlockPos).
    support: Option<BlockPosition>,
    /// Entity.movementThisTick.
    recorded: Vec<Movement>,
    /// Entity.xo, yo, zo and yRotO: where the tick began, and each track step from 1.21.2.
    old_position: Vec3,
    old_y_rot: f32,
    /// MinecartHopper.consumedItemThisFrame.
    consumed_item: bool,
    tick: MinecartTick,
}

impl Scene<'_> {
    fn cart(&mut self) -> &mut MinecartState {
        &mut self.carts[self.current]
    }

    fn me(&self) -> &MinecartState {
        &self.carts[self.current]
    }

    fn release(&self) -> MinecraftVersion {
        self.rules.release
    }

    fn improved(&self) -> bool {
        self.rules.behavior == MinecartBehavior::Improved
    }

    fn at_least(&self, major: u16, minor: u16, patch: u16) -> bool {
        self.release().at_least(major, minor, patch)
    }

    /// Entity.setPos: the box follows.
    fn set_pos(&mut self, position: Vec3) {
        let keeps_box = !self.at_least(1, 17, 0);
        let cart = self.cart();
        cart.position = position;
        cart.bounding_box = keeps_box.then(|| box_at(position));
    }

    /// AbstractMinecart.tick and what each variant does around it (26.3 AbstractMinecart.java:219-241).
    fn tick(&mut self) {
        // Level.tickNonPassenger counts the tick off before it runs (1.8.9 World.java, 26.3 Level)
        let cart = self.cart();
        cart.tick_count += 1;
        if cart.hurt_time > 0 {
            cart.hurt_time -= 1;
        }
        if cart.damage > 0.0 {
            cart.damage -= 1.0;
        }
        self.check_below_world();
        self.handle_portal();
        self.old_position = self.me().position;
        self.old_y_rot = self.me().y_rot;
        if !self.at_least(1, 17, 0) && self.me().bounding_box.is_none() {
            let bounds = bounds_of(self.me());
            self.cart().bounding_box = Some(bounds);
        }
        match self.rules.behavior {
            MinecartBehavior::Old => self.tick_old(),
            MinecartBehavior::Improved => self.tick_improved(),
        }
        if self.update_fluids() && self.at_least(1, 16, 2) {
            // from 1.16.2, by the jars (AbstractMinecart.tick: isInLava, lavaHurt; 1.16.1 has none); 1.17
            // AbstractMinecartEntity.java:94-97, 26.3 :234-238
            self.lava_hurt();
            let halved = self.halved_fall();
            self.cart().fall_distance = halved;
        }
        self.cart().first_tick = false;
        // MinecartFurnace.tick, after super.tick (1.8.9 FurnaceMinecartEntity.java tick; 26.3 :46-58)
        let cart = self.cart();
        if cart.variant == MinecartVariant::Furnace {
            if cart.fuel > 0 {
                cart.fuel -= 1;
            }
            if cart.fuel <= 0 {
                cart.push = Vec3::ZERO;
            }
        }
        match self.me().variant {
            MinecartVariant::Tnt => self.tick_tnt(),
            MinecartVariant::Hopper => self.try_consume_items(),
            _ => {}
        }
    }

    /// `fallDistance *= 0.5`, in the field's type (a double from 1.21.5).
    fn halved_fall(&self) -> f64 {
        let fall = self.me().fall_distance;
        if self.at_least(1, 21, 5) {
            fall * 0.5
        } else {
            f64::from(fall as f32 * 0.5)
        }
    }

    /// Entity.checkBelowWorld: under -64 before 1.17 (1.8.9, 1.16 AbstractMinecartEntity.java tick),
    /// then 64 under the level's bottom (1.17 Entity.attemptTickInVoid, 26.3 Entity.java:626-631).
    fn check_below_world(&mut self) {
        let floor = f64::from(self.rules.min_y) - 64.0;
        if self.me().position.y < floor {
            self.remove(MinecartRemoval::BelowWorld);
        }
    }

    fn remove(&mut self, why: MinecartRemoval) {
        if self.me().removed.is_none() {
            self.cart().removed = Some(why);
        }
        self.eject();
    }

    /// What a powered activator rail, or the cart's end, does to its riders.
    fn eject(&mut self) {
        self.cart().rider = None;
        let current = self.current;
        for other in self.others.iter_mut().filter(|other| other.rides == Some(current)) {
            other.rides = None;
            other.passenger = false;
        }
    }

    /// Entity.getPortalWaitTime of what is no player: 1 from 1.9, 0 again by 1.16.4 (1.8.9, 1.9.4 and
    /// 1.16 Entity.java getMaxNetherPortalTime; 1.16.4 getPortalWaitTime). 1.16.1 records as 1.
    fn portal_wait(&self) -> i32 {
        i32::from(self.at_least(1, 9, 0) && !self.at_least(1, 16, 2))
    }

    /// Entity.handlePortal (26.3 Entity.java:2725-2745, PortalProcessor) from 1.21; before it the
    /// counter of Entity.tickPortal (1.20.4 Entity.java) or of the cart's own tick (1.8.9): a cart
    /// goes once it has been in one past its wait.
    fn handle_portal(&mut self) {
        let wait = self.portal_wait();
        let processed = self.at_least(1, 21, 0);
        let cart = self.cart();
        if processed {
            if cart.portal_cooldown > 0 {
                cart.portal_cooldown -= 1;
            }
            let Some(portal) = cart.portal else {
                return;
            };
            if cart.inside_portal {
                cart.inside_portal = false;
                cart.portal_time += 1;
                self.go_through(portal);
            } else {
                cart.portal_time = (cart.portal_time - 4).max(0);
                if cart.portal_time <= 0 {
                    cart.portal = None;
                }
            }
            return;
        }
        if cart.inside_portal {
            // (what stays out is decided on the way in: this asks only that it rides nothing, and a cart does not)
            cart.inside_portal = false;
            let time = cart.portal_time;
            cart.portal_time += 1;
            if time >= wait {
                cart.portal_time = wait;
                let portal = cart.portal.unwrap_or(MinecartPortal::Nether);
                self.go_through(portal);
            }
        } else {
            cart.portal_time = (cart.portal_time - 4).max(0);
        }
        let cart = self.cart();
        if cart.portal_cooldown > 0 {
            cart.portal_cooldown -= 1;
        }
    }

    /// Entity.changeDimension: it goes, unless the far side has nothing for it, and then only the
    /// cooldown is left of the attempt.
    fn go_through(&mut self, portal: MinecartPortal) {
        self.cart().portal_cooldown = 300;
        if portal == MinecartPortal::End || self.rules.nether_exit {
            self.remove(MinecartRemoval::Portal(portal));
        }
    }

    /// NetherPortalBlock.entityInside and, from 1.21, EndPortalBlock's: Entity.setAsInsidePortal
    /// (26.3 Entity.java:2702-2717; 1.20.4 setInNetherPortal). A cart stays out while it carries
    /// anyone until 1.21 (1.8.9 and 1.20.4 canUsePortals; 26.3 Entity.java canUsePortal(false)
    /// asks only that it rides nothing).
    fn enter_portal(&mut self, portal: MinecartPortal) {
        let processed = self.at_least(1, 21, 0);
        if !processed && self.me().rider.is_some() {
            return;
        }
        let cart = self.cart();
        if cart.portal_cooldown > 0 {
            cart.portal_cooldown = 300;
            return;
        }
        if processed && cart.portal != Some(portal) {
            cart.portal_time = 0;
        }
        cart.portal = Some(portal);
        cart.inside_portal = true;
    }

    /// What the blocks a pass of Entity.checkInsideBlocks holds do to a cart besides its motion:
    /// CactusBlock.entityInside, and from 1.16 BaseFireBlock's (26.3 :116-120); a cell each, for
    /// each pass. Before 1.16 fire burns through Entity.move (`burn`). An end portal takes a cart at
    /// once before 1.21 (1.8.9 and 1.20.4 EndPortalBlock.java).
    fn contact_hurts(&mut self, inside: &[((i32, i32, i32), bool)]) {
        for &(position, _) in inside {
            if self.me().removed.is_some() {
                return;
            }
            match self.world.effect_at(position) {
                BlockEffect::Cactus => self.hurt(MinecartDamage::Plain, 1.0),
                BlockEffect::Fire if self.at_least(1, 16, 0) => self.hurt(MinecartDamage::Fire, 1.0),
                BlockEffect::SoulFire if self.at_least(1, 16, 0) => self.hurt(MinecartDamage::Fire, 2.0),
                BlockEffect::NetherPortal => self.enter_portal(MinecartPortal::Nether),
                BlockEffect::EndPortal if !self.in_end_portal(position) => {}
                BlockEffect::EndPortal if self.at_least(1, 21, 0) => self.enter_portal(MinecartPortal::End),
                BlockEffect::EndPortal if self.me().rider.is_none() => {
                    self.remove(MinecartRemoval::Portal(MinecartPortal::End));
                }
                _ => {}
            }
        }
    }

    /// The block's shape has to meet the box: up to 12/16 of its height from 1.9 (1.9.4
    /// EndPortalBlock.java), and from 6/16 too from 1.17 (1.16.5 and 1.17 EndPortalBlock.java, 26.3
    /// SHAPE). Before 1.9 its cell is enough.
    fn in_end_portal(&self, (x, y, z): BlockPosition) -> bool {
        if !self.at_least(1, 9, 0) {
            return true;
        }
        let at = Vec3::new(f64::from(x), f64::from(y), f64::from(z));
        let bottom = if self.at_least(1, 17, 0) { 6.0 / 16.0 } else { 0.0 };
        let shape = Aabb::new(at + Vec3::new(0.0, bottom, 0.0), at + Vec3::new(1.0, 12.0 / 16.0, 1.0));
        bounds_of(self.me()).intersects(shape)
    }

    /// Entity.move's fire test before 1.16: fire or lava anywhere in the box shrunk by 0.001 burns
    /// it for 1 (1.8.9 Entity.java:710-711, 1.15 :631-639; 1.16 has it no more, only the ticks).
    fn burn_in_move(&mut self) {
        if self.at_least(1, 16, 0) {
            return;
        }
        let bounds = bounds_of(self.me()).deflate(Vec3::new(0.001, 0.001, 0.001));
        let end = |value: f64| {
            if self.at_least(1, 13, 0) {
                value.ceil() as i32
            } else {
                floor_i32_for(self.release(), value + 1.0)
            }
        };
        let (min, max) = (bounds.min, bounds.max);
        let burns = (floor_i32_for(self.release(), min.x)..end(max.x)).any(|x| {
            (floor_i32_for(self.release(), min.y)..end(max.y))
                .any(|y| (floor_i32_for(self.release(), min.z)..end(max.z)).any(|z| fire_or_lava_block(self.world, (x, y, z))))
        });
        if burns {
            self.hurt(MinecartDamage::Fire, 1.0);
        }
    }

    /// Entity.lavaHurt with the draw of its sound, on a hurt that took (26.3 Entity.java:662-671;
    /// 1.20.4 Entity.java setOnFireFromLava).
    fn lava_hurt(&mut self) {
        let takes = self.me().removed.is_some() || !self.me().invulnerable;
        self.hurt(MinecartDamage::Fire, 4.0);
        if takes {
            let cart = self.cart();
            let mut random = EntityRandom(cart.random_seed);
            random.next_float();
            cart.random_seed = random.0;
        }
    }

    /// VehicleEntity.hurtServer (AbstractMinecartEntity.damage before 1.20.3) of the tick's own fire.
    fn hurt(&mut self, kind: MinecartDamage, amount: f32) {
        self.attack(MinecartHurt { kind, amount, creative: false, burning_arrow: None });
    }

    fn attack(&mut self, hurt: MinecartHurt) {
        // MinecartTNT.hurtServer: a burning arrow sets it off first, whatever comes of the hurt
        if self.me().variant == MinecartVariant::Tnt {
            if let Some(speed_sqr) = hurt.burning_arrow {
                self.explode(speed_sqr);
            }
        }
        let release = self.release();
        let cart = self.cart();
        if cart.removed.is_some() || cart.invulnerable {
            return;
        }
        cart.hurt_dir = -cart.hurt_dir;
        cart.hurt_time = 10;
        cart.damage += hurt.amount * 10.0;
        // shouldSourceDestroy, from 1.20.3 (1.20.4 VehicleEntity.java; 1.20.2 has neither)
        let always = release.at_least(1, 20, 3)
            && cart.variant == MinecartVariant::Tnt
            && (hurt.kind != MinecartDamage::Plain || hurt.burning_arrow.is_some());
        let beaten = cart.damage > 40.0;
        if release.at_least(1, 20, 3) {
            if always || (beaten && !hurt.creative) {
                self.destroy(hurt);
            } else if hurt.creative {
                self.remove(MinecartRemoval::Discarded);
            }
            return;
        }
        if hurt.creative {
            self.remove(MinecartRemoval::Discarded);
        } else if beaten {
            self.eject();
            self.destroy(hurt);
        }
    }

    /// VehicleEntity.destroy with MinecartTNT's: the fire or the speed that sets it off, its blast
    /// at once before 1.12 (1.8.9 TntMinecartEntity.java dropItems, 1.11.2 :89-99), from there a
    /// fuse of its random's two draws (1.12.2 :89-101, 26.3 MinecartTNT.java destroy).
    fn destroy(&mut self, hurt: MinecartHurt) {
        if self.me().variant != MinecartVariant::Tnt {
            self.remove(MinecartRemoval::Destroyed);
            return;
        }
        let speed_sqr = self.me().velocity.horizontal_length_squared();
        let ignites = hurt.kind != MinecartDamage::Plain || hurt.burning_arrow.is_some();
        let fast = speed_sqr >= f64::from(0.01_f32);
        if !self.at_least(1, 12, 0) {
            if ignites || fast {
                self.explode(speed_sqr);
            }
            self.remove(MinecartRemoval::Destroyed);
            return;
        }
        if !ignites && !fast {
            self.remove(MinecartRemoval::Destroyed);
        } else if self.me().fuse < 0 {
            self.prime_fuse();
            let mut random = EntityRandom(self.me().random_seed);
            let fuse = random.next_int(20) + random.next_int(20);
            let cart = self.cart();
            cart.random_seed = random.0;
            cart.fuse = fuse;
        }
    }

    /// MinecartTNT.primeFuse: 80, and an event for the clients; from 1.21.5 not under the game rule.
    fn prime_fuse(&mut self) {
        if self.at_least(1, 21, 5) && !self.rules.tnt_explodes {
            return;
        }
        self.cart().fuse = 80;
        self.tick.primed = true;
    }

    /// MinecartTNT.tick, after super.tick (1.8.9 TntMinecartEntity.java tick, 26.3 :49-66): the
    /// fuse runs out, or a wall meets it fast.
    fn tick_tnt(&mut self) {
        let cart = self.cart();
        let speed_sqr = cart.velocity.horizontal_length_squared();
        if cart.fuse > 0 {
            cart.fuse -= 1;
        } else if cart.fuse == 0 {
            self.explode(speed_sqr);
        }
        if self.me().collided_horizontally {
            let speed_sqr = self.me().velocity.horizontal_length_squared();
            if speed_sqr >= f64::from(0.01_f32) {
                self.explode(speed_sqr);
            }
        }
    }

    /// MinecartTNT.explode: a power of 4 and up to 1.5 for each block of speed under 5, by the
    /// cart's random (26.3 :119-131; 1.8.9 TntMinecartEntity.java explode). From 1.21.5 the game
    /// rule keeps it, and a primed cart goes without it.
    fn explode(&mut self, speed_sqr: f64) {
        if self.at_least(1, 21, 5) && !self.rules.tnt_explodes {
            if self.me().fuse > -1 {
                self.remove(MinecartRemoval::Discarded);
            }
            return;
        }
        let speed = speed_sqr.sqrt().min(5.0);
        let mut random = EntityRandom(self.me().random_seed);
        let roll = random.next_double();
        let cart = self.cart();
        cart.random_seed = random.0;
        let power = f64::from(cart.explosion_power_base) + f64::from(cart.explosion_speed_factor) * roll * 1.5 * speed;
        let position = cart.position;
        self.tick.explosions.push(MinecartExplosion { position, power: power as f32 });
        self.remove(MinecartRemoval::Exploded);
    }

    /// MinecartHopper.tryConsumeItems (1.21.2+) and what its tick did before it (1.8.9
    /// HopperMinecartEntity.java tick; whose cooldown 1.8.9 - 1.19.4 zeroes each tick, as the
    /// position it compares with is never set).
    fn try_consume_items(&mut self) {
        let cart = self.me();
        if cart.variant != MinecartVariant::Hopper || cart.removed.is_some() || !cart.enabled || self.consumed_item {
            return;
        }
        if self.suck_in_items() {
            self.consumed_item = true;
        }
    }

    /// MinecartHopper.suckInItems: HopperBlockEntity.suckInItems, then what lies around the cart.
    fn suck_in_items(&mut self) -> bool {
        if self.suck_from_above() {
            return true;
        }
        let around = bounds_of(self.me()).inflate(Vec3::new(0.25, 0.0, 0.25));
        // only the first until 1.20, which then says it took nothing (1.19.4 and 1.20
        // HopperMinecartEntity.java canOperate)
        let first_alone = !self.at_least(1, 20, 0);
        for index in 0..self.items.len() {
            if self.items[index].stack.count > 0 && self.items[index].bounds.intersects(around) {
                let taken = self.take_item(index);
                if first_alone {
                    return false;
                }
                if taken {
                    return true;
                }
            }
        }
        false
    }

    /// HopperBlockEntity.suckInItems: the container above its top (a block's cell), or the items
    /// over it. The hopper's place is the cart's and half a block up (26.3 MinecartHopper.java).
    fn suck_from_above(&mut self) -> bool {
        let position = self.me().position;
        let top = position.y + 0.5;
        let above = (floor_i32_for(self.release(), position.x), floor_i32_for(self.release(), top + 1.0), floor_i32_for(self.release(), position.z));
        if let Some(container) = self.containers.iter().position(|container| container.position == above) {
            return self.take_from_container(container);
        }
        for area in self.suck_areas(position) {
            for index in 0..self.items.len() {
                if self.items[index].stack.count > 0
                    && self.items[index].bounds.intersects(area)
                    && self.take_item(index)
                {
                    return true;
                }
            }
        }
        false
    }

    /// The boxes it draws items from: a block's worth over it (1.8.9 HopperBlockEntity.java:444), a
    /// block and a half (1.9.4 :434), Hopper's inside and above shapes (1.13 - 1.20.4
    /// Hopper.java), 11/16 to 32/16 of its block as one box from 1.20.5 (26.3 getSuckAabb).
    fn suck_areas(&self, position: Vec3) -> Vec<Aabb> {
        let (x, y, z) = (position.x, position.y, position.z);
        let cuboid = |x0: f64, y0: f64, z0: f64, x1: f64, y1: f64, z1: f64| {
            Aabb::new(
                Vec3::new(x - 0.5 + x0 / 16.0, y + y0 / 16.0, z - 0.5 + z0 / 16.0),
                Vec3::new(x - 0.5 + x1 / 16.0, y + y1 / 16.0, z - 0.5 + z1 / 16.0),
            )
        };
        if self.at_least(1, 20, 5) {
            vec![cuboid(0.0, 11.0, 0.0, 16.0, 32.0, 16.0)]
        } else if self.at_least(1, 13, 0) {
            vec![cuboid(2.0, 11.0, 2.0, 14.0, 16.0, 14.0), cuboid(0.0, 16.0, 0.0, 16.0, 32.0, 16.0)]
        } else if self.at_least(1, 9, 0) {
            vec![cuboid(0.0, 8.0, 0.0, 16.0, 32.0, 16.0)]
        } else {
            vec![cuboid(0.0, 16.0, 0.0, 16.0, 32.0, 16.0)]
        }
    }

    /// HopperBlockEntity.addItem(container, entity): true only when all of it went in.
    fn take_item(&mut self, index: usize) -> bool {
        let mut stack = self.items[index].stack;
        self.add_to_inventory(&mut stack);
        self.items[index].stack = stack;
        stack.count == 0
    }

    /// tryTakeInItemFromSlot, slot by slot: one item, where there is room for it.
    fn take_from_container(&mut self, container: usize) -> bool {
        for slot in 0..self.containers[container].slots.len() {
            let source = self.containers[container].slots[slot];
            if source.count <= 0 {
                continue;
            }
            let mut one = MinecartStack { count: 1, ..source };
            self.add_to_inventory(&mut one);
            if one.count == 0 {
                self.containers[container].slots[slot].count -= 1;
                return true;
            }
        }
        false
    }

    /// HopperBlockEntity.addItem(from, to, stack, side), slot by slot, and the comparator's signal
    /// its drag reads.
    fn add_to_inventory(&mut self, stack: &mut MinecartStack) {
        let cart = self.cart();
        for slot in &mut cart.inventory {
            if stack.count <= 0 {
                break;
            }
            if slot.count <= 0 {
                *slot = *stack;
                stack.count = 0;
            } else if slot.count <= slot.max_stack && slot.item == stack.item {
                let moved = stack.count.min(stack.max_stack - slot.count);
                stack.count -= moved;
                slot.count += moved;
            }
        }
        cart.comparator_signal = comparator_signal(&cart.inventory);
    }

    /// Entity.updateFluidInteraction (updateWaterState): the water's current and whether the cart
    /// is in it, then from 1.16 the lava's current; the same as a boat's but for the box. Water ends
    /// a fall (1.8.9 Entity.java:845, 26.3 updateInWaterStateAndDoWaterCurrentPushing). Whether it
    /// is in lava.
    fn update_fluids(&mut self) -> bool {
        let release = self.release();
        let bounds = bounds_of(self.me());
        let world = self.world;
        let ultra_warm = self.me().ultra_warm;
        let cart = self.cart();
        let mut body = SimulationState {
            velocity: cart.velocity,
            bounding_box: Some(bounds),
            ..SimulationState::default()
        };
        if legacy_fluid::applies(release) {
            legacy_fluid::handle_water_movement(&mut body, world, true, release);
            cart.in_water = body.in_water;
            if cart.in_water {
                cart.fall_distance = 0.0;
            }
        } else {
            let water = water_contact(world, bounds, release);
            cart.in_water = water.touching;
            if water.touching {
                push_by_fluid(&mut body, water, 0.014, release);
                cart.fall_distance = 0.0;
            }
        }
        let mut in_lava = false;
        if release.at_least(1, 16, 0) {
            let lava = world.fluid_contact(FluidState::Lava, bounds, release);
            in_lava = lava.touching;
            push_by_fluid(&mut body, lava, lava_flow_scale(ultra_warm), release);
        }
        cart.velocity = body.velocity;
        in_lava
    }

    /// Entity.applyGravity: 0.04F as read until 1.14, the double after, 0.005 in water from 1.17.
    /// NoGravity is read from 1.10.
    fn apply_gravity(&mut self) {
        let release = self.release();
        let cart = self.cart();
        if cart.no_gravity && release.at_least(1, 10, 0) {
            return;
        }
        cart.velocity.y -= if release.at_least(1, 17, 0) && cart.in_water {
            0.005
        } else if release.at_least(1, 14, 0) {
            0.04
        } else {
            f64::from(0.04_f32)
        };
    }

    /// getCurrentBlockPosOrRailBelow (26.3 AbstractMinecart.java:243-257): its block, or the rail
    /// under it. The improved path reaches down by the height it rides above a rail.
    fn rail_position(&self) -> BlockPosition {
        let position = self.me().position;
        let release = self.release();
        let x = floor_i32_for(release, position.x);
        let mut y = floor_i32_for(release, position.y);
        let z = floor_i32_for(release, position.z);
        if self.improved() {
            let below = position.y - 0.1 - TINY;
            if is_rail(self.world, (x, floor_i32_for(release, below), z)) {
                y = floor_i32_for(release, below);
            }
        } else if is_rail(self.world, (x, y - 1, z)) {
            y -= 1;
        }
        (x, y, z)
    }

    /// getMaxSpeed: 0.4 and a furnace's 0.2 until 1.17; from there 8 and 4 blocks a second, 4 and
    /// 3 in water (1.17 AbstractMinecartEntity.java:383, FurnaceMinecartEntity); from 1.21.2 the
    /// behaviour's speed, of which a furnace cart gets half, in water three quarters (26.3
    /// MinecartFurnace.java:61-63, OldMinecartBehavior.java:388-390,
    /// NewMinecartBehavior.java:460-462).
    fn max_speed(&self) -> f64 {
        let cart = self.me();
        let furnace = cart.variant == MinecartVariant::Furnace;
        if self.at_least(1, 21, 2) {
            let base = if self.improved() {
                f64::from(self.rules.max_minecart_speed) * if cart.in_water { 0.5 } else { 1.0 } / 20.0
            } else if cart.in_water {
                0.2
            } else {
                0.4
            };
            return match (furnace, cart.in_water) {
                (true, true) => base * 0.75,
                (true, false) => base * 0.5,
                (false, _) => base,
            };
        }
        if self.at_least(1, 17, 0) {
            let blocks = match (furnace, cart.in_water) {
                (true, true) => 3.0,
                (true, false) => 4.0,
                (false, true) => 4.0,
                (false, false) => 8.0,
            };
            return blocks / 20.0;
        }
        if furnace {
            0.2
        } else {
            0.4
        }
    }

    /// AbstractMinecart.applyNaturalSlowdown with the variants' overrides.
    fn natural_slowdown(&mut self, movement: Vec3) -> Vec3 {
        let variant = self.me().variant;
        if variant.holds_items() {
            return self.container_slowdown(movement);
        }
        let movement = if variant == MinecartVariant::Furnace {
            self.furnace_slowdown(movement)
        } else {
            movement
        };
        self.base_slowdown(movement)
    }

    fn base_slowdown(&self, movement: Vec3) -> Vec3 {
        let cart = self.me();
        let vehicle = cart.rider.is_some();
        let factor = if self.improved() {
            if vehicle {
                0.997
            } else {
                0.975
            }
        } else if self.at_least(1, 14, 0) {
            if vehicle {
                0.997
            } else {
                0.96
            }
        } else if vehicle {
            f64::from(0.997_f32)
        } else {
            f64::from(0.96_f32)
        };
        let slowed = Vec3::new(movement.x * factor, movement.y * 0.0, movement.z * factor);
        if self.at_least(1, 17, 0) && cart.in_water {
            slowed.scale(0.949999988079071)
        } else {
            slowed
        }
    }

    /// AbstractMinecartContainer.applyNaturalSlowdown (1.8.9 StorageMinecartEntity.java:167-173;
    /// 1.20.4 :101-113; 26.3 :65-77): nothing of the fullness while a loot table is still to be
    /// rolled, and water from 1.17.
    fn container_slowdown(&self, movement: Vec3) -> Vec3 {
        let cart = self.me();
        let mut keep = 0.98_f32;
        if !cart.has_loot_table {
            keep += 15_i32.wrapping_sub(cart.comparator_signal) as f32 * 0.001_f32;
        }
        if self.at_least(1, 17, 0) && cart.in_water {
            keep *= 0.95_f32;
        }
        let keep = f64::from(keep);
        Vec3::new(movement.x * keep, movement.y * 0.0, movement.z * keep)
    }

    /// MinecartFurnace.applyNaturalSlowdown, before its super's.
    fn furnace_slowdown(&mut self, movement: Vec3) -> Vec3 {
        let in_water = self.me().in_water;
        let release = self.release();
        let cart = self.cart();
        let push = cart.push;
        if release.at_least(1, 21, 2) {
            // 26.3 MinecartFurnace.java:72-87
            if push.length_squared() <= 1.0e-7 {
                return Vec3::new(movement.x * 0.98, 0.0, movement.z * 0.98);
            }
            // calculateNewPushAlong
            cart.push = if push.horizontal_length_squared() > 1.0e-4
                && movement.horizontal_length_squared() > 0.001
            {
                normalized(push.projected_on(movement)).scale(push.length())
            } else {
                push
            };
            let pushed = Vec3::new(movement.x * 0.8, movement.y * 0.0, movement.z * 0.8) + cart.push;
            return if in_water { pushed.scale(0.1) } else { pushed };
        }
        // 1.8.9 - 1.13.2: 1.0E-4 and floats; 1.14: 1.0E-7 and doubles; 1.17: the double square
        // root and water (1.8.9 FurnaceMinecartEntity.java applySlowdown, 1.14 :method_7525, 1.17)
        let modern = release.at_least(1, 14, 0);
        let threshold = if modern { 1.0e-7 } else { 1.0e-4 };
        let squared = push.x * push.x + push.z * push.z;
        let (keep, coast) = if modern {
            (0.8, 0.98)
        } else {
            (f64::from(0.8_f32), f64::from(0.98_f32))
        };
        if squared <= threshold {
            return Vec3::new(movement.x * coast, movement.y * 0.0, movement.z * coast);
        }
        let length = if release.at_least(1, 17, 0) {
            squared.sqrt()
        } else {
            java_float(squared.sqrt())
        };
        cart.push.x /= length;
        cart.push.z /= length;
        let pushed = Vec3::new(
            movement.x * keep + cart.push.x,
            movement.y * 0.0,
            movement.z * keep + cart.push.z,
        );
        if release.at_least(1, 17, 0) && in_water {
            pushed.scale(0.1)
        } else {
            pushed
        }
    }

    /// MinecartFurnace.moveAlongTrack (1.8.9 - 1.21.1), after its super's: the push drops against
    /// the motion until 1.15.2, and follows it after; gone from 1.21.2.
    fn furnace_after_track(&mut self) {
        if self.me().variant != MinecartVariant::Furnace || self.at_least(1, 21, 2) {
            return;
        }
        let release = self.release();
        let max = self.max_speed();
        let cart = self.cart();
        let velocity = cart.velocity;
        let squared = velocity.x * velocity.x + velocity.z * velocity.z;
        let push_squared = cart.push.x * cart.push.x + cart.push.z * cart.push.z;
        if push_squared <= 1.0e-4 || squared <= 0.001 {
            return;
        }
        let float_root = |value: f64| {
            if release.at_least(1, 17, 0) {
                value.sqrt()
            } else {
                java_float(value.sqrt())
            }
        };
        if release.at_least(1, 15, 2) {
            let speed = float_root(squared);
            let push = float_root(push_squared);
            cart.push.x = velocity.x / speed * push;
            cart.push.z = velocity.z / speed * push;
            return;
        }
        let length = float_root(push_squared);
        cart.push.x /= length;
        cart.push.z /= length;
        if cart.push.x * velocity.x + cart.push.z * velocity.z < 0.0 {
            cart.push.x = 0.0;
            cart.push.z = 0.0;
        } else {
            let scale = length / max;
            cart.push.x *= scale;
            cart.push.z *= scale;
        }
    }

    fn body(&self) -> SimulationState {
        let cart = self.me();
        SimulationState {
            position: cart.position,
            velocity: cart.velocity,
            half_width: f64::from(HALF_WIDTH),
            height: f64::from(HEIGHT),
            on_ground: cart.on_ground,
            collided_horizontally: cart.collided_horizontally,
            collided_vertically: cart.collided_vertically,
            controlled_by_local_instance: true,
            bounding_box: (!self.at_least(1, 17, 0)).then(|| bounds_of(cart)),
            stuck_speed_multiplier: cart.stuck_speed_multiplier,
            sweet_berry_bush_immune: true,
            fall_distance: cart.fall_distance,
            ..SimulationState::default()
        }
    }

    fn take(&mut self, body: &SimulationState) {
        let cart = self.cart();
        cart.position = body.position;
        cart.velocity = body.velocity;
        cart.on_ground = body.on_ground;
        cart.collided_horizontally = body.collided_horizontally;
        cart.collided_vertically = body.collided_vertically;
        cart.stuck_speed_multiplier = body.stuck_speed_multiplier;
        cart.move_out_of_range |= body.move_out_of_range;
        cart.bounding_box = body.bounding_box;
        // (what a web or a honey side does to a fall)
        cart.fall_distance = body.fall_distance;
    }

    /// The boxes a move of this cart collides with (Entity.collide's getEntityCollisions under
    /// AbstractMinecart.canCollideWith: 1.8.9 AbstractMinecartEntity.java:165-168, 26.3 :118).
    fn entity_boxes(&self, movement: Vec3) -> Vec<Aabb> {
        let swept = bounds_of(self.me()).expand_towards(movement);
        let carts = self.carts.iter().enumerate()
            .filter(|(index, cart)| *index != self.current && cart.removed.is_none())
            .map(|(_, cart)| bounds_of(cart));
        // (before 1.9 the rider is no exception: World.getCollisionBoxes compares it with the list, 1.8.9 World.java:1097)
        let riders_collide = !self.at_least(1, 9, 0);
        let others = self.others.iter()
            .filter(|other| (other.pushable || other.solid) && (riders_collide || other.rides != Some(self.current)))
            .map(|other| other.bounds);
        carts.chain(others).filter(|bounds| bounds.intersects(swept)).collect()
    }

    /// Entity.move of a cart: from 1.21.2 AbstractMinecart.move, which the improved path follows
    /// with pushAndPickupEntities and what is left of a move a rider it picks up stopped, and the
    /// old path with the blocks at where it ends (26.3 AbstractMinecart.java:330-347).
    fn move_cart(&mut self, delta: Vec3) -> VehicleMove {
        if !self.improved() {
            let outcome = self.super_move(delta);
            if self.at_least(1, 21, 2) {
                self.apply_effects_here();
                self.recorded.clear();
            }
            return outcome;
        }
        let to_position = self.me().position + delta;
        let outcome = self.super_move(delta);
        if self.push_and_pickup_improved() {
            let rest = to_position - self.me().position;
            return self.super_move(rest);
        }
        outcome
    }

    fn super_move(&mut self, delta: Vec3) -> VehicleMove {
        let world = self.world;
        let release = self.release();
        let mut body = self.body();
        let from = body.position;
        let entities = self.entity_boxes(delta);
        // The improved cart's collision context: nothing below its rail, nor ahead up a slope
        // (26.3 MinecartCollisionContext.java:20-45)
        let ignored = if self.improved() { self.ignored_blocks() } else { [None, None] };
        // (what a landing's bounce works out from 26.2: AbstractMinecart.getDefaultGravity, getAirDrag)
        let rules = MoveRules {
            rails_keep_speed: release.at_least(1, 16, 0),
            ignored,
            gravity: if self.me().in_water { 0.005 } else { 0.04 },
            air_drag: self.air_drag(),
            ..MoveRules::MINECART
        };
        let rules = MoveRules::with_gravity_of(rules, self.me().no_gravity);
        // (a web or a honey side stops the fall the move's end counts, 1.20.4 Entity.java move, whatever was in it)
        let stopped = std::cell::Cell::new(false);
        let outcome = move_vehicle_among(
            &mut body,
            world,
            release,
            delta,
            rules,
            &entities,
            |body, support| {
                let fall = std::mem::replace(&mut body.fall_distance, 1.0);
                apply_effects_inside(body, world, support, release);
                stopped.set(body.fall_distance == 0.0);
                body.fall_distance = fall;
            },
        );
        self.support = outcome.support;
        let fall = self.me().fall_distance;
        if release.at_least(1, 21, 5) {
            let moved_length = outcome.moved.length_squared();
            if moved_length > 1.0e-7 || outcome.requested.length_squared() - moved_length < 1.0e-7 {
                self.recorded.push(Movement {
                    from,
                    to: from + outcome.moved,
                    axis_order: Some(if release.at_least(1, 21, 9) { outcome.requested } else { outcome.moved }),
                });
            }
        }
        self.take(&body);
        self.fall_after_move(outcome.moved.y, world, fall);
        if stopped.get() {
            self.cart().fall_distance = 0.0;
        }
        if !release.at_least(1, 21, 2) {
            // the move's own checkInsideBlocks and, before 1.16, its fire test
            let body = self.body();
            let inside: Vec<_> = blocks_inside(&body, release).into_iter().map(|position| (position, true)).collect();
            self.contact_hurts(&inside);
            self.burn_in_move();
        }
        outcome
    }

    /// Entity.checkFallDamage (Entity.fall before 1.21.2): down it counts, and landing ends it with
    /// the block's fallOn. The field is a double from 1.21.5, whose water counts nothing; the
    /// float's sum is of floats from 1.19 (1.18 and 1.19 Entity.java fall; 1.21.5
    /// Entity.java:1284-1303).
    fn fall_after_move(&mut self, moved_y: f64, world: &WorldSnapshot, fall: f64) {
        let release = self.release();
        let body = self.body();
        let on_ground = body.on_ground;
        let landed_on = world.effect_at(landing_position(world, &body, self.support, release));
        let mut fall = fall;
        if release.at_least(1, 21, 5) && !self.me().in_water && moved_y < 0.0 {
            fall -= f64::from(moved_y as f32);
        }
        if on_ground {
            if fall > 0.0 {
                self.land(fall, landed_on);
            }
            fall = 0.0;
        } else if !release.at_least(1, 21, 5) && moved_y < 0.0 {
            // (d2f, fsub in the 1.18.2 jar: accumulated_fall_distance)
            fall = if release.at_least(1, 18, 2) {
                f64::from(fall as f32 - moved_y as f32)
            } else {
                f64::from((fall - moved_y) as f32)
            };
        }
        self.cart().fall_distance = fall;
    }

    /// Block.fallOn as far as it gives a cart a fall: a bed's is half from 1.12 (1.12.2
    /// BedBlock.java, 26.3 BedBlock.java fallOn), a dripstone's point longer (26.3
    /// PointedDripstoneBlock.java:52-60), and powder snow gives none (26.3 PowderSnowBlock.java:81-87).
    /// Only MinecartTNT.causeFallDamage takes it up (26.3 :133-140, 1.8.9 :107-114).
    fn land(&mut self, fall: f64, on: BlockEffect) {
        let fall = match on {
            BlockEffect::Bed if self.at_least(1, 12, 0) => fall * 0.5,
            BlockEffect::PointedDripstoneTip => fall + 2.5,
            BlockEffect::PowderSnow => return,
            _ => fall,
        };
        if self.me().variant != MinecartVariant::Tnt || fall < 3.0 {
            return;
        }
        let power = if self.at_least(1, 21, 5) {
            let power = fall / 10.0;
            power * power
        } else {
            let power = fall as f32 / 10.0;
            f64::from(power * power)
        };
        self.explode(power);
    }

    fn ignored_blocks(&self) -> [Option<BlockPosition>; 2] {
        let position = self.rail_position();
        let Some(rail) = rail_at(self.world, position) else {
            return [None, None];
        };
        let slope = match rail.shape {
            RailShape::AscendingEast => Some(offset(position, (1, 0, 0))),
            RailShape::AscendingWest => Some(offset(position, (-1, 0, 0))),
            RailShape::AscendingNorth => Some(offset(position, (0, 0, -1))),
            RailShape::AscendingSouth => Some(offset(position, (0, 0, 1))),
            _ => None,
        };
        [Some(offset(position, (0, -1, 0))), slope]
    }

    /// Entity.applyEffectsFromBlocks(position, position): the old path from 1.21.2.
    fn apply_effects_here(&mut self) {
        let position = self.me().position;
        self.apply_effects(&[Movement { from: position, to: position, axis_order: None }]);
    }

    fn apply_effects(&mut self, movements: &[Movement]) {
        let world = self.world;
        let release = self.release();
        let mut body = self.body();
        let (inside, effects) = blocks_inside_moves(&body, world, movements, release);
        apply_block_effects(&mut body, world, self.support, release, &inside);
        self.take(&body);
        self.contact_hurts(&inside);
        // LavaFluid.entityInside, a cell at a time (1.21.5 LavaFluid.java:116-120)
        for _ in 0..effects.lava_hurts {
            if self.me().removed.is_none() {
                self.lava_hurt();
            }
        }
    }

    /// Entity.checkBlockCollision at the end of the tick, before 1.21.2 (after the move's own).
    fn check_block_collision(&mut self) {
        let world = self.world;
        let release = self.release();
        let mut body = self.body();
        let inside: Vec<_> = blocks_inside(&body, release)
            .into_iter()
            .map(|position| (position, true))
            .collect();
        apply_inside_block_effects(&mut body, world, release, &inside);
        self.take(&body);
        self.contact_hurts(&inside);
    }

    // The old path: AbstractMinecart.tick to 1.21.1, OldMinecartBehavior.tick from 1.21.2.

    fn tick_old(&mut self) {
        self.apply_gravity();
        let position = self.rail_position();
        let rail = rail_at(self.world, position);
        self.cart().on_rails = rail.is_some();
        if let Some(rail) = rail {
            self.move_along_track_old(position, rail);
            self.furnace_after_track();
            if rail.activator {
                self.activate(rail.powered);
            }
        } else {
            self.come_off_track();
        }
        if self.at_least(1, 21, 2) {
            self.apply_effects_here();
            self.recorded.clear();
        } else {
            self.check_block_collision();
        }
        self.rotate_old();
        self.push_and_pickup_old();
    }

    /// AbstractMinecart.activateMinecart: a rideable cart throws its rider off a powered rail and
    /// takes a hurt of 50 that breaks nothing (1.8.9 MinecartEntity.java, 26.3 Minecart.java:41-55),
    /// a TNT cart primes (26.3 MinecartTNT.java), a hopper cart stops (26.3 MinecartHopper.java:44-50)
    /// and a command block cart runs its command, 4 ticks apart (26.3 MinecartCommandBlock.java).
    fn activate(&mut self, powered: bool) {
        self.tick.activator = Some(powered);
        match self.me().variant {
            MinecartVariant::Rideable if powered => {
                self.eject();
                let cart = self.cart();
                if cart.hurt_time == 0 {
                    cart.hurt_dir = -cart.hurt_dir;
                    cart.hurt_time = 10;
                    cart.damage = 50.0;
                }
            }
            MinecartVariant::Tnt if powered && self.me().fuse < 0 => self.prime_fuse(),
            MinecartVariant::Hopper => self.cart().enabled = !powered,
            MinecartVariant::CommandBlock if powered => {
                let cart = self.cart();
                if cart.tick_count - cart.last_activated >= 4 {
                    cart.last_activated = cart.tick_count;
                    self.tick.command_ran = true;
                }
            }
            _ => {}
        }
    }

    /// The tick's yaw: along the way it moved, turned over by `flipped`, and flipped when it turns
    /// about (26.3 OldMinecartBehavior.java:67-84; 1.8.9 AbstractMinecartEntity.java:335-350).
    fn rotate_old(&mut self) {
        let old_y_rot = self.old_y_rot;
        let old = self.old_position;
        let cart = self.cart();
        cart.x_rot = 0.0;
        let dx = old.x - cart.position.x;
        let dz = old.z - cart.position.z;
        if dx * dx + dz * dz > 0.001 {
            cart.y_rot = (atan2_vanilla(dz, dx) * 180.0 / std::f64::consts::PI) as f32;
            if cart.flipped {
                cart.y_rot += 180.0;
            }
        }
        let turned = f64::from(wrap_degrees_f32(cart.y_rot - old_y_rot));
        if turned < -170.0 || turned >= 170.0 {
            cart.y_rot += 180.0;
            cart.flipped = !cart.flipped;
        }
        cart.x_rot %= 360.0;
        cart.y_rot %= 360.0;
    }

    /// AbstractMinecart.comeOffTrack (moveOffRail).
    fn come_off_track(&mut self) {
        let max = self.max_speed();
        let release = self.release();
        let cart = self.cart();
        cart.velocity.x = clamp_f64_for(release, cart.velocity.x, -max, max);
        cart.velocity.z = clamp_f64_for(release, cart.velocity.z, -max, max);
        if cart.on_ground {
            cart.velocity = cart.velocity.scale(0.5);
        }
        let movement = cart.velocity;
        self.move_cart(movement);
        let air_drag = self.air_drag();
        let cart = self.cart();
        if !cart.on_ground {
            cart.velocity = cart.velocity.scale(air_drag);
        }
    }

    /// The air's 0.95: a float before 1.14, a double to 26.1 (1.21.11 AbstractMinecart.java:373),
    /// the float getAirDrag from 26.2 (26.3 AbstractMinecart.java:317, 322).
    fn air_drag(&self) -> f64 {
        if !self.at_least(1, 14, 0) || self.at_least(26, 2, 0) {
            f64::from(0.95_f32)
        } else {
            0.95
        }
    }

    /// The rider's way of starting a resting cart, which a halting rail then does not stop.
    fn rider_start_old(&mut self, halting: &mut bool) {
        let release = self.release();
        let cart = self.cart();
        let Some(rider) = cart.rider else {
            return;
        };
        let own = cart.velocity.horizontal_length_squared();
        if release.at_least(1, 21, 2) {
            // 26.3 OldMinecartBehavior.java:153-169
            let intent = rider.move_intent;
            if rider.player && intent.length_squared() > 0.0 && normalized(intent).length_squared() > 0.0 && own < 0.01 {
                cart.velocity = cart.velocity.add_components(intent.x * 0.001, 0.0, intent.z * 0.001);
                *halting = false;
            }
        } else if release.at_least(1, 14, 0) {
            // 1.14 AbstractMinecartEntity.java:415-420, 1.21 :413-417
            let own_rider = rider.velocity;
            if rider.player && own_rider.horizontal_length_squared() > 1.0e-4 && own < 0.01 {
                cart.velocity = cart.velocity.add_components(own_rider.x * 0.1, 0.0, own_rider.z * 0.1);
                *halting = false;
            }
        } else if (if release.at_least(1, 13, 0) { rider.player } else { rider.living }) && rider.forward > 0.0 {
            // 1.8.9 AbstractMinecartEntity.java:443-455; 1.9.4 :452-462, as one constant
            let radians = if release.at_least(1, 9, 0) {
                rider.yaw * (std::f64::consts::PI / 180.0) as f32
            } else {
                rider.yaw * std::f32::consts::PI / 180.0
            };
            let x = -f64::from(radians).sin();
            let z = f64::from(radians).cos();
            if own < 0.01 {
                cart.velocity.x += x * 0.1;
                cart.velocity.z += z * 0.1;
                *halting = false;
            }
        }
    }

    /// 26.3 OldMinecartBehavior.moveAlongTrack (1.8.9 AbstractMinecartEntity.moveOnRail).
    fn move_along_track_old(&mut self, pos: BlockPosition, rail: Rail) {
        let world = self.world;
        let modern = self.at_least(1, 14, 0);
        self.cart().fall_distance = 0.0;
        let position = self.me().position;
        let old_snap = snap_to_rail(world, position, self.release());
        let (x, z) = (position.x, position.z);
        let mut y = f64::from(pos.1);
        let (power_track, mut halt_track) = if rail.powered_rail {
            (rail.powered, !rail.powered)
        } else {
            (false, false)
        };
        let mut slide = 0.0078125;
        if self.at_least(1, 17, 0) && self.me().in_water {
            slide *= 0.2;
        }
        {
            let cart = self.cart();
            match rail.shape {
                RailShape::AscendingEast => cart.velocity.x -= slide,
                RailShape::AscendingWest => cart.velocity.x += slide,
                RailShape::AscendingNorth => cart.velocity.z += slide,
                RailShape::AscendingSouth => cart.velocity.z -= slide,
                _ => {}
            }
        }
        if rail.shape.is_slope() {
            y += 1.0;
        }
        let (exit0, exit1) = rail.shape.exits();
        let mut x_d = f64::from(exit1.0 - exit0.0);
        let mut z_d = f64::from(exit1.2 - exit0.2);
        let length = (x_d * x_d + z_d * z_d).sqrt();
        {
            let cart = self.cart();
            if cart.velocity.x * x_d + cart.velocity.z * z_d < 0.0 {
                x_d = -x_d;
                z_d = -z_d;
            }
            let pow = cart.velocity.horizontal_length().min(2.0);
            cart.velocity.x = pow * x_d / length;
            cart.velocity.z = pow * z_d / length;
        }
        self.rider_start_old(&mut halt_track);
        if halt_track {
            let cart = self.cart();
            let speed = cart.velocity.horizontal_length();
            if speed < 0.03 {
                cart.velocity = if modern { Vec3::ZERO } else { cart.velocity.scale(0.0) };
            } else {
                cart.velocity.x *= 0.5;
                cart.velocity.y *= 0.0;
                cart.velocity.z *= 0.5;
            }
        }
        let x0 = f64::from(pos.0) + 0.5 + f64::from(exit0.0) * 0.5;
        let z0 = f64::from(pos.2) + 0.5 + f64::from(exit0.2) * 0.5;
        let x1 = f64::from(pos.0) + 0.5 + f64::from(exit1.0) * 0.5;
        let z1 = f64::from(pos.2) + 0.5 + f64::from(exit1.2) * 0.5;
        let x_d = x1 - x0;
        let z_d = z1 - z0;
        let progress = if x_d == 0.0 {
            z - f64::from(pos.2)
        } else if z_d == 0.0 {
            x - f64::from(pos.0)
        } else {
            ((x - x0) * x_d + (z - z0) * z_d) * 2.0
        };
        self.set_pos(Vec3::new(x0 + x_d * progress, y, z0 + z_d * progress));
        let scale = if self.me().rider.is_some() { 0.75 } else { 1.0 };
        let max = self.max_speed();
        let velocity = self.me().velocity;
        self.move_cart(Vec3::new(
            clamp_f64_for(self.release(), scale * velocity.x, -max, max),
            0.0,
            clamp_f64_for(self.release(), scale * velocity.z, -max, max),
        ));
        let at = self.me().position;
        let cell = |value: f64, origin: i32| floor_i32_for(self.release(), value).wrapping_sub(origin);
        let (cell_x, cell_z) = (cell(at.x, pos.0), cell(at.z, pos.2));
        if exit0.1 != 0 && cell_x == exit0.0 && cell_z == exit0.2 {
            self.set_pos(at.add_components(0.0, f64::from(exit0.1), 0.0));
        } else if exit1.1 != 0 && cell_x == exit1.0 && cell_z == exit1.2 {
            self.set_pos(at.add_components(0.0, f64::from(exit1.1), 0.0));
        }
        let slowed = self.natural_slowdown(self.me().velocity);
        self.cart().velocity = slowed;
        let at = self.me().position;
        if let (Some(new_snap), Some(old_snap)) = (snap_to_rail(world, at, self.release()), old_snap) {
            let speed = (old_snap.y - new_snap.y) * 0.05;
            let cart = self.cart();
            let pow = cart.velocity.horizontal_length();
            if pow > 0.0 && modern {
                cart.velocity.x *= (pow + speed) / pow;
                cart.velocity.z *= (pow + speed) / pow;
            } else if pow > 0.0 {
                // (1.13.2 AbstractMinecartEntity.java: the two divide before they multiply, 1.14 Vec3d.multiply)
                cart.velocity.x = cart.velocity.x / pow * (pow + speed);
                cart.velocity.z = cart.velocity.z / pow * (pow + speed);
            }
            self.set_pos(Vec3::new(at.x, new_snap.y, at.z));
        }
        let at = self.me().position;
        let (xn, zn) = (floor_i32_for(self.release(), at.x), floor_i32_for(self.release(), at.z));
        if xn != pos.0 || zn != pos.2 {
            let cart = self.cart();
            let pow = cart.velocity.horizontal_length();
            cart.velocity.x = pow * f64::from(xn.wrapping_sub(pos.0));
            cart.velocity.z = pow * f64::from(zn.wrapping_sub(pos.2));
        }
        if power_track {
            self.power_track_old(pos, rail.shape);
        }
    }

    /// The powered rail's end of moveAlongTrack: 0.06 along the motion, or off the block at its end.
    fn power_track_old(&mut self, pos: BlockPosition, shape: RailShape) {
        let world = self.world;
        let cart = self.cart();
        let speed = cart.velocity.horizontal_length();
        if speed > 0.01 {
            cart.velocity.x += cart.velocity.x / speed * 0.06;
            cart.velocity.z += cart.velocity.z / speed * 0.06;
            return;
        }
        match shape {
            RailShape::EastWest => {
                if conductor(world, offset(pos, (-1, 0, 0))) {
                    cart.velocity.x = 0.02;
                } else if conductor(world, offset(pos, (1, 0, 0))) {
                    cart.velocity.x = -0.02;
                }
            }
            RailShape::NorthSouth => {
                if conductor(world, offset(pos, (0, 0, -1))) {
                    cart.velocity.z = 0.02;
                } else if conductor(world, offset(pos, (0, 0, 1))) {
                    cart.velocity.z = -0.02;
                }
            }
            _ => {}
        }
    }

    /// OldMinecartBehavior.pushAndPickupEntities (26.3 :356-378), the end of AbstractMinecart.tick
    /// from 1.10 (1.10.2 :376-394). Before that a cart pushes other carts alone and a rideable
    /// cart picks its riders up when they push it (1.8.9 :351-355, :672-682).
    fn push_and_pickup_old(&mut self) {
        let release = self.release();
        let hitbox = bounds_of(self.me()).inflate(Vec3::new(f64::from(0.2_f32), 0.0, f64::from(0.2_f32)));
        let moving = self.me().velocity.horizontal_length_squared();
        // (>= 0.01 from 1.21.2, 26.3 OldMinecartBehavior.java:358; 1.21 :300 has >)
        let fast = if self.at_least(1, 21, 2) { moving >= 0.01 } else { moving > 0.01 };
        let picks_up = self.me().variant == MinecartVariant::Rideable && fast;
        if release.at_least(1, 10, 0) && picks_up {
            for index in 0..self.others.len() {
                let other = self.others[index];
                if !other.pushable || !other.bounds.intersects(hitbox) {
                    continue;
                }
                if !other.player && !other.iron_golem && self.me().rider.is_none() && !other.passenger {
                    self.pick_up(index);
                } else {
                    self.push_other(index);
                }
            }
            for index in 0..self.carts.len() {
                if index != self.current && self.carts[index].removed.is_none() && bounds_of(&self.carts[index]).intersects(hitbox) {
                    self.cart_pushed_by_me(index);
                }
            }
            return;
        }
        for index in 0..self.carts.len() {
            if index != self.current && self.carts[index].removed.is_none() && bounds_of(&self.carts[index]).intersects(hitbox) {
                self.cart_pushed_by_me(index);
            }
        }
    }

    fn pick_up(&mut self, index: usize) {
        let current = self.current;
        let other = &mut self.others[index];
        other.rides = Some(current);
        other.passenger = true;
        let living = other.living;
        self.cart().rider = Some(MinecartRider { living, ..MinecartRider::default() });
    }

    /// `entity.push(cart)` of what is not a cart: Entity.push, behind Boat.push's gate for a boat (1.9.4 BoatEntity.java:185-193).
    fn push_other(&mut self, index: usize) {
        let release = self.release();
        let cart_position = self.me().position;
        let cart_vehicle = self.me().rider.is_some();
        let cart_bottom = bounds_of(self.me()).min.y;
        let other = &mut self.others[index];
        if other.boat && cart_bottom > other.bounds.min.y {
            return;
        }
        let (to_other, to_cart) = entity_push_impulses(
            other.position,
            cart_position,
            false,
            false,
            false,
            other.has_passengers,
            cart_vehicle,
            other.pushable,
            true,
            release,
        );
        other.velocity = other.velocity + to_other;
        let cart = self.cart();
        cart.velocity = cart.velocity + to_cart;
    }

    /// `entity.push(cart)` of a cart: AbstractMinecart.push and pushOtherMinecart, with `this`
    /// the cart pushed (26.3 AbstractMinecart.java:435-506; 1.8.9 AbstractMinecartEntity.java:669).
    fn cart_pushed_by_me(&mut self, this: usize) {
        let release = self.release();
        let source = self.current;
        let this_position = self.carts[this].position;
        let source_position = self.carts[source].position;
        let Some((xa, za)) = minecart_push_impulse(this_position, source_position, release) else {
            return;
        };
        let (xo, zo) = if self.improved() {
            let velocity = self.carts[this].velocity;
            (velocity.x, velocity.z)
        } else {
            (source_position.x - this_position.x, source_position.z - this_position.z)
        };
        let direction = legacy_normalized(Vec3::new(xo, 0.0, zo), release);
        let radians = self.yaw_radians(this);
        let facing = legacy_normalized(Vec3::new(radians.0, 0.0, radians.1), release);
        if direction.dot(facing).abs() < f64::from(0.8_f32) && !self.improved() {
            return;
        }
        let movement = self.carts[this].velocity;
        let entity_movement = self.carts[source].velocity;
        let this_furnace = self.carts[this].variant == MinecartVariant::Furnace;
        let source_furnace = self.carts[source].variant == MinecartVariant::Furnace;
        let (fifth, slowed) = if self.at_least(1, 14, 0) {
            (0.2, 0.95)
        } else {
            (f64::from(0.2_f32), f64::from(0.95_f32))
        };
        let scaled = |v: Vec3, by: f64| Vec3::new(v.x * by, v.y, v.z * by);
        if source_furnace && !this_furnace {
            self.carts[this].velocity = scaled(movement, fifth)
                .add_components(entity_movement.x - xa, 0.0, entity_movement.z - za);
            self.carts[source].velocity = scaled(entity_movement, slowed);
        } else if !source_furnace && this_furnace {
            self.carts[source].velocity = scaled(entity_movement, fifth)
                .add_components(movement.x + xa, 0.0, movement.z + za);
            self.carts[this].velocity = scaled(movement, slowed);
        } else {
            let xdd = (entity_movement.x + movement.x) / 2.0;
            let zdd = (entity_movement.z + movement.z) / 2.0;
            self.carts[this].velocity = scaled(movement, fifth).add_components(xdd - xa, 0.0, zdd - za);
            self.carts[source].velocity = scaled(entity_movement, fifth).add_components(xdd + xa, 0.0, zdd + za);
        }
    }

    /// The yaw of the cart `this` as (cos, sin) of its radians: Mth's tables with the release's
    /// constant (1.8.9 `yaw * (float)Math.PI / 180.0F`; 1.9.4 `yaw * (float)(Math.PI / 180.0)`).
    fn yaw_radians(&self, this: usize) -> (f64, f64) {
        let yaw = self.carts[this].y_rot;
        let radians = if self.at_least(1, 9, 0) {
            yaw * 0.017453292_f32
        } else {
            yaw * std::f32::consts::PI / 180.0
        };
        let radians = f64::from(radians);
        (mth_cos(radians, self.release()), mth_sin(radians, self.release()))
    }

    // The improved path: NewMinecartBehavior, from 1.21.2 (the same code to 26.3).

    fn tick_improved(&mut self) {
        let position = self.rail_position();
        let rail = rail_at(self.world, position);
        if self.me().first_tick {
            self.cart().on_rails = rail.is_some();
            self.adjust_to_rails(position, rail, true);
        }
        self.apply_gravity();
        self.move_along_track_improved();
    }

    fn step_of(&self, weight: f32) -> MinecartStep {
        let cart = self.me();
        MinecartStep {
            position: cart.position,
            movement: cart.velocity,
            y_rot: cart.y_rot,
            x_rot: cart.x_rot,
            weight,
        }
    }

    /// 26.3 NewMinecartBehavior.isDecending.
    fn descending(movement: Vec3, shape: RailShape) -> bool {
        match shape {
            RailShape::AscendingEast => movement.x < 0.0,
            RailShape::AscendingWest => movement.x > 0.0,
            RailShape::AscendingNorth => movement.z > 0.0,
            RailShape::AscendingSouth => movement.z < 0.0,
            _ => false,
        }
    }

    /// 26.3 NewMinecartBehavior.setRotation.
    fn set_rotation(&mut self, mut y_rot: f32, mut x_rot: f32) {
        let cart = self.cart();
        let difference = f64::from((y_rot - cart.y_rot).abs());
        if (175.0..=185.0).contains(&difference) {
            cart.flipped = !cart.flipped;
            y_rot -= 180.0;
            x_rot *= -1.0;
        }
        x_rot = x_rot.clamp(-45.0, 45.0);
        cart.x_rot = x_rot % 360.0;
        cart.y_rot = y_rot % 360.0;
    }

    /// 26.3 NewMinecartBehavior.adjustToRails.
    fn adjust_to_rails(&mut self, target: BlockPosition, rail: Option<Rail>, instant: bool) {
        let Some(rail) = rail else {
            return;
        };
        let (exit0, exit1) = rail.shape.exits();
        let (exit0_half, exit1_half) = (half_exit(exit0), half_exit(exit1));
        let mut out_direction = exit0_half.horizontal();
        let mut in_direction = exit1_half.horizontal();
        let movement = self.me().velocity;
        if movement.length() > TINY && movement.dot(out_direction) < movement.dot(in_direction)
            || Self::descending(in_direction, rail.shape)
        {
            std::mem::swap(&mut out_direction, &mut in_direction);
        }
        let flipped = self.me().flipped;
        let degrees = |z: f64, x: f64| 180.0_f32 - (z.atan2(x) * 180.0 / std::f64::consts::PI) as f32;
        let turned = if flipped { 180.0 } else { 0.0 };
        let mut y_rot = degrees(out_direction.z, out_direction.x) + turned;
        let previous = self.me().position;
        let in_corner = exit0_half.x != exit1_half.x && exit0_half.z != exit1_half.z;
        let center = bottom_center(target);
        let target_position = if in_corner {
            let from_0_to_1 = exit1_half - exit0_half;
            let from_0_to_pos = (previous - center) - exit0_half;
            let travel = from_0_to_1.scale(from_0_to_1.dot(from_0_to_pos) / from_0_to_1.dot(from_0_to_1));
            y_rot = degrees(travel.z, travel.x) + turned;
            center + exit0_half + travel
        } else {
            let difference = exit0_half - exit1_half;
            let (z_snap, x_snap) = (difference.x != 0.0, difference.z != 0.0);
            Vec3::new(
                if x_snap { center.x } else { previous.x },
                f64::from(target.1),
                if z_snap { center.z } else { previous.z },
            )
        };
        self.set_pos(target_position);
        let mut x_rot = 0.0_f32;
        if exit0.1 != exit1.1 {
            let in_position = center + in_direction;
            let from_in = in_position.distance(self.me().position);
            self.set_pos(self.me().position.add_components(0.0, from_in + 0.1, 0.0));
            x_rot = if flipped { 45.0 } else { -45.0 };
        } else {
            self.set_pos(self.me().position.add_components(0.0, 0.1, 0.0));
        }
        self.set_rotation(y_rot, x_rot);
        let adjusted = previous.distance(self.me().position);
        if adjusted > 0.0 {
            let step = self.step_of(if instant { 0.0 } else { adjusted as f32 });
            self.tick.steps.push(step);
        }
    }

    /// 26.3 NewMinecartBehavior.moveAlongTrack.
    fn move_along_track_improved(&mut self) {
        let world = self.world;
        let mut iteration = TrackIteration::default();
        while iteration.first || iteration.movement_left > TINY {
            let initial = self.me().velocity;
            let position = self.rail_position();
            let rail = rail_at(world, position);
            if self.me().on_rails != rail.is_some() {
                self.cart().on_rails = rail.is_some();
                self.adjust_to_rails(position, rail, false);
            }
            if let Some(rail) = rail {
                self.cart().fall_distance = 0.0;
                self.old_position = self.me().position;
                self.old_y_rot = self.me().y_rot;
                if rail.activator {
                    self.activate(rail.powered);
                }
                let speed = self.track_speed(initial.horizontal(), &mut iteration, position, rail);
                if iteration.first {
                    iteration.movement_left = speed.horizontal_length();
                } else {
                    iteration.movement_left += speed.horizontal_length() - initial.horizontal_length();
                }
                self.cart().velocity = speed;
                iteration.movement_left = self.step_along_track(position, rail.shape, iteration.movement_left);
                // MinecartHopper.makeStepAlongTrack (1.21.3 HopperMinecartEntity.java, 26.3 :80-84)
                self.try_consume_items();
            } else {
                self.come_off_track();
                iteration.movement_left = 0.0;
            }
            let step_position = self.me().position;
            let step_delta = step_position - self.old_position;
            let step_length = step_delta.length();
            if step_length > TINY {
                if step_delta.horizontal_length_squared() > TINY {
                    let degrees = |y: f64, x: f64| (y.atan2(x) * 180.0 / std::f64::consts::PI) as f32;
                    let mut y_rot = 180.0_f32 - degrees(step_delta.z, step_delta.x);
                    let grounded = self.me().on_ground && !self.me().on_rails;
                    let mut x_rot = if grounded {
                        0.0
                    } else {
                        90.0_f32 - degrees(step_delta.horizontal_length(), step_delta.y)
                    };
                    let flipped = self.me().flipped;
                    y_rot += if flipped { 180.0 } else { 0.0 };
                    x_rot *= if flipped { -1.0 } else { 1.0 };
                    self.set_rotation(y_rot, x_rot);
                } else if !self.me().on_rails {
                    let cart = self.cart();
                    cart.x_rot = if cart.on_ground { 0.0 } else { rot_lerp(0.2, cart.x_rot, 0.0) };
                }
                let weight = step_length.min(self.max_speed()) as f32;
                let step = self.step_of(weight);
                self.tick.steps.push(step);
            } else if initial.horizontal_length_squared() > 0.0 {
                let step = self.step_of(1.0);
                self.tick.steps.push(step);
            }
            if step_length > TINY || iteration.first {
                self.apply_tick_effects();
                self.apply_tick_effects();
            }
            iteration.first = false;
        }
    }

    /// Entity.applyEffectsFromBlocks(): the moves recorded since the last, and on to the position.
    fn apply_tick_effects(&mut self) {
        let position = self.me().position;
        let mut movements = std::mem::take(&mut self.recorded);
        match movements.last() {
            None => movements.push(Movement { from: self.old_position, to: position, axis_order: None }),
            Some(last) if last.to.distance_squared(position) > 9.999999439624929e-11 => {
                movements.push(Movement { from: last.to, to: position, axis_order: None });
            }
            Some(_) => {}
        }
        self.apply_effects(&movements);
    }

    /// 26.3 NewMinecartBehavior.calculateTrackSpeed.
    fn track_speed(
        &mut self,
        delta: Vec3,
        iteration: &mut TrackIteration,
        position: BlockPosition,
        rail: Rail,
    ) -> Vec3 {
        let mut speed = delta;
        if !iteration.gained_slope_speed {
            let sloped = self.slope_speed(delta, rail.shape);
            if sloped.horizontal_length_squared() != delta.horizontal_length_squared() {
                iteration.gained_slope_speed = true;
                speed = sloped;
            }
        }
        if iteration.first {
            let input = self.player_input_speed(speed);
            if input.horizontal_length_squared() != speed.horizontal_length_squared() {
                iteration.halted = true;
                speed = input;
            }
        }
        if !iteration.halted && rail.powered_rail && !rail.powered {
            let halted = if speed.length() < 0.03 { Vec3::ZERO } else { speed.scale(0.5) };
            if halted.horizontal_length_squared() != speed.horizontal_length_squared() {
                iteration.halted = true;
                speed = halted;
            }
        }
        if iteration.first {
            speed = self.natural_slowdown(speed);
            if speed.length_squared() > 0.0 {
                let capped = speed.length().min(self.max_speed());
                speed = normalized(speed).scale(capped);
            }
        }
        if !iteration.boosted {
            let boosted = self.boost_speed(speed, position, rail);
            if boosted.horizontal_length_squared() != speed.horizontal_length_squared() {
                iteration.boosted = true;
                speed = boosted;
            }
        }
        speed
    }

    fn slope_speed(&self, delta: Vec3, shape: RailShape) -> Vec3 {
        let mut slide = (delta.horizontal_length() * 0.02).max(0.0078125);
        if self.me().in_water {
            slide *= 0.2;
        }
        match shape {
            RailShape::AscendingEast => delta.add_components(-slide, 0.0, 0.0),
            RailShape::AscendingWest => delta.add_components(slide, 0.0, 0.0),
            RailShape::AscendingNorth => delta.add_components(0.0, 0.0, slide),
            RailShape::AscendingSouth => delta.add_components(0.0, 0.0, -slide),
            _ => delta,
        }
    }

    fn player_input_speed(&self, delta: Vec3) -> Vec3 {
        let Some(rider) = self.me().rider else {
            return delta;
        };
        if !rider.player || rider.move_intent.length_squared() <= 0.0 {
            return delta;
        }
        let movement = normalized(rider.move_intent);
        if movement.length_squared() > 0.0 && delta.horizontal_length_squared() < 0.01 {
            return delta + normalized(Vec3::new(movement.x, 0.0, movement.z)).scale(0.001);
        }
        delta
    }

    fn boost_speed(&self, delta: Vec3, position: BlockPosition, rail: Rail) -> Vec3 {
        if !rail.powered_rail || !rail.powered {
            return delta;
        }
        if delta.length() > 0.01 {
            return normalized(delta).scale(delta.length() + 0.06);
        }
        // AbstractMinecart.getRedstoneDirection
        let world = self.world;
        let direction = match rail.shape {
            RailShape::EastWest if conductor(world, offset(position, (-1, 0, 0))) => Vec3::new(1.0, 0.0, 0.0),
            RailShape::EastWest if conductor(world, offset(position, (1, 0, 0))) => Vec3::new(-1.0, 0.0, 0.0),
            RailShape::NorthSouth if conductor(world, offset(position, (0, 0, -1))) => Vec3::new(0.0, 0.0, 1.0),
            RailShape::NorthSouth if conductor(world, offset(position, (0, 0, 1))) => Vec3::new(0.0, 0.0, -1.0),
            _ => return delta,
        };
        direction.scale(delta.length() + 0.2)
    }

    /// 26.3 NewMinecartBehavior.stepAlongTrack.
    fn step_along_track(&mut self, pos: BlockPosition, shape: RailShape, movement_left: f64) -> f64 {
        if movement_left < TINY {
            return 0.0;
        }
        let old_position = self.me().position;
        let (exit0, exit1) = shape.exits();
        let mut movement = self.me().velocity.horizontal();
        if movement.length() < TINY {
            self.cart().velocity = Vec3::ZERO;
            return 0.0;
        }
        let in_hill = exit0.1 != exit1.1;
        let in_direction = half_exit(exit1).horizontal();
        let mut out_direction = half_exit(exit0).horizontal();
        if movement.dot(out_direction) < movement.dot(in_direction) {
            out_direction = in_direction;
        }
        let mut out_position = (bottom_center(pos) + out_direction)
            .add_components(0.0, 0.1, 0.0)
            + normalized(out_direction).scale(TINY);
        if in_hill && !Self::descending(movement, shape) {
            out_position = out_position.add_components(0.0, 1.0, 0.0);
        }
        let towards_out = normalized(out_position - self.me().position);
        movement = towards_out.scale(movement.length() / towards_out.horizontal_length());
        let root_two = f64::from(if in_hill { std::f32::consts::SQRT_2 } else { 1.0 });
        let mut new_position = old_position + normalized(movement).scale(movement_left * root_two);
        let mut left = 0.0;
        if old_position.distance_squared(out_position) <= old_position.distance_squared(new_position) {
            left = (out_position - new_position).horizontal_length();
            new_position = out_position;
        }
        self.move_cart(new_position - old_position);
        if in_hill {
            let release = self.release();
            let new_cell = (
                floor_i32_for(release, new_position.x),
                floor_i32_for(release, new_position.y),
                floor_i32_for(release, new_position.z),
            );
            if let Some(new_rail) = rail_at(self.world, new_cell) {
                if self.rest_at_v_shape(shape, new_rail.shape) {
                    return 0.0;
                }
            }
            let from_out = out_position.horizontal().distance(self.me().position.horizontal());
            let project = out_position.y + if Self::descending(movement, shape) { from_out } else { -from_out };
            let at = self.me().position;
            if at.y < project {
                self.set_pos(Vec3::new(at.x, project, at.z));
            }
        }
        if self.me().position.distance(old_position) < TINY && new_position.distance(old_position) > TINY {
            self.cart().velocity = Vec3::ZERO;
            return 0.0;
        }
        self.cart().velocity = movement;
        left
    }

    /// 26.3 NewMinecartBehavior.restAtVShape.
    fn rest_at_v_shape(&mut self, current: RailShape, new: RailShape) -> bool {
        let velocity = self.me().velocity;
        if velocity.length_squared() < 0.005
            && new.is_slope()
            && Self::descending(velocity, current)
            && !Self::descending(velocity, new)
        {
            self.cart().velocity = Vec3::ZERO;
            return true;
        }
        false
    }

    /// 26.3 NewMinecartBehavior.pushAndPickupEntities: whether a rider picked up and nothing
    /// pushed leaves the rest of the move to make.
    fn push_and_pickup_improved(&mut self) -> bool {
        let bounds = bounds_of(self.me());
        let picked_up = self.pick_up_improved(bounds.inflate(Vec3::new(0.2, 0.0, 0.2)));
        let cart = self.me();
        if !cart.collided_horizontally && !cart.collided_vertically {
            return false;
        }
        let pushed = self.push_improved(bounds.inflate(Vec3::new(1.0e-7, 1.0e-7, 1.0e-7)));
        picked_up && !pushed
    }

    fn pick_up_improved(&mut self, hitbox: Aabb) -> bool {
        if self.me().variant != MinecartVariant::Rideable || self.me().rider.is_some() {
            return false;
        }
        for index in 0..self.others.len() {
            let other = self.others[index];
            if other.pushable && other.bounds.intersects(hitbox) && !other.player && !other.iron_golem && !other.passenger {
                self.pick_up(index);
                return true;
            }
        }
        false
    }

    fn push_improved(&mut self, hitbox: Aabb) -> bool {
        let mut pushed = false;
        if self.me().variant == MinecartVariant::Rideable {
            for index in 0..self.others.len() {
                let other = self.others[index];
                if other.pushable
                    && other.bounds.intersects(hitbox)
                    && (other.player || other.iron_golem || self.me().rider.is_some() || other.passenger)
                {
                    self.push_other(index);
                    pushed = true;
                }
            }
        }
        for index in 0..self.carts.len() {
            if index != self.current && self.carts[index].removed.is_none() && bounds_of(&self.carts[index]).intersects(hitbox) {
                self.cart_pushed_by_me(index);
                pushed = true;
            }
        }
        pushed
    }
}

/// NewMinecartBehavior.TrackIteration.
struct TrackIteration {
    movement_left: f64,
    first: bool,
    gained_slope_speed: bool,
    halted: bool,
    boosted: bool,
}

impl Default for TrackIteration {
    fn default() -> Self {
        Self { movement_left: 0.0, first: true, gained_slope_speed: false, halted: false, boosted: false }
    }
}

/// AbstractContainerMenu.getRedstoneSignalFromContainer of a hopper cart's five slots: each stack's
/// fullness as a float, 14 steps and 1 for holding anything (1.8.9 ScreenHandler.java:530-548,
/// 26.3 Mth.lerpDiscrete, the same).
fn comparator_signal(inventory: &[MinecartStack; 5]) -> i32 {
    let mut fullness = 0.0_f32;
    let mut held = false;
    for slot in inventory.iter().filter(|slot| slot.count > 0) {
        fullness += slot.count as f32 / slot.max_stack.min(64) as f32;
        held = true;
    }
    fullness /= 5.0;
    (fullness * 14.0).floor() as i32 + i32::from(held)
}

/// Vec3.normalize of the release: the float square root before 1.17, 1.0E-4 before 1.21.2.
fn legacy_normalized(vector: Vec3, release: MinecraftVersion) -> Vec3 {
    let exact = vector.length();
    let length = if release.at_least(1, 17, 0) { exact } else { java_float(exact) };
    let minimum = if release.at_least(1, 21, 2) { TINY } else { 1.0e-4 };
    if length < minimum {
        Vec3::ZERO
    } else {
        Vec3::new(vector.x / length, vector.y / length, vector.z / length)
    }
}

/// OldMinecartBehavior.getPos (snapPositionToRail): the place on the rail at a position, or None.
fn snap_to_rail(world: &WorldSnapshot, position: Vec3, release: MinecraftVersion) -> Option<Vec3> {
    let xt = floor_i32_for(release, position.x);
    let mut yt = floor_i32_for(release, position.y);
    let zt = floor_i32_for(release, position.z);
    if is_rail(world, (xt, yt - 1, zt)) {
        yt -= 1;
    }
    let rail = rail_at(world, (xt, yt, zt))?;
    let (exit0, exit1) = rail.shape.exits();
    let half = |value: i32| f64::from(value) * 0.5;
    let x0 = f64::from(xt) + 0.5 + half(exit0.0);
    let y0 = f64::from(yt) + 0.0625 + half(exit0.1);
    let z0 = f64::from(zt) + 0.5 + half(exit0.2);
    let x1 = f64::from(xt) + 0.5 + half(exit1.0);
    let y1 = f64::from(yt) + 0.0625 + half(exit1.1);
    let z1 = f64::from(zt) + 0.5 + half(exit1.2);
    let x_d = x1 - x0;
    let y_d = (y1 - y0) * 2.0;
    let z_d = z1 - z0;
    let progress = if x_d == 0.0 {
        position.z - f64::from(zt)
    } else if z_d == 0.0 {
        position.x - f64::from(xt)
    } else {
        ((position.x - x0) * x_d + (position.z - z0) * z_d) * 2.0
    };
    let mut y = y0 + y_d * progress;
    if y_d < 0.0 {
        y += 1.0;
    } else if y_d > 0.0 {
        y += 0.5;
    }
    Some(Vec3::new(x0 + x_d * progress, y, z0 + z_d * progress))
}

// A client's cart. It reads no rail and no block: it goes where the server last said.

/// A client's cart under the old path: the linear interpolation to the last target.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MinecartClientLerp {
    pub position: Vec3,
    pub y_rot: f32,
    pub x_rot: f32,
    pub steps: i32,
    pub target: Vec3,
    pub target_y_rot: f32,
    pub target_x_rot: f32,
}

/// The steps a client's lerpTo gives a cart: 3 and 2 more until 1.21.2 (1.8.9
/// AbstractMinecartEntity.java:106, 1.20.4 :719), the handler's 3 from 1.21.5
/// (26.3 LinearInterpolationHandler.java:8, 33). Before 1.14 the packet's own steps are always 3.
#[must_use]
pub fn client_lerp_steps(release: MinecraftVersion) -> i32 {
    if release.at_least(1, 21, 5) {
        3
    } else {
        5
    }
}

/// What a client's tick keeps counting of a cart. The numbers are the server's, by entity data and
/// entity events: this only runs them down between two of its packets.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MinecartClientEffects {
    pub hurt_time: i32,
    pub damage: f32,
    /// MinecartTNT.fuse: 80 from the priming event, whatever the server's own is.
    pub fuse: i32,
}

/// One client tick of AbstractMinecart.tick's head and MinecartTNT.tick: the counts alone. A client
/// neither moves a cart here nor blows it up (26.3 MinecartTNT.java:119 asks for a ServerLevel, as
/// 1.8.9 :95 for !isClient), breaks it (hurtClient, 26.3 VehicleEntity.java:25-27) or picks up
/// anything (26.3 MinecartHopper.java:94).
pub fn tick_client_effects(cart: &mut MinecartClientEffects) {
    if cart.hurt_time > 0 {
        cart.hurt_time -= 1;
    }
    if cart.damage > 0.0 {
        cart.damage -= 1.0;
    }
    if cart.fuse > 0 {
        cart.fuse -= 1;
    }
}

/// One client tick of the old path's interpolation. Until 1.20.2 the cart works it out itself, dividing by the steps left
/// and from 1.17 turning in floats (1.8.9 AbstractMinecartEntity.java:291-302, 1.16.5 :361-363, 1.17 :296-298); from there
/// Entity.lerpPositionAndRotationStep (1.20.4 Entity.java:3416-3425, 26.3
/// LinearInterpolationHandler.doInterpolate).
pub fn tick_client_linear(cart: &mut MinecartClientLerp, release: MinecraftVersion) {
    if cart.steps <= 0 {
        return;
    }
    let steps = f64::from(cart.steps);
    let turn = crate::math::wrap_degrees(f64::from(cart.target_y_rot) - f64::from(cart.y_rot));
    let pitch = f64::from(cart.target_x_rot) - f64::from(cart.x_rot);
    if release.at_least(1, 20, 2) {
        let share = 1.0 / steps;
        cart.position = cart.position.lerp(cart.target, share);
        cart.y_rot = (f64::from(cart.y_rot) + share * turn) as f32;
        cart.x_rot = (f64::from(cart.x_rot) + share * pitch) as f32;
    } else {
        let step = cart.target - cart.position;
        cart.position = Vec3::new(cart.position.x + step.x / steps, cart.position.y + step.y / steps, cart.position.z + step.z / steps);
        if release.at_least(1, 17, 0) {
            cart.y_rot += turn as f32 / cart.steps as f32;
            cart.x_rot += pitch as f32 / cart.steps as f32;
        } else {
            cart.y_rot = (f64::from(cart.y_rot) + turn / steps) as f32;
            cart.x_rot = (f64::from(cart.x_rot) + pitch / steps) as f32;
        }
    }
    cart.steps -= 1;
}

/// A client's cart under the improvements: NewMinecartBehavior's steps and delay.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MinecartClientSteps {
    pub position: Vec3,
    pub velocity: Vec3,
    pub y_rot: f32,
    pub x_rot: f32,
    /// lerpDelay.
    pub delay: i32,
    /// lerpSteps: what ClientboundMoveMinecartPacket brought since it last started on some.
    pub pending: Vec<MinecartStep>,
    /// currentLerpSteps.
    pub current: Vec<MinecartStep>,
    pub total_weight: f64,
    /// oldLerp.
    pub old: MinecartStep,
}

/// NewMinecartBehavior.POS_ROT_LERP_TICKS.
const LERP_TICKS: i32 = 3;

/// One client tick of the improvements' interpolation (26.3 NewMinecartBehavior.java:67-91).
pub fn tick_client_weighted(cart: &mut MinecartClientSteps) {
    cart.delay = cart.delay.wrapping_sub(1);
    if cart.delay <= 0 {
        cart.old = MinecartStep {
            position: cart.position,
            movement: cart.velocity,
            y_rot: cart.y_rot,
            x_rot: cart.x_rot,
            weight: 0.0,
        };
        cart.current.clear();
        if !cart.pending.is_empty() {
            cart.current.append(&mut cart.pending);
            cart.total_weight = cart.current.iter().map(|step| f64::from(step.weight)).sum();
            cart.delay = if cart.total_weight == 0.0 { 0 } else { LERP_TICKS };
        }
    }
    if cart.current.is_empty() {
        return;
    }
    let (partial, current, previous) = current_step(cart, 1.0);
    cart.position = previous.position.lerp(current.position, f64::from(partial));
    cart.velocity = previous.movement.lerp(current.movement, f64::from(partial));
    cart.x_rot = rot_lerp(partial, previous.x_rot, current.x_rot);
    cart.y_rot = rot_lerp(partial, previous.y_rot, current.y_rot);
}

/// 26.3 NewMinecartBehavior.getCurrentLerpStep.
fn current_step(cart: &MinecartClientSteps, partial_tick: f32) -> (f32, MinecartStep, MinecartStep) {
    let alpha = ((LERP_TICKS - cart.delay) as f32 + partial_tick) / LERP_TICKS as f32;
    let mut count_up = 0.0_f32;
    let mut partial = 1.0_f32;
    let mut found = None;
    for (index, step) in cart.current.iter().enumerate() {
        if step.weight <= 0.0 {
            continue;
        }
        count_up += step.weight;
        if f64::from(count_up) >= cart.total_weight * f64::from(alpha) {
            let before = count_up - step.weight;
            partial = ((f64::from(alpha) * cart.total_weight - f64::from(before)) / f64::from(step.weight)) as f32;
            found = Some(index);
            break;
        }
    }
    let index = found.unwrap_or(cart.current.len() - 1);
    let previous = if index > 0 { cart.current[index - 1] } else { cart.old };
    (partial, cart.current[index], previous)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::{BlockShape, BlockState};

    /// `minecart#0.vel` at tick 19 of the fresh 1.20.4 recording of physrec/v_boat_into_minecart.
    const BOAT_PUSH_1_20_4: f64 = 0.05000000074505806;

    fn release(major: u16, minor: u16, patch: u16) -> MinecraftVersion {
        MinecraftVersion::new(major, minor, patch)
    }

    fn old(version: MinecraftVersion) -> MinecartRules {
        MinecartRules::new(version, false, None).unwrap()
    }

    fn improved(max_speed: i32) -> MinecartRules {
        MinecartRules::new(release(26, 3, 0), true, Some(max_speed)).unwrap()
    }

    fn rail(world: &mut WorldSnapshot, at: BlockPosition, shape: &str) {
        world.set_block(at, BlockState { tags: TAG_RAIL, ..BlockState::default() });
        world.set_block_properties(at, vec![("shape".to_owned(), shape.to_owned())]);
    }

    fn powered(world: &mut WorldSnapshot, at: BlockPosition, shape: &str, on: bool) {
        world.set_block(at, BlockState { tags: TAG_RAIL | TAG_POWERED_RAIL, ..BlockState::default() });
        world.set_block_properties(at, vec![
            ("shape".to_owned(), shape.to_owned()),
            ("powered".to_owned(), on.to_string()),
        ]);
    }

    fn solid(world: &mut WorldSnapshot, at: BlockPosition) {
        world.set_block(at, BlockState {
            shape: Some(BlockShape::full_block()),
            tags: TAG_REDSTONE_CONDUCTOR,
            ..BlockState::default()
        });
    }

    fn straight(length: i32) -> WorldSnapshot {
        let mut world = WorldSnapshot::new();
        for x in -4..length {
            rail(&mut world, (x, 0, 0), "east_west");
            solid(&mut world, (x, -1, 0));
        }
        world
    }

    fn cart_at(x: f64, velocity: f64) -> MinecartState {
        MinecartState {
            position: Vec3::new(x, 0.0625, 0.5),
            velocity: Vec3::new(velocity, 0.0, 0.0),
            ..MinecartState::default()
        }
    }

    fn rider() -> Option<MinecartRider> {
        Some(MinecartRider { player: true, living: true, ..MinecartRider::default() })
    }

    #[test]
    fn the_flag_chooses_the_path_and_a_release_alone_does_not() {
        let at = release(1, 21, 2);
        assert_eq!(MinecartRules::new(at, false, None).unwrap().behavior, MinecartBehavior::Old);
        assert_eq!(MinecartRules::new(at, true, Some(8)).unwrap().behavior, MinecartBehavior::Improved);
        assert!(MinecartRules::new(at, true, None).is_err());
        assert!(MinecartRules::new(at, true, Some(1001)).is_err());
        assert!(MinecartRules::new(release(1, 21, 1), true, Some(8)).is_err());
        let world = straight(30);
        let mut plain = cart_at(1.5, 0.1);
        let mut new = cart_at(1.5, 0.1);
        new.position.y = 0.1;
        tick_minecart(&mut plain, &world, MinecartRules::new(at, false, None).unwrap());
        tick_minecart(&mut new, &world, MinecartRules::new(at, true, Some(8)).unwrap());
        assert_eq!(plain.velocity.x, 0.1 * 0.96);
        assert_eq!(new.velocity.x, 0.1 * 0.975);
    }

    #[test]
    fn a_cart_coasts_along_a_straight_rail() {
        let world = straight(30);
        let mut cart = cart_at(1.5, 0.1);
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert_eq!(cart.position, Vec3::new(1.6, 0.0625, 0.5));
        assert_eq!(cart.velocity, Vec3::new(0.1 * 0.96, 0.0, 0.0));
        assert!(cart.on_rails);
    }

    #[test]
    fn the_old_drag_was_a_float_before_1_14() {
        let world = straight(30);
        let mut cart = cart_at(1.5, 0.1);
        tick_minecart(&mut cart, &world, old(release(1, 13, 2)));
        assert_eq!(cart.velocity.x, 0.1 * f64::from(0.96_f32));
    }

    #[test]
    fn a_rider_keeps_a_cart_going_and_slows_its_move() {
        let world = straight(30);
        let mut cart = cart_at(1.5, 0.2);
        cart.rider = rider();
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert_eq!(cart.position.x, 1.5 + 0.2 * 0.75);
        assert_eq!(cart.velocity.x, 0.2 * 0.997);
    }

    #[test]
    fn a_cart_is_held_to_the_top_speed_of_its_release() {
        let world = straight(30);
        let mut cart = cart_at(1.5, 1.0);
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert_eq!(cart.position.x, 1.9);
        let mut furnace = cart_at(1.5, 1.0);
        furnace.variant = MinecartVariant::Furnace;
        tick_minecart(&mut furnace, &world, old(release(1, 20, 4)));
        assert_eq!(furnace.position.x, 1.7);
    }

    #[test]
    fn water_halves_the_top_speed_from_1_17() {
        let world = straight(30);
        let mut wet = cart_at(1.5, 1.0);
        wet.in_water = true;
        tick_minecart(&mut wet, &world, old(release(1, 17, 0)));
        assert_eq!(wet.position.x, 1.7);
        let mut before = cart_at(1.5, 1.0);
        before.in_water = true;
        tick_minecart(&mut before, &world, old(release(1, 16, 5)));
        assert_eq!(before.position.x, 1.9);
    }

    #[test]
    fn gravity_in_water_goes_with_1_17() {
        let mut wet = cart_at(0.5, 0.0);
        wet.in_water = true;
        let mut scene = WorldSnapshot::new();
        solid(&mut scene, (0, -9, 0));
        tick_minecart(&mut wet, &scene, old(release(1, 17, 0)));
        assert_eq!(wet.position.y, 0.0625 - 0.005);
        let mut before = cart_at(0.5, 0.0);
        tick_minecart(&mut before, &scene, old(release(1, 16, 5)));
        assert_eq!(before.position.y, 0.0625 - 0.04);
        let mut legacy = cart_at(0.5, 0.0);
        tick_minecart(&mut legacy, &scene, old(release(1, 13, 2)));
        assert_eq!(legacy.position.y, 0.0625 - f64::from(0.04_f32));
    }

    #[test]
    fn no_gravity_is_read_from_1_10() {
        let scene = WorldSnapshot::new();
        let mut floating = cart_at(0.5, 0.0);
        floating.no_gravity = true;
        tick_minecart(&mut floating, &scene, old(release(1, 10, 2)));
        assert_eq!(floating.position.y, 0.0625);
        let mut falling = cart_at(0.5, 0.0);
        falling.no_gravity = true;
        tick_minecart(&mut falling, &scene, old(release(1, 9, 4)));
        assert!(falling.position.y < 0.0625);
    }

    #[test]
    fn a_powered_rail_boosts_and_an_unpowered_one_brakes() {
        let mut world = straight(30);
        powered(&mut world, (2, 0, 0), "east_west", true);
        let mut cart = cart_at(2.5, 0.1);
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert_eq!(cart.velocity.x, 0.1 * 0.96 + 0.06);
        powered(&mut world, (2, 0, 0), "east_west", false);
        let mut braked = cart_at(2.5, 0.1);
        tick_minecart(&mut braked, &world, old(release(1, 20, 4)));
        assert_eq!(braked.position.x, 2.55);
        let mut stopped = cart_at(2.5, 0.02);
        tick_minecart(&mut stopped, &world, old(release(1, 20, 4)));
        assert_eq!(stopped.velocity.x, 0.0);
    }

    #[test]
    fn a_powered_rail_starts_a_resting_cart_off_a_block() {
        let mut world = straight(30);
        powered(&mut world, (2, 0, 0), "east_west", true);
        solid(&mut world, (1, 0, 0));
        let mut cart = cart_at(2.5, 0.0);
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert_eq!(cart.velocity.x, 0.02);
    }

    #[test]
    fn a_curve_turns_the_motion() {
        let mut world = straight(3);
        rail(&mut world, (3, 0, 0), "south_west");
        rail(&mut world, (3, 0, 1), "north_south");
        solid(&mut world, (3, -1, 0));
        solid(&mut world, (3, -1, 1));
        let mut cart = cart_at(2.9, 0.3);
        let rules = old(release(1, 20, 4));
        for _ in 0..4 {
            tick_minecart(&mut cart, &world, rules);
        }
        assert_eq!(cart.position.x.floor(), 3.0);
        assert_eq!(cart.position.z.floor(), 1.0);
        assert!(cart.velocity.z > 0.0 && cart.velocity.x.abs() < 1.0e-12);
    }

    #[test]
    fn a_slope_lifts_the_cart_and_pulls_it_back() {
        let mut world = straight(2);
        rail(&mut world, (2, 0, 0), "ascending_east");
        solid(&mut world, (2, -1, 0));
        let mut cart = cart_at(2.5, 0.1);
        cart.position.y = 0.5625;
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert!(cart.position.y > 0.5625);
        assert!(cart.velocity.x < 0.1 * 0.96 - 0.0078125 * 0.9);
    }

    #[test]
    fn a_cart_runs_into_a_block_and_stops() {
        let mut world = straight(4);
        solid(&mut world, (3, 0, 0));
        let mut cart = cart_at(2.4, 0.2);
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert!(cart.position.x < 2.6);
        assert_eq!(cart.velocity.x, 0.0);
        assert!(cart.collided_horizontally);
    }

    #[test]
    fn off_the_rail_a_cart_falls_and_drags() {
        let world = WorldSnapshot::new();
        let mut cart = cart_at(0.5, 0.1);
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert!(!cart.on_rails);
        assert_eq!(cart.position.x, 0.6);
        assert_eq!(cart.velocity.x, 0.1 * 0.95);
        assert_eq!(cart.velocity.y, -0.04 * 0.95);
    }

    #[test]
    fn on_the_ground_off_a_rail_a_cart_halves_its_motion() {
        let mut world = WorldSnapshot::new();
        solid(&mut world, (0, -1, 0));
        let mut cart = cart_at(0.5, 0.2);
        cart.position.y = 0.0;
        cart.on_ground = true;
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert!(cart.on_ground);
        assert_eq!(cart.position.x, 0.6);
    }

    #[test]
    fn the_yaw_follows_the_way_and_flips_when_it_turns_back() {
        let world = straight(30);
        let mut cart = cart_at(2.5, 0.2);
        cart.y_rot = 0.0;
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert_eq!(cart.y_rot, 0.0);
        assert!(cart.flipped);
    }

    #[test]
    fn a_full_chest_cart_drags_more_than_an_empty_one() {
        let world = straight(30);
        let mut empty = cart_at(1.5, 0.1);
        empty.variant = MinecartVariant::Chest;
        tick_minecart(&mut empty, &world, old(release(1, 20, 4)));
        assert_eq!(empty.velocity.x, 0.1 * f64::from(0.98_f32 + 15.0 * 0.001_f32));
        let mut full = cart_at(1.5, 0.1);
        full.variant = MinecartVariant::Chest;
        full.comparator_signal = 15;
        tick_minecart(&mut full, &world, old(release(1, 20, 4)));
        assert_eq!(full.velocity.x, 0.1 * f64::from(0.98_f32));
        let mut unrolled = cart_at(1.5, 0.1);
        unrolled.variant = MinecartVariant::Hopper;
        unrolled.has_loot_table = true;
        tick_minecart(&mut unrolled, &world, old(release(1, 20, 4)));
        assert_eq!(unrolled.velocity.x, 0.1 * f64::from(0.98_f32));
    }

    #[test]
    fn a_rider_getting_off_pushes_its_cart_from_where_its_own_tick_takes_it() {
        let world = straight(30);
        let player = |x: f64| MinecartOther {
            position: Vec3::new(x, 0.0625, 0.5),
            bounds: Aabb::new(Vec3::new(x - 0.3, 0.0625, 0.2), Vec3::new(x + 0.3, 1.8625, 0.8)),
            pushable: true,
            living: true,
            player: true,
            passenger: true,
            rides: Some(0),
            gets_off: true,
            ..MinecartOther::default()
        };
        let ridden = || {
            let mut cart = cart_at(2.5, 0.0);
            cart.rider = Some(MinecartRider { player: true, living: true, ..MinecartRider::default() });
            cart
        };
        // from where it landed, off the cart at the player's turn
        let mut others = [player(1.9)];
        let mut carts = [ridden()];
        tick_minecarts(&mut carts, &mut others, &world, old(release(1, 20, 4)));
        assert!(carts[0].rider.is_none());
        assert_eq!((others[0].rides, others[0].passenger), (None, false));
        assert!(carts[0].velocity.x > 0.0);
        // its tick carried it out of reach, whatever the connection then snaps it back to
        let away = player(1.0);
        let mut others = [MinecartOther { tick_place: Some((away.position, away.bounds)), ..player(1.9) }];
        let mut carts = [ridden()];
        tick_minecarts(&mut carts, &mut others, &world, old(release(1, 20, 4)));
        assert_eq!(carts[0].velocity.x, 0.0);
    }

    #[test]
    fn a_furnace_cart_pushes_itself_along_and_burns_its_fuel() {
        let world = straight(30);
        let mut cart = cart_at(1.5, 0.1);
        cart.variant = MinecartVariant::Furnace;
        cart.fuel = 2;
        cart.push = Vec3::new(1.0, 0.0, 0.0);
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert_eq!(cart.velocity.x, (0.1 * 0.8 + 1.0) * 0.96);
        assert_eq!(cart.fuel, 1);
        assert_eq!(cart.push.x, 1.0);
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert_eq!(cart.fuel, 0);
        assert_eq!(cart.push, Vec3::ZERO);
    }

    #[test]
    fn the_furnace_push_drops_against_the_motion_before_1_15_2() {
        let world = straight(30);
        // (the slowdown makes a push of length 1, which a speed of 2 outruns)
        let mut cart = cart_at(1.5, 6.0);
        cart.variant = MinecartVariant::Furnace;
        cart.fuel = 100;
        cart.push = Vec3::new(-1.0, 0.0, 0.0);
        tick_minecart(&mut cart, &world, old(release(1, 15, 1)));
        assert_eq!(cart.push, Vec3::ZERO);
        let mut after = cart_at(1.5, 6.0);
        after.variant = MinecartVariant::Furnace;
        after.fuel = 100;
        after.push = Vec3::new(-1.0, 0.0, 0.0);
        tick_minecart(&mut after, &world, old(release(1, 16, 0)));
        assert!(after.push.x > 0.0);
    }

    #[test]
    fn the_furnace_push_keeps_its_length_from_1_21_2() {
        let world = straight(30);
        let mut cart = cart_at(1.5, 0.1);
        cart.variant = MinecartVariant::Furnace;
        cart.fuel = 100;
        cart.push = Vec3::new(0.5, 0.0, 0.0);
        tick_minecart(&mut cart, &world, old(release(1, 21, 2)));
        // (projected on the motion with the tick's gravity in it, which it keeps)
        assert!((cart.push.length() - 0.5).abs() < 1.0e-12);
        assert_eq!(cart.velocity.x, (0.1 * 0.8 + cart.push.x) * 0.96);
    }

    #[test]
    fn the_rider_starts_a_resting_cart_as_its_release_says() {
        let world = straight(30);
        let mut by_input = cart_at(1.5, 0.0);
        by_input.rider = Some(MinecartRider { living: true, forward: 1.0, yaw: -90.0, ..MinecartRider::default() });
        tick_minecart(&mut by_input, &world, old(release(1, 12, 2)));
        assert!(by_input.position.x > 1.5);
        // a mob's input counts no more from 1.13
        let mut mob = cart_at(1.5, 0.0);
        mob.rider = Some(MinecartRider { living: true, forward: 1.0, yaw: -90.0, ..MinecartRider::default() });
        tick_minecart(&mut mob, &world, old(release(1, 13, 2)));
        assert_eq!(mob.position.x, 1.5);
        let mut by_velocity = cart_at(1.5, 0.0);
        by_velocity.rider = Some(MinecartRider { player: true, velocity: Vec3::new(0.2, 0.0, 0.0), ..MinecartRider::default() });
        tick_minecart(&mut by_velocity, &world, old(release(1, 20, 4)));
        assert_eq!(by_velocity.position.x, 1.5 + 0.02 * 0.75);
        let mut by_intent = cart_at(1.5, 0.0);
        by_intent.rider = Some(MinecartRider { player: true, move_intent: Vec3::new(1.0, 0.0, 0.0), ..MinecartRider::default() });
        tick_minecart(&mut by_intent, &world, old(release(1, 21, 2)));
        assert_eq!(by_intent.position.x, 1.5 + 0.001 * 0.75);
    }

    #[test]
    fn a_rail_keeps_the_soul_sand_under_it_out_from_1_16() {
        let mut world = straight(30);
        let soul_sand = BlockShape { effect: crate::world::BlockEffect::SoulSand, ..BlockShape::full_block() };
        world.set_block((2, -1, 0), BlockState { shape: Some(soul_sand), ..BlockState::default() });
        let mut slowed = cart_at(2.3, 0.1);
        tick_minecart(&mut slowed, &world, old(release(1, 15, 0)));
        assert_eq!(slowed.velocity.x, 0.1 * f64::from(0.4_f32) * 0.96);
        let mut kept = cart_at(2.3, 0.1);
        tick_minecart(&mut kept, &world, old(release(1, 16, 0)));
        assert_eq!(kept.velocity.x, 0.1 * 0.96);
    }

    #[test]
    fn water_slows_the_slope_from_1_17() {
        let mut world = straight(2);
        rail(&mut world, (2, 0, 0), "ascending_east");
        solid(&mut world, (2, -1, 0));
        let slide = |at| {
            let mut cart = cart_at(2.5, 0.0);
            cart.position.y = 0.5625;
            cart.in_water = true;
            tick_minecart(&mut cart, &world, old(at));
            cart.velocity.x.abs()
        };
        assert!(slide(release(1, 17, 0)) < 0.003);
        assert!(slide(release(1, 16, 5)) > 0.007);
    }

    #[test]
    fn the_air_drag_is_a_float_again_from_26_2() {
        let world = WorldSnapshot::new();
        let fall = |at| {
            let mut cart = cart_at(0.5, 0.1);
            tick_minecart(&mut cart, &world, old(at));
            cart.velocity.x
        };
        assert_eq!(fall(release(1, 13, 2)), 0.1 * f64::from(0.95_f32));
        assert_eq!(fall(release(1, 14, 0)), 0.1 * 0.95);
        assert_eq!(fall(release(26, 1, 0)), 0.1 * 0.95);
        assert_eq!(fall(release(26, 2, 0)), 0.1 * f64::from(0.95_f32));
    }

    #[test]
    fn a_rider_still_at_its_old_place_stops_the_cart_before_1_9() {
        let world = straight(30);
        let lagging = |at| {
            let mut others = [MinecartOther {
                position: Vec3::new(4.0, 0.0625, 0.5),
                bounds: Aabb::new(Vec3::new(3.7, 0.0625, 0.2), Vec3::new(4.3, 1.8625, 0.8)),
                pushable: true,
                living: true,
                passenger: true,
                rides: Some(0),
                ..MinecartOther::default()
            }];
            let mut carts = [cart_at(3.1, 0.3)];
            carts[0].rider = Some(MinecartRider { living: true, ..MinecartRider::default() });
            tick_minecarts(&mut carts, &mut others, &world, old(at));
            carts[0].collided_horizontally
        };
        assert!(lagging(release(1, 8, 8)));
        assert!(!lagging(release(1, 9, 4)));
    }

    #[test]
    fn the_improved_cart_rests_at_the_bottom_of_a_valley() {
        let mut world = WorldSnapshot::new();
        rail(&mut world, (0, 0, 0), "ascending_west");
        rail(&mut world, (1, 0, 0), "ascending_east");
        solid(&mut world, (0, -1, 0));
        solid(&mut world, (1, -1, 0));
        let mut cart = improved_cart(0.75, 0.05);
        cart.position.y = 0.35;
        let rules = improved(8);
        for _ in 0..40 {
            tick_minecart(&mut cart, &world, rules);
        }
        assert_eq!(cart.velocity, Vec3::ZERO);
    }

    #[test]
    fn the_improved_cart_goes_through_the_block_under_its_slope() {
        // MinecartCollisionContext: the cell ahead of a slope does not stop the cart climbing out of it
        let mut world = straight(2);
        rail(&mut world, (2, 0, 0), "ascending_east");
        solid(&mut world, (2, -1, 0));
        solid(&mut world, (3, 0, 0));
        rail(&mut world, (3, 1, 0), "east_west");
        let mut cart = improved_cart(2.2, 0.3);
        cart.position.y = 0.3;
        tick_minecart(&mut cart, &world, improved(8));
        assert!(!cart.collided_horizontally, "{cart:?}");
        assert!(cart.position.x > 2.3);
    }

    #[test]
    fn a_cart_bumps_a_cart_on_its_way() {
        let world = straight(30);
        let mut carts = [cart_at(2.5, 0.2), cart_at(3.2, 0.0)];
        tick_minecarts(&mut carts, &mut [], &world, old(release(1, 20, 4)));
        assert!(carts[1].velocity.x > 0.0, "{:?}", carts[1]);
        assert!(carts[0].velocity.x < 0.2 * 0.96);
    }

    #[test]
    fn a_moving_cart_picks_a_mob_up_and_a_still_one_does_not() {
        let world = straight(30);
        let mob = |x: f64| MinecartOther {
            position: Vec3::new(x, 0.0625, 0.5),
            bounds: Aabb::new(Vec3::new(x - 0.3, 0.0625, 0.2), Vec3::new(x + 0.3, 1.8625, 0.8)),
            pushable: true,
            living: true,
            ..MinecartOther::default()
        };
        let mut others = [mob(3.2)];
        let mut carts = [cart_at(2.5, 0.25)];
        tick_minecarts(&mut carts, &mut others, &world, old(release(1, 20, 4)));
        assert_eq!(others[0].rides, Some(0));
        assert!(carts[0].rider.is_some());
        let mut others = [mob(2.9)];
        let mut carts = [cart_at(2.5, 0.0)];
        tick_minecarts(&mut carts, &mut others, &world, old(release(1, 20, 4)));
        assert_eq!(others[0].rides, None);
    }

    #[test]
    fn a_living_thing_beside_a_cart_pushes_it_after_its_tick() {
        let world = straight(30);
        let beside = MinecartOther {
            position: Vec3::new(3.0, 0.0625, 0.5),
            bounds: Aabb::new(Vec3::new(2.7, 0.0625, 0.2), Vec3::new(3.3, 1.8625, 0.8)),
            pushable: true,
            living: true,
            ..MinecartOther::default()
        };
        let mut others = [beside];
        let mut carts = [cart_at(2.5, 0.0)];
        tick_minecarts(&mut carts, &mut others, &world, old(release(1, 20, 4)));
        assert!(carts[0].velocity.x < 0.0);
        // the box of 1.8 reaches 0.2F further, and a fast cart it meets carries it off
        let far = MinecartOther {
            position: Vec3::new(4.0, 0.0625, 0.5),
            bounds: Aabb::new(Vec3::new(3.7, 0.0625, 0.2), Vec3::new(4.3, 1.8625, 0.8)),
            ..beside
        };
        let mut others = [far];
        let mut carts = [cart_at(3.0, 0.2)];
        tick_minecarts(&mut carts, &mut others, &world, old(release(1, 8, 8)));
        assert_eq!(others[0].rides, Some(0));
        let mut others = [far];
        let mut carts = [cart_at(3.0, 0.2)];
        tick_minecarts(&mut carts, &mut others, &world, old(release(1, 9, 4)));
        assert_eq!(others[0].rides, None);
    }

    #[test]
    fn a_player_shoves_a_cart_before_its_tick_only_in_1_8() {
        let world = straight(30);
        let shoved = |at| {
            let mut others = [MinecartOther {
                position: Vec3::new(3.0, 0.0625, 0.5),
                bounds: Aabb::new(Vec3::new(2.7, 0.0625, 0.2), Vec3::new(3.3, 1.8625, 0.8)),
                pushable: true,
                player: true,
                living: true,
                ..MinecartOther::default()
            }];
            let mut carts = [cart_at(2.5, 0.0)];
            tick_minecarts(&mut carts, &mut others, &world, old(at));
            carts[0].position.x
        };
        assert!(shoved(release(1, 8, 8)) < 2.5);
        assert_eq!(shoved(release(1, 9, 4)), 2.5);
    }

    /// The recording's physrec/v_boat_into_minecart: the cart spawned first, the ridden boat beside it after.
    fn boat_beside(x: f64) -> MinecartOther {
        MinecartOther {
            position: Vec3::new(x, 0.0, 0.5),
            bounds: Aabb::new(Vec3::new(x - 0.6875, 0.0, -0.1875), Vec3::new(x + 0.6875, 0.5625, 1.1875)),
            pushable: true,
            solid: true,
            boat: true,
            has_passengers: true,
            ..MinecartOther::default()
        }
    }

    fn cart_on_the_floor() -> MinecartState {
        MinecartState { on_ground: true, ..resting(MinecartVariant::Rideable, Vec3::new(33.5, 0.0, 0.5)) }
    }

    #[test]
    fn a_boat_ticking_after_the_cart_leaves_it_a_whole_entity_push() {
        let world = floor(40);
        let push = |at: MinecraftVersion| {
            let mut carts = [cart_on_the_floor()];
            let mut others = [boat_beside(32.150015071923065)];
            tick_minecarts(&mut carts, &mut others, &world, old(at));
            assert_eq!(carts[0].position.x, 33.5);
            assert_eq!(others[0].velocity, Vec3::ZERO, "a ridden boat takes nothing back");
            carts[0].velocity
        };
        assert_eq!(push(release(1, 20, 4)), Vec3::new(BOAT_PUSH_1_20_4, 0.0, 0.0));
        // (the float square root before 1.17, as the 1.13.2 recording has it)
        assert_eq!(push(release(1, 13, 2)).x, 0.050000003992758585);
        assert_eq!(push(release(1, 9, 4)).x, 0.050000003992758585);
        assert_eq!(push(release(26, 3, 0)).x, push(release(1, 20, 4)).x);
    }

    #[test]
    fn a_boat_ticking_ahead_of_the_cart_pushes_it_before_the_cart_moves() {
        let world = floor(40);
        let mut carts = [cart_on_the_floor()];
        let mut others = [MinecartOther { ticks_after: Some(0), ..boat_beside(32.150015071923065) }];
        tick_minecarts(&mut carts, &mut others, &world, old(release(1, 20, 4)));
        // (the ground halves what the push gave, and the cart moves that)
        assert_eq!(carts[0].velocity.x, BOAT_PUSH_1_20_4 * 0.5);
        assert_eq!(carts[0].position.x, 33.5 + BOAT_PUSH_1_20_4 * 0.5);
    }

    #[test]
    fn a_boat_between_two_carts_pushes_the_second_before_it_moves() {
        let world = floor(40);
        let mut carts = [resting(MinecartVariant::Rideable, Vec3::new(-3.5, 0.0, 0.5)), cart_on_the_floor()];
        carts[0].on_ground = true;
        let mut others = [MinecartOther { ticks_after: Some(1), ..boat_beside(32.150015071923065) }];
        tick_minecarts(&mut carts, &mut others, &world, old(release(1, 20, 4)));
        assert_eq!(carts[0].velocity, Vec3::ZERO);
        assert_eq!(carts[1].velocity.x, BOAT_PUSH_1_20_4 * 0.5);
    }

    #[test]
    fn a_boat_pushes_from_where_its_tick_leaves_it() {
        let world = floor(40);
        let mut carts = [cart_on_the_floor()];
        let moved = boat_beside(32.150015071923065);
        let mut others = [MinecartOther { tick_place: Some((moved.position, moved.bounds)), ..boat_beside(332.05002523908257) }];
        tick_minecarts(&mut carts, &mut others, &world, old(release(1, 20, 4)));
        assert_eq!(carts[0].velocity.x, BOAT_PUSH_1_20_4);
        assert_eq!((others[0].position, others[0].tick_place), (moved.position, None));
    }

    #[test]
    fn a_boat_short_of_its_reach_pushes_nothing() {
        let world = floor(40);
        let mut carts = [cart_on_the_floor()];
        tick_minecarts(&mut carts, &mut [boat_beside(32.05002523908257)], &world, old(release(1, 20, 4)));
        assert_eq!(carts[0].velocity, Vec3::ZERO);
    }

    #[test]
    fn up_to_1_8_a_boat_pushes_no_cart() {
        let world = floor(40);
        let mut carts = [cart_on_the_floor()];
        tick_minecarts(&mut carts, &mut [boat_beside(32.150015071923065)], &world, old(release(1, 8, 8)));
        assert_eq!(carts[0].velocity, Vec3::ZERO);
    }

    #[test]
    fn a_boat_pushes_no_cart_above_it_or_with_a_rider() {
        let world = floor(40);
        let mut above = [cart_on_the_floor()];
        above[0].position.y = 0.25;
        tick_minecarts(&mut above, &mut [boat_beside(32.150015071923065)], &world, old(release(1, 20, 4)));
        assert_eq!(above[0].velocity.x, 0.0);
        let mut ridden = [MinecartState { rider: rider(), ..cart_on_the_floor() }];
        tick_minecarts(&mut ridden, &mut [boat_beside(32.150015071923065)], &world, old(release(1, 20, 4)));
        assert_eq!(ridden[0].velocity.x, 0.0);
    }

    #[test]
    fn a_boat_nobody_rides_takes_the_push_back() {
        let world = floor(40);
        let mut carts = [cart_on_the_floor()];
        let mut others = [MinecartOther { has_passengers: false, ..boat_beside(32.150015071923065) }];
        tick_minecarts(&mut carts, &mut others, &world, old(release(1, 20, 4)));
        assert_eq!(others[0].velocity.x, -carts[0].velocity.x);
    }

    #[test]
    fn a_cart_above_a_boat_takes_nothing_in_pushing_it() {
        let world = floor(40);
        let boat = MinecartOther { has_passengers: false, ..boat_beside(32.150015071923065) };
        let pushed = |y: f64| {
            let mut carts = [MinecartState { velocity: Vec3::new(-0.2, 0.0, 0.0), ..cart_on_the_floor() }];
            carts[0].position.y = y;
            let mut others = [MinecartOther { ticks_after: Some(1), ..boat }];
            let mut items = [];
            let mut scene = Scene {
                world: &world,
                rules: old(release(1, 20, 4)),
                carts: &mut carts,
                others: &mut others,
                items: &mut items,
                containers: &mut [],
                current: 0,
                support: None,
                recorded: Vec::new(),
                old_position: Vec3::ZERO,
                old_y_rot: 0.0,
                consumed_item: false,
                tick: MinecartTick::default(),
            };
            scene.push_other(0);
            others[0].velocity.x
        };
        assert!(pushed(0.0) < 0.0);
        assert_eq!(pushed(0.25), 0.0);
    }

    #[test]
    fn a_mob_in_the_way_stops_the_move() {
        let world = straight(30);
        let mut others = [MinecartOther {
            position: Vec3::new(4.0, 0.0625, 0.5),
            bounds: Aabb::new(Vec3::new(3.7, 0.0625, 0.2), Vec3::new(4.3, 1.8625, 0.8)),
            pushable: true,
            player: true,
            living: true,
            ..MinecartOther::default()
        }];
        let mut carts = [cart_at(3.1, 0.3)];
        tick_minecarts(&mut carts, &mut others, &world, old(release(1, 20, 4)));
        assert!(carts[0].position.x + f64::from(HALF_WIDTH) <= 3.7 + 1.0e-7, "{:?}", carts[0]);
        assert!(carts[0].collided_horizontally);
    }

    #[test]
    fn an_entity_pushes_a_cart_harder_than_it_is_pushed_back() {
        let mut cart = cart_at(2.5, 0.0);
        let mut other = MinecartOther { position: Vec3::new(3.0, 0.0625, 0.5), ..MinecartOther::default() };
        push_minecart(&mut cart, &mut other, release(1, 20, 4));
        assert!(cart.velocity.x < 0.0);
        assert_eq!(other.velocity.x, -cart.velocity.x / 4.0);
    }

    #[test]
    fn the_activator_rail_throws_the_rider_off() {
        let mut world = straight(30);
        world.set_block((2, 0, 0), BlockState { tags: TAG_RAIL | TAG_ACTIVATOR_RAIL, ..BlockState::default() });
        world.set_block_properties((2, 0, 0), vec![
            ("shape".to_owned(), "east_west".to_owned()),
            ("powered".to_owned(), "true".to_owned()),
        ]);
        let mut cart = cart_at(2.5, 0.0);
        cart.rider = rider();
        let tick = tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert_eq!(tick.activator, Some(true));
        assert!(cart.rider.is_none());
        // and what it threw off is no rider any more: on foot it shoves the cart, whose tick it was in
        let mut carts = [cart_at(2.5, 0.0)];
        carts[0].rider = rider();
        let mut others = [MinecartOther {
            position: Vec3::new(2.0, 0.0625, 0.5),
            bounds: Aabb::new(Vec3::new(1.7, 0.0625, 0.2), Vec3::new(2.3, 1.8625, 0.8)),
            pushable: true,
            player: true,
            living: true,
            passenger: true,
            rides: Some(0),
            ..MinecartOther::default()
        }];
        tick_minecarts(&mut carts, &mut others, &world, old(release(1, 20, 4)));
        assert_eq!(others[0].rides, None);
        assert!(carts[0].velocity.x > 0.0);
    }

    fn improved_cart(x: f64, velocity: f64) -> MinecartState {
        MinecartState {
            position: Vec3::new(x, 0.1, 0.5),
            velocity: Vec3::new(velocity, 0.0, 0.0),
            on_rails: true,
            ..MinecartState::default()
        }
    }

    #[test]
    fn the_improved_cart_rides_above_its_rail_and_steps_for_the_client() {
        let world = straight(30);
        let mut cart = improved_cart(1.5, 0.1);
        let tick = tick_minecart(&mut cart, &world, improved(8));
        assert_eq!(cart.position.y, 0.1);
        assert_eq!(cart.velocity.x, 0.1 * 0.975);
        assert!((cart.position.x - (1.5 + 0.1 * 0.975)).abs() < 1.0e-9);
        assert_eq!(tick.steps.len(), 1);
        assert_eq!(tick.steps[0].position, cart.position);
    }

    #[test]
    fn the_improved_top_speed_is_the_game_rule() {
        let world = straight(40);
        let mut slow = improved_cart(1.5, 5.0);
        tick_minecart(&mut slow, &world, improved(8));
        assert!((slow.velocity.x - 0.4).abs() < 1.0e-12);
        let mut fast = improved_cart(1.5, 5.0);
        tick_minecart(&mut fast, &world, improved(40));
        assert!((fast.velocity.x - 2.0).abs() < 1.0e-12);
        assert!((fast.position.x - 3.5).abs() < 1.0e-9, "{:?}", fast);
    }

    #[test]
    fn the_improved_cart_crosses_blocks_within_a_tick() {
        let mut world = straight(40);
        powered(&mut world, (2, 0, 0), "east_west", true);
        let mut cart = improved_cart(1.9, 0.5);
        let tick = tick_minecart(&mut cart, &world, improved(40));
        assert!(tick.steps.len() >= 2, "{tick:?}");
        assert!((cart.velocity.x - (0.5 * 0.975 + 0.06)).abs() < 1.0e-9);
    }

    #[test]
    fn the_improved_cart_settles_onto_its_rail_on_its_first_tick() {
        let world = straight(30);
        let mut cart = cart_at(1.5, 0.0);
        cart.position.y = 0.0;
        cart.first_tick = true;
        let tick = tick_minecart(&mut cart, &world, improved(8));
        assert_eq!(cart.position, Vec3::new(1.5, 0.1, 0.5));
        assert!(cart.on_rails && !cart.first_tick);
        assert_eq!(tick.steps[0].weight, 0.0);
    }

    #[test]
    fn the_improved_slide_grows_with_the_speed() {
        let mut world = straight(2);
        rail(&mut world, (2, 0, 0), "ascending_east");
        solid(&mut world, (2, -1, 0));
        let mut cart = improved_cart(2.5, 1.0);
        cart.position.y = 0.6;
        tick_minecart(&mut cart, &world, improved(40));
        assert!(cart.position.x > 2.5 && cart.position.y > 0.6);
        assert!(cart.velocity.horizontal_length() < 0.975);
    }

    #[test]
    fn the_client_old_path_goes_a_share_of_the_way_each_tick() {
        let mut cart = MinecartClientLerp {
            steps: 2,
            target: Vec3::new(1.0, 0.0, 0.0),
            target_y_rot: 170.0,
            y_rot: -170.0,
            ..MinecartClientLerp::default()
        };
        let at = release(26, 3, 0);
        tick_client_linear(&mut cart, at);
        assert_eq!(cart.position.x, 0.5);
        assert_eq!(cart.y_rot, -180.0);
        tick_client_linear(&mut cart, at);
        assert_eq!(cart.position.x, 1.0);
        assert_eq!(cart.steps, 0);
        tick_client_linear(&mut cart, at);
        assert_eq!(cart.position.x, 1.0);
        // (until 1.20.2 it divides by the steps: the rounding of a third is not the same)
        let third = |at| {
            let mut cart = MinecartClientLerp { position: Vec3::new(0.7, 0.0, 0.0), steps: 3, target: Vec3::new(1.9, 0.0, 0.0), ..MinecartClientLerp::default() };
            tick_client_linear(&mut cart, at);
            cart.position.x
        };
        assert_eq!(third(release(1, 20, 1)), 0.7 + (1.9 - 0.7) / 3.0);
        assert_eq!(third(release(1, 20, 2)), 0.7 + (1.0 / 3.0) * (1.9 - 0.7));
    }

    #[test]
    fn the_client_steps_weigh_the_way_over_three_ticks() {
        let step = |x: f64, weight: f32| MinecartStep { position: Vec3::new(x, 0.0, 0.0), weight, ..MinecartStep::default() };
        let mut cart = MinecartClientSteps {
            pending: vec![step(1.0, 1.0), step(3.0, 2.0)],
            ..MinecartClientSteps::default()
        };
        let near = |x: f64, want: f64| assert!((x - want).abs() < 1.0e-6, "{x} {want}");
        tick_client_weighted(&mut cart);
        near(cart.position.x, 1.0);
        tick_client_weighted(&mut cart);
        near(cart.position.x, 2.0);
        tick_client_weighted(&mut cart);
        near(cart.position.x, 3.0);
        assert_eq!(cart.delay, 1);
        tick_client_weighted(&mut cart);
        near(cart.position.x, 3.0);
        assert!(cart.current.is_empty());
    }

    // The side effects.

    fn passable(world: &mut WorldSnapshot, at: BlockPosition, effect: BlockEffect) {
        world.set_block(at, BlockState {
            shape: Some(BlockShape { bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO), effect, ..BlockShape::full_block() }),
            ..BlockState::default()
        });
    }

    fn lava(world: &mut WorldSnapshot, at: BlockPosition) {
        world.set_block(at, BlockState { fluid: FluidState::Lava, fluid_source: true, ..BlockState::default() });
    }

    fn activator(world: &mut WorldSnapshot, at: BlockPosition, on: bool) {
        world.set_block(at, BlockState { tags: TAG_RAIL | TAG_ACTIVATOR_RAIL, ..BlockState::default() });
        world.set_block_properties(at, vec![
            ("shape".to_owned(), "east_west".to_owned()),
            ("powered".to_owned(), on.to_string()),
        ]);
    }

    fn floor(size: i32) -> WorldSnapshot {
        let mut world = WorldSnapshot::new();
        for x in -size..size {
            for z in -size..size {
                solid(&mut world, (x, -1, z));
            }
        }
        world
    }

    fn resting(variant: MinecartVariant, position: Vec3) -> MinecartState {
        MinecartState { variant, position, on_ground: true, random_seed: 42, ..MinecartState::default() }
    }

    fn tnt_on_rail(x: f64, velocity: f64) -> MinecartState {
        MinecartState { variant: MinecartVariant::Tnt, random_seed: 42, ..cart_at(x, velocity) }
    }

    fn hurt(kind: MinecartDamage, amount: f32) -> MinecartHurt {
        MinecartHurt { kind, amount, creative: false, burning_arrow: None }
    }

    #[test]
    fn an_entity_draws_as_java_does() {
        // java.util.Random with its raw state at 42, worked out apart: (x * 0x5DEECE66D + 11) mod 2^48
        let mut random = EntityRandom(42);
        assert_eq!(random.next_int(20), 6);
        assert_eq!(random.next_int(20), 19);
        assert_eq!(random.0, 197_491_923_327_988);
        let mut random = EntityRandom(42);
        assert_eq!(random.next_double(), 0.0037624195461311016);
        assert_eq!(EntityRandom(123_456_789_012).next_double(), 0.8579115295862211);
    }

    #[test]
    fn a_powered_activator_rail_hurts_a_rideable_cart_once_and_breaks_nothing() {
        let mut world = straight(30);
        activator(&mut world, (2, 0, 0), true);
        let rules = old(release(1, 20, 4));
        let mut cart = MinecartState { damage: 3.0, ..cart_at(2.5, 0.0) };
        let tick = tick_minecart(&mut cart, &world, rules);
        assert_eq!(tick.activator, Some(true));
        assert_eq!((cart.hurt_time, cart.hurt_dir, cart.damage), (10, -1, 50.0));
        tick_minecart(&mut cart, &world, rules);
        // the next tick's hurt time is left of the first: no second hurt until it has run out
        assert_eq!((cart.hurt_time, cart.hurt_dir, cart.damage), (9, -1, 49.0));
        assert_eq!(cart.removed, None);
        let mut off = cart_at(2.5, 0.0);
        let mut unpowered = world.clone();
        activator(&mut unpowered, (2, 0, 0), false);
        tick_minecart(&mut off, &unpowered, rules);
        assert_eq!((off.hurt_time, off.damage), (0, 0.0));
        // it is the rideable cart's: a chest cart takes none of it
        let mut chest = MinecartState { variant: MinecartVariant::Chest, ..cart_at(2.5, 0.0) };
        tick_minecart(&mut chest, &world, rules);
        assert_eq!((chest.hurt_time, chest.damage), (0, 0.0));
    }

    #[test]
    fn hurt_time_and_damage_run_down_each_tick() {
        let world = straight(30);
        let mut cart = MinecartState { hurt_time: 2, damage: 1.5, ..cart_at(1.5, 0.0) };
        let rules = old(release(26, 3, 0));
        tick_minecart(&mut cart, &world, rules);
        assert_eq!((cart.hurt_time, cart.damage), (1, 0.5));
        tick_minecart(&mut cart, &world, rules);
        assert_eq!((cart.hurt_time, cart.damage), (0, -0.5));
        tick_minecart(&mut cart, &world, rules);
        assert_eq!((cart.hurt_time, cart.damage), (0, -0.5));
    }

    #[test]
    fn an_activator_rail_primes_a_tnt_cart_which_then_counts_down_and_goes_off() {
        let mut world = straight(30);
        activator(&mut world, (2, 0, 0), true);
        let rules = old(release(1, 20, 4));
        let mut cart = tnt_on_rail(2.5, 0.0);
        let tick = tick_minecart(&mut cart, &world, rules);
        assert!(tick.primed);
        // primed in the tick's move, and its tail counts it off
        assert_eq!(cart.fuse, 79);
        let tick = tick_minecart(&mut cart, &world, rules);
        assert!(!tick.primed);
        assert_eq!(cart.fuse, 78);
        cart.fuse = 0;
        let tick = tick_minecart(&mut cart, &world, rules);
        assert_eq!(cart.removed, Some(MinecartRemoval::Exploded));
        // at rest: nothing of its speed, 4 as a float
        assert_eq!(tick.explosions.len(), 1);
        assert_eq!(tick.explosions[0].power, 4.0);
        assert_eq!(tick.explosions[0].position, cart.position);
        let mut unpowered = world.clone();
        activator(&mut unpowered, (2, 0, 0), false);
        let mut off = tnt_on_rail(2.5, 0.0);
        tick_minecart(&mut off, &unpowered, rules);
        assert_eq!(off.fuse, -1);
    }

    #[test]
    fn a_tnt_carts_blast_grows_with_its_speed_by_its_random() {
        let world = straight(30);
        let mut cart = MinecartState { fuse: 0, ..tnt_on_rail(1.5, 0.2) };
        let tick = tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        let speed = cart.velocity.horizontal_length();
        let want = (4.0 + 0.0037624195461311016 * 1.5 * speed) as f32;
        assert_eq!(tick.explosions[0].power, want);
        assert_eq!(cart.random_seed, 197_491_923_327_988);
    }

    #[test]
    fn a_tnt_cart_goes_off_against_a_wall_only_at_speed() {
        // a box moving along the wall as well keeps speed through the collision
        let mut world = floor(8);
        solid(&mut world, (3, 0, 0));
        solid(&mut world, (3, 0, 1));
        solid(&mut world, (3, 0, -1));
        let rules = old(release(1, 20, 4));
        let mut fast = resting(MinecartVariant::Tnt, Vec3::new(2.3, 0.0, 0.5));
        fast.on_ground = false;
        fast.velocity = Vec3::new(0.3, 0.0, 0.3);
        let tick = tick_minecart(&mut fast, &world, rules);
        assert!(fast.collided_horizontally);
        assert_eq!(tick.explosions.len(), 1);
        assert_eq!(fast.removed, Some(MinecartRemoval::Exploded));
        let mut slow = resting(MinecartVariant::Tnt, Vec3::new(2.3, 0.0, 0.5));
        slow.on_ground = false;
        slow.velocity = Vec3::new(0.3, 0.0, 0.01);
        let tick = tick_minecart(&mut slow, &world, rules);
        assert!(slow.collided_horizontally);
        assert!(tick.explosions.is_empty());
    }

    #[test]
    fn a_tnt_cart_goes_off_on_landing_from_three_blocks() {
        let world = floor(8);
        let drop = |release: MinecraftVersion, fall: f64| {
            let mut cart = resting(MinecartVariant::Tnt, Vec3::new(0.5, 0.02, 0.5));
            cart.on_ground = false;
            cart.velocity = Vec3::new(0.0, -0.1, 0.0);
            cart.fall_distance = fall;
            (tick_minecart(&mut cart, &world, old(release)), cart)
        };
        let (tick, cart) = drop(release(1, 20, 4), 2.9);
        assert!(tick.explosions.is_empty());
        assert_eq!(cart.removed, None);
        assert_eq!(cart.fall_distance, 0.0);
        let (tick, cart) = drop(release(1, 20, 4), 3.0);
        assert_eq!(cart.removed, Some(MinecartRemoval::Exploded));
        // (fall / 10 squared, as the floats it was until 1.21.5; its square root the speed. The last
        // move's height is not counted: Entity.fall takes the fall or the landing)
        let power = 3.0_f32 / 10.0;
        let speed = f64::from(power * power).sqrt();
        assert_eq!(tick.explosions[0].power, (4.0 + 0.0037624195461311016 * 1.5 * speed) as f32);
    }

    #[test]
    fn a_bed_halves_the_fall_a_tnt_cart_goes_off_by() {
        let mut world = floor(8);
        world.set_block((0, -1, 0), BlockState {
            shape: Some(BlockShape { effect: BlockEffect::Bed, ..BlockShape::full_block() }),
            ..BlockState::default()
        });
        let drop = |release: MinecraftVersion| {
            let mut cart = resting(MinecartVariant::Tnt, Vec3::new(0.5, 0.02, 0.5));
            cart.on_ground = false;
            cart.velocity = Vec3::new(0.0, -0.1, 0.0);
            cart.fall_distance = 4.0;
            tick_minecart(&mut cart, &world, old(release));
            cart.removed
        };
        assert_eq!(drop(release(1, 20, 4)), None);
        assert_eq!(drop(release(1, 11, 2)), Some(MinecartRemoval::Exploded));
    }

    #[test]
    fn fire_sets_a_tnt_cart_off_by_the_releases_way() {
        let world = straight(8);
        let burn = |version: MinecraftVersion, speed: f64, damage: f32| {
            let mut cart = MinecartState { damage, ..tnt_on_rail(1.5, speed) };
            let tick = hurt_minecart(&mut cart, &mut [], hurt(MinecartDamage::Fire, 1.0), &world, old(version));
            (cart, tick)
        };
        // before 1.12 at once, past the 40 of damage
        let (cart, tick) = burn(release(1, 11, 2), 0.0, 35.0);
        assert_eq!((cart.removed, tick.explosions.len()), (Some(MinecartRemoval::Exploded), 1));
        // from 1.12 by a fuse of two draws of its random, still there
        let (cart, tick) = burn(release(1, 12, 2), 0.0, 35.0);
        assert_eq!((cart.removed, cart.fuse, tick.primed), (None, 6 + 19, true));
        assert_eq!(cart.random_seed, 197_491_923_327_988);
        // not until it is beaten before 1.20.3
        let (cart, _) = burn(release(1, 20, 2), 0.0, 0.0);
        assert_eq!((cart.fuse, cart.damage, cart.hurt_time), (-1, 10.0, 10));
        // from 1.20.3 the first fire does it
        let (cart, tick) = burn(release(1, 20, 3), 0.0, 0.0);
        assert_eq!((cart.fuse, tick.primed), (25, true));
        // a fuse once lit is not lit again, and burns on
        let mut lit = MinecartState { fuse: 7, ..tnt_on_rail(1.5, 0.0) };
        hurt_minecart(&mut lit, &mut [], hurt(MinecartDamage::Fire, 1.0), &world, old(release(1, 20, 4)));
        assert_eq!((lit.fuse, lit.random_seed), (7, 42));
    }

    #[test]
    fn a_plain_hit_breaks_a_still_tnt_cart_and_sets_off_a_moving_one() {
        let world = straight(8);
        let hit = |speed: f64| {
            let mut cart = MinecartState { damage: 35.0, ..tnt_on_rail(1.5, speed) };
            hurt_minecart(&mut cart, &mut [], hurt(MinecartDamage::Plain, 1.0), &world, old(release(1, 20, 4)));
            cart
        };
        let still = hit(0.0);
        assert_eq!((still.removed, still.fuse), (Some(MinecartRemoval::Destroyed), -1));
        let moving = hit(0.2);
        assert_eq!((moving.removed, moving.fuse), (None, 25));
    }

    #[test]
    fn a_burning_arrow_sets_a_tnt_cart_off_at_once() {
        let world = straight(8);
        let mut cart = tnt_on_rail(1.5, 0.0);
        let arrow = MinecartHurt { burning_arrow: Some(4.0), ..hurt(MinecartDamage::Plain, 1.0) };
        let tick = hurt_minecart(&mut cart, &mut [], arrow, &world, old(release(1, 8, 8)));
        assert_eq!(cart.removed, Some(MinecartRemoval::Exploded));
        assert_eq!(tick.explosions[0].power, (4.0 + 0.0037624195461311016 * 1.5 * 2.0) as f32);
    }

    #[test]
    fn a_creative_hit_takes_a_cart_away_with_no_drop() {
        let world = straight(8);
        for version in [release(1, 8, 8), release(1, 20, 4), release(26, 3, 0)] {
            let mut cart = cart_at(1.5, 0.0);
            let creative = MinecartHurt { creative: true, ..hurt(MinecartDamage::Plain, 1.0) };
            hurt_minecart(&mut cart, &mut [], creative, &world, old(version));
            assert_eq!(cart.removed, Some(MinecartRemoval::Discarded), "{version}");
        }
    }

    #[test]
    fn a_rider_thrown_off_in_the_tick_rides_through_it_before_1_9() {
        // the 0.75 of a move with a passenger: 1.8.8 mc_ride_activator t=26 moves 0.1394 at a motion of 0.1858
        let world = straight(8);
        let moved = |version: MinecraftVersion, world: &WorldSnapshot| {
            let mut cart = cart_at(2.5, 0.2);
            cart.rider = Some(MinecartRider { player: true, living: true, ..MinecartRider::default() });
            let mut carts = [cart];
            let mut others = [MinecartOther { rides: Some(0), passenger: true, gets_off: true, player: true, living: true, pushable: true, ..MinecartOther::default() }];
            tick_minecarts_among(&mut carts, &mut others, &mut [], &mut [], world, old(version));
            (carts[0].position.x - 2.5, others[0].gets_off)
        };
        let (old_move, waits) = moved(release(1, 8, 8), &world);
        assert!(waits, "the turn waits for the next tick");
        let (new_move, _) = moved(release(1, 9, 4), &world);
        assert!(old_move < 0.2 * 0.8, "{old_move}");
        assert!(new_move > 0.0);
    }

    #[test]
    fn hits_add_up_past_forty_and_the_rider_gets_off() {
        let world = straight(8);
        let mut others = [MinecartOther { rides: Some(0), passenger: true, ..MinecartOther::default() }];
        let mut cart = MinecartState { rider: Some(MinecartRider::default()), ..cart_at(1.5, 0.0) };
        let rules = old(release(1, 20, 4));
        hurt_minecart(&mut cart, &mut others, hurt(MinecartDamage::Plain, 4.0), &world, rules);
        assert_eq!((cart.damage, cart.hurt_dir, cart.removed), (40.0, -1, None));
        hurt_minecart(&mut cart, &mut others, hurt(MinecartDamage::Plain, 0.5), &world, rules);
        assert_eq!((cart.hurt_dir, cart.removed), (1, Some(MinecartRemoval::Destroyed)));
        assert_eq!((others[0].rides, others[0].passenger), (None, false));
    }

    #[test]
    fn the_game_rule_stops_a_tnt_cart() {
        let mut world = straight(8);
        activator(&mut world, (2, 0, 0), true);
        let rules = old(release(1, 21, 5)).in_level(0, false);
        let mut cart = tnt_on_rail(2.5, 0.0);
        tick_minecart(&mut cart, &world, rules);
        assert_eq!(cart.fuse, -1);
        // what was lit before the rule goes without a blast
        let mut lit = MinecartState { fuse: 0, ..tnt_on_rail(2.5, 0.0) };
        let tick = tick_minecart(&mut lit, &world, rules);
        assert!(tick.explosions.is_empty());
        assert_eq!(lit.removed, Some(MinecartRemoval::Discarded));
        // and nothing happens to one that was not, as no release before it had the rule to ask
        let mut plain = MinecartState { fuse: 0, ..tnt_on_rail(2.5, 0.0) };
        let before = old(release(1, 21, 4)).in_level(0, false);
        assert_eq!(tick_minecart(&mut plain, &world, before).explosions.len(), 1);
    }

    fn stone(count: i32) -> MinecartStack {
        MinecartStack { item: 1, count, max_stack: 64 }
    }

    fn hopper(x: f64) -> MinecartState {
        MinecartState { variant: MinecartVariant::Hopper, ..cart_at(x, 0.0) }
    }

    fn item_at(x: f64, y: f64, stack: MinecartStack) -> MinecartItem {
        MinecartItem {
            bounds: Aabb::new(Vec3::new(x - 0.125, y, 0.375), Vec3::new(x + 0.125, y + 0.25, 0.625)),
            stack,
        }
    }

    fn tick_hopper(cart: &mut MinecartState, items: &mut [MinecartItem], world: &WorldSnapshot, version: MinecraftVersion) {
        tick_minecarts_among(std::slice::from_mut(cart), &mut [], items, &mut [], world, old(version));
    }

    #[test]
    fn a_hopper_cart_takes_an_item_and_grows_heavier_by_it() {
        let world = straight(8);
        let mut cart = hopper(1.5);
        let mut items = [item_at(1.5, 0.0625, stone(3))];
        tick_hopper(&mut cart, &mut items, &world, release(1, 20, 4));
        assert_eq!(items[0].stack.count, 0);
        assert_eq!(cart.inventory[0], stone(3));
        // 3/64 of one of five slots: floor(14 * 0.009375) + 1
        assert_eq!(cart.comparator_signal, 1);
        // a stack that is gone is no longer there to take
        let mut again = hopper(1.5);
        tick_hopper(&mut again, &mut items, &world, release(1, 20, 4));
        assert_eq!(again.inventory[0].count, 0);
    }

    #[test]
    fn a_comparator_reads_a_hopper_carts_stacks() {
        let mut slots = [MinecartStack::default(); 5];
        assert_eq!(comparator_signal(&slots), 0);
        slots[0] = stone(64);
        slots[1] = stone(64);
        assert_eq!(comparator_signal(&slots), 6);
        slots[2] = MinecartStack { item: 2, count: 1, max_stack: 1 };
        slots[3] = stone(64);
        slots[4] = stone(64);
        assert_eq!(comparator_signal(&slots), 15);
    }

    #[test]
    fn a_hopper_cart_takes_part_of_a_stack_and_tries_the_next_item() {
        let world = straight(8);
        let mut cart = hopper(1.5);
        cart.inventory = [stone(62), MinecartStack { item: 2, count: 64, max_stack: 64 }, MinecartStack { item: 2, count: 64, max_stack: 64 }, MinecartStack { item: 2, count: 64, max_stack: 64 }, MinecartStack { item: 2, count: 64, max_stack: 64 }];
        let mut items = [item_at(1.5, 0.0625, stone(5)), item_at(1.5, 0.0625, MinecartStack { item: 2, count: 1, max_stack: 64 })];
        tick_hopper(&mut cart, &mut items, &world, release(1, 20, 4));
        assert_eq!(cart.inventory[0].count, 64);
        // the rest stays where it is, and addItem said nothing went: the second cannot go in either
        assert_eq!(items[0].stack.count, 3);
        assert_eq!(items[1].stack.count, 1);
    }

    #[test]
    fn a_hopper_cart_merges_only_the_same_item() {
        let world = straight(8);
        let mut cart = hopper(1.5);
        cart.inventory[0] = MinecartStack { item: 2, count: 1, max_stack: 64 };
        let mut items = [item_at(1.5, 0.0625, stone(2))];
        tick_hopper(&mut cart, &mut items, &world, release(1, 20, 4));
        assert_eq!(cart.inventory[0].count, 1);
        assert_eq!(cart.inventory[1], stone(2));
    }

    #[test]
    fn a_hopper_cart_stopped_by_the_rail_takes_nothing_until_an_unpowered_one() {
        let mut world = straight(8);
        activator(&mut world, (2, 0, 0), true);
        let mut cart = hopper(2.5);
        let mut items = [item_at(2.5, 0.0625, stone(3))];
        tick_hopper(&mut cart, &mut items, &world, release(1, 20, 4));
        assert!(!cart.enabled);
        assert_eq!(items[0].stack.count, 3);
        activator(&mut world, (2, 0, 0), false);
        tick_hopper(&mut cart, &mut items, &world, release(1, 20, 4));
        assert!(cart.enabled);
        assert_eq!(items[0].stack.count, 0);
    }

    #[test]
    fn a_hopper_carts_draw_box_goes_by_the_release() {
        let world = straight(8);
        // over its top at the height of each release's box, and out of reach of the 0.25 around it
        let takes = |version: MinecraftVersion, y: f64| {
            let mut cart = hopper(1.5);
            let mut items = [item_at(1.5, y, stone(1))];
            tick_hopper(&mut cart, &mut items, &world, version);
            items[0].stack.count == 0
        };
        let above = 0.0625 + 0.7 + 0.01;
        // (1.8.9: from a block up; 1.9: from half a block; 1.13 on: from 11/16)
        assert!(!takes(release(1, 8, 8), above));
        assert!(takes(release(1, 9, 4), above));
        assert!(takes(release(1, 20, 4), above));
        let high = 0.0625 + 1.9;
        assert!(takes(release(1, 8, 8), high));
        assert!(takes(release(26, 3, 0), high));
        assert!(!takes(release(26, 3, 0), 0.0625 + 2.1));
        // the inside box is narrower than the block's until 1.20.5
        let beside = |version: MinecraftVersion| {
            let mut cart = hopper(1.5);
            let mut items = [MinecartItem {
                bounds: Aabb::new(Vec3::new(1.5 + 0.40, 0.8, 0.5), Vec3::new(1.5 + 0.45, 0.9, 0.6)),
                stack: stone(1),
            }];
            tick_hopper(&mut cart, &mut items, &world, version);
            items[0].stack.count == 0
        };
        assert!(!beside(release(1, 20, 4)));
        assert!(beside(release(1, 20, 5)));
    }

    #[test]
    fn a_hopper_cart_took_only_the_first_item_about_it_until_1_20() {
        let world = straight(8);
        // out of the box over it, in the 0.25 around it
        let beside = |stack| MinecartItem {
            bounds: Aabb::new(Vec3::new(1.5, 0.0625, 0.5 + 0.6), Vec3::new(1.6, 0.1, 0.5 + 0.7)),
            stack,
        };
        let full = MinecartStack { item: 2, count: 64, max_stack: 64 };
        let run = |version: MinecraftVersion| {
            let mut cart = hopper(1.5);
            cart.inventory = [full, full, full, full, stone(1)];
            let mut items = [beside(full), beside(stone(2))];
            tick_hopper(&mut cart, &mut items, &world, version);
            items[1].stack.count
        };
        assert_eq!(run(release(1, 19, 4)), 2);
        assert_eq!(run(release(1, 20, 0)), 0);
    }

    #[test]
    fn a_container_over_a_hopper_cart_gives_one_item_and_hides_the_items_there() {
        let world = straight(8);
        let mut cart = hopper(1.5);
        let mut items = [item_at(1.5, 1.0, stone(1))];
        let mut containers = [MinecartContainer { position: (1, 1, 0), slots: vec![MinecartStack::default(), stone(5)] }];
        tick_minecarts_among(std::slice::from_mut(&mut cart), &mut [], &mut items, &mut containers, &world, old(release(1, 20, 4)));
        assert_eq!(cart.inventory[0], stone(1));
        assert_eq!(containers[0].slots[1].count, 4);
        assert_eq!(items[0].stack.count, 1);
    }

    #[test]
    fn a_hopper_cart_takes_once_a_tick_though_it_steps_many_times() {
        let world = straight(30);
        let mut cart = MinecartState { variant: MinecartVariant::Hopper, ..cart_at(1.5, 0.3) };
        cart.position.y = 0.1;
        cart.on_rails = true;
        let mut items = [item_at(2.2, 0.1, stone(1)), item_at(2.3, 0.1, stone(1))];
        tick_minecarts_among(std::slice::from_mut(&mut cart), &mut [], &mut items, &mut [], &world, improved(8));
        assert_eq!(items.iter().filter(|item| item.stack.count == 0).count(), 1);
    }

    #[test]
    fn a_command_block_cart_runs_its_command_four_ticks_apart() {
        let mut world = straight(8);
        activator(&mut world, (2, 0, 0), true);
        let rules = old(release(1, 20, 4));
        let mut cart = MinecartState { variant: MinecartVariant::CommandBlock, tick_count: 100, ..cart_at(2.5, 0.0) };
        let runs: Vec<bool> = (0..6).map(|_| tick_minecart(&mut cart, &world, rules).command_ran).collect();
        assert_eq!(runs, [true, false, false, false, true, false]);
        assert_eq!(cart.last_activated, 105);
        activator(&mut world, (2, 0, 0), false);
        let mut off = MinecartState { variant: MinecartVariant::CommandBlock, tick_count: 100, ..cart_at(2.5, 0.0) };
        assert!(!tick_minecart(&mut off, &world, rules).command_ran);
    }

    fn fire_floor() -> WorldSnapshot {
        let mut world = floor(8);
        passable(&mut world, (0, 0, 0), BlockEffect::Fire);
        world
    }

    fn cart_in_cell() -> MinecartState {
        resting(MinecartVariant::Rideable, Vec3::new(0.5, 0.0, 0.5))
    }

    #[test]
    fn fire_burns_a_cart_once_a_move_before_1_16_and_once_a_pass_after() {
        let world = fire_floor();
        let damage = |version: MinecraftVersion| {
            let mut cart = cart_in_cell();
            tick_minecart(&mut cart, &world, old(version));
            cart.damage
        };
        // a move's burn of 1 is 10
        assert_eq!(damage(release(1, 8, 8)), 10.0);
        assert_eq!(damage(release(1, 15, 2)), 10.0);
        // the move's checkInsideBlocks, and the tick's own
        assert_eq!(damage(release(1, 16, 5)), 20.0);
        assert_eq!(damage(release(1, 21, 1)), 20.0);
        assert_eq!(damage(release(26, 3, 0)), 20.0);
    }

    #[test]
    fn soul_fire_burns_double() {
        let mut world = floor(8);
        passable(&mut world, (0, 0, 0), BlockEffect::SoulFire);
        let mut cart = cart_in_cell();
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert_eq!(cart.damage, 40.0);
    }

    #[test]
    fn a_cart_left_in_fire_breaks() {
        let world = fire_floor();
        let mut cart = cart_in_cell();
        let rules = old(release(1, 20, 4));
        let mut ticks = 0;
        while cart.removed.is_none() {
            tick_minecart(&mut cart, &world, rules);
            ticks += 1;
            assert!(ticks < 10);
        }
        assert_eq!(cart.removed, Some(MinecartRemoval::Destroyed));
        assert_eq!(ticks, 3);
    }

    #[test]
    fn a_cactus_hurts_a_cart_and_magma_does_not() {
        let mut world = floor(8);
        passable(&mut world, (0, 0, 0), BlockEffect::Cactus);
        let mut cart = cart_in_cell();
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert_eq!(cart.damage, 20.0);
        let mut hot = floor(8);
        hot.set_block((0, -1, 0), BlockState {
            shape: Some(BlockShape { effect: BlockEffect::Magma, ..BlockShape::full_block() }),
            ..BlockState::default()
        });
        let mut cart = cart_in_cell();
        tick_minecart(&mut cart, &hot, old(release(1, 20, 4)));
        assert_eq!(cart.damage, 0.0);
    }

    #[test]
    fn lava_hurts_a_cart_by_the_releases_way() {
        let mut world = floor(8);
        lava(&mut world, (0, 0, 0));
        let damage = |version: MinecraftVersion| {
            let mut cart = cart_in_cell();
            tick_minecart(&mut cart, &world, old(version));
            cart.damage
        };
        // Entity.move's fire test, for its lava too
        assert_eq!(damage(release(1, 15, 2)), 10.0);
        // 1.16 dropped that and has no test of a cart's own
        assert_eq!(damage(release(1, 16, 1)), 0.0);
        // AbstractMinecart.tick's, of 4, from 1.16.2
        assert_eq!(damage(release(1, 16, 2)), 40.0);
        assert_eq!(damage(release(1, 17, 0)), 40.0);
        assert_eq!(damage(release(1, 21, 4)), 40.0);
    }

    #[test]
    fn a_cart_in_lava_goes_in_two_ticks_and_halves_its_fall() {
        let mut world = floor(8);
        lava(&mut world, (0, 0, 0));
        let rules = old(release(1, 20, 4));
        let mut cart = MinecartState { fall_distance: 2.0, ..cart_in_cell() };
        tick_minecart(&mut cart, &world, rules);
        assert_eq!((cart.removed, cart.fall_distance), (None, 0.0));
        tick_minecart(&mut cart, &world, rules);
        assert_eq!(cart.removed, Some(MinecartRemoval::Destroyed));
        // falling in, it keeps half of what it fell
        let mut cart = MinecartState { fall_distance: 2.0, on_ground: false, ..cart_in_cell() };
        cart.position.y = 0.5;
        tick_minecart(&mut cart, &world, rules);
        assert_eq!(cart.fall_distance, f64::from((2.0_f32 + (0.04_f64 as f32)) * 0.5));
    }

    #[test]
    fn lava_draws_the_sound_of_its_hurt_from_a_carts_random() {
        let mut world = floor(8);
        lava(&mut world, (0, 0, 0));
        let mut cart = MinecartState { random_seed: 42, ..cart_in_cell() };
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        let mut random = EntityRandom(42);
        random.next_float();
        assert_eq!(cart.random_seed, random.0);
    }

    #[test]
    fn lava_in_the_blocks_of_a_move_hurts_as_well_from_1_21_5() {
        let mut world = floor(8);
        lava(&mut world, (0, 0, 0));
        let mut cart = cart_in_cell();
        tick_minecart(&mut cart, &world, old(release(1, 21, 5)));
        assert!(cart.damage > 40.0 || cart.removed.is_some());
        assert_eq!(cart.removed, Some(MinecartRemoval::Destroyed));
    }

    #[test]
    fn a_tnt_cart_in_lava_primes_where_a_plain_one_only_hurts() {
        let mut world = floor(8);
        lava(&mut world, (0, 0, 0));
        let mut cart = MinecartState { variant: MinecartVariant::Tnt, ..cart_in_cell() };
        cart.random_seed = 42;
        let tick = tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert!(tick.primed);
        // the fuse of its draws, counted off in the same tick
        assert_eq!(cart.fuse, 24);
        assert_eq!(cart.removed, None);
    }

    #[test]
    fn a_cart_under_the_bottom_of_its_level_is_gone() {
        let world = WorldSnapshot::new();
        let gone = |rules: MinecartRules, y: f64| {
            let mut cart = resting(MinecartVariant::Rideable, Vec3::new(0.5, y, 0.5));
            tick_minecart(&mut cart, &world, rules);
            cart.removed
        };
        assert_eq!(gone(old(release(1, 16, 5)), -64.0), None);
        assert_eq!(gone(old(release(1, 16, 5)), -64.5), Some(MinecartRemoval::BelowWorld));
        let deep = old(release(1, 18, 2)).in_level(-64, true);
        assert_eq!(gone(deep, -65.0), None);
        assert_eq!(gone(deep, -128.5), Some(MinecartRemoval::BelowWorld));
    }

    #[test]
    fn a_cart_gone_is_out_of_the_tick_of_the_rest() {
        let world = straight(30);
        let rules = old(release(1, 20, 4));
        let mut carts = [
            MinecartState { removed: Some(MinecartRemoval::Exploded), ..tnt_on_rail(1.5, 0.0) },
            cart_at(1.8, 0.0),
        ];
        let before = carts[0];
        let ticks = tick_minecarts(&mut carts, &mut [], &world, rules);
        assert_eq!(ticks[0], MinecartTick::default());
        assert_eq!(carts[0], before);
        // and nothing is pushed by it or pushes it
        assert_eq!(carts[1].velocity.x, 0.0);
    }

    fn portal_world(portal: BlockEffect) -> WorldSnapshot {
        let mut world = floor(8);
        passable(&mut world, (0, 0, 0), portal);
        world
    }

    #[test]
    fn a_cart_goes_through_a_nether_portal_the_tick_after_it_is_in_one() {
        let world = portal_world(BlockEffect::NetherPortal);
        for version in [release(1, 8, 8), release(1, 20, 4), release(26, 3, 0)] {
            let mut cart = cart_in_cell();
            tick_minecart(&mut cart, &world, old(version));
            assert_eq!(cart.removed, None, "{version}");
            assert!(cart.inside_portal, "{version}");
            tick_minecart(&mut cart, &world, old(version));
            assert_eq!(cart.removed, Some(MinecartRemoval::Portal(MinecartPortal::Nether)), "{version}");
        }
    }

    #[test]
    fn a_cart_waits_a_tick_longer_in_a_portal_from_1_9_to_1_16_1() {
        let world = portal_world(BlockEffect::NetherPortal);
        let mut cart = cart_in_cell();
        let rules = old(release(1, 9, 4));
        tick_minecart(&mut cart, &world, rules);
        tick_minecart(&mut cart, &world, rules);
        assert_eq!((cart.removed, cart.portal_time), (None, 1));
        tick_minecart(&mut cart, &world, rules);
        assert_eq!(cart.removed, Some(MinecartRemoval::Portal(MinecartPortal::Nether)));
    }

    #[test]
    fn a_portal_cooldown_keeps_a_cart_where_it_is() {
        let world = portal_world(BlockEffect::NetherPortal);
        let mut cart = MinecartState { portal_cooldown: 5, ..cart_in_cell() };
        let rules = old(release(1, 20, 4));
        tick_minecart(&mut cart, &world, rules);
        tick_minecart(&mut cart, &world, rules);
        assert_eq!(cart.removed, None);
        assert_eq!(cart.portal_cooldown, 300);
    }

    #[test]
    fn a_cart_carrying_someone_stays_out_of_a_portal_until_1_21() {
        let world = portal_world(BlockEffect::NetherPortal);
        let ridden = || MinecartState { rider: Some(MinecartRider::default()), ..cart_in_cell() };
        let mut cart = ridden();
        let rules = old(release(1, 20, 4));
        tick_minecart(&mut cart, &world, rules);
        tick_minecart(&mut cart, &world, rules);
        assert_eq!(cart.removed, None);
        let mut cart = ridden();
        let rules = old(release(1, 21, 0));
        tick_minecart(&mut cart, &world, rules);
        tick_minecart(&mut cart, &world, rules);
        assert_eq!(cart.removed, Some(MinecartRemoval::Portal(MinecartPortal::Nether)));
    }

    #[test]
    fn an_end_portal_takes_a_cart_at_once_until_1_21() {
        let mut world = WorldSnapshot::new();
        passable(&mut world, (0, 0, 0), BlockEffect::EndPortal);
        let in_it = || MinecartState { position: Vec3::new(0.5, 0.5, 0.5), no_gravity: true, ..cart_in_cell() };
        let mut cart = in_it();
        tick_minecart(&mut cart, &world, old(release(1, 20, 4)));
        assert_eq!(cart.removed, Some(MinecartRemoval::Portal(MinecartPortal::End)));
        let mut cart = in_it();
        tick_minecart(&mut cart, &world, old(release(1, 21, 0)));
        assert_eq!(cart.removed, None);
        tick_minecart(&mut cart, &world, old(release(1, 21, 0)));
        assert_eq!(cart.removed, Some(MinecartRemoval::Portal(MinecartPortal::End)));
    }

    #[test]
    fn an_end_portal_is_only_the_shape_of_its_block_from_1_9() {
        let mut world = WorldSnapshot::new();
        passable(&mut world, (0, 0, 0), BlockEffect::EndPortal);
        let over_it = |version: MinecraftVersion| {
            let mut cart = MinecartState { position: Vec3::new(0.5, 0.8, 0.5), no_gravity: true, ..cart_in_cell() };
            tick_minecart(&mut cart, &world, old(version));
            cart.removed
        };
        assert_eq!(over_it(release(1, 9, 4)), None);
        assert_eq!(over_it(release(1, 8, 8)), Some(MinecartRemoval::Portal(MinecartPortal::End)));
        // under the shape, from when it has an underside
        let under_it = |version: MinecraftVersion| {
            let mut cart = MinecartState { position: Vec3::new(0.5, -0.45, 0.5), no_gravity: true, ..cart_in_cell() };
            tick_minecart(&mut cart, &world, old(version));
            cart.removed
        };
        assert_eq!(under_it(release(1, 17, 0)), None);
        assert_eq!(under_it(release(1, 16, 5)), Some(MinecartRemoval::Portal(MinecartPortal::End)));
    }

    #[test]
    fn a_nether_portal_with_nothing_beyond_it_leaves_a_cart_its_cooldown() {
        let world = portal_world(BlockEffect::NetherPortal);
        let mut rules = old(release(1, 20, 4));
        rules.nether_exit = false;
        let mut cart = cart_in_cell();
        tick_minecart(&mut cart, &world, rules);
        tick_minecart(&mut cart, &world, rules);
        assert_eq!(cart.removed, None);
        assert_eq!((cart.portal_cooldown, cart.portal_time), (300, 0));
    }

    #[test]
    fn a_fall_off_the_rail_counts_and_a_landing_ends_it() {
        let world = floor(8);
        let rules = old(release(1, 20, 4));
        let mut cart = resting(MinecartVariant::Rideable, Vec3::new(0.5, 2.0, 0.5));
        cart.on_ground = false;
        tick_minecart(&mut cart, &world, rules);
        assert_eq!(cart.fall_distance, f64::from(0.04_f64 as f32));
        // down to the floor, with a landing that adds nothing of its last move and leaves nothing
        for _ in 0..20 {
            tick_minecart(&mut cart, &world, rules);
        }
        assert!(cart.on_ground);
        assert_eq!(cart.fall_distance, 0.0);
    }

    #[test]
    fn fall_distance_adds_in_the_releases_type() {
        let world = WorldSnapshot::new();
        let fell = |version: MinecraftVersion| {
            let mut cart = resting(MinecartVariant::Rideable, Vec3::new(0.5, 50.0, 0.5));
            cart.on_ground = false;
            cart.fall_distance = 0.1;
            cart.velocity = Vec3::new(0.0, -0.3, 0.0);
            tick_minecart(&mut cart, &world, old(version));
            cart.fall_distance
        };
        let moved = -0.34_f64;
        assert_eq!(fell(release(1, 18, 2)), f64::from((f64::from(0.1_f32 as f64 as f32) - moved) as f32).max(0.0).min(10.0).max(fell(release(1, 18, 2))));
        assert_ne!(fell(release(26, 3, 0)) as f32 as f64, fell(release(26, 3, 0)));
    }

    #[test]
    fn water_stops_a_fall_adding_up_and_a_rail_clears_it() {
        let mut world = straight(8);
        let rules = old(release(1, 20, 4));
        let mut cart = MinecartState { fall_distance: 3.0, ..cart_at(1.5, 0.0) };
        tick_minecart(&mut cart, &world, rules);
        assert_eq!(cart.fall_distance, 0.0);
        world.set_block((0, 5, 0), BlockState { fluid: FluidState::Water, fluid_source: true, fluid_level: 8, water_block: true, ..BlockState::default() });
        let mut wet = resting(MinecartVariant::Rideable, Vec3::new(0.5, 5.0, 0.5));
        wet.on_ground = false;
        wet.in_water = true;
        wet.fall_distance = 2.0;
        tick_minecart(&mut wet, &world, rules);
        assert_eq!(wet.fall_distance, 0.0);
    }

    #[test]
    fn a_clients_tick_only_runs_its_numbers_down() {
        let mut cart = MinecartClientEffects { hurt_time: 1, damage: 1.5, fuse: 1 };
        tick_client_effects(&mut cart);
        assert_eq!(cart, MinecartClientEffects { hurt_time: 0, damage: 0.5, fuse: 0 });
        tick_client_effects(&mut cart);
        assert_eq!(cart, MinecartClientEffects { hurt_time: 0, damage: -0.5, fuse: 0 });
    }
}
