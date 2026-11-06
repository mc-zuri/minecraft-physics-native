package dev.mcpn.recorder.mc;

/** No simulation distance before 1.18. */
final class CompatOptions {
    private CompatOptions() {
    }

    static void configure(net.minecraft.client.Minecraft mc) {
        mc.options.pauseOnLostFocus = false;
        mc.options.renderDistance = Integer.getInteger("recorder.renderDistance", 4);
    }

    static void setAutoJump(net.minecraft.client.Minecraft mc, boolean enabled) {
        // (no auto-jump before 1.10)
    }

    static int renderDistance(net.minecraft.client.Minecraft mc) {
        // (a chunk less of it than from 1.15: IntegratedServer.tickServer takes 2 off it, not 1)
        return mc.options.renderDistance - 1;
    }

    /** The server's view distance for this client (the integrated server takes the client's render distance). */
    static int effectiveDistance(net.minecraft.client.Minecraft mc) {
        return mc.options.renderDistance;
    }

    static void setGameTime(net.minecraft.client.Minecraft mc, long time) {
        mc.level.setGameTime(time);
    }
}
