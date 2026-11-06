package dev.mcpn.recorder.mc;

/** The constructor is private from 1.21. */
final class CompatNames {
    private CompatNames() {
    }

    static net.minecraft.resources.ResourceLocation id(String text) {
        return net.minecraft.resources.ResourceLocation.parse(text);
    }

    static String gameVersion() {
        return net.minecraft.SharedConstants.getCurrentVersion().name();
    }
}
