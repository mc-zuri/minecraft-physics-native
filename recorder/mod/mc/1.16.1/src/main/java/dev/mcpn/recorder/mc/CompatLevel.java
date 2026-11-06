package dev.mcpn.recorder.mc;

/** The flat world by hand, before the dynamic registries of 1.16.2. */
public final class CompatLevel {
    private CompatLevel() {
    }

    static void createLevel(net.minecraft.client.Minecraft mc, String name, long seed) {
        var settings = new net.minecraft.world.level.LevelSettings(name, net.minecraft.world.level.GameType.SURVIVAL, false,
            net.minecraft.world.Difficulty.PEACEFUL, true, new net.minecraft.world.level.GameRules(), net.minecraft.world.level.DataPackConfig.DEFAULT);
        // what the "Superflat" preset of the create-world screen builds
        net.minecraft.core.RegistryAccess.RegistryHolder registries = net.minecraft.core.RegistryAccess.builtin();
        var generator = new net.minecraft.world.level.levelgen.FlatLevelSource(net.minecraft.world.level.levelgen.flat.FlatLevelGeneratorSettings.getDefault());
        var worldGen = new net.minecraft.world.level.levelgen.WorldGenSettings(seed, false, false, net.minecraft.world.level.levelgen.WorldGenSettings.withOverworld(
            net.minecraft.world.level.dimension.DimensionType.defaultDimensions(seed), generator));
        mc.createLevel(name, settings, registries, worldGen);
    }

    static void muteSound(net.minecraft.client.Minecraft mc) {
        mc.options.setSoundCategoryVolume(net.minecraft.sounds.SoundSource.MASTER, 0.0F);
    }

    static boolean isOnboarding(net.minecraft.client.gui.screens.Screen screen) {
        return false;
    }

    /** What LevelRenderer.renderLevel does each frame: without frames the client's light queue would only grow. */
    public static void pollClientLight(net.minecraft.client.multiplayer.ClientLevel level) {
        level.getChunkSource().getLightEngine().runUpdates(Integer.MAX_VALUE, true, true);
    }

    /** The entities in tick order. */
    static java.util.Collection<net.minecraft.world.entity.Entity> tickOrder(net.minecraft.client.multiplayer.ClientLevel level) {
        return java.util.List.copyOf(((dev.mcpn.recorder.mc.mixin.ClientLevelAccessor) level).recorder$entitiesById().values());
    }
}
