package dev.mcpn.recorder.mc;

/** A chunk column to one client, past what the server tracks: the forget-level-chunk packet, and the column again. */
final class CompatChunks {
    private CompatChunks() {
    }

    /** No such packet in 1.8: a full column of no sections (1.8.9 PlayerWorldManager.java:278, read at ClientPlayNetworkHandler.java:566-574). */
    static void forget(net.minecraft.server.level.ServerPlayer player, net.minecraft.world.level.chunk.LevelChunk chunk, int chunkX, int chunkZ) {
        player.connection.send(new net.minecraft.network.protocol.game.ClientboundLevelChunkPacket(chunk, true, 0));
    }

    /** The same packet with every section: PlayerWorldManager sends it in bulk, this is one column. */
    static void send(net.minecraft.server.level.ServerPlayer player, net.minecraft.server.level.ServerLevel level, net.minecraft.world.level.chunk.LevelChunk chunk) {
        player.connection.send(new net.minecraft.network.protocol.game.ClientboundLevelChunkPacket(chunk, true, 65535));
    }
}
