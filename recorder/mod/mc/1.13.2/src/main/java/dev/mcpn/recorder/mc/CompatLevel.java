package dev.mcpn.recorder.mc;

/** The flat world by hand, before the dynamic registries of 1.16.2. */
public final class CompatLevel {
    private CompatLevel() {
    }

    static void createLevel(net.minecraft.client.Minecraft mc, String name, long seed) {
        mc.selectLevel(name, name, new net.minecraft.world.level.LevelSettings(seed, net.minecraft.world.level.GameType.SURVIVAL, false, false,
            net.minecraft.world.level.LevelType.FLAT).enableSinglePlayerCommands());
    }

    static void muteSound(net.minecraft.client.Minecraft mc) {
        mc.options.setSoundCategoryVolume(net.minecraft.sounds.SoundSource.MASTER, 0.0F);
    }

    static boolean isOnboarding(net.minecraft.client.gui.screens.Screen screen) {
        return false;
    }

    /** What LevelRenderer.renderLevel does each frame: without frames the client's light queue would only grow. */
    public static void pollClientLight(net.minecraft.client.multiplayer.MultiPlayerLevel level) {
        // (the level does it itself before 1.15)
    }

    /** The entities in tick order. */
    static java.util.Collection<net.minecraft.world.entity.Entity> tickOrder(net.minecraft.client.multiplayer.MultiPlayerLevel level) {
        return java.util.List.copyOf(level.loadedEntities);
    }
}
