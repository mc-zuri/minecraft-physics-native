package dev.mcpn.recorder.mc;

/** Data pack config and world-gen settings instead of world options; sound levels by key. */
public final class CompatLevel {
    private CompatLevel() {
    }

    static void createLevel(net.minecraft.client.Minecraft mc, String name, long seed) {
        var settings = new net.minecraft.world.level.LevelSettings(name, net.minecraft.world.level.GameType.SURVIVAL, false,
            net.minecraft.world.Difficulty.PEACEFUL, true, new net.minecraft.world.level.GameRules(), net.minecraft.world.level.DataPackConfig.DEFAULT);
        net.minecraft.core.RegistryAccess.Writable registries = net.minecraft.core.RegistryAccess.builtinCopy();
        var worldGen = registries.registryOrThrow(net.minecraft.core.Registry.WORLD_PRESET_REGISTRY)
            .getHolderOrThrow(net.minecraft.world.level.levelgen.presets.WorldPresets.FLAT).value().createWorldGenSettings(seed, false, false);
        mc.createWorldOpenFlows().createFreshLevel(name, settings, registries, worldGen);
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
