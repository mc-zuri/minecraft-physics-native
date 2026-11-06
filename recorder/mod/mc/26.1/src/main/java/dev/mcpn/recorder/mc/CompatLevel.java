package dev.mcpn.recorder.mc;

/** Game rules take the enabled features from 1.21.2. */
public final class CompatLevel {
    private CompatLevel() {
    }

    /** The experiments of this run's world (record.ts --features), by the data pack each is. */
    private static net.minecraft.world.level.WorldDataConfiguration dataConfiguration() {
        var plain = net.minecraft.world.level.WorldDataConfiguration.DEFAULT;
        if (!System.getProperty("recorder.features", "").contains("minecart_improvements")) {
            return plain;
        }
        var packs = new java.util.ArrayList<>(plain.dataPacks().getEnabled());
        packs.add("minecart_improvements");
        return new net.minecraft.world.level.WorldDataConfiguration(new net.minecraft.world.level.DataPackConfig(packs, plain.dataPacks().getDisabled()),
            plain.enabledFeatures().join(net.minecraft.world.flag.FeatureFlagSet.of(net.minecraft.world.flag.FeatureFlags.MINECART_IMPROVEMENTS)));
    }

    static void createLevel(net.minecraft.client.Minecraft mc, String name, long seed) {
        var settings = new net.minecraft.world.level.LevelSettings(name, net.minecraft.world.level.GameType.SURVIVAL,
            new net.minecraft.world.level.LevelSettings.DifficultySettings(net.minecraft.world.Difficulty.PEACEFUL, false, false), true,
            dataConfiguration());
        mc.createWorldOpenFlows().createFreshLevel(name, settings, new net.minecraft.world.level.levelgen.WorldOptions(seed, false, false),
            registries -> registries.lookupOrThrow(net.minecraft.core.registries.Registries.WORLD_PRESET)
                .getOrThrow(net.minecraft.world.level.levelgen.presets.WorldPresets.FLAT).value().createWorldDimensions(), new net.minecraft.client.gui.screens.TitleScreen());
    }

    static void muteSound(net.minecraft.client.Minecraft mc) {
        mc.options.getSoundSourceOptionInstance(net.minecraft.sounds.SoundSource.MASTER).set(0.0);
    }

    static boolean isOnboarding(net.minecraft.client.gui.screens.Screen screen) {
        return screen instanceof net.minecraft.client.gui.screens.AccessibilityOnboardingScreen;
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
