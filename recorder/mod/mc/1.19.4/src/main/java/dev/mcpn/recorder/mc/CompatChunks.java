package dev.mcpn.recorder.mc;

/** A chunk column to one client, past what the server tracks: the forget-level-chunk packet, and the column again. */
final class CompatChunks {
    private CompatChunks() {
    }

    static void forget(net.minecraft.server.level.ServerPlayer player, net.minecraft.world.level.chunk.LevelChunk chunk, int chunkX, int chunkZ) {
        player.connection.send(new net.minecraft.network.protocol.game.ClientboundForgetLevelChunkPacket(chunkX, chunkZ));
    }


    /** ChunkMap.playerLoadedChunk's packet. */
    static void send(net.minecraft.server.level.ServerPlayer player, net.minecraft.server.level.ServerLevel level, net.minecraft.world.level.chunk.LevelChunk chunk) {
        player.connection.send(new net.minecraft.network.protocol.game.ClientboundLevelChunkWithLightPacket(chunk, level.getLightEngine(), null, null, true));
    }
}
