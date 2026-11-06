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
        player.connection.send(new net.minecraft.network.protocol.common.ClientboundResourcePackPacket(url, hash, required,
            prompt == null ? null : net.minecraft.network.chat.Component.literal(prompt)));
    }
}
