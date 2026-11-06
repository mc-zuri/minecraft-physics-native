package dev.mcpn.recorder.mc;

/** No accessibility onboarding screen. */
public final class CompatLevel {
    private CompatLevel() {
    }

    static void createLevel(net.minecraft.client.Minecraft mc, String name, long seed) {
        var settings = new net.minecraft.world.level.LevelSettings(name, net.minecraft.world.level.GameType.SURVIVAL, false,
            net.minecraft.world.Difficulty.PEACEFUL, true, new net.minecraft.world.level.GameRules(), net.minecraft.world.level.WorldDataConfiguration.DEFAULT);
        mc.createWorldOpenFlows().createFreshLevel(name, settings, new net.minecraft.world.level.levelgen.WorldOptions(seed, false, false),
            registries -> registries.registryOrThrow(net.minecraft.core.registries.Registries.WORLD_PRESET)
                .getHolderOrThrow(net.minecraft.world.level.levelgen.presets.WorldPresets.FLAT).value().createWorldDimensions());
    }

    static void muteSound(net.minecraft.client.Minecraft mc) {
        mc.options.getSoundSourceOptionInstance(net.minecraft.sounds.SoundSource.MASTER).set(0.0);
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
