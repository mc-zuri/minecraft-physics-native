package dev.mcpn.recorder.mc;

import net.minecraft.server.level.ServerLevel;

/** What a tall box's build leaves undone (ServerOpsImpl.skipLight), which is nothing from 1.14. */
final class CompatTallBox {
    private CompatTallBox() {
    }

    static void settle(ServerLevel level, int[] box) {
    }
}
