package dev.mcpn.recorder.mc;

/** Packet ids and bundles. */
public final class CompatNet {
    private CompatNet() {
    }

    static int packetId(net.minecraft.network.protocol.PacketFlow flow, net.minecraft.network.protocol.Packet<?> packet) {
        return net.minecraft.network.ConnectionProtocol.PLAY.codec(flow).packetId(packet);
    }

    static boolean isBundle(net.minecraft.network.protocol.Packet<?> packet) {
        return packet instanceof net.minecraft.network.protocol.game.ClientboundBundlePacket;
    }

    public static int protocolVersion() {
        return net.minecraft.SharedConstants.getProtocolVersion();
    }

    /** The packet's id and bytes in the PLAY protocol, or false when it has no PLAY id (configuration...). */
    static boolean write(net.minecraft.network.protocol.PacketFlow flow, net.minecraft.network.protocol.Packet<?> packet, io.netty.buffer.ByteBuf raw) throws Exception {
        int id;
        try {
            id = packetId(flow, packet);
        } catch (RuntimeException e) {
            return false;
        }
        if (id < 0) {
            return false;
        }
        net.minecraft.network.FriendlyByteBuf buf = new net.minecraft.network.FriendlyByteBuf(raw);
        buf.writeVarInt(id);
        packet.write(buf);
        return true;
    }

    /** No chunk waits in the batched sender: the server pairs an entity with a player only over a chunk it has sent. */
    static boolean chunksSent(net.minecraft.server.level.ServerPlayer player) {
        return ((dev.mcpn.recorder.mc.mixin.PlayerChunkSenderAccessor) player.connection.chunkSender).recorder$pendingChunks().isEmpty();
    }
}
