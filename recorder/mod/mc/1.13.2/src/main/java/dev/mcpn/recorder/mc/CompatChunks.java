package dev.mcpn.recorder.mc;

/** A chunk column to one client, past what the server tracks: the forget-level-chunk packet, and the column again. */
final class CompatChunks {
    private CompatChunks() {
    }

    static void forget(net.minecraft.server.level.ServerPlayer player, net.minecraft.world.level.chunk.LevelChunk chunk, int chunkX, int chunkZ) {
        player.connection.send(new net.minecraft.network.protocol.game.ClientboundForgetLevelChunkPacket(chunkX, chunkZ));
    }


    /** ChunkPlayerManager's packet (1.12.2 :115): light comes in it until 1.14. */
    static void send(net.minecraft.server.level.ServerPlayer player, net.minecraft.server.level.ServerLevel level, net.minecraft.world.level.chunk.LevelChunk chunk) {
        player.connection.send(new net.minecraft.network.protocol.game.ClientboundLevelChunkPacket(chunk, 65535));
    }
}
