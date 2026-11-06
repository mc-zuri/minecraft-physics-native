//! Which travel the engine has for an entity kind, by release: the inventory of the kinds that
//! move through fluids or are steered through them. A kind with no travel here is refused by
//! name, so it never runs on the player's equations (LivingEntity.travel has an override or an
//! AI move control for each of these: 26.3 WaterAnimal.java, AbstractFish.java:115-123,
//! Squid.java, Dolphin.java, Axolotl.java, Turtle.java, Guardian.java).

use crate::version::MinecraftVersion;

/// The path that moves a kind.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TravelFamily {
    /// The local player's tick (simulateVersionedTick, NativePlayer), water and lava included.
    Player,
    /// Boat.tick (simulateVersionedBoatTick), its own status and water level kept between ticks.
    Boat,
    /// LivingEntity.travelRidden of a mob a player steers (simulateVersionedHorseTick).
    Ridden,
    /// LivingEntity.travel of a mob from where its AI left it (simulateVersionedMobTravel).
    Mob,
    /// A kind of the game with no path here.
    Unsupported,
}

impl TravelFamily {
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::Player => "player",
            Self::Boat => "boat",
            Self::Ridden => "ridden",
            Self::Mob => "mob",
            Self::Unsupported => "unsupported",
        }
    }
}

type Release = (u16, u16, u16);

/// The kinds by the first release whose registry has them, from each release's EntityType source.
/// (Before 1.11 a horse's variants and the elder guardian are data of one type, 1.10.2
/// HorseBaseEntity, GuardianEntity: they count from those types' first release.)
const INVENTORY: &[(&str, TravelFamily, Release)] = &[
    ("player", TravelFamily::Player, (1, 8, 0)),
    ("pig", TravelFamily::Ridden, (1, 8, 0)),
    ("horse", TravelFamily::Ridden, (1, 8, 0)),
    ("donkey", TravelFamily::Ridden, (1, 8, 0)),
    ("mule", TravelFamily::Ridden, (1, 8, 0)),
    ("skeleton_horse", TravelFamily::Ridden, (1, 8, 0)),
    ("zombie_horse", TravelFamily::Ridden, (1, 8, 0)),
    ("llama", TravelFamily::Ridden, (1, 11, 0)),
    ("trader_llama", TravelFamily::Ridden, (1, 14, 0)),
    ("strider", TravelFamily::Ridden, (1, 16, 0)),
    ("camel", TravelFamily::Ridden, (1, 19, 3)),
    ("happy_ghast", TravelFamily::Ridden, (1, 21, 6)),
    ("camel_husk", TravelFamily::Ridden, (1, 21, 11)),
    ("nautilus", TravelFamily::Ridden, (1, 21, 11)),
    ("zombie_nautilus", TravelFamily::Ridden, (1, 21, 11)),
    ("squid", TravelFamily::Mob, (1, 8, 0)),
    ("guardian", TravelFamily::Mob, (1, 8, 0)),
    ("elder_guardian", TravelFamily::Mob, (1, 8, 0)),
    // (1.8.9 EntityType.java:261; 1.11.2 :207; 1.13.2 :282; 1.19 :159)
    ("ghast", TravelFamily::Mob, (1, 8, 0)),
    ("vex", TravelFamily::Mob, (1, 11, 0)),
    ("phantom", TravelFamily::Mob, (1, 13, 0)),
    ("allay", TravelFamily::Mob, (1, 19, 0)),
    ("cod", TravelFamily::Mob, (1, 13, 0)),
    ("salmon", TravelFamily::Mob, (1, 13, 0)),
    ("pufferfish", TravelFamily::Mob, (1, 13, 0)),
    ("tropical_fish", TravelFamily::Mob, (1, 13, 0)),
    ("dolphin", TravelFamily::Mob, (1, 13, 0)),
    ("turtle", TravelFamily::Mob, (1, 13, 0)),
    ("drowned", TravelFamily::Mob, (1, 13, 0)),
    ("glow_squid", TravelFamily::Mob, (1, 17, 0)),
    ("axolotl", TravelFamily::Mob, (1, 17, 0)),
    ("tadpole", TravelFamily::Mob, (1, 19, 0)),
    ("frog", TravelFamily::Mob, (1, 19, 0)),
    // (1.8.9 EntityType.java; PolarBear 1.10.2, Parrot 1.12.2, Bee 1.15, SulfurCube 26.3)
    ("blaze", TravelFamily::Mob, (1, 8, 0)),
    ("bat", TravelFamily::Mob, (1, 8, 0)),
    ("zombie", TravelFamily::Mob, (1, 8, 0)),
    ("cow", TravelFamily::Mob, (1, 8, 0)),
    ("spider", TravelFamily::Mob, (1, 8, 0)),
    ("cave_spider", TravelFamily::Mob, (1, 8, 0)),
    ("wither", TravelFamily::Mob, (1, 8, 0)),
    ("armor_stand", TravelFamily::Mob, (1, 8, 0)),
    ("polar_bear", TravelFamily::Mob, (1, 10, 0)),
    ("parrot", TravelFamily::Mob, (1, 12, 0)),
    ("bee", TravelFamily::Mob, (1, 15, 0)),
    ("sulfur_cube", TravelFamily::Mob, (26, 3, 0)),
];

/// The woods of the boats EntityType names one by one from 1.21.2 (client1.21.2 EntityType.java);
/// 1.21.1 has `boat` and `chest_boat`, the latter from 1.19.
const BOAT_WOODS: &[&str] = &[
    "oak", "spruce", "birch", "jungle", "acacia", "cherry", "dark_oak", "pale_oak", "mangrove",
];

/// A boat's name, the first release that has it and the first that no longer does.
fn boat(name: &str) -> Option<(Release, Option<Release>)> {
    const NAMED: Release = (1, 21, 2);
    match name {
        "boat" => return Some(((1, 8, 0), Some(NAMED))),
        "chest_boat" => return Some(((1, 19, 0), Some(NAMED))),
        "bamboo_raft" | "bamboo_chest_raft" => return Some((NAMED, None)),
        _ => {}
    }
    let wood = name
        .strip_suffix("_chest_boat")
        .or_else(|| name.strip_suffix("_boat"))?;
    BOAT_WOODS.contains(&wood).then_some((NAMED, None))
}

/// What the engine says of a kind in a release.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TravelSupport {
    /// None for a name outside the inventory.
    pub family: Option<TravelFamily>,
    /// The release's registry holds the kind.
    pub available: bool,
    /// The first release that has it.
    pub since: Option<Release>,
}

/// The inventory's entry for a kind in a release.
#[must_use]
pub fn travel_support(name: &str, release: MinecraftVersion) -> TravelSupport {
    let at_least = |(major, minor, patch): Release| release.at_least(major, minor, patch);
    if let Some((since, until)) = boat(name) {
        return TravelSupport {
            family: Some(TravelFamily::Boat),
            available: at_least(since) && !until.is_some_and(at_least),
            since: Some(since),
        };
    }
    match INVENTORY.iter().find(|(kind, ..)| *kind == name) {
        Some(&(_, family, since)) => TravelSupport {
            family: Some(family),
            available: at_least(since),
            since: Some(since),
        },
        None => TravelSupport {
            family: None,
            available: false,
            since: None,
        },
    }
}

/// Why the player's tick refuses a kind it was named for: everything but the player, by what it
/// should go through instead.
pub fn refuse_for_player_tick(name: &str) -> Result<(), String> {
    // (the release plays no part: no kind but the player has this path in any of them)
    let family = travel_support(name, MinecraftVersion::new(u16::MAX, 0, 0)).family;
    match family {
        Some(TravelFamily::Player) => Ok(()),
        Some(TravelFamily::Boat) => Err(format!("{name} ticks through simulateVersionedBoatTick")),
        Some(TravelFamily::Ridden) => Err(format!("{name} ticks through simulateVersionedHorseTick")),
        Some(TravelFamily::Mob) => Err(format!(
            "no travel simulation for {name} on the player's equations: it travels through simulateVersionedMobTravel"
        )),
        Some(TravelFamily::Unsupported) => Err(format!(
            "no travel simulation for {name}: it is not run on the player's equations"
        )),
        None => Err(format!("{name} is not in the engine's entity inventory")),
    }
}

/// Why a mob's travel refuses a kind, when it does: one its release does not have runs no equations.
pub fn refuse_for_mob_travel(name: &str, release: MinecraftVersion) -> Result<(), String> {
    // ("living" is any LivingEntity with nothing of its own, which names no kind; a mount out of a
    // saddle travels here as well)
    if name == "living" {
        return Ok(());
    }
    let support = travel_support(name, release);
    let unridden = matches!(name, "strider" | "skeleton_horse");
    match support.family {
        Some(TravelFamily::Mob) if support.available => Ok(()),
        Some(TravelFamily::Ridden) if unridden && support.available => Ok(()),
        Some(TravelFamily::Mob) => Err(format!("{name} is not in {release}")),
        Some(TravelFamily::Ridden) if unridden => Err(format!("{name} is not in {release}")),
        _ => Err(format!("no travel of its own: {name}")),
    }
}

/// Why a ridden tick refuses a kind, when it does.
pub fn refuse_for_ridden_tick(name: &str, release: MinecraftVersion) -> Result<(), String> {
    let support = travel_support(name, release);
    if support.family == Some(TravelFamily::Ridden) && !support.available {
        return Err(format!("{name} does not exist in this release"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        refuse_for_mob_travel, refuse_for_player_tick, refuse_for_ridden_tick, travel_support,
        TravelFamily,
    };
    use crate::version::MinecraftVersion;

    const fn release(major: u16, minor: u16, patch: u16) -> MinecraftVersion {
        MinecraftVersion::new(major, minor, patch)
    }

    #[test]
    fn a_kind_is_available_from_its_first_release() {
        let available = |name, at| travel_support(name, at).available;
        assert!(!available("strider", release(1, 15, 2)));
        assert!(available("strider", release(1, 16, 0)));
        assert!(!available("cod", release(1, 12, 2)));
        assert!(available("cod", release(1, 13, 0)));
        assert!(!available("nautilus", release(1, 21, 10)));
        assert!(available("nautilus", release(1, 21, 11)));
    }

    #[test]
    fn the_boats_change_names_at_1_21_2() {
        let available = |name, at| travel_support(name, at).available;
        assert!(available("boat", release(1, 21, 1)));
        assert!(!available("boat", release(1, 21, 2)));
        assert!(!available("oak_boat", release(1, 21, 1)));
        assert!(available("oak_boat", release(1, 21, 2)));
        assert!(!available("chest_boat", release(1, 18, 2)));
        assert!(available("chest_boat", release(1, 19, 0)));
        assert!(available("bamboo_chest_raft", release(26, 3, 0)));
        assert_eq!(
            travel_support("pale_oak_chest_boat", release(26, 3, 0)).family,
            Some(TravelFamily::Boat)
        );
        assert_eq!(travel_support("stone_boat", release(26, 3, 0)).family, None);
    }

    #[test]
    fn the_player_tick_takes_the_player_alone() {
        assert!(refuse_for_player_tick("player").is_ok());
        for (name, reason) in [
            ("cod", "no travel simulation"),
            ("squid", "no travel simulation"),
            ("strider", "simulateVersionedHorseTick"),
            ("oak_boat", "simulateVersionedBoatTick"),
            ("minecart", "inventory"),
        ] {
            let refused = refuse_for_player_tick(name).expect_err(name);
            assert!(refused.contains(reason), "{name}: {refused}");
        }
    }

    #[test]
    fn a_mobs_travel_exists_from_the_release_that_has_the_mob() {
        let refuses = |name, at| refuse_for_mob_travel(name, at).is_err();
        for (name, before, first) in [
            ("vex", release(1, 10, 2), release(1, 11, 0)),
            ("phantom", release(1, 12, 2), release(1, 13, 0)),
            ("cod", release(1, 12, 2), release(1, 13, 0)),
            ("glow_squid", release(1, 16, 5), release(1, 17, 0)),
            ("allay", release(1, 18, 2), release(1, 19, 0)),
        ] {
            assert!(refuses(name, before), "{name}");
            assert!(!refuses(name, first), "{name}");
        }
        assert!(!refuses("squid", release(1, 8, 8)));
        assert!(!refuses("ghast", release(1, 8, 8)));
        // a kind with no travel here is refused whatever the release
        assert!(refuses("minecart", release(26, 3, 0)));
        assert!(refuses("trident", release(26, 3, 0)));
        assert!(refuses("horse", release(26, 3, 0)));
    }

    #[test]
    fn a_ridden_tick_refuses_a_mob_its_release_does_not_have() {
        assert!(refuse_for_ridden_tick("strider", release(1, 16, 0)).is_ok());
        assert!(refuse_for_ridden_tick("strider", release(1, 15, 2)).is_err());
        assert!(refuse_for_ridden_tick("happy_ghast", release(1, 21, 5)).is_err());
    }
}
