package dev.mcpn.recorder.mc;

/** The flat world by hand: no world presets before 1.19. */
public final class CompatLevel {
    private CompatLevel() {
    }

    static void createLevel(net.minecraft.client.Minecraft mc, String name, long seed) {
        var settings = new net.minecraft.world.level.LevelSettings(name, net.minecraft.world.level.GameType.SURVIVAL, false,
            net.minecraft.world.Difficulty.PEACEFUL, true, new net.minecraft.world.level.GameRules(), net.minecraft.world.level.DataPackConfig.DEFAULT);
        // what the "Superflat" preset of the create-world screen builds
        net.minecraft.core.RegistryAccess.Writable registries = net.minecraft.core.RegistryAccess.builtinCopy();
        var sets = registries.registryOrThrow(net.minecraft.core.Registry.STRUCTURE_SET_REGISTRY);
        var generator = new net.minecraft.world.level.levelgen.FlatLevelSource(sets,
            net.minecraft.world.level.levelgen.flat.FlatLevelGeneratorSettings.getDefault(registries.registryOrThrow(net.minecraft.core.Registry.BIOME_REGISTRY), sets));
        var worldGen = new net.minecraft.world.level.levelgen.WorldGenSettings(seed, false, false, net.minecraft.world.level.levelgen.WorldGenSettings.withOverworld(
            registries.registryOrThrow(net.minecraft.core.Registry.DIMENSION_TYPE_REGISTRY), net.minecraft.world.level.dimension.DimensionType.defaultDimensions(registries, seed), generator));
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
        level.pollLightUpdates();
    }

    /** The entities in tick order. */
    static java.util.Collection<net.minecraft.world.entity.Entity> tickOrder(net.minecraft.client.multiplayer.ClientLevel level) {
        var ticking = (dev.mcpn.recorder.mc.mixin.EntityTickListAccessor) ((dev.mcpn.recorder.mc.mixin.ClientLevelAccessor) level).recorder$tickingEntities();
        return java.util.List.copyOf(ticking.recorder$active().values());
    }
}
