package dev.mcpn.recorder.mc;

/** Before 1.19 the options are plain fields. */
final class CompatOptions {
    private CompatOptions() {
    }

    static void configure(net.minecraft.client.Minecraft mc) {
        mc.options.pauseOnLostFocus = false;
        mc.options.autoJump = false;
        mc.options.toggleCrouch = false;
        mc.options.toggleSprint = false;
        mc.options.renderDistance = Integer.getInteger("recorder.renderDistance", 4);
        mc.options.simulationDistance = 5;
    }

    static void setAutoJump(net.minecraft.client.Minecraft mc, boolean enabled) {
        mc.options.autoJump = enabled;
    }

    static int renderDistance(net.minecraft.client.Minecraft mc) {
        return mc.options.renderDistance;
    }

    /** The server's view distance for this client (the integrated server takes the client's render distance). */
    static int effectiveDistance(net.minecraft.client.Minecraft mc) {
        return mc.options.getEffectiveRenderDistance();
    }

    static void setGameTime(net.minecraft.client.Minecraft mc, long time) {
        mc.level.setGameTime(time);
    }
}
