package dev.mcpn.recorder.mc;

import net.minecraft.server.level.ServerPlayer;

/** The server's resource pack packets, which changed more than most. */
final class CompatPack {
    private CompatPack() {
    }

    static void send(ServerPlayer player, String url, String hash, boolean required, String prompt, boolean pop) {
        java.util.UUID id = java.util.UUID.nameUUIDFromBytes(url.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        if (pop) {
            player.connection.send(new net.minecraft.network.protocol.common.ClientboundResourcePackPopPacket(java.util.Optional.of(id)));
            return;
        }
        player.connection.send(new net.minecraft.network.protocol.common.ClientboundResourcePackPushPacket(id, url, hash, required,
            prompt == null ? null : net.minecraft.network.chat.Component.literal(prompt)));
    }
}
