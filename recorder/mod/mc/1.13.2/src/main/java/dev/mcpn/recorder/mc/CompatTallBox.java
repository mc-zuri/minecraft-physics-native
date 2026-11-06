package dev.mcpn.recorder.mc;

import net.minecraft.server.level.ServerLevel;

/**
 * A tall box's build skips the chunk's lightBlock (ServerOpsImpl.skipLight), and that is what keeps the height map. Left
 * alone, whether a block sees the sky would depend on the cases before this one, and with it a phantom's burning in the sun.
 * calculateSkyLight works it out again from the blocks alone.
 */
final class CompatTallBox {
    private CompatTallBox() {
    }

    static void settle(ServerLevel level, int[] box) {
        for (int x = box[0] >> 4; x <= box[3] >> 4; x++) {
            for (int z = box[2] >> 4; z <= box[5] >> 4; z++) {
                level.getChunk(x, z).calculateSkyLight();
            }
        }
    }
}
