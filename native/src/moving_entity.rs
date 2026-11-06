//! The dedicated ticks of the entities that move on their own without a brain: primed TNT, falling
//! blocks, dropped items and experience orbs (PrimedTnt, FallingBlockEntity, ItemEntity and
//! ExperienceOrb). A tick reads the world and never writes it: what vanilla does to the world or
//! to other entities comes out as an event of [`MovingEntityOutcome`], and only under
//! [`MovingEntityAuthority::Server`]. A client's prediction therefore places no block, sets off no
//! explosion, merges nothing and collects nothing; the server's packets do those. What a client
//! cannot see comes in as [`MovingEntityInputs`]: the entity's random draws, the players an orb
//! chooses among.
//!
//! [`tick_mob_travel`] is the same for the mobs whose `travel` is their own: the server's AI stays
//! outside, and what it decides comes in as the state a travel starts from.

use crate::block_traversal::Movement;
use crate::legacy_fluid;
use crate::math::{floor_i32_for, java_float, Aabb, Vec3};
use crate::simulation::{
    accumulated_fall_distance, apply_block_effects, block_position, blocks_inside_moves,
    collision_query_entity, entity_collision_context, entity_eyes_in_fluid, entity_fluid_contact,
    movements_this_tick, on_position, position_of_bounding_box, push_by_fluid,
    SimulationState,
};
use crate::ridden::PlainMob;
use crate::vehicle::{
    apply_effects_inside, is_water, lava_flow_scale, move_vehicle, MoveRules, VehicleMove,
};
use crate::version::MinecraftVersion;
use crate::world::{FluidContact, FluidState, WorldSnapshot};

type BlockPosition = (i32, i32, i32);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MovingEntityKind {
    PrimedTnt,
    FallingBlock,
    Item,
    ExperienceOrb,
}

impl MovingEntityKind {
    /// The entity's registry name (`tnt`, `falling_block`, `item`, `experience_orb`).
    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "tnt" => Some(Self::PrimedTnt),
            "falling_block" => Some(Self::FallingBlock),
            "item" => Some(Self::Item),
            "experience_orb" => Some(Self::ExperienceOrb),
            _ => None,
        }
    }

    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::PrimedTnt => "tnt",
            Self::FallingBlock => "falling_block",
            Self::Item => "item",
            Self::ExperienceOrb => "experience_orb",
        }
    }

    /// EntityType's width and height, which hold from 1.8 (1.8.9 TntEntity.java:14,
    /// FallingBlockEntity.java:51, ItemEntity.java:34, ExperienceOrbEntity.java:61; 1.20.4
    /// EntityType.java:312, 326, 397, 593).
    #[must_use]
    pub const fn dimensions(self) -> (f32, f32) {
        match self {
            Self::PrimedTnt | Self::FallingBlock => (0.98, 0.98),
            Self::Item => (0.25, 0.25),
            Self::ExperienceOrb => (0.5, 0.5),
        }
    }

    /// getDefaultGravity. A float widened to double in the motion before 1.14 (1.13.2
    /// TntEntity.java:61, ExperienceOrbEntity.java:101), a double after (1.14.4 ItemEntity.java:81,
    /// ExperienceOrb.java:105; 26.3 PrimedTnt.java:80, ExperienceOrb.java:92).
    #[must_use]
    pub fn gravity(self, release: MinecraftVersion) -> f64 {
        let gravity = if self == Self::ExperienceOrb { 0.03 } else { 0.04 };
        if release.at_least(1, 14, 0) {
            gravity
        } else {
            java_float(gravity)
        }
    }
}

/// Whose tick this is. The client and the server run the same tick with different branches
/// (`level.isClientSide()`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MovingEntityAuthority {
    /// A prediction: the client's branches, with no event.
    Client,
    /// The server's tick: its branches, and what they do to the world as events.
    Server,
}

/// A player an orb can follow, where it stands when the orb ticks.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MovingEntityPlayer {
    pub id: i32,
    pub position: Vec3,
    /// Entity.getEyeHeight of its pose.
    pub eye_height: f32,
    pub spectator: bool,
    pub dead: bool,
}

/// What a tick reads that its state does not say.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MovingEntityInputs {
    /// The entity's next `random.nextFloat()` draws, in order. A tick that needs more than there
    /// are says so in `random_missing`, and uses 0.
    pub random: Vec<f32>,
    /// The players of the level, in Level.players() order.
    pub players: Vec<MovingEntityPlayer>,
    /// A falling block on a server before 1.14: FallingBlock.isFree of the block under its feet at
    /// y - 0.01, whose air, fire, liquid and replaceable materials no block state here says. Such
    /// a block goes on falling from what it landed on (a fence's top).
    pub falls_through_below: bool,
}

/// What a tick leaves for others to do, and how it used its inputs. Nothing here has happened.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MovingEntityOutcome {
    /// PrimedTnt.explode (server only).
    pub explodes: bool,
    /// A falling block ended here (server only): its block goes in, breaks or drops.
    pub landed_at: Option<BlockPosition>,
    /// A falling block that fell too long (server only): its item drops if the rules say so.
    pub expired: bool,
    /// Before 1.18.2 a falling block's first tick takes its own block out of the world, on both
    /// sides. The tick moved as if it had; the caller's world changes from the server's packet.
    pub clears_block: Option<BlockPosition>,
    /// The tick looks for items or orbs to merge with (server only).
    pub merge_check: bool,
    /// How many of `inputs.random` the tick drew.
    pub random_used: u32,
    /// The tick drew more than it was given.
    pub random_missing: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MovingEntityState {
    pub kind: MovingEntityKind,
    pub authority: MovingEntityAuthority,
    /// Entity.id: an item's rest and an orb's choice of target turn on it.
    pub id: i32,
    /// Entity.tickCount, which Level.tickNonPassenger counts before the tick.
    pub tick_count: i32,
    pub position: Vec3,
    pub velocity: Vec3,
    /// Before 1.17 Entity keeps its box, which the position follows.
    pub bounding_box: Option<Aabb>,
    pub on_ground: bool,
    pub collided_horizontally: bool,
    pub collided_vertically: bool,
    pub vertical_collision_below: bool,
    pub in_water: bool,
    pub in_lava: bool,
    pub no_gravity: bool,
    pub no_physics: bool,
    pub stuck_speed_multiplier: Vec3,
    pub fall_distance: f64,
    /// The dimension is ultrawarm: lava pushes at 0.007.
    pub ultra_warm: bool,
    pub first_tick: bool,
    /// Entity.finalMovementsThisTick: a resting item's blocks from 26.1.
    pub(crate) last_movements: Vec<Movement>,
    pub removed: bool,
    /// PrimedTnt.getFuse.
    pub fuse: i32,
    /// FallingBlockEntity.time.
    pub time: i32,
    /// The carried block's id, as the world's blocks say it.
    pub carried_block: u32,
    /// The carried block is air: it goes at once.
    pub carried_air: bool,
    /// The carried block is a concrete powder: water stops it.
    pub concrete_powder: bool,
    /// 1.18 and 1.18.1: the client keeps a landed block for 50 ms after the server's removal,
    /// frozen (FallingBlockEntity.discardTime; 1.18 FallingBlockEntity.java:103-106).
    pub discarding: bool,
    /// ItemEntity.age, ExperienceOrb.age.
    pub age: i32,
    /// ItemEntity.pickupDelay; ExperienceOrb.throwTime before 1.17.
    pub pickup_delay: i32,
    /// The item's stack is empty: it goes at once.
    pub item_empty: bool,
    /// ExperienceOrb.followingPlayer, by its entity id.
    pub following_player: Option<i32>,
    /// ExperienceOrb.followingTime before 1.17.
    pub following_time: i32,
    /// ExperienceOrb.tickCount before 1.17, its own and not Entity's.
    pub orb_ticks: i32,
    /// A move past MAX_WALKED_CELLS did not run, and the bindings refuse the tick (`move_vehicle`).
    pub move_out_of_range: bool,
}

impl MovingEntityState {
    #[must_use]
    pub fn new(kind: MovingEntityKind, position: Vec3, velocity: Vec3) -> Self {
        Self {
            kind,
            authority: MovingEntityAuthority::Client,
            id: 0,
            tick_count: 0,
            position,
            velocity,
            bounding_box: None,
            on_ground: false,
            collided_horizontally: false,
            collided_vertically: false,
            vertical_collision_below: false,
            in_water: false,
            in_lava: false,
            no_gravity: false,
            no_physics: false,
            stuck_speed_multiplier: Vec3::ZERO,
            fall_distance: 0.0,
            ultra_warm: false,
            first_tick: true,
            last_movements: Vec::new(),
            removed: false,
            fuse: 80,
            time: 0,
            carried_block: 0,
            carried_air: false,
            concrete_powder: false,
            discarding: false,
            age: 0,
            pickup_delay: 0,
            item_empty: false,
            following_player: None,
            following_time: 0,
            orb_ticks: 0,
            move_out_of_range: false,
        }
    }

    #[must_use]
    pub fn on_server(self) -> Self {
        Self {
            authority: MovingEntityAuthority::Server,
            ..self
        }
    }

    fn server(&self) -> bool {
        self.authority == MovingEntityAuthority::Server
    }

    /// EntityDimensions.makeBoundingBox: half the width in float, either side of the position.
    fn box_at(&self, position: Vec3) -> Aabb {
        let (width, height) = self.kind.dimensions();
        let half = f64::from(width / 2.0);
        Aabb::new(
            Vec3::new(position.x - half, position.y, position.z - half),
            Vec3::new(
                position.x + half,
                position.y + f64::from(height),
                position.z + half,
            ),
        )
    }

    fn rules(&self, release: MinecraftVersion) -> MoveRules {
        MoveRules {
            living: false,
            max_step: 0.0,
            // (the 26.2+ landing compensates what gravity adds and drag takes)
            gravity: if self.no_gravity {
                0.0
            } else {
                self.kind.gravity(release)
            },
            air_drag: f64::from(0.98_f32),
            bounciness: 0.0,
            stands_on_lava: false,
            checks_inside_at_fall: false,
            rails_keep_speed: false,
            ignored: [None, None],
        }
    }

    fn body(&self, release: MinecraftVersion) -> SimulationState {
        let (width, height) = self.kind.dimensions();
        let keeps_box = !release.at_least(1, 17, 0);
        SimulationState {
            position: self.position,
            velocity: self.velocity,
            half_width: f64::from(width / 2.0),
            height: f64::from(height),
            on_ground: self.on_ground,
            collided_horizontally: self.collided_horizontally,
            collided_vertically: self.collided_vertically,
            vertical_collision_below: self.vertical_collision_below,
            in_water: self.in_water,
            in_lava: self.in_lava,
            fall_distance: self.fall_distance,
            // (the server owns these, and from 26.3 they simulate on both sides, MoveSimulationType.SERVER_AND_CLIENT:
            // 26.3 ItemEntity.java:429, PrimedTnt.java:187, FallingBlockEntity.java:362, ExperienceOrb.java:373)
            controlled_by_local_instance: self.server(),
            can_simulate_movement: Some(true),
            client_side: !self.server(),
            no_gravity: self.no_gravity,
            no_physics: self.no_physics,
            bounding_box: keeps_box
                .then(|| self.bounding_box.unwrap_or_else(|| self.box_at(self.position))),
            stuck_speed_multiplier: self.stuck_speed_multiplier,
            non_living: true,
            sweet_berry_bush_immune: true,
            // (PowderSnowBlock.getCollisionShape holds a falling block up: 1.17
            // PowderSnowBlock.java:75, 26.3 :84)
            powder_snow_walkable: self.kind == MovingEntityKind::FallingBlock,
            ..SimulationState::default()
        }
    }

    fn adopt(&mut self, body: &SimulationState) {
        self.position = body.position;
        self.velocity = body.velocity;
        self.bounding_box = body.bounding_box;
        self.on_ground = body.on_ground;
        self.collided_horizontally = body.collided_horizontally;
        self.collided_vertically = body.collided_vertically;
        self.vertical_collision_below = body.vertical_collision_below;
        self.in_water = body.in_water;
        self.in_lava = body.in_lava;
        self.fall_distance = body.fall_distance;
        self.stuck_speed_multiplier = body.stuck_speed_multiplier;
        self.move_out_of_range |= body.move_out_of_range;
    }
}

/// The tick's reading of its random inputs.
struct Draws<'a> {
    random: &'a [f32],
    used: usize,
    missing: bool,
}

impl Draws<'_> {
    fn next(&mut self) -> f32 {
        let draw = self.random.get(self.used).copied();
        self.used += 1;
        self.missing |= draw.is_none();
        draw.unwrap_or(0.0)
    }

    /// `(random.nextFloat() - random.nextFloat()) * 0.2F`.
    fn spread(&mut self) -> f64 {
        let (a, b) = (self.next(), self.next());
        f64::from((a - b) * 0.2)
    }
}

/// One tick of the entity: the level's count, then its own tick. A tick does nothing to an entity
/// that is gone.
pub fn tick_moving_entity(
    state: &mut MovingEntityState,
    world: &WorldSnapshot,
    inputs: &MovingEntityInputs,
    release: MinecraftVersion,
) -> MovingEntityOutcome {
    let mut outcome = MovingEntityOutcome::default();
    if state.removed {
        return outcome;
    }
    let mut draws = Draws {
        random: &inputs.random,
        used: 0,
        missing: false,
    };
    state.tick_count = state.tick_count.wrapping_add(1);
    match state.kind {
        MovingEntityKind::PrimedTnt => tick_tnt(state, world, release, &mut outcome),
        MovingEntityKind::FallingBlock => {
            tick_falling_block(state, world, inputs, release, &mut outcome);
        }
        MovingEntityKind::Item => tick_item(state, world, &mut draws, release, &mut outcome),
        MovingEntityKind::ExperienceOrb => {
            tick_orb(state, world, inputs, &mut draws, release, &mut outcome);
        }
    }
    outcome.random_used = draws.used as u32;
    outcome.random_missing = draws.missing;
    outcome
}

/// The tick's gravity: before 1.10 nothing turns it off (1.9.4 TntEntity.java:55, 1.10.2 :55-57).
fn apply_gravity(state: &MovingEntityState, body: &mut SimulationState, release: MinecraftVersion) {
    if state.no_gravity && release.at_least(1, 10, 0) {
        return;
    }
    body.velocity.y -= state.kind.gravity(release);
}

/// Entity.move, with its noPhysics way out (1.8.9 Entity.java:460-464, 1.21.8 the same; 1.21.9
/// clears the collision flags, 26.3 Entity.java:689-696), and from 1.21.2 applyEffectsFromBlocks
/// after it (before, the move's own check: 1.21.3 TntEntity.java:92). Counts the fall
/// (checkFallDamage).
fn move_entity(
    state: &mut MovingEntityState,
    body: &mut SimulationState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> VehicleMove {
    let movement = body.velocity;
    let old_position = body.position;
    if body.no_physics {
        match body.bounding_box {
            Some(bounds) => {
                let moved = bounds.translated(movement);
                body.bounding_box = Some(moved);
                body.position = position_of_bounding_box(moved);
            }
            None => body.position = body.position + movement,
        }
        if release.at_least(1, 21, 9) {
            body.collided_horizontally = false;
            body.collided_vertically = false;
            body.vertical_collision_below = false;
        }
        record_movements(state, body, old_position, movement, movement, release);
        return VehicleMove {
            requested: movement,
            moved: movement,
            support: None,
            motion_at_landing: body.velocity,
            fluid_heights: None,
        };
    }
    let rules = state.rules(release);
    let outcome = move_vehicle(body, world, release, movement, rules, |body, support| {
        apply_effects_inside(body, world, support, release);
    });
    count_fall(body, outcome.moved.y, release);
    let movements = record_movements(
        state,
        body,
        old_position,
        outcome.requested,
        outcome.moved,
        release,
    );
    if release.at_least(1, 21, 2) {
        let (inside, _) = blocks_inside_moves(body, world, &movements, release);
        apply_block_effects(body, world, outcome.support, release, &inside);
    }
    outcome
}

/// Entity.checkFallDamage: a fall counts unless it ends here, and from 1.21.5 before that but not
/// in water (1.20.4 Entity.fall, 1.21.5 Entity.java:1284-1297, 26.3 :1595-1607). Before 1.21.2 a
/// cobweb's stop in the move ended the fall after it was counted.
pub(crate) fn count_fall(body: &mut SimulationState, dy: f64, release: MinecraftVersion) {
    // (from 1.21.2 the move's check runs on the side that controls the entity: the server's)
    if body.client_side && release.at_least(1, 21, 2) {
        return;
    }
    let modern = release.at_least(1, 21, 5);
    if modern && dy < 0.0 && !body.in_water {
        body.fall_distance = accumulated_fall_distance(body.fall_distance, dy, release);
    }
    if body.on_ground {
        body.fall_distance = 0.0;
    } else if !modern && dy < 0.0 {
        body.fall_distance = accumulated_fall_distance(body.fall_distance, dy, release);
    }
    if !release.at_least(1, 21, 2) && body.stuck_speed_multiplier != Vec3::ZERO {
        body.fall_distance = 0.0;
    }
}

fn record_movements(
    state: &mut MovingEntityState,
    body: &SimulationState,
    old_position: Vec3,
    requested: Vec3,
    moved: Vec3,
    release: MinecraftVersion,
) -> Vec<Movement> {
    let movements = movements_this_tick(body, old_position, requested, moved, release);
    state.last_movements.clone_from(&movements);
    movements
}

/// Entity's fluid update, which an item and an orb take through Entity.tick and TNT at the end of
/// its own tick: the water's current, and from 1.16 the lava's. Answers the two heights.
fn update_fluids(
    state: &MovingEntityState,
    body: &mut SimulationState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> (f64, f64) {
    let bounds = body.bounds();
    let mut water_height = 0.0;
    if legacy_fluid::applies(release) {
        match state.kind {
            // an item and an orb take the push over their whole box and no fall from it, and an orb
            // keeps no flag (1.8.9 ItemEntity.java:186-198, ExperienceOrbEntity.java:155-157;
            // 1.12.2 :215, :162; gone in 1.13)
            MovingEntityKind::Item => {
                body.in_water = legacy_fluid::material_acceleration(body, world, bounds, true, release);
            }
            MovingEntityKind::ExperienceOrb => {
                legacy_fluid::material_acceleration(body, world, bounds, true, release);
            }
            _ => legacy_fluid::handle_water_movement(body, world, true, release),
        }
    } else {
        let water = entity_fluid_contact(body, world, FluidState::Water, release);
        water_height = water.height;
        body.in_water = water.touching;
        if water.touching {
            body.fall_distance = 0.0;
            push_by_fluid(body, water, 0.014, release);
        }
    }
    // (as a ridden mob's: 1.16 - 1.16.1 measure no lava in water)
    let measures_lava = release.at_least(1, 16, 2) || !release.at_least(1, 16, 0) || !body.in_water;
    let lava = if measures_lava {
        entity_fluid_contact(body, world, FluidState::Lava, release)
    } else {
        FluidContact::default()
    };
    if release.at_least(1, 16, 0) {
        if measures_lava {
            push_by_fluid(body, lava, lava_flow_scale(state.ultra_warm), release);
        }
        if release.at_least(1, 16, 2) {
            body.in_lava = lava.height > 0.0;
        }
    } else if !release.at_least(1, 14, 0) {
        body.in_lava = legacy_fluid::touching_lava(world, bounds, release);
    }
    (water_height, lava.height)
}

/// What Entity.tick does for an item and an orb: the fluids, the fall halved in lava, and the end
/// of an entity far under the world (1.8.9 Entity.java:408-411 at -64; 1.17 Entity.java:458-461
/// by the world's bottom, 26.3 Entity.java:552-608).
fn base_tick(
    state: &mut MovingEntityState,
    body: &mut SimulationState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> (f64, f64) {
    let heights = update_fluids(state, body, world, release);
    if body.in_lava {
        body.fall_distance *= 0.5;
    }
    let bottom = if release.at_least(1, 17, 0) {
        f64::from(world.world_bounds().0)
    } else {
        0.0
    };
    if body.position.y < bottom - 64.0 {
        state.removed = true;
    }
    state.first_tick = false;
    heights
}

/// PrimedTnt.tick. It takes no Entity.tick: no base tick, so no end under the world. The fuse runs
/// out at its last count from 1.9, one tick later in 1.8 (1.8.9 TntEntity.java:46-70, 1.9.4 :51-75,
/// 1.13.2 :54-79, 1.20.5 :63-84; from 1.21.2 the blocks' effects after the move, 1.21.3 :88-111;
/// 26.3 PrimedTnt.java:84-112). Client and server both discard it; only the server explodes.
fn tick_tnt(
    state: &mut MovingEntityState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
    outcome: &mut MovingEntityOutcome,
) {
    let mut body = state.body(release);
    apply_gravity(state, &mut body, release);
    move_entity(state, &mut body, world, release);
    drag(&mut body, release);
    if body.on_ground {
        landing_bounce(&mut body, release);
    }
    let last = if release.at_least(1, 9, 0) { 1 } else { 0 };
    state.fuse = state.fuse.wrapping_sub(1);
    if state.fuse < last {
        state.removed = true;
        outcome.explodes = state.server();
    } else {
        update_fluids(state, &mut body, world, release);
    }
    state.adopt(&body);
}

/// TNT's and a falling block's drag: `*= 0.98F` before 1.14, the double 0.98 until 26.2 made it
/// the float getAirDrag (26.1 PrimedTnt.java:85, 26.2 :89; 26.2 FallingBlockEntity.java:233).
fn drag(body: &mut SimulationState, release: MinecraftVersion) {
    let factor = if release.at_least(1, 14, 0) && !release.at_least(26, 2, 0) {
        0.98
    } else {
        f64::from(0.98_f32)
    };
    body.velocity = body.velocity.scale(factor);
}

/// TNT's and a falling block's bounce: `0.7F, -0.5, 0.7F` before 1.14, then the doubles.
fn landing_bounce(body: &mut SimulationState, release: MinecraftVersion) {
    let side = if release.at_least(1, 14, 0) {
        0.7
    } else {
        f64::from(0.7_f32)
    };
    body.velocity = Vec3::new(
        body.velocity.x * side,
        body.velocity.y * -0.5,
        body.velocity.z * side,
    );
}

/// FallingBlockEntity.tick. The client falls and does nothing else. Before 1.18.2 the first tick
/// takes the block out of the world where it finds it, and a server with no such block drops the
/// entity (1.8.9 FallingBlockEntity.java:76-92, 1.18 :100-120; from 1.18.2 FallingBlockEntity.fall
/// does that at the spawn). The drag came before the landing until 1.12 (1.11.2 :116-122, 1.12.2
/// :118-180).
fn tick_falling_block(
    state: &mut MovingEntityState,
    world: &WorldSnapshot,
    inputs: &MovingEntityInputs,
    release: MinecraftVersion,
    outcome: &mut MovingEntityOutcome,
) {
    if state.carried_air {
        state.removed = true;
        return;
    }
    let clock_era = release.at_least(1, 18, 0) && !release.at_least(1, 18, 2);
    if clock_era && !state.server() && state.discarding {
        return;
    }
    let first = state.time == 0;
    state.time = state.time.wrapping_add(1);
    let mut cleared = None;
    if first && !release.at_least(1, 18, 2) {
        let cell = block_position(state.position, release);
        if world.block(cell).id == state.carried_block {
            outcome.clears_block = Some(cell);
            let mut without = world.clone();
            without.set_block(cell, crate::world::BlockState::default());
            cleared = Some(without);
        } else if state.server() {
            state.removed = true;
            return;
        }
    }
    let world = cleared.as_ref().unwrap_or(world);
    let mut body = state.body(release);
    apply_gravity(state, &mut body, release);
    let start = body.position;
    move_entity(state, &mut body, world, release);
    let drag_first = !release.at_least(1, 12, 0);
    if drag_first {
        drag(&mut body, release);
    }
    if state.server() && land_falling_block(state, &mut body, start, world, inputs, release, outcome)
    {
        state.adopt(&body);
        return;
    }
    if !drag_first {
        drag(&mut body, release);
    }
    state.adopt(&body);
}

/// The server's part of a falling block's tick. Answers whether the tick ends here, before its
/// drag. What goes into the world is the server's: the event says where. From 1.9 until 1.14 a
/// block on something free underneath it goes on falling (1.9.4 :109-112, 1.13.2 :151-155).
fn land_falling_block(
    state: &mut MovingEntityState,
    body: &mut SimulationState,
    start: Vec3,
    world: &WorldSnapshot,
    inputs: &MovingEntityInputs,
    release: MinecraftVersion,
    outcome: &mut MovingEntityOutcome,
) -> bool {
    let mut cell = block_position(body.position, release);
    let concrete = state.concrete_powder && release.at_least(1, 12, 0);
    let mut stuck = concrete && is_water(world.fluid_at(cell));
    if concrete && body.velocity.length_squared() > 1.0 {
        if let Some(water) = water_along(world, start, body.position, release) {
            cell = water;
            stuck = true;
        }
    }
    if !body.on_ground && !stuck {
        // (1.8.9 :137, 1.14 :192 to 256; 1.17 :201 the world's bottom and height, over which the
        // top counts as the block above it until 1.21.2, 1.21.3 :164 getTopYInclusive)
        let outside = if release.at_least(1, 17, 0) {
            let (bottom, height_end, ..) = world.world_bounds();
            let top = if release.at_least(1, 21, 2) {
                height_end - 1
            } else {
                height_end
            };
            cell.1 <= bottom || cell.1 > top
        } else {
            cell.1 < 1 || cell.1 > 256
        };
        if state.time > 100 && outside || state.time > 600 {
            state.removed = true;
            outcome.expired = true;
        }
        return false;
    }
    let free_edge = release.at_least(1, 9, 0) && !release.at_least(1, 14, 0);
    if free_edge && !stuck && inputs.falls_through_below {
        body.on_ground = false;
        return true;
    }
    landing_bounce(body, release);
    if !world.is_moving_block(cell) {
        state.removed = true;
        outcome.landed_at = Some(cell);
    }
    false
}

/// The first water source the segment reaches before a block's collision shape (ClipContext
/// Block.COLLIDER, Fluid.SOURCE_ONLY), cell by cell along the line.
fn water_along(
    world: &WorldSnapshot,
    from: Vec3,
    to: Vec3,
    release: MinecraftVersion,
) -> Option<BlockPosition> {
    let delta = to - from;
    let origin = block_position(from, release);
    let end = block_position(to, release);
    let (mut x, mut y, mut z) = origin;
    let step = |d: f64| if d > 0.0 { 1 } else { -1 };
    let time = |at: i32, start: f64, d: f64| {
        if d == 0.0 {
            f64::INFINITY
        } else {
            let border = if d > 0.0 { f64::from(at) + 1.0 } else { f64::from(at) };
            (border - start) / d
        }
    };
    for _ in 0..1024 {
        let block = world.block((x, y, z));
        if block.fluid_source && is_water(block.fluid) {
            return Some((x, y, z));
        }
        if (x, y, z) != origin && world.has_collision_shape((x, y, z)) {
            return None;
        }
        if (x, y, z) == end {
            return None;
        }
        let (tx, ty, tz) = (
            time(x, from.x, delta.x),
            time(y, from.y, delta.y),
            time(z, from.z, delta.z),
        );
        if tx <= ty && tx <= tz {
            x += step(delta.x);
        } else if ty <= tz {
            y += step(delta.y);
        } else {
            z += step(delta.z);
        }
    }
    None
}

/// Block.isShapeFullCube of the block's collision shape (1.8.9 World.java:1771-1775 by its box,
/// 1.13.2 World.java:1537, 1.16.5 isFullCube, 26.3 isCollisionShapeFullBlock).
fn full_cube(world: &WorldSnapshot, (x, y, z): BlockPosition) -> bool {
    let min = Vec3::new(f64::from(x), f64::from(y), f64::from(z));
    let whole = Aabb::new(min, min + Vec3::new(1.0, 1.0, 1.0));
    world
        .block_collision_boxes((x, y, z))
        .iter()
        .any(|shape| *shape == whole)
}

/// Entity.moveTowardsClosestSpace (checkInBlock until 1.16, pushOutOfBlocks before): the entity
/// goes out of the nearest open side of the cell at its middle, at a speed its random draws. Until
/// 1.14 it first asks whether it is stuck at all and answers that. 1.8 sets the speed, up before
/// north and south; 1.9 - 1.10 add it; 1.11 - 1.13 set it and keep three quarters of the rest; from
/// 1.14 north and south go first (1.8.9 Entity.java:1527-1582, 1.9.4 :1730-1782, 1.11.2 :1729-1786,
/// 1.13.2 :1912-1961, 1.14 :1905-1933, 26.3 :3039-3067).
fn move_towards_closest_space(
    body: &mut SimulationState,
    world: &WorldSnapshot,
    draws: &mut Draws<'_>,
    release: MinecraftVersion,
) -> bool {
    let bounds = body.bounds();
    let centre = Vec3::new(
        body.position.x,
        (bounds.min.y + bounds.max.y) / 2.0,
        body.position.z,
    );
    let cell = block_position(centre, release);
    if !release.at_least(1, 14, 0) {
        let free = world.no_collision(bounds, release);
        let stuck = if release.at_least(1, 9, 0) {
            !free
        } else {
            !free || full_cube(world, cell)
        };
        if !stuck {
            return false;
        }
    }
    let inside = Vec3::new(
        centre.x - f64::from(cell.0),
        centre.y - f64::from(cell.1),
        centre.z - f64::from(cell.2),
    );
    const NORTH: (i32, i32, i32) = (0, 0, -1);
    const SOUTH: (i32, i32, i32) = (0, 0, 1);
    const WEST: (i32, i32, i32) = (-1, 0, 0);
    const EAST: (i32, i32, i32) = (1, 0, 0);
    const UP: (i32, i32, i32) = (0, 1, 0);
    let order = if release.at_least(1, 14, 0) {
        [NORTH, SOUTH, WEST, EAST, UP]
    } else if release.at_least(1, 9, 0) {
        [WEST, EAST, NORTH, SOUTH, UP]
    } else {
        [WEST, EAST, UP, NORTH, SOUTH]
    };
    let mut closest = if release.at_least(1, 9, 0) {
        f64::MAX
    } else {
        9999.0
    };
    let mut direction = UP;
    for side in order {
        if full_cube(world, (cell.0 + side.0, cell.1 + side.1, cell.2 + side.2)) {
            continue;
        }
        let along = if side.0 != 0 {
            inside.x
        } else if side.1 != 0 {
            inside.y
        } else {
            inside.z
        };
        let distance = if side.0 + side.1 + side.2 > 0 {
            1.0 - along
        } else {
            along
        };
        if distance < closest {
            closest = distance;
            direction = side;
        }
    }
    let speed = draws.next() * 0.2 + 0.1;
    let step = (direction.0 + direction.1 + direction.2) as f32;
    let push = f64::from(step * speed);
    let velocity = body.velocity;
    if release.at_least(1, 9, 0) && !release.at_least(1, 11, 0) {
        body.velocity = Vec3::new(
            velocity.x + if direction.0 != 0 { push } else { 0.0 },
            velocity.y + if direction.1 != 0 { push } else { 0.0 },
            velocity.z + if direction.2 != 0 { push } else { 0.0 },
        );
        return true;
    }
    let kept = if release.at_least(1, 9, 0) { 0.75 } else { 1.0 };
    body.velocity = Vec3::new(
        if direction.0 != 0 { push } else { velocity.x * kept },
        if direction.1 != 0 { push } else { velocity.y * kept },
        if direction.2 != 0 { push } else { velocity.z * kept },
    );
    true
}

/// The block whose friction an item or an orb on the ground slides on: a whole block under its box
/// before 1.15, under its position until 1.20, then getOnPos(0.999999F), from the supporting block
/// (1.8.9 ItemEntity.java:93-98, 1.14.4 ItemEntity.java:100, 1.15 :97, 1.20 :124, :163).
fn friction_cell(
    world: &WorldSnapshot,
    body: &SimulationState,
    support: Option<BlockPosition>,
    release: MinecraftVersion,
) -> BlockPosition {
    if release.at_least(1, 20, 0) {
        return on_position(world, body, support, 0.999_999, release);
    }
    let y = if release.at_least(1, 15, 0) {
        body.position.y
    } else {
        body.bounds().min.y
    };
    block_position(Vec3::new(body.position.x, y - 1.0, body.position.z), release)
}

/// `velocity + 5.0E-4F` below 0.06F, the sideways motion at `side` (1.13.2 ItemEntity.java:146-153,
/// 1.14 :139-142, 26.3 :184-194).
fn float_item(velocity: Vec3, side: f32) -> Vec3 {
    let side = f64::from(side);
    let rise = if velocity.y < f64::from(0.06_f32) {
        f64::from(5.0e-4_f32)
    } else {
        0.0
    };
    Vec3::new(velocity.x * side, velocity.y + rise, velocity.z * side)
}

/// ItemEntity.tick. The client keeps the age but never ends the item: the server's removal does.
/// Water lifts it from 1.13, by the fluid at its eyes; lava from 1.16; from 1.16.2 by the fluid's
/// height over 0.1 of a block. It moves every tick before 1.15; after that it rests three ticks in
/// four once settled, and from 26.1 still takes the blocks of its last move. Up to 1.16.5 lava in
/// its cell throws it about, on the client too, by the random (1.8.9 ItemEntity.java:64-118, 1.11.2
/// :74, 1.13.2 :68, 1.14.4 ItemEntity.java:67-140, 1.15 :69, 1.16 :86, 1.16.5 :86, 1.17 :83,
/// 1.20.5 :115, 26.3 :108-171).
fn tick_item(
    state: &mut MovingEntityState,
    world: &WorldSnapshot,
    draws: &mut Draws<'_>,
    release: MinecraftVersion,
    outcome: &mut MovingEntityOutcome,
) {
    if state.item_empty {
        state.removed = true;
        return;
    }
    let mut body = state.body(release);
    let (water_height, lava_height) = base_tick(state, &mut body, world, release);
    if state.pickup_delay > 0 && state.pickup_delay != 32767 {
        state.pickup_delay -= 1;
    }
    let start = body.position;
    let floats_in = |body: &SimulationState, fluid: FluidState, height: f64| {
        if release.at_least(1, 16, 2) {
            let threshold = if release.at_least(1, 20, 5) {
                0.1_f32
            } else {
                0.25_f32 * 0.85_f32 - 0.111_111_11_f32
            };
            let touching = if fluid == FluidState::Water {
                body.in_water
            } else {
                body.in_lava
            };
            touching && height > f64::from(threshold)
        } else {
            entity_eyes_in_fluid(body, world, fluid, release)
        }
    };
    if release.at_least(1, 13, 0) && floats_in(&body, FluidState::Water, water_height) {
        body.velocity = float_item(body.velocity, 0.99);
    } else if release.at_least(1, 16, 0) && floats_in(&body, FluidState::Lava, lava_height) {
        body.velocity = float_item(body.velocity, 0.95);
    } else {
        apply_gravity(state, &mut body, release);
    }
    // (both sides until 1.11: 1.10.2 ItemEntity.java:75, 1.11.2 :93-97)
    if state.server() || !release.at_least(1, 11, 0) {
        if release.at_least(1, 14, 0) {
            let query = if release.at_least(1, 17, 0) {
                body.bounds().deflate(Vec3::new(1.0e-7, 1.0e-7, 1.0e-7))
            } else {
                body.bounds()
            };
            let context = entity_collision_context(&body);
            let free = world.no_collision_for_entity(
                query,
                collision_query_entity(&body, &context),
                release,
            );
            body.no_physics = !free;
            if body.no_physics {
                move_towards_closest_space(&mut body, world, draws, release);
            }
        } else {
            body.no_physics = move_towards_closest_space(&mut body, world, draws, release);
        }
    } else {
        body.no_physics = false;
    }
    state.no_physics = body.no_physics;
    let rests = release.at_least(1, 15, 0)
        && body.on_ground
        && !(horizontal_speed_squared(body.velocity) > f64::from(1.0e-5_f32))
        && state.tick_count.wrapping_add(state.id) % 4 != 0;
    if rests {
        if release.at_least(26, 1, 0) && !body.no_physics {
            let (inside, _) = blocks_inside_moves(&body, world, &state.last_movements, release);
            apply_block_effects(&mut body, world, None, release, &inside);
        }
    } else {
        let moved = move_entity(state, &mut body, world, release);
        // (before 1.14 the lava and the merge come before the friction: 1.13.2 ItemEntity.java:97-111,
        // 1.14.4 ItemEntity.java:104-117 after it)
        if !release.at_least(1, 14, 0) {
            item_check(state, &mut body, start, world, draws, release, outcome);
        }
        let friction = if body.on_ground {
            world.slipperiness_at(friction_cell(world, &body, moved.support, release)) as f32 * 0.98
        } else {
            0.98
        };
        let vertical = if release.at_least(1, 14, 0) && !release.at_least(26, 2, 0) {
            0.98
        } else {
            f64::from(0.98_f32)
        };
        body.velocity = Vec3::new(
            body.velocity.x * f64::from(friction),
            body.velocity.y * vertical,
            body.velocity.z * f64::from(friction),
        );
        if body.on_ground && (body.velocity.y < 0.0 || !release.at_least(1, 16, 2)) {
            body.velocity.y *= -0.5;
        }
    }
    if release.at_least(1, 14, 0) {
        item_check(state, &mut body, start, world, draws, release, outcome);
    }
    if state.age != -32768 {
        state.age = state.age.wrapping_add(1);
    }
    update_fluids(state, &mut body, world, release);
    if state.server() && state.age >= 6000 {
        state.removed = true;
    }
    state.adopt(&body);
}

/// The item's look around, every so often: until 1.17 for lava in its cell, and for a merge.
fn item_check(
    state: &MovingEntityState,
    body: &mut SimulationState,
    start: Vec3,
    world: &WorldSnapshot,
    draws: &mut Draws<'_>,
    release: MinecraftVersion,
    outcome: &mut MovingEntityOutcome,
) {
    let moved_cell = moved_to_another_cell(start, body.position, release);
    let due = if release.at_least(1, 14, 0) {
        state.tick_count % if moved_cell { 2 } else { 40 } == 0
    } else {
        moved_cell || state.tick_count % 25 == 0
    };
    if due {
        if !release.at_least(1, 17, 0) && lava_in_cell(body, world, release) {
            scatter_in_lava(body, draws);
            // (the burn's sound takes a draw)
            draws.next();
        }
        outcome.merge_check = state.server();
    }
}

fn horizontal_speed_squared(velocity: Vec3) -> f64 {
    velocity.x * velocity.x + velocity.z * velocity.z
}

/// `(int)` of the coordinates until 1.14, Mth.floor from it (1.13.2 ItemEntity.java:97, 1.14.4
/// ItemEntity.java:111).
fn moved_to_another_cell(from: Vec3, to: Vec3, release: MinecraftVersion) -> bool {
    let cell = |value: f64| {
        if release.at_least(1, 14, 0) {
            floor_i32_for(release, value)
        } else {
            value as i32
        }
    };
    cell(from.x) != cell(to.x) || cell(from.y) != cell(to.y) || cell(from.z) != cell(to.z)
}

fn lava_in_cell(body: &SimulationState, world: &WorldSnapshot, release: MinecraftVersion) -> bool {
    world.fluid_at(block_position(body.position, release)) == FluidState::Lava
}

/// `setDeltaMovement((a - b) * 0.2F, 0.2F, (c - d) * 0.2F)`, x's draws first.
fn scatter_in_lava(body: &mut SimulationState, draws: &mut Draws<'_>) {
    let x = draws.spread();
    let z = draws.spread();
    body.velocity = Vec3::new(x, f64::from(0.2_f32), z);
}

/// World.getNearestPlayer(entity, 8.0): the nearest player that is no spectator, strictly nearer
/// than 8 blocks (1.8.9 World.java:2413-2429).
fn nearest_player(players: &[MovingEntityPlayer], at: Vec3) -> Option<MovingEntityPlayer> {
    let mut nearest: Option<(f64, MovingEntityPlayer)> = None;
    for player in players.iter().filter(|player| !player.spectator) {
        let distance = player.position.distance_squared(at);
        if distance < 64.0 && nearest.is_none_or(|(best, _)| distance < best) {
            nearest = Some((distance, *player));
        }
    }
    nearest.map(|(_, player)| player)
}

/// ExperienceOrb.tick. Before 1.17 the orb keeps its own tick count and looks for a player when
/// that count runs ahead of its last look; from 1.17 once in 20 of Entity's ticks; from 1.21.5
/// every tick, and the client's first tick does nothing. Water lifts it from 1.13; lava throws it,
/// on the client too. It leaves a block on both sides until 1.21.5, then on the server alone when
/// no player draws it, and from 1.21.6 only if its motion would not take it out. A landing bounces
/// at 0.9 until 1.21.4, then 0.4 of the motion it landed with, and from 1.21.5 only from a real
/// fall (1.8.9 ExperienceOrbEntity.java:85-170, 1.13.2 :89, 1.14.4 ExperienceOrb.java:91, 1.15 :73,
/// 1.17 :56, 1.21.3 :66, 1.21.4 :66, 1.21.5 ExperienceOrb.java:78-124, 1.21.6 :101, 26.3 :96-142).
fn tick_orb(
    state: &mut MovingEntityState,
    world: &WorldSnapshot,
    inputs: &MovingEntityInputs,
    draws: &mut Draws<'_>,
    release: MinecraftVersion,
    outcome: &mut MovingEntityOutcome,
) {
    let modern = release.at_least(1, 21, 5);
    if modern && state.first_tick && !state.server() {
        state.first_tick = false;
        return;
    }
    let mut body = state.body(release);
    base_tick(state, &mut body, world, release);
    if !release.at_least(1, 17, 0) && state.pickup_delay > 0 {
        state.pickup_delay -= 1;
    }
    let colliding = !world.no_collision(body.bounds(), release);
    if release.at_least(1, 13, 0) && entity_eyes_in_fluid(&body, world, FluidState::Water, release)
    {
        let v = body.velocity;
        body.velocity = Vec3::new(
            v.x * f64::from(0.99_f32),
            (v.y + f64::from(5.0e-4_f32)).min(f64::from(0.06_f32)),
            v.z * f64::from(0.99_f32),
        );
    } else if !modern || !colliding {
        apply_gravity(state, &mut body, release);
    }
    if lava_in_cell(&body, world, release) {
        scatter_in_lava(&mut body, draws);
        // (the burn's sound takes a draw until 1.17: 1.16.5 ExperienceOrbEntity.java:92)
        if !release.at_least(1, 17, 0) {
            draws.next();
        }
    }
    if !release.at_least(1, 14, 0) || (!modern && !world.no_collision(body.bounds(), release)) {
        move_towards_closest_space(&mut body, world, draws, release);
    }
    if release.at_least(1, 17, 0) && state.tick_count % 20 == 1 {
        outcome.merge_check = state.server();
    }
    follow_player(state, &mut body, inputs, release);
    if modern && state.following_player.is_none() && state.server() && colliding {
        let blocked = !release.at_least(1, 21, 6)
            || !world.no_collision(body.bounds().translated(body.velocity), release);
        if blocked {
            move_towards_closest_space(&mut body, world, draws, release);
        }
    }
    let falling = body.velocity.y;
    let moved = move_entity(state, &mut body, world, release);
    let friction = if body.on_ground {
        world.slipperiness_at(friction_cell(world, &body, moved.support, release)) as f32 * 0.98
    } else {
        0.98
    };
    let vertical = if modern {
        f64::from(friction)
    } else if release.at_least(1, 14, 0) {
        0.98
    } else {
        f64::from(0.98_f32)
    };
    body.velocity = Vec3::new(
        body.velocity.x * f64::from(friction),
        body.velocity.y * vertical,
        body.velocity.z * f64::from(friction),
    );
    if modern {
        let gravity = if state.no_gravity {
            0.0
        } else {
            state.kind.gravity(release)
        };
        if body.vertical_collision_below && falling < -gravity {
            body.velocity.y = -falling * 0.4;
        }
    } else if body.on_ground {
        if release.at_least(1, 21, 4) {
            body.velocity.y = -falling * 0.4;
        } else if release.at_least(1, 14, 0) {
            body.velocity.y *= -0.9;
        } else {
            body.velocity.y *= f64::from(-0.9_f32);
        }
    }
    state.orb_ticks = state.orb_ticks.wrapping_add(1);
    state.age = state.age.wrapping_add(1);
    if state.age >= 6000 {
        state.removed = true;
    }
    state.adopt(&body);
}

/// The orb's choice of a player and the pull of the one it has.
fn follow_player(
    state: &mut MovingEntityState,
    body: &mut SimulationState,
    inputs: &MovingEntityInputs,
    release: MinecraftVersion,
) {
    let at = body.position;
    let mut target = state
        .following_player
        .and_then(|id| inputs.players.iter().find(|player| player.id == id).copied());
    let far = target.is_none_or(|player| player.position.distance_squared(at) > 64.0);
    if release.at_least(1, 21, 5) {
        if far || target.is_some_and(|player| player.spectator) {
            target = nearest_player(&inputs.players, at).filter(|player| !player.dead);
        }
    } else if release.at_least(1, 17, 0) {
        if state.tick_count % 20 == 1 && far {
            target = nearest_player(&inputs.players, at);
        }
        if target.is_some_and(|player| player.spectator || player.dead) {
            target = None;
        }
    } else {
        if state.following_time < state.orb_ticks.wrapping_sub(20).wrapping_add(state.id % 100) {
            if far {
                target = nearest_player(&inputs.players, at);
            }
            state.following_time = state.orb_ticks;
        }
        if target.is_some_and(|player| player.spectator) {
            target = None;
        }
    }
    state.following_player = target.map(|player| player.id);
    let Some(player) = target else { return };
    if release.at_least(1, 14, 0) {
        let to = Vec3::new(
            player.position.x - at.x,
            player.position.y + f64::from(player.eye_height) / 2.0 - at.y,
            player.position.z - at.z,
        );
        let distance = to.length_squared();
        if distance < 64.0 || release.at_least(1, 21, 5) {
            let power = 1.0 - distance.sqrt() / 8.0;
            body.velocity = body.velocity + to.normalized(release).scale(power * power * 0.1);
        }
        return;
    }
    // (the whole of the eye height in 1.8, half from 1.9: 1.8.9 ExperienceOrbEntity.java:118)
    let eye = if release.at_least(1, 9, 0) {
        f64::from(player.eye_height) / 2.0
    } else {
        f64::from(player.eye_height)
    };
    let (x, y, z) = (
        (player.position.x - at.x) / 8.0,
        (player.position.y + eye - at.y) / 8.0,
        (player.position.z - at.z) / 8.0,
    );
    let length = (x * x + y * y + z * z).sqrt();
    let share = 1.0 - length;
    if share > 0.0 {
        let (share, pull) = (share * share, 0.1);
        body.velocity = body.velocity
            + Vec3::new(
                x / length * share * pull,
                y / length * share * pull,
                z / length * share * pull,
            );
    }
}

/// The mobs whose `travel` is their own. Their AI stays with the server: the control and the motion
/// a travel starts from are the caller's. (The happy ghast and the nautilus a player controls take
/// ridden.rs.)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MobTravelKind {
    Squid,
    /// AbstractFish.
    Fish,
    /// Guardian and ElderGuardian.
    Guardian,
    Ghast,
    Phantom,
    Allay,
    Vex,
    /// Any LivingEntity with nothing of its own in `travel`: a blaze, a zombie. A blaze's slow fall
    /// is its aiStep's before the travel, and comes in as motion.
    Living,
    /// LivingEntity's travel, the motion its AI gives it, and no fall counted.
    Bat,
    /// FlyingAnimal: a bee, a parrot.
    FlyingAnimal,
    Dolphin,
    Turtle,
    Axolotl,
    Frog,
    Drowned,
    /// Spider and CaveSpider: its own climbing, and no cobweb.
    Spider,
    PolarBear,
    /// WitherBoss: nothing makes it stuck.
    Wither,
    ArmorStand,
    /// A mob that can be ridden, out of a saddle: ridden.rs's rules of its kind.
    Mount(crate::ridden::RiddenMobKind),
    SulfurCube,
}

impl MobTravelKind {
    /// The entity's registry name.
    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "squid" | "glow_squid" => Some(Self::Squid),
            "cod" | "salmon" | "tropical_fish" | "pufferfish" | "tadpole" => Some(Self::Fish),
            "guardian" | "elder_guardian" => Some(Self::Guardian),
            "ghast" => Some(Self::Ghast),
            "phantom" => Some(Self::Phantom),
            "allay" => Some(Self::Allay),
            "vex" => Some(Self::Vex),
            "living" | "blaze" | "zombie" | "cow" => Some(Self::Living),
            "bat" => Some(Self::Bat),
            "bee" | "parrot" => Some(Self::FlyingAnimal),
            "dolphin" => Some(Self::Dolphin),
            "turtle" => Some(Self::Turtle),
            "axolotl" => Some(Self::Axolotl),
            "frog" => Some(Self::Frog),
            "drowned" => Some(Self::Drowned),
            "spider" | "cave_spider" => Some(Self::Spider),
            "polar_bear" => Some(Self::PolarBear),
            "wither" => Some(Self::Wither),
            "armor_stand" => Some(Self::ArmorStand),
            "strider" => Some(Self::Mount(crate::ridden::RiddenMobKind::Strider)),
            "skeleton_horse" => Some(Self::Mount(crate::ridden::RiddenMobKind::SkeletonHorse)),
            "sulfur_cube" => Some(Self::SulfurCube),
            _ => None,
        }
    }

    /// Entity.isPushedByFluid of a mob that is not swimming: WaterAnimal, AgeableWaterCreature,
    /// Axolotl and Turtle say no for good (26.3 WaterAnimal.java:59, AgeableWaterCreature.java:53,
    /// Axolotl.java:318, Turtle.java:158).
    #[must_use]
    pub const fn pushed_by_fluid(self) -> bool {
        !matches!(
            self,
            Self::Squid | Self::Fish | Self::Dolphin | Self::Axolotl | Self::Turtle
        )
    }

    /// An empty checkFallDamage: FlyingMob until 26.1 (then Ghast and Phantom), Bat, Parrot, Bee
    /// and Allay (1.8.9 FlyingEntity.java, BatEntity.java; 1.12.2 ParrotEntity.java, 1.15
    /// BeeEntity.java, 1.20.4 AllayEntity.java; 26.3 Ghast.java, Phantom.java, Allay.java, Bat.java,
    /// Bee.java, Parrot.java).
    const fn no_fall_check(self) -> bool {
        matches!(
            self,
            Self::Ghast | Self::Phantom | Self::Allay | Self::Bat | Self::FlyingAnimal
        )
    }

    /// LivingEntity.getWaterSlowDown where it is not the 0.8F of every mob (1.10.2
    /// PolarBearEntity.java; 26.3 PolarBear.java:219).
    const fn water_slow_down(self) -> Option<f32> {
        match self {
            Self::PolarBear => Some(0.98),
            _ => None,
        }
    }
}

/// A mob where its AI left it: what `LivingEntity.travel` starts from.
#[derive(Clone, Debug, PartialEq)]
pub struct MobTravelState {
    pub kind: MobTravelKind,
    pub position: Vec3,
    /// The motion after its AI (a move control or a goal may have set it).
    pub velocity: Vec3,
    /// Entity.getYRot, in degrees: what the input is turned by.
    pub yaw: f32,
    /// xxa, yya, zza.
    pub input: Vec3,
    /// LivingEntity.getSpeed.
    pub speed: f32,
    pub half_width: f64,
    pub height: f64,
    pub max_step: f32,
    pub bounding_box: Option<Aabb>,
    pub on_ground: bool,
    pub collided_horizontally: bool,
    pub collided_vertically: bool,
    pub in_water: bool,
    pub in_lava: bool,
    pub no_gravity: bool,
    pub stuck_speed_multiplier: Vec3,
    pub fall_distance: f64,
    /// Mob.getTarget is set: a fish or guardian then does not sink.
    pub has_target: bool,
    /// Guardian.isMoving: its spikes are out, and it does not sink.
    pub guardian_moving: bool,
    /// A move past MAX_WALKED_CELLS did not run, and the bindings refuse the tick (`move_vehicle`).
    pub move_out_of_range: bool,
    /// Spider.isClimbing: its own onClimbable, in place of the block it is in.
    pub climbing: bool,
    /// Entity.isPushedByFluid.
    pub pushed_by_fluid: bool,
    /// Entity.getFluidJumpThreshold.
    pub fluid_jump_threshold: f64,
    /// Entity.isUnderWater.
    pub under_water: bool,
    /// Drowned.wantsToSwim.
    pub wants_to_swim: bool,
    /// Turtle.goingHome, and within 20 blocks of it: it does not sink.
    pub near_home: bool,
    /// ArmorStand.isMarker.
    pub marker: bool,
    /// Fox and Bee: a sweet berry bush does not hold them.
    pub sweet_berry_bush_immune: bool,
    /// SulfurCube.hasBodyItem.
    pub body_item: bool,
    /// SulfurCube.floatsInLiquids.
    pub floats_in_liquids: bool,
    /// Entity.tickCount: what a floating sulfur cube bobs by.
    pub tick_count: i32,
    /// MobEffects.SLOW_FALLING.
    pub slow_falling: bool,
    /// MobEffects.LEVITATION's amplifier.
    pub levitation_amplifier: Option<i32>,
    /// MobEffects.DOLPHINS_GRACE.
    pub dolphins_grace: bool,
    /// Attributes.GRAVITY, from 1.20.5.
    pub gravity: Option<f64>,
    /// Attributes.WATER_MOVEMENT_EFFICIENCY, from 1.21.
    pub water_movement_efficiency: f64,
}

/// What the rest of `travel` needs of the mob's own rules.
fn plain_of(state: &MobTravelState) -> PlainMob {
    PlainMob {
        yaw: state.yaw,
        max_step: state.max_step,
        pushed_by_fluid: state.pushed_by_fluid,
        fluid_jump_threshold: state.fluid_jump_threshold,
        climbing: (state.kind == MobTravelKind::Spider).then_some(state.climbing),
        water_slow_down: state.kind.water_slow_down(),
        omnidirectional: state.kind == MobTravelKind::FlyingAnimal
            || (state.kind == MobTravelKind::SulfurCube && state.body_item),
        no_fall_check: state.kind.no_fall_check(),
        inside_after_move: state.kind == MobTravelKind::Vex,
        slow_falling: state.slow_falling,
        levitation_amplifier: state.levitation_amplifier,
        dolphins_grace: state.dolphins_grace,
        gravity: state.gravity,
        water_movement_efficiency: state.water_movement_efficiency,
    }
}

/// The speed of a mob's own swim, where it swims: LivingEntity.travel's fluid branch is theirs in
/// water (1.13.2 FishEntity.java:112-126, DolphinEntity.java:374-387, TurtleEntity.java:295-308,
/// 1.17 AxolotlEntity, 1.19 FrogEntity, 26.3 Dolphin.java, Turtle.java, Axolotl.java, Frog.java). A
/// drowned swims only to where it wants: in water, under it from 1.21.2 (1.21 DrownedEntity.java,
/// 1.21.3 :208-210, 26.3 Drowned.java).
fn swim_speed(state: &MobTravelState, in_water: bool, release: MinecraftVersion) -> Option<f32> {
    match state.kind {
        MobTravelKind::Fish if in_water => Some(0.01),
        MobTravelKind::Guardian | MobTravelKind::Turtle if in_water => Some(0.1),
        MobTravelKind::Dolphin | MobTravelKind::Axolotl | MobTravelKind::Frog if in_water => {
            Some(state.speed)
        }
        MobTravelKind::Drowned if state.wants_to_swim => {
            let submerged = if release.at_least(1, 21, 2) {
                state.under_water
            } else {
                in_water
            };
            submerged.then_some(0.01)
        }
        _ => None,
    }
}

/// Whether the swim ends with the sink of 0.005.
fn sinks(state: &MobTravelState) -> bool {
    match state.kind {
        MobTravelKind::Fish | MobTravelKind::Dolphin => !state.has_target,
        MobTravelKind::Guardian => !state.guardian_moving && !state.has_target,
        MobTravelKind::Turtle => !state.has_target && !state.near_home,
        _ => false,
    }
}

/// ArmorStand.travel: only with its physics, which a marker lost at 1.14 (1.13.2
/// ArmorStandEntity.java, 1.14 :137, 26.3 ArmorStand.java).
fn armor_stand_travels(state: &MobTravelState, release: MinecraftVersion) -> bool {
    !state.no_gravity && !(state.marker && release.at_least(1, 14, 0))
}

/// LivingEntity.travel of a mob with nothing of its own left in it, and a sulfur cube's float in a
/// fluid after it (26.3 SulfurCube.java:176-185).
fn travel_living(
    state: &MobTravelState,
    body: &mut SimulationState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> Option<VehicleMove> {
    let bounds = body.bounds();
    let heights = (
        world.fluid_contact(FluidState::Water, bounds, release).height,
        world.fluid_contact(FluidState::Lava, bounds, release).height,
    );
    let in_fluid = body.in_water || body.in_lava;
    let in_water = body.in_water;
    let kind = match state.kind {
        MobTravelKind::Mount(kind) => kind,
        _ => crate::ridden::RiddenMobKind::Pig,
    };
    let moved = crate::ridden::plain_living_travel(
        kind,
        state.position,
        state.speed,
        state.input,
        body,
        world,
        release,
        plain_of(state),
    );
    if state.kind == MobTravelKind::SulfurCube && state.body_item && state.floats_in_liquids && in_fluid {
        let (water, lava) = moved
            .and_then(|moved| moved.fluid_heights)
            .unwrap_or(heights);
        let vibe = 0.2 * crate::simulation::mth_sin(f64::from(state.tick_count as f32 * 0.4), release) as f32;
        let height = if in_water { water } else { lava };
        let immersion = height - state.fluid_jump_threshold + f64::from(vibe);
        if immersion > 0.0 {
            body.velocity = body.velocity + Vec3::new(0.0, immersion.min(1.0) * f64::from(0.04_f32), 0.0);
        }
    }
    moved
}

/// One LivingEntity.travel of the mob, with what its aiStep does right after it from 1.21.2:
/// applyEffectsFromBlocks. Nothing else of its tick: its AI before, and what its aiStep does later
/// (a squid's next motion), are the server's.
pub fn tick_mob_travel(state: &mut MobTravelState, world: &WorldSnapshot, release: MinecraftVersion) {
    let keeps_box = !release.at_least(1, 17, 0);
    let is_vex = state.kind == MobTravelKind::Vex;
    let mut body = SimulationState {
        position: state.position,
        velocity: state.velocity,
        half_width: state.half_width,
        height: state.height,
        on_ground: state.on_ground,
        collided_horizontally: state.collided_horizontally,
        collided_vertically: state.collided_vertically,
        in_water: state.in_water,
        in_lava: state.in_lava,
        no_gravity: state.no_gravity,
        // (Vex.tick lets it through all blocks: 1.11.2 EntityVex, 26.3 Vex.java:71-76)
        no_physics: is_vex,
        web_immune: state.kind == MobTravelKind::Spider,
        stuck_immune: state.kind == MobTravelKind::Wither,
        sweet_berry_bush_immune: state.sweet_berry_bush_immune,
        fall_distance: state.fall_distance,
        controlled_by_local_instance: true,
        stuck_speed_multiplier: state.stuck_speed_multiplier,
        bounding_box: keeps_box.then_some(state.bounding_box).flatten(),
        ..SimulationState::default()
    };
    if keeps_box && body.bounding_box.is_none() {
        let half = state.half_width;
        let at = state.position;
        body.bounding_box = Some(Aabb::new(
            Vec3::new(at.x - half, at.y, at.z - half),
            Vec3::new(at.x + half, at.y + state.height, at.z + half),
        ));
    }
    let old_position = body.position;
    let swims = swim_speed(state, body.in_water, release);
    let moved = match (state.kind, swims) {
        (MobTravelKind::Squid, _) => Some(mob_move(state, &mut body, world, release)),
        (_, Some(speed)) => {
            mob_relative(state, &mut body, speed, release);
            let moved = mob_move(state, &mut body, world, release);
            // (float before 1.14: 1.8.9 GuardianEntity.java:travel, 1.13.2 DolphinEntity.java:378,
            // 1.14 the double)
            body.velocity = body.velocity.scale(if release.at_least(1, 14, 0) {
                0.9
            } else {
                f64::from(0.9_f32)
            });
            if sinks(state) {
                body.velocity.y -= 0.005;
            }
            Some(moved)
        }
        (MobTravelKind::Ghast | MobTravelKind::Phantom | MobTravelKind::Allay, _) => {
            travel_flying(state, &mut body, world, release)
        }
        (MobTravelKind::ArmorStand, _) if !armor_stand_travels(state, release) => None,
        _ => travel_living(state, &mut body, world, release),
    };
    if release.at_least(1, 21, 2) {
        // Entity.applyEffectsFromBlocks at the end of LivingEntity's travel step (1.21.3
        // LivingEntity.java:2785, 26.3 :3064-3066). A vex is affected though it has noPhysics
        // (1.21.3 VexEntity.java:65, 26.3 Vex.java:68): that noPhysics is its tick's, and its travel
        // has no move to apply them in; no other mob has it.
        let (requested, displacement) =
            moved.map_or((Vec3::ZERO, Vec3::ZERO), |moved| (moved.requested, moved.moved));
        let movements = movements_this_tick(&body, old_position, requested, displacement, release);
        let (inside, _) = blocks_inside_moves(&body, world, &movements, release);
        let support = moved.and_then(|moved| moved.support);
        body.no_physics = false;
        apply_block_effects(&mut body, world, support, release, &inside);
    }
    state.position = body.position;
    state.velocity = body.velocity;
    state.bounding_box = body.bounding_box;
    state.on_ground = body.on_ground;
    state.collided_horizontally = body.collided_horizontally;
    state.collided_vertically = body.collided_vertically;
    state.fall_distance = body.fall_distance;
    state.stuck_speed_multiplier = body.stuck_speed_multiplier;
    state.move_out_of_range |= body.move_out_of_range;
}

fn mob_relative(
    state: &MobTravelState,
    body: &mut SimulationState,
    speed: f32,
    release: MinecraftVersion,
) {
    let turn = crate::simulation::yaw_radians(state.yaw, release);
    let push = crate::simulation::relative_movement(state.input, f64::from(speed), turn, release);
    body.velocity = body.velocity + push;
}

fn mob_move(
    state: &MobTravelState,
    body: &mut SimulationState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> VehicleMove {
    let rules = MoveRules {
        living: true,
        max_step: state.max_step,
        gravity: if state.no_gravity { 0.0 } else { 0.08 },
        air_drag: f64::from(0.98_f32),
        bounciness: 0.0,
        stands_on_lava: false,
        checks_inside_at_fall: false,
        rails_keep_speed: false,
        ignored: [None, None],
    };
    crate::ridden::plain_living_move(body, world, release, rules, plain_of(state))
}

/// FlyingMob.travel until 1.21.5 for a ghast and a phantom, Allay.travel for an allay; from 1.21.6
/// LivingEntity.travelFlying with each one's speed in the air (1.8.9 FlyingEntity.java,
/// 1.21.4 FlyingEntity.java:20-46, 1.21.5 FlyingMob.java:18-44, 1.20.4 AllayEntity.java:170-187,
/// 26.3 LivingEntity.java:2364-2380, Ghast.java:90, Phantom.java:133, Allay.java:134).
fn travel_flying(
    state: &MobTravelState,
    body: &mut SimulationState,
    world: &WorldSnapshot,
    release: MinecraftVersion,
) -> Option<VehicleMove> {
    if body.in_water || body.in_lava {
        mob_relative(state, body, 0.02, release);
        let moved = mob_move(state, body, world, release);
        let drag = if body.in_water {
            f64::from(0.8_f32)
        } else {
            0.5
        };
        body.velocity = body.velocity.scale(drag);
        return Some(moved);
    }
    let modern = release.at_least(1, 21, 6);
    if modern || state.kind == MobTravelKind::Allay {
        let speed = match state.kind {
            MobTravelKind::Ghast => 0.02,
            MobTravelKind::Phantom => 0.2,
            _ => state.speed,
        };
        mob_relative(state, body, speed, release);
        let moved = mob_move(state, body, world, release);
        body.velocity = body.velocity.scale(f64::from(0.91_f32));
        return Some(moved);
    }
    let ground = |body: &SimulationState, support| {
        world.slipperiness_at(crate::simulation::block_below_affecting_movement(world, body, support, release)) as f32 * 0.91
    };
    let support = release
        .at_least(1, 20, 0)
        .then(|| crate::simulation::main_supporting_block(world, body, None, release))
        .flatten();
    let friction = if body.on_ground { ground(body, support) } else { 0.91 };
    let speed = if body.on_ground {
        0.1 * (0.162_771_37 / (friction * friction * friction))
    } else {
        0.02
    };
    mob_relative(state, body, speed, release);
    let moved = mob_move(state, body, world, release);
    body.velocity = body.velocity.scale(f64::from(friction));
    Some(moved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::{BlockEffect, BlockShape, BlockState};

    #[test]
    fn an_items_cell_test_is_of_ints() {
        let (old, new) = (R1_13, MinecraftVersion::new(1, 14, 4));
        let at = |x: f64| Vec3::new(x, 64.0, 0.5);
        // `(int)` truncates towards zero until 1.14, Mth.floor floors from it
        assert!(!moved_to_another_cell(at(-0.5), at(0.5), old));
        assert!(moved_to_another_cell(at(-0.5), at(0.5), new));
        // both are ints: past the range two coordinates are the one cell
        assert!(!moved_to_another_cell(at(3.0e9), at(3.0e9 + 5.0), old));
        assert!(!moved_to_another_cell(at(3.0e9), at(3.0e9 + 5.0), new));
    }

    const R1_8: MinecraftVersion = MinecraftVersion::new(1, 8, 8);
    const R1_9: MinecraftVersion = MinecraftVersion::new(1, 9, 4);
    const R1_10: MinecraftVersion = MinecraftVersion::new(1, 10, 2);
    const R1_11: MinecraftVersion = MinecraftVersion::new(1, 11, 2);
    const R1_12: MinecraftVersion = MinecraftVersion::new(1, 12, 2);
    const R1_13: MinecraftVersion = MinecraftVersion::new(1, 13, 2);
    const R1_14: MinecraftVersion = MinecraftVersion::new(1, 14, 4);
    const R1_15: MinecraftVersion = MinecraftVersion::new(1, 15, 0);
    const R1_16: MinecraftVersion = MinecraftVersion::new(1, 16, 1);
    const R1_16_2: MinecraftVersion = MinecraftVersion::new(1, 16, 2);
    const R1_17: MinecraftVersion = MinecraftVersion::new(1, 17, 0);
    const R1_18: MinecraftVersion = MinecraftVersion::new(1, 18, 0);
    const R1_18_2: MinecraftVersion = MinecraftVersion::new(1, 18, 2);
    const R1_20: MinecraftVersion = MinecraftVersion::new(1, 20, 4);
    const R1_20_5: MinecraftVersion = MinecraftVersion::new(1, 20, 5);
    const R1_21_3: MinecraftVersion = MinecraftVersion::new(1, 21, 3);
    const R1_21_4: MinecraftVersion = MinecraftVersion::new(1, 21, 4);
    const R1_21_5: MinecraftVersion = MinecraftVersion::new(1, 21, 5);
    const R1_21_6: MinecraftVersion = MinecraftVersion::new(1, 21, 6);
    const R1_21_8: MinecraftVersion = MinecraftVersion::new(1, 21, 8);
    const R1_21_9: MinecraftVersion = MinecraftVersion::new(1, 21, 9);
    const R26_1: MinecraftVersion = MinecraftVersion::new(26, 1, 0);
    const R26_2: MinecraftVersion = MinecraftVersion::new(26, 2, 0);
    const R26_3: MinecraftVersion = MinecraftVersion::new(26, 3, 0);

    fn solid(id: u32, slipperiness: f64) -> BlockState {
        BlockState {
            id,
            shape: Some(BlockShape {
                slipperiness,
                ..BlockShape::full_block()
            }),
            ..BlockState::default()
        }
    }

    /// A floor under y = 100.
    fn floor(slipperiness: f64) -> WorldSnapshot {
        let mut world = WorldSnapshot::new();
        for x in -6..=6 {
            for z in -6..=6 {
                world.set_block((x, 99, z), solid(1, slipperiness));
            }
        }
        world
    }

    fn fluid(kind: FluidState) -> BlockState {
        BlockState {
            fluid: kind,
            fluid_source: true,
            ..BlockState::default()
        }
    }

    fn tick(
        state: &mut MovingEntityState,
        world: &WorldSnapshot,
        release: MinecraftVersion,
    ) -> MovingEntityOutcome {
        tick_moving_entity(state, world, &MovingEntityInputs::default(), release)
    }

    fn entity(kind: MovingEntityKind, y: f64, velocity: Vec3) -> MovingEntityState {
        MovingEntityState::new(kind, Vec3::new(0.5, y, 0.5), velocity)
    }

    fn one_draw() -> MovingEntityInputs {
        MovingEntityInputs {
            random: vec![0.5],
            ..MovingEntityInputs::default()
        }
    }

    #[test]
    fn gravity_is_a_float_before_1_14_and_the_drag_a_double_until_26_2() {
        let world = floor(0.6);
        let fall = |release| {
            let mut state = entity(MovingEntityKind::PrimedTnt, 110.0, Vec3::ZERO);
            tick(&mut state, &world, release);
            state.velocity.y
        };
        assert_eq!(fall(R1_13), -f64::from(0.04_f32) * f64::from(0.98_f32));
        assert_eq!(fall(R1_14), -0.04 * 0.98);
        assert_eq!(fall(R26_1), -0.04 * 0.98);
        assert_eq!(fall(R26_2), -0.04 * f64::from(0.98_f32));
    }

    #[test]
    fn tnt_keeps_seven_tenths_of_its_motion_on_landing() {
        let world = floor(0.6);
        let mut state = entity(MovingEntityKind::PrimedTnt, 100.01, Vec3::new(0.1, -0.2, 0.0));
        tick(&mut state, &world, R1_20);
        assert!(state.on_ground);
        assert_eq!(state.velocity.x, 0.1 * 0.98 * 0.7);
        assert!(state.velocity.y == 0.0 && state.velocity.y.is_sign_positive());
    }

    #[test]
    fn the_fuse_runs_a_tick_longer_in_1_8_and_only_the_server_explodes() {
        let world = floor(0.6);
        for (release, ticks_left) in [(R1_8, 2), (R1_9, 1)] {
            let mut state = entity(MovingEntityKind::PrimedTnt, 100.0, Vec3::ZERO).on_server();
            state.fuse = 1;
            for left in (0..ticks_left).rev() {
                let outcome = tick(&mut state, &world, release);
                assert_eq!(outcome.explodes, left == 0, "{release:?}");
            }
            assert!(state.removed);
        }
        let mut client = entity(MovingEntityKind::PrimedTnt, 100.0, Vec3::ZERO);
        client.fuse = 1;
        let outcome = tick(&mut client, &world, R26_3);
        assert!(client.removed, "the client discards it too");
        assert!(!outcome.explodes);
    }

    #[test]
    fn no_gravity_counts_from_1_10() {
        let world = WorldSnapshot::new();
        let moves = |release| {
            let mut state = entity(MovingEntityKind::Item, 110.0, Vec3::ZERO);
            state.no_gravity = true;
            tick(&mut state, &world, release);
            state.velocity.y
        };
        assert!(moves(R1_9) < 0.0);
        assert_eq!(moves(R1_10), 0.0);
    }

    #[test]
    fn the_void_ends_an_item_and_not_tnt_which_has_no_base_tick() {
        let world = WorldSnapshot::new();
        let mut tnt = entity(MovingEntityKind::PrimedTnt, -70.0, Vec3::ZERO);
        tick(&mut tnt, &world, R1_13);
        assert!(!tnt.removed);
        let mut item = entity(MovingEntityKind::Item, -70.0, Vec3::ZERO);
        tick(&mut item, &world, R1_13);
        assert!(item.removed);
    }

    #[test]
    fn a_client_falling_block_waits_for_the_server_and_places_nothing() {
        let world = floor(0.6);
        let mut client = entity(MovingEntityKind::FallingBlock, 100.0, Vec3::new(0.0, -0.1, 0.0));
        client.time = 5;
        let outcome = tick(&mut client, &world, R26_3);
        assert!(client.on_ground && !client.removed);
        assert_eq!(outcome, MovingEntityOutcome::default());
        let mut server = entity(MovingEntityKind::FallingBlock, 100.0, Vec3::new(0.0, -0.1, 0.0)).on_server();
        server.time = 5;
        let outcome = tick(&mut server, &world, R26_3);
        assert!(server.removed);
        assert_eq!(outcome.landed_at, Some((0, 100, 0)));
    }

    #[test]
    fn a_client_leaves_a_landing_motion_to_the_server_from_1_21_2_until_26_3() {
        // 1.21.2 Entity.java:721-724, 1.21.5 :720-725: the block's fall stop is for the side that simulates;
        // 26.3 ItemEntity.java:429 simulates on both sides; 1.21 Entity.java:667 had no such gate
        let world = floor(0.6);
        let landed = |release| {
            let mut client = entity(MovingEntityKind::PrimedTnt, 100.1, Vec3::new(0.0, -0.3, 0.0));
            tick(&mut client, &world, release);
            client.velocity.y
        };
        assert!(landed(MinecraftVersion::new(1, 21, 8)) > 0.1);
        assert!(landed(MinecraftVersion::new(1, 21, 2)) > 0.1);
        assert_eq!(landed(MinecraftVersion::new(1, 21, 0)).abs(), 0.0);
    }

    #[test]
    fn a_moving_piston_under_a_landed_block_lets_it_bounce_on() {
        let mut world = floor(0.6);
        world.set_block((0, 100, 0), BlockState::default());
        world.set_moving_block((0, 100, 0), &[], false);
        let mut server = entity(MovingEntityKind::FallingBlock, 100.0, Vec3::new(0.0, -0.1, 0.0)).on_server();
        server.time = 5;
        let outcome = tick(&mut server, &world, R26_3);
        assert!(!server.removed);
        assert_eq!(outcome.landed_at, None);
    }

    #[test]
    fn the_first_tick_takes_the_block_out_only_before_1_18_2() {
        let mut world = floor(0.6);
        world.set_block((0, 105, 0), solid(12, 0.6));
        let start = || {
            let mut state = entity(MovingEntityKind::FallingBlock, 105.0, Vec3::ZERO).on_server();
            state.carried_block = 12;
            state
        };
        let mut old = start();
        assert_eq!(tick(&mut old, &world, R1_18).clears_block, Some((0, 105, 0)));
        assert!(old.position.y < 105.0, "it fell out of the block it took");
        let mut new = start();
        assert_eq!(tick(&mut new, &world, R1_18_2).clears_block, None);
        // a server drops an entity whose block is gone, and a client keeps it
        let mut gone = start();
        gone.carried_block = 13;
        tick(&mut gone, &world, R1_18);
        assert!(gone.removed);
        let mut client = start();
        client.carried_block = 13;
        client.authority = MovingEntityAuthority::Client;
        tick(&mut client, &world, R1_18);
        assert!(!client.removed);
    }

    #[test]
    fn only_1_18_and_1_18_1_freeze_a_client_block_that_is_going() {
        let world = WorldSnapshot::new();
        let frozen = |release| {
            let mut state = entity(MovingEntityKind::FallingBlock, 105.0, Vec3::ZERO);
            state.time = 4;
            state.discarding = true;
            tick(&mut state, &world, release);
            state.position.y == 105.0
        };
        assert!(frozen(R1_18));
        assert!(!frozen(R1_17));
        assert!(!frozen(R1_18_2));
    }

    #[test]
    fn a_falling_block_drags_before_its_landing_until_1_12() {
        let world = floor(0.6);
        let landed = |release| {
            let mut state = entity(MovingEntityKind::FallingBlock, 100.0, Vec3::new(0.1, -0.1, 0.0)).on_server();
            state.time = 3;
            state.concrete_powder = false;
            tick(&mut state, &world, release);
            state.velocity.x
        };
        assert_eq!(landed(R1_11), 0.1 * f64::from(0.98_f32) * f64::from(0.7_f32));
        assert_eq!(landed(R1_12), 0.1 * f64::from(0.7_f32) * f64::from(0.98_f32));
    }

    #[test]
    fn from_1_9_until_1_14_a_block_with_nothing_solid_under_its_feet_falls_on() {
        let world = floor(0.6);
        let inputs = MovingEntityInputs {
            falls_through_below: true,
            ..MovingEntityInputs::default()
        };
        for (release, carries_on) in [(R1_8, false), (R1_9, true), (R1_13, true), (R1_14, false)] {
            let mut state = entity(MovingEntityKind::FallingBlock, 100.0, Vec3::new(0.0, -0.1, 0.0)).on_server();
            state.time = 3;
            tick_moving_entity(&mut state, &world, &inputs, release);
            assert_eq!(!state.removed, carries_on, "{release:?}");
        }
    }

    #[test]
    fn water_stops_a_concrete_powder_and_nothing_else() {
        let mut world = WorldSnapshot::new();
        world.set_block((0, 104, 0), fluid(FluidState::Water));
        let in_water = |concrete, release| {
            let mut state = entity(MovingEntityKind::FallingBlock, 104.5, Vec3::ZERO).on_server();
            state.time = 3;
            state.concrete_powder = concrete;
            tick(&mut state, &world, release).landed_at.is_some()
        };
        assert!(in_water(true, R1_13));
        assert!(!in_water(false, R1_13));
        assert!(!in_water(true, R1_11), "there was none before 1.12");
    }

    #[test]
    fn a_fast_concrete_powder_stops_at_the_water_it_passes_through() {
        let mut world = WorldSnapshot::new();
        world.set_block((0, 103, 0), fluid(FluidState::Water));
        let mut state = entity(MovingEntityKind::FallingBlock, 105.5, Vec3::new(0.0, -3.0, 0.0)).on_server();
        state.time = 3;
        state.concrete_powder = true;
        assert_eq!(tick(&mut state, &world, R1_20).landed_at, Some((0, 103, 0)));
    }

    #[test]
    fn a_block_falls_for_600_ticks_at_most_and_100_outside_the_world() {
        let mut world = WorldSnapshot::new();
        world.set_world_bounds(-64, 320, 0.0, 0.0, 1.0e7);
        let expired = |time, y, release| {
            let mut state = entity(MovingEntityKind::FallingBlock, y, Vec3::ZERO).on_server();
            state.time = time;
            state.no_gravity = true;
            tick(&mut state, &world, release).expired
        };
        assert!(!expired(599, 100.0, R26_3) || !expired(598, 100.0, R26_3));
        assert!(expired(600, 100.0, R26_3));
        assert!(!expired(99, -64.0, R26_3));
        assert!(expired(100, -64.0, R26_3));
        assert!(!expired(100, 320.0, R1_20), "the height counts as inside until 1.21.2");
        assert!(expired(100, 320.0, R26_3));
        assert!(expired(100, 257.0, R1_14));
    }

    #[test]
    fn an_item_rests_three_ticks_in_four_from_1_15() {
        let world = floor(0.6);
        let settled = |id| {
            let mut state = entity(MovingEntityKind::Item, 100.0, Vec3::ZERO);
            state.on_ground = true;
            state.id = id;
            state
        };
        let mut resting = settled(1);
        tick(&mut resting, &world, R1_15);
        assert_eq!(resting.velocity.y, -0.04, "gravity, and no move to stop it");
        let mut moving = settled(3);
        tick(&mut moving, &world, R1_15);
        assert_ne!(moving.velocity.y, -0.04);
        let mut old = settled(1);
        tick(&mut old, &world, R1_14);
        assert_ne!(old.velocity.y, -0.04, "it moved every tick before 1.15");
    }

    #[test]
    fn an_item_slides_by_the_friction_of_its_block() {
        let world = floor(0.98);
        let mut state = entity(MovingEntityKind::Item, 100.01, Vec3::new(0.2, -0.1, 0.0));
        tick(&mut state, &world, R1_20);
        assert_eq!(state.velocity.x, 0.2 * f64::from(0.98_f32 * 0.98_f32));
    }

    #[test]
    fn an_item_going_up_when_it_lands_turns_back_only_before_1_16_2() {
        let mut world = floor(0.6);
        world.set_block((0, 99, 0), solid(1, 0.6));
        let after = |release| {
            let mut state = entity(MovingEntityKind::Item, 100.0, Vec3::new(0.0, -0.1, 0.0));
            tick(&mut state, &world, release);
            state.velocity.y
        };
        // landing leaves the motion at -0, which only the old way multiplies
        assert!(after(R1_16).is_sign_positive());
        assert!(after(R1_16_2).is_sign_negative());
    }

    #[test]
    fn water_lifts_an_item_and_an_orb_from_1_13_and_lets_them_sink_before() {
        let mut world = WorldSnapshot::new();
        for y in 103..=105 {
            world.set_block((0, y, 0), fluid(FluidState::Water));
        }
        let lift = |kind, release| {
            let mut state = entity(kind, 104.2, Vec3::ZERO);
            tick(&mut state, &world, release);
            state.velocity.y
        };
        assert!(lift(MovingEntityKind::Item, R1_12) < 0.0);
        assert!(lift(MovingEntityKind::Item, R1_13) > 0.0);
        assert!(lift(MovingEntityKind::ExperienceOrb, R1_12) < 0.0);
        assert!(lift(MovingEntityKind::ExperienceOrb, R1_13) > 0.0);
    }

    #[test]
    fn lava_lifts_an_item_from_1_16() {
        let mut world = WorldSnapshot::new();
        for y in 103..=105 {
            world.set_block((0, y, 0), fluid(FluidState::Lava));
        }
        let lift = |release| {
            let mut state = entity(MovingEntityKind::Item, 104.2, Vec3::new(0.1, 0.0, 0.0));
            state.tick_count = 1;
            tick(&mut state, &world, release);
            state.velocity.y
        };
        assert!(lift(R1_15) < 0.0);
        assert!(lift(R1_20) > 0.0);
    }

    #[test]
    fn lava_throws_an_item_until_1_17_and_its_sound_takes_a_draw() {
        let mut world = WorldSnapshot::new();
        world.set_block((0, 105, 0), fluid(FluidState::Lava));
        let inputs = MovingEntityInputs {
            random: vec![0.75, 0.25, 0.5, 0.0, 0.9],
            ..MovingEntityInputs::default()
        };
        let mut state = entity(MovingEntityKind::Item, 105.5, Vec3::ZERO);
        state.tick_count = 24;
        let outcome = tick_moving_entity(&mut state, &world, &inputs, R1_13);
        assert_eq!(outcome.random_used, 5);
        assert_eq!(state.velocity.x, f64::from(0.5_f32 * 0.2) * f64::from(0.98_f32));
        let mut late = entity(MovingEntityKind::Item, 105.5, Vec3::ZERO);
        late.tick_count = 39;
        assert_eq!(tick_moving_entity(&mut late, &world, &inputs, R1_17).random_used, 0);
    }

    #[test]
    fn a_tick_that_needs_a_draw_it_was_not_given_says_so() {
        let mut world = WorldSnapshot::new();
        world.set_block((0, 105, 0), fluid(FluidState::Lava));
        let mut state = entity(MovingEntityKind::ExperienceOrb, 105.0, Vec3::ZERO);
        assert!(tick(&mut state, &world, R1_20).random_missing);
    }

    fn stuck_world() -> WorldSnapshot {
        let mut world = WorldSnapshot::new();
        world.set_block((0, 100, 0), solid(1, 0.6));
        world
    }

    fn stuck(kind: MovingEntityKind, y: f64) -> MovingEntityState {
        MovingEntityState::new(kind, Vec3::new(0.1, y, 0.5), Vec3::ZERO)
    }

    #[test]
    fn a_server_item_leaves_a_block_and_a_client_one_stays_from_1_11() {
        let world = stuck_world();
        let inputs = one_draw();
        let mut server = stuck(MovingEntityKind::Item, 100.4).on_server();
        tick_moving_entity(&mut server, &world, &inputs, R26_3);
        assert!(server.no_physics);
        assert!(server.position.x < 0.1);
        let mut client = stuck(MovingEntityKind::Item, 100.4);
        let outcome = tick_moving_entity(&mut client, &world, &inputs, R26_3);
        assert!(!client.no_physics);
        assert_eq!(outcome.random_used, 0);
        let mut old = stuck(MovingEntityKind::Item, 100.4);
        assert_eq!(tick_moving_entity(&mut old, &world, &inputs, R1_10).random_used, 1);
    }

    #[test]
    fn the_way_out_of_a_block_has_changed_three_times() {
        let world = stuck_world();
        let inputs = one_draw();
        let after = |release| {
            let mut state = stuck(MovingEntityKind::Item, 100.4);
            state.velocity = Vec3::new(0.04, 0.0, 0.08);
            let mut body = state.body(release);
            let mut draws = Draws {
                random: &inputs.random,
                used: 0,
                missing: false,
            };
            move_towards_closest_space(&mut body, &world, &mut draws, release);
            body.velocity
        };
        let speed = -f64::from(0.5_f32 * 0.2 + 0.1);
        assert_eq!(after(R1_8), Vec3::new(speed, 0.0, 0.08), "set");
        assert_eq!(after(R1_9), Vec3::new(0.04 + speed, 0.0, 0.08), "added");
        assert_eq!(after(R1_11), Vec3::new(speed, 0.0, 0.06), "set, the rest at 3/4");
        assert_eq!(after(R1_14), Vec3::new(speed, 0.0, 0.06));
    }

    #[test]
    fn north_goes_before_west_from_1_14() {
        let world = stuck_world();
        let inputs = one_draw();
        let after = |release| {
            let mut state = MovingEntityState::new(MovingEntityKind::Item, Vec3::new(0.25, 100.5, 0.25), Vec3::ZERO);
            state.bounding_box = None;
            let mut body = state.body(release);
            let mut draws = Draws {
                random: &inputs.random,
                used: 0,
                missing: false,
            };
            move_towards_closest_space(&mut body, &world, &mut draws, release);
            body.velocity
        };
        assert!(after(R1_13).x < 0.0);
        assert!(after(R1_14).z < 0.0);
    }

    fn player(position: Vec3) -> MovingEntityPlayer {
        MovingEntityPlayer {
            id: 7,
            position,
            eye_height: 1.62,
            spectator: false,
            dead: false,
        }
    }

    fn orb_inputs(position: Vec3) -> MovingEntityInputs {
        MovingEntityInputs {
            players: vec![player(position)],
            ..MovingEntityInputs::default()
        }
    }

    #[test]
    fn an_orb_follows_the_nearest_player_within_8_blocks() {
        let world = WorldSnapshot::new();
        let pulled = |x: f64| {
            let mut state = entity(MovingEntityKind::ExperienceOrb, 110.0, Vec3::ZERO).on_server();
            let inputs = orb_inputs(Vec3::new(x, 109.0, 0.5));
            tick_moving_entity(&mut state, &world, &inputs, R26_3);
            state
        };
        let near = pulled(4.5);
        assert_eq!(near.following_player, Some(7));
        assert!(near.velocity.x > 0.0);
        let far = pulled(9.5);
        assert_eq!(far.following_player, None);
        assert_eq!(far.velocity.x, 0.0);
    }

    #[test]
    fn a_spectator_draws_no_orb() {
        let world = WorldSnapshot::new();
        let mut state = entity(MovingEntityKind::ExperienceOrb, 110.0, Vec3::ZERO).on_server();
        let mut watcher = player(Vec3::new(2.5, 110.0, 0.5));
        watcher.spectator = true;
        let inputs = MovingEntityInputs {
            players: vec![watcher],
            ..MovingEntityInputs::default()
        };
        tick_moving_entity(&mut state, &world, &inputs, R26_3);
        assert_eq!(state.following_player, None);
    }

    #[test]
    fn an_orb_looks_for_a_player_by_its_own_count_then_every_20_ticks_then_every_tick() {
        let world = WorldSnapshot::new();
        let inputs = orb_inputs(Vec3::new(4.5, 110.0, 0.5));
        let looks = |tick_count, release| {
            let mut state = entity(MovingEntityKind::ExperienceOrb, 110.0, Vec3::ZERO).on_server();
            state.tick_count = tick_count;
            state.orb_ticks = 100;
            state.following_time = 90;
            tick_moving_entity(&mut state, &world, &inputs, release);
            state.following_player.is_some()
        };
        assert!(!looks(5, R1_16), "it looked 10 of its ticks ago");
        assert!(looks(0, R1_17), "the 1st of 20");
        assert!(!looks(1, R1_17));
        assert!(looks(1, R1_21_5));
    }

    #[test]
    fn the_pull_of_a_player_takes_the_whole_eye_height_in_1_8_and_half_after() {
        let world = WorldSnapshot::new();
        // under the orb's feet by half the eye height and over them by the whole
        let inputs = orb_inputs(Vec3::new(0.5, 109.0, 0.5));
        let rise = |release| {
            let mut state = entity(MovingEntityKind::ExperienceOrb, 110.0, Vec3::ZERO).on_server();
            state.following_player = Some(7);
            state.no_gravity = true;
            state.pickup_delay = 0;
            tick_moving_entity(&mut state, &world, &inputs, release);
            state.velocity.y
        };
        assert!(rise(R1_8) > rise(R1_9));
    }

    #[test]
    fn a_player_too_far_pulls_only_from_1_21_5_where_the_orb_lets_it_go_first() {
        let world = WorldSnapshot::new();
        let inputs = orb_inputs(Vec3::new(8.7, 110.0, 0.5));
        let mut state = entity(MovingEntityKind::ExperienceOrb, 110.0, Vec3::ZERO).on_server();
        state.following_player = Some(7);
        state.tick_count = 5;
        tick_moving_entity(&mut state, &world, &inputs, R1_20);
        assert_eq!(state.velocity.x, 0.0, "it keeps its player, but past 8 blocks no pull");
        assert_eq!(state.following_player, Some(7));
        state.velocity = Vec3::ZERO;
        state.tick_count = 5;
        tick_moving_entity(&mut state, &world, &inputs, R1_21_5);
        assert_eq!(state.following_player, None);
    }

    #[test]
    fn an_orb_on_the_ground_bounces_by_the_release() {
        let world = floor(0.6);
        let bounce = |release| {
            let mut state = entity(MovingEntityKind::ExperienceOrb, 100.01, Vec3::new(0.0, -0.3, 0.0)).on_server();
            tick(&mut state, &world, release);
            state.velocity.y
        };
        let falling = -0.3 - 0.03;
        assert_eq!(bounce(R1_21_3), 0.0);
        assert_eq!(bounce(R1_21_4), -falling * 0.4);
        assert_eq!(bounce(R1_21_5), -falling * 0.4);
        let settled = |release| {
            let mut state = entity(MovingEntityKind::ExperienceOrb, 100.0, Vec3::ZERO).on_server();
            state.on_ground = true;
            tick(&mut state, &world, release);
            state.velocity.y
        };
        assert_eq!(settled(R1_21_4), 0.03 * 0.4);
        assert_eq!(settled(R1_21_5), 0.0, "only a real fall bounces");
    }

    #[test]
    fn a_client_orb_skips_its_first_tick_from_1_21_5() {
        let world = WorldSnapshot::new();
        let moved = |release| {
            let mut state = entity(MovingEntityKind::ExperienceOrb, 110.0, Vec3::ZERO);
            tick(&mut state, &world, release);
            assert!(!state.first_tick);
            state.position.y != 110.0
        };
        assert!(moved(R1_20_5));
        assert!(!moved(R1_21_5));
    }

    #[test]
    fn an_orb_in_a_block_stays_from_1_21_6_if_its_motion_takes_it_out() {
        let world = stuck_world();
        let drew = |release, velocity| {
            let mut state = stuck(MovingEntityKind::ExperienceOrb, 100.2).on_server();
            state.velocity = velocity;
            tick_moving_entity(&mut state, &world, &one_draw(), release).random_used
        };
        assert_eq!(drew(R1_21_5, Vec3::new(2.0, 0.0, 0.0)), 1);
        assert_eq!(drew(R1_21_6, Vec3::new(2.0, 0.0, 0.0)), 0);
        assert_eq!(drew(R1_21_6, Vec3::ZERO), 1);
    }

    #[test]
    fn a_client_orb_leaves_a_block_itself_only_until_1_21_5() {
        let world = stuck_world();
        let drew = |release| {
            let mut state = stuck(MovingEntityKind::ExperienceOrb, 100.2);
            state.first_tick = false;
            tick_moving_entity(&mut state, &world, &one_draw(), release).random_used
        };
        assert_eq!(drew(R1_20), 1);
        assert_eq!(drew(R1_21_5), 0);
    }

    #[test]
    fn age_ends_an_item_on_the_server_alone_and_an_orb_on_both_sides() {
        let world = WorldSnapshot::new();
        let ended = |kind, server| {
            let mut state = entity(kind, 110.0, Vec3::ZERO);
            state.age = 5999;
            state.first_tick = false;
            if server {
                state = state.on_server();
            }
            tick(&mut state, &world, R26_3);
            state.removed
        };
        assert!(ended(MovingEntityKind::Item, true));
        assert!(!ended(MovingEntityKind::Item, false));
        assert!(ended(MovingEntityKind::ExperienceOrb, true));
        assert!(ended(MovingEntityKind::ExperienceOrb, false));
    }

    #[test]
    fn only_a_server_item_or_orb_looks_for_a_merge() {
        let world = WorldSnapshot::new();
        let check = |kind, server: bool, count| {
            let mut state = entity(kind, 110.0, Vec3::ZERO);
            state.tick_count = count;
            state.first_tick = false;
            if server {
                state = state.on_server();
            }
            tick(&mut state, &world, R26_3).merge_check
        };
        assert!(check(MovingEntityKind::Item, true, 39));
        assert!(!check(MovingEntityKind::Item, false, 39));
        assert!(check(MovingEntityKind::ExperienceOrb, true, 20));
        assert!(!check(MovingEntityKind::ExperienceOrb, false, 20));
    }

    #[test]
    fn a_pickup_delay_counts_down_but_not_for_ever() {
        let world = WorldSnapshot::new();
        let after = |delay| {
            let mut state = entity(MovingEntityKind::Item, 110.0, Vec3::ZERO);
            state.pickup_delay = delay;
            tick(&mut state, &world, R26_3);
            state.pickup_delay
        };
        assert_eq!(after(10), 9);
        assert_eq!(after(32767), 32767);
    }

    #[test]
    fn a_resting_item_still_takes_the_blocks_of_its_last_move_from_26_1() {
        let mut world = floor(0.6);
        world.set_block(
            (0, 100, 0),
            BlockState {
                shape: Some(BlockShape {
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    effect: BlockEffect::Web,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let held = |release| {
            let mut state = entity(MovingEntityKind::Item, 100.0, Vec3::ZERO);
            state.on_ground = true;
            state.id = 1;
            state.last_movements = vec![Movement {
                from: Vec3::new(0.5, 100.1, 0.5),
                to: Vec3::new(0.5, 100.0, 0.5),
                axis_order: None,
            }];
            tick(&mut state, &world, release);
            state.stuck_speed_multiplier != Vec3::ZERO
        };
        assert!(held(R26_1));
        assert!(!held(R1_20));
    }

    #[test]
    fn no_physics_clears_the_collision_flags_from_1_21_9() {
        let world = stuck_world();
        let flag = |release| {
            let mut state = MovingEntityState::new(MovingEntityKind::Item, Vec3::new(0.5, 100.5, 0.5), Vec3::ZERO).on_server();
            state.collided_vertically = true;
            tick_moving_entity(&mut state, &world, &one_draw(), release);
            state.collided_vertically
        };
        assert!(flag(R1_21_8));
        assert!(!flag(R1_21_9));
    }

    #[test]
    fn from_1_21_5_no_fall_counts_in_water() {
        let mut world = WorldSnapshot::new();
        world.set_block((0, 104, 0), fluid(FluidState::Water));
        let fall = |release| {
            let mut state = entity(MovingEntityKind::PrimedTnt, 104.5, Vec3::new(0.0, -0.1, 0.0)).on_server();
            state.in_water = true;
            let mut body = state.body(release);
            move_entity(&mut state, &mut body, &world, release);
            body.fall_distance
        };
        assert!(fall(R1_20) > 0.0);
        assert_eq!(fall(R1_21_5), 0.0);
    }

    #[test]
    fn a_client_counts_a_fall_only_before_1_21_2() {
        let world = WorldSnapshot::new();
        let fall = |release| {
            let mut state = entity(MovingEntityKind::Item, 110.0, Vec3::ZERO);
            tick(&mut state, &world, release);
            state.fall_distance
        };
        assert!(fall(R1_20) > 0.0);
        assert_eq!(fall(R1_21_3), 0.0);
    }

    #[test]
    fn a_cobweb_ends_the_fall_it_stops_before_1_21_2() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 105, 0),
            BlockState {
                shape: Some(BlockShape {
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    effect: BlockEffect::Web,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let mut state = entity(MovingEntityKind::Item, 105.5, Vec3::new(0.0, -0.1, 0.0)).on_server();
        tick(&mut state, &world, R1_13);
        assert_eq!(state.fall_distance, 0.0);
        assert_ne!(state.stuck_speed_multiplier, Vec3::ZERO);
    }
}

#[cfg(test)]
mod mob_travel_tests {
    use super::*;
    use crate::world::{BlockShape, BlockState};

    const R1_13: MinecraftVersion = MinecraftVersion::new(1, 13, 2);
    const R1_14: MinecraftVersion = MinecraftVersion::new(1, 14, 4);
    const R1_20_4: MinecraftVersion = MinecraftVersion::new(1, 20, 4);
    const R1_20_5: MinecraftVersion = MinecraftVersion::new(1, 20, 5);
    const R1_21_5: MinecraftVersion = MinecraftVersion::new(1, 21, 5);
    const R1_21_6: MinecraftVersion = MinecraftVersion::new(1, 21, 6);
    const R26_3: MinecraftVersion = MinecraftVersion::new(26, 3, 0);

    fn mob(kind: MobTravelKind) -> MobTravelState {
        MobTravelState {
            kind,
            position: Vec3::new(0.5, 110.0, 0.5),
            velocity: Vec3::new(0.1, 0.0, 0.0),
            yaw: 0.0,
            input: Vec3::new(0.0, 0.0, 1.0),
            speed: 0.1,
            half_width: 0.25,
            height: 0.5,
            max_step: 0.6,
            bounding_box: None,
            on_ground: false,
            collided_horizontally: false,
            collided_vertically: false,
            in_water: false,
            in_lava: false,
            no_gravity: false,
            stuck_speed_multiplier: Vec3::ZERO,
            fall_distance: 0.0,
            has_target: false,
            guardian_moving: false,
            move_out_of_range: false,
            climbing: false,
            pushed_by_fluid: kind.pushed_by_fluid(),
            fluid_jump_threshold: 0.4,
            under_water: false,
            wants_to_swim: false,
            near_home: false,
            marker: false,
            sweet_berry_bush_immune: false,
            body_item: false,
            floats_in_liquids: false,
            tick_count: 0,
            slow_falling: false,
            levitation_amplifier: None,
            dolphins_grace: false,
            gravity: None,
            water_movement_efficiency: 0.0,
        }
    }

    fn after(state: MobTravelState, release: MinecraftVersion) -> MobTravelState {
        let world = WorldSnapshot::new();
        let mut state = state;
        tick_mob_travel(&mut state, &world, release);
        state
    }

    #[test]
    fn a_squid_goes_by_its_motion_alone() {
        let squid = after(mob(MobTravelKind::Squid), R26_3);
        assert_eq!(squid.position.x, 0.6);
        assert_eq!(squid.velocity, Vec3::new(0.1, 0.0, 0.0));
    }

    #[test]
    fn a_fish_in_water_swims_at_a_hundredth_and_sinks_with_no_target() {
        let mut fish = mob(MobTravelKind::Fish);
        fish.in_water = true;
        fish.velocity = Vec3::ZERO;
        let swum = after(fish.clone(), R26_3);
        assert_eq!(swum.velocity.y, -0.005);
        assert!((swum.velocity.z - 0.01 * 0.9).abs() < 1.0e-9);
        fish.has_target = true;
        assert_eq!(after(fish, R26_3).velocity.y, 0.0);
    }

    #[test]
    fn a_guardian_swims_at_a_tenth_and_its_spikes_keep_it_up() {
        let mut guardian = mob(MobTravelKind::Guardian);
        guardian.in_water = true;
        guardian.velocity = Vec3::ZERO;
        let swum = after(guardian.clone(), R26_3);
        assert_eq!(swum.velocity.y, -0.005);
        assert!((swum.velocity.z - 0.1 * 0.9).abs() < 1.0e-8);
        guardian.guardian_moving = true;
        assert_eq!(after(guardian, R26_3).velocity.y, 0.0);
    }

    #[test]
    fn a_guardian_drags_in_float_before_1_14() {
        let mut guardian = mob(MobTravelKind::Guardian);
        guardian.in_water = true;
        guardian.input = Vec3::ZERO;
        guardian.has_target = true;
        assert_eq!(after(guardian.clone(), R1_13).velocity.x, 0.1 * f64::from(0.9_f32));
        assert_eq!(after(guardian, R1_14).velocity.x, 0.1 * 0.9);
    }

    #[test]
    fn out_of_water_a_fish_takes_a_living_entitys_travel_and_falls() {
        let fish = mob(MobTravelKind::Fish);
        assert!(after(fish, R26_3).velocity.y < 0.0);
    }

    #[test]
    fn a_ghast_flies_at_0_02_and_a_phantom_at_0_2_only_from_1_21_6() {
        let air = |kind, release| {
            let mut flyer = mob(kind);
            flyer.velocity = Vec3::ZERO;
            after(flyer, release).velocity.z
        };
        let drag = f64::from(0.91_f32);
        assert!((air(MobTravelKind::Ghast, R26_3) - 0.02 * drag).abs() < 1.0e-9);
        assert!((air(MobTravelKind::Phantom, R1_21_5) - 0.02 * drag).abs() < 1.0e-9);
        assert!((air(MobTravelKind::Phantom, R1_21_6) - 0.2 * drag).abs() < 1.0e-8);
    }

    #[test]
    fn an_allay_flies_at_its_own_speed() {
        let mut allay = mob(MobTravelKind::Allay);
        allay.velocity = Vec3::ZERO;
        assert!((after(allay, R1_21_5).velocity.z - 0.1 * f64::from(0.91_f32)).abs() < 1.0e-8);
    }

    #[test]
    fn water_and_lava_hold_a_flying_mob() {
        let mut flyer = mob(MobTravelKind::Ghast);
        flyer.input = Vec3::ZERO;
        flyer.in_water = true;
        assert_eq!(after(flyer.clone(), R26_3).velocity.x, 0.1 * f64::from(0.8_f32));
        flyer.in_water = false;
        flyer.in_lava = true;
        assert_eq!(after(flyer, R26_3).velocity.x, 0.05);
    }

    #[test]
    fn the_ground_slows_a_flying_mob_only_until_1_21_6() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 109, 0),
            BlockState {
                shape: Some(BlockShape {
                    slipperiness: 0.6,
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        let on_ground = |release| {
            let mut flyer = mob(MobTravelKind::Ghast);
            flyer.input = Vec3::ZERO;
            flyer.on_ground = true;
            tick_mob_travel(&mut flyer, &world, release);
            flyer.velocity.x
        };
        assert_eq!(on_ground(R1_21_5), 0.1 * f64::from(0.6_f32 * 0.91_f32));
        assert_eq!(on_ground(R1_21_6), 0.1 * f64::from(0.91_f32));
    }

    #[test]
    fn a_vex_goes_through_a_block_that_stops_a_squid() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (1, 110, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let go = |kind| {
            let mut state = mob(kind);
            state.no_gravity = true;
            state.velocity = Vec3::new(0.6, 0.0, 0.0);
            tick_mob_travel(&mut state, &world, R26_3);
            state.position.x
        };
        assert!(go(MobTravelKind::Vex) > 0.75 + 0.3);
        assert!(go(MobTravelKind::Squid) <= 0.75);
    }

    fn web_at(position: (i32, i32, i32)) -> WorldSnapshot {
        let mut world = WorldSnapshot::new();
        world.set_block(
            position,
            BlockState {
                shape: Some(BlockShape {
                    effect: crate::world::BlockEffect::Web,
                    bounds: Aabb::new(Vec3::ZERO, Vec3::ZERO),
                    ..BlockShape::full_block()
                }),
                ..BlockState::default()
            },
        );
        world
    }

    #[test]
    fn a_cobweb_stops_a_mob_after_its_travel_from_1_21_2() {
        let world = web_at((0, 110, 0));
        let mut state = mob(MobTravelKind::Living);
        state.velocity = Vec3::ZERO;
        state.input = Vec3::ZERO;
        state.fall_distance = 3.0;
        tick_mob_travel(&mut state, &world, R26_3);
        assert_eq!(state.stuck_speed_multiplier, Vec3::new(0.25, java_float(0.05), 0.25));
        assert_eq!(state.fall_distance, 0.0);
    }

    #[test]
    fn a_spider_goes_through_a_cobweb_and_a_wither_through_anything() {
        let world = web_at((0, 110, 0));
        for kind in [MobTravelKind::Spider, MobTravelKind::Wither] {
            let mut state = mob(kind);
            tick_mob_travel(&mut state, &world, R26_3);
            assert_eq!(state.stuck_speed_multiplier, Vec3::ZERO);
        }
    }

    #[test]
    fn a_vex_feels_a_cobweb_though_it_goes_through_blocks() {
        let world = web_at((0, 110, 0));
        let held = |release| {
            let mut state = mob(MobTravelKind::Vex);
            state.no_gravity = true;
            tick_mob_travel(&mut state, &world, release);
            state.stuck_speed_multiplier
        };
        assert_ne!(held(R1_14), Vec3::ZERO);
        assert_ne!(held(R26_3), Vec3::ZERO);
    }

    #[test]
    fn a_cobweb_ends_the_fall_of_the_move_that_reaches_it_before_1_21_2() {
        let world = web_at((0, 110, 0));
        let mut state = mob(MobTravelKind::Living);
        state.position = Vec3::new(0.5, 110.5, 0.5);
        state.velocity = Vec3::new(0.0, -0.2, 0.0);
        state.input = Vec3::ZERO;
        state.fall_distance = 3.0;
        tick_mob_travel(&mut state, &world, R1_20_4);
        assert_eq!(state.fall_distance, 0.0);
    }

    #[test]
    fn a_bee_keeps_its_climb_as_the_rest_from_1_20_5_and_by_the_air_alone_from_26_2() {
        let mut bee = mob(MobTravelKind::FlyingAnimal);
        bee.velocity = Vec3::new(0.0, 0.5, 0.0);
        bee.input = Vec3::ZERO;
        bee.no_gravity = true;
        assert_eq!(after(bee.clone(), R1_20_4).velocity.y, 0.5 * f64::from(0.98_f32));
        assert_eq!(after(bee.clone(), R1_20_5).velocity.y, 0.5 * f64::from(0.91_f32));
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 109, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        bee.on_ground = true;
        let on_ground = |release| {
            let mut state = bee.clone();
            tick_mob_travel(&mut state, &world, release);
            state.velocity.y
        };
        // (a block's 0.6 of friction in the drag until 26.2)
        assert_eq!(on_ground(R1_21_5), 0.5 * f64::from(0.6_f32 * 0.91));
        assert_eq!(on_ground(R26_3), 0.5 * f64::from(0.91_f32));
    }

    #[test]
    fn a_plain_mob_is_turned_by_its_yaw() {
        let mut state = mob(MobTravelKind::Living);
        state.velocity = Vec3::ZERO;
        state.yaw = 90.0;
        let turned = after(state, R26_3);
        assert!(turned.velocity.x < 0.0);
        assert!(turned.velocity.z.abs() < 1.0e-7);
    }

    #[test]
    fn a_mob_without_gravity_does_not_sink_in_water() {
        let mut state = mob(MobTravelKind::Living);
        state.velocity = Vec3::ZERO;
        state.input = Vec3::ZERO;
        state.in_water = true;
        state.no_gravity = true;
        assert_eq!(after(state, R26_3).velocity.y, 0.0);
    }

    #[test]
    fn a_plain_mob_steps_up_as_high_as_it_is_given() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (1, 109, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        world.set_block(
            (0, 108, 0),
            BlockState {
                shape: Some(BlockShape::full_block()),
                ..BlockState::default()
            },
        );
        let climbed = |max_step| {
            let mut state = mob(MobTravelKind::Living);
            state.position = Vec3::new(0.5, 109.0, 0.5);
            state.velocity = Vec3::new(0.4, 0.0, 0.0);
            state.input = Vec3::ZERO;
            state.on_ground = true;
            state.max_step = max_step;
            tick_mob_travel(&mut state, &world, R26_3);
            state.position.y
        };
        assert_eq!(climbed(0.6), 109.0);
        assert_eq!(climbed(1.5), 110.0);
    }

    #[test]
    fn dolphins_and_turtles_sink_and_axolotls_and_frogs_do_not() {
        let swum = |kind, speed| {
            let mut state = mob(kind);
            state.in_water = true;
            state.velocity = Vec3::ZERO;
            state.speed = speed;
            after(state, R26_3).velocity
        };
        assert_eq!(swum(MobTravelKind::Dolphin, 0.3).y, -0.005);
        assert!((swum(MobTravelKind::Dolphin, 0.3).z - 0.3 * 0.9).abs() < 1.0e-6);
        assert_eq!(swum(MobTravelKind::Turtle, 0.9).y, -0.005);
        assert!((swum(MobTravelKind::Turtle, 0.9).z - 0.1 * 0.9).abs() < 1.0e-6);
        assert_eq!(swum(MobTravelKind::Axolotl, 0.3).y, 0.0);
        assert_eq!(swum(MobTravelKind::Frog, 0.3).y, 0.0);
    }

    #[test]
    fn a_turtle_going_home_near_it_holds_its_depth() {
        let mut turtle = mob(MobTravelKind::Turtle);
        turtle.in_water = true;
        turtle.near_home = true;
        assert_eq!(after(turtle, R26_3).velocity.y, 0.0);
    }

    #[test]
    fn a_drowned_swims_only_where_it_wants_and_under_water_from_1_21_2() {
        let mut drowned = mob(MobTravelKind::Drowned);
        drowned.in_water = true;
        drowned.velocity = Vec3::ZERO;
        drowned.wants_to_swim = true;
        let swims = |state: MobTravelState, release| (after(state, release).velocity.z - 0.01 * 0.9).abs() < 1.0e-6;
        assert!(swims(drowned.clone(), R1_14));
        assert!(!swims(drowned.clone(), R26_3));
        drowned.under_water = true;
        assert!(swims(drowned.clone(), R26_3));
        drowned.wants_to_swim = false;
        assert!(!swims(drowned, R26_3));
    }

    #[test]
    fn a_polar_bear_keeps_more_of_its_motion_in_water() {
        let swum = |kind| {
            let mut state = mob(kind);
            state.in_water = true;
            state.input = Vec3::ZERO;
            state.velocity = Vec3::new(1.0, 0.0, 0.0);
            after(state, R26_3).velocity.x
        };
        assert_eq!(swum(MobTravelKind::Living), f64::from(0.8_f32));
        assert_eq!(swum(MobTravelKind::PolarBear), f64::from(0.98_f32));
    }

    #[test]
    fn a_spider_climbs_by_its_flag_and_not_by_a_ladder() {
        let mut spider = mob(MobTravelKind::Spider);
        spider.velocity = Vec3::new(0.0, -0.5, 0.0);
        spider.input = Vec3::ZERO;
        spider.climbing = true;
        let held = after(spider.clone(), R26_3).velocity.y;
        spider.climbing = false;
        assert!(held > after(spider, R26_3).velocity.y);
    }

    #[test]
    fn an_armor_stand_travels_only_with_its_physics() {
        let mut stand = mob(MobTravelKind::ArmorStand);
        stand.input = Vec3::ZERO;
        let at = stand.position;
        assert_ne!(after(stand.clone(), R26_3).position, at);
        stand.marker = true;
        assert_eq!(after(stand.clone(), R26_3).position, at);
        assert_ne!(after(stand.clone(), R1_13).position, at);
        stand.marker = false;
        stand.no_gravity = true;
        assert_eq!(after(stand, R1_13).position, at);
    }

    #[test]
    fn what_flies_counts_no_fall_and_a_blaze_does() {
        let fell = |kind| {
            let mut state = mob(kind);
            state.velocity = Vec3::new(0.0, -0.5, 0.0);
            state.input = Vec3::ZERO;
            after(state, R26_3).fall_distance
        };
        for kind in [MobTravelKind::Bat, MobTravelKind::FlyingAnimal, MobTravelKind::Ghast, MobTravelKind::Phantom, MobTravelKind::Allay] {
            assert_eq!(fell(kind), 0.0);
        }
        assert_eq!(fell(MobTravelKind::Living), 0.5);
    }

    #[test]
    fn no_player_controls_a_mob_so_1_21_4_keeps_its_fall() {
        // (1.21.4 Entity.java:697 skips checkFallDamage for isControlledByPlayer alone: physrec/me_mob_cow_falls)
        let fell = |release| {
            let mut state = mob(MobTravelKind::Living);
            state.velocity = Vec3::new(0.0, -0.5, 0.0);
            state.input = Vec3::ZERO;
            after(state, release).fall_distance
        };
        assert_eq!(fell(MinecraftVersion::new(1, 21, 3)), fell(MinecraftVersion::new(1, 21, 4)));
        assert_ne!(fell(MinecraftVersion::new(1, 21, 4)), 0.0);
    }

    #[test]
    fn a_current_moves_what_it_can_push() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 110, 0),
            BlockState {
                fluid: FluidState::Water,
                fluid_level: 2,
                fluid_flow: Vec3::new(1.0, 0.0, 0.0),
                ..BlockState::default()
            },
        );
        let carried = |pushed| {
            let mut state = mob(MobTravelKind::Living);
            state.velocity = Vec3::ZERO;
            state.input = Vec3::ZERO;
            state.no_gravity = true;
            state.pushed_by_fluid = pushed;
            tick_mob_travel(&mut state, &world, R1_21_5);
            state.velocity.x
        };
        assert!(carried(true) > 0.0);
        assert_eq!(carried(false), 0.0);
    }

    #[test]
    fn the_lava_is_shallow_by_the_mobs_own_threshold() {
        let mut world = WorldSnapshot::new();
        world.set_block(
            (0, 110, 0),
            BlockState {
                fluid: FluidState::Lava,
                fluid_source: true,
                ..BlockState::default()
            },
        );
        let lands = |threshold| {
            let mut state = mob(MobTravelKind::Living);
            state.position = Vec3::new(0.5, 110.5, 0.5);
            state.velocity = Vec3::new(0.0, 0.1, 0.0);
            state.input = Vec3::ZERO;
            state.in_lava = true;
            state.fluid_jump_threshold = threshold;
            tick_mob_travel(&mut state, &world, R1_21_5);
            state.velocity.y
        };
        assert_ne!(lands(0.0), lands(0.9));
    }

    #[test]
    fn what_goes_through_blocks_loses_its_collision_flags_from_1_21_9() {
        let mut vex = mob(MobTravelKind::Vex);
        vex.no_gravity = true;
        vex.collided_horizontally = true;
        assert!(after(vex.clone(), MinecraftVersion::new(1, 21, 8)).collided_horizontally);
        assert!(!after(vex, MinecraftVersion::new(1, 21, 9)).collided_horizontally);
    }

    #[test]
    fn levitation_lifts_and_slow_falling_slows_a_mob() {
        let mut cow = mob(MobTravelKind::Living);
        cow.velocity = Vec3::new(0.0, -0.5, 0.0);
        cow.input = Vec3::ZERO;
        let plain = after(cow.clone(), R26_3).velocity.y;
        let mut slow = cow.clone();
        slow.slow_falling = true;
        assert!(after(slow, R26_3).velocity.y > plain);
        let mut up = cow;
        up.levitation_amplifier = Some(1);
        up.velocity.y = 0.0;
        assert!(after(up, R26_3).velocity.y > 0.0);
    }

    #[test]
    fn gravity_and_water_efficiency_are_the_attributes_of_their_release() {
        let mut cow = mob(MobTravelKind::Living);
        cow.velocity = Vec3::ZERO;
        cow.input = Vec3::ZERO;
        cow.gravity = Some(0.01);
        assert!((after(cow.clone(), R26_3).velocity.y + 0.01 * f64::from(0.98_f32)).abs() < 1.0e-9);
        assert!((after(cow.clone(), R1_20_4).velocity.y + 0.08 * f64::from(0.98_f32)).abs() < 1.0e-9);
        let mut swimmer = mob(MobTravelKind::Living);
        swimmer.in_water = true;
        swimmer.velocity = Vec3::ZERO;
        let plain = after(swimmer.clone(), R26_3).velocity.z;
        swimmer.water_movement_efficiency = 1.0;
        assert!(after(swimmer, R26_3).velocity.z > plain);
    }

    #[test]
    fn the_names_are_the_registrys() {
        assert_eq!(MobTravelKind::parse("glow_squid"), Some(MobTravelKind::Squid));
        assert_eq!(MobTravelKind::parse("tadpole"), Some(MobTravelKind::Fish));
        assert_eq!(MobTravelKind::parse("elder_guardian"), Some(MobTravelKind::Guardian));
        assert_eq!(MobTravelKind::parse("cow"), Some(MobTravelKind::Living));
        assert_eq!(MobTravelKind::parse("minecart"), None);
    }
}
