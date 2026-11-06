package dev.mcpn.recorder.mc;

/** Resource names. */
final class CompatNames {
    private CompatNames() {
    }

    static net.minecraft.resources.ResourceLocation id(String text) {
        return new net.minecraft.resources.ResourceLocation(text);
    }

    static String gameVersion() {
        return net.minecraft.SharedConstants.getCurrentVersion().getName();
    }
}
