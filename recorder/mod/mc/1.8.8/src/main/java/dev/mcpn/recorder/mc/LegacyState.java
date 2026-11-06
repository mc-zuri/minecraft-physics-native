package dev.mcpn.recorder.mc;

import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;

/** A block state before the flattening, as its numbers: minecraft-data has no properties to name it by. */
public final class LegacyState {
    /** The chunks of the areas, which stay loaded (KeepChunksMixin). */
    public static final java.util.Set<Long> FORCED = java.util.concurrent.ConcurrentHashMap.newKeySet();

    private LegacyState() {
    }

    private static final java.util.Map<String, String> ENTITIES = java.util.Map.ofEntries(
        java.util.Map.entry("XPOrb", "experience_orb"), java.util.Map.entry("MinecartRideable", "minecart"),
        java.util.Map.entry("MinecartChest", "chest_minecart"), java.util.Map.entry("MinecartFurnace", "furnace_minecart"),
        java.util.Map.entry("MinecartTNT", "tnt_minecart"), java.util.Map.entry("MinecartHopper", "hopper_minecart"),
        java.util.Map.entry("MinecartSpawner", "spawner_minecart"), java.util.Map.entry("MinecartCommandBlock", "command_block_minecart"),
        java.util.Map.entry("FireworksRocketEntity", "firework_rocket"), java.util.Map.entry("PrimedTnt", "tnt"),
        java.util.Map.entry("FallingSand", "falling_block"), java.util.Map.entry("ThrownEnderpearl", "ender_pearl"),
        java.util.Map.entry("ThrownPotion", "potion"), java.util.Map.entry("ThrownEgg", "egg"),
        java.util.Map.entry("ThrownExpBottle", "experience_bottle"), java.util.Map.entry("EyeOfEnderSignal", "eye_of_ender"),
        java.util.Map.entry("PigZombie", "zombie_pigman"), java.util.Map.entry("LavaSlime", "magma_cube"),
        java.util.Map.entry("Ozelot", "ocelot"), java.util.Map.entry("MushroomCow", "mooshroom"),
        java.util.Map.entry("SnowMan", "snow_golem"), java.util.Map.entry("VillagerGolem", "iron_golem"),
        java.util.Map.entry("EnderCrystal", "end_crystal"), java.util.Map.entry("WitherBoss", "wither"));

    /** The name later releases give an entity. */
    public static String modernEntity(net.minecraft.world.entity.Entity e) {
        if (e instanceof net.minecraft.world.entity.animal.horse.AbstractHorse horse) {
            return java.util.List.of("horse", "donkey", "mule", "zombie_horse", "skeleton_horse").get(horse.getType());
        }
        // (the hook has no name in EntityList before 1.11)
        if (e instanceof net.minecraft.world.entity.fishing.FishingHook) {
            return "fishing_bobber";
        }
        String name = net.minecraft.world.entity.EntityType.getKey(e);
        if (name == null) {
            return e.getClass().getSimpleName();
        }
        String modern = ENTITIES.get(name);
        return modern != null ? modern : name.replaceAll("([a-z])([A-Z])", "$1_$2").toLowerCase(java.util.Locale.ROOT);
    }

    public static String of(BlockState state) {
        int id = Block.getId(state);
        return "#" + (id & 4095) + ":" + (id >> 12 & 15);
    }
}
