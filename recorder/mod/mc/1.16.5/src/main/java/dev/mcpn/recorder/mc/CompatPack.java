package dev.mcpn.recorder.mc;

import net.minecraft.server.level.ServerPlayer;

/** The server's resource pack packets, which changed more than most. */
final class CompatPack {
    private CompatPack() {
    }

    static void send(ServerPlayer player, String url, String hash, boolean required, String prompt, boolean pop) {
        if (pop) {
            // (a server cannot take a pack back before 1.20.3)
            return;
        }
        // (no prompt before 1.17, and the server's required flag is its own)
        player.connection.send(new net.minecraft.network.protocol.game.ClientboundResourcePackPacket(url, hash));
    }
}
