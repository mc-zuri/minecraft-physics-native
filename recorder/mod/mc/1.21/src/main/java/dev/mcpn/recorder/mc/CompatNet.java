package dev.mcpn.recorder.mc;

import io.netty.buffer.ByteBuf;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.ProtocolInfo;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.network.protocol.game.GameProtocols;

/** From 1.20.5 a packet is written by its protocol's codec, which needs the connection's registries. */
public final class CompatNet {
    private static Object bound;
    private static ProtocolInfo<?> serverbound;
    private static ProtocolInfo<?> clientbound;

    private CompatNet() {
    }

    static boolean isBundle(Packet<?> packet) {
        return packet instanceof net.minecraft.network.protocol.game.ClientboundBundlePacket;
    }

    public static int protocolVersion() {
        return net.minecraft.SharedConstants.getProtocolVersion();
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static synchronized boolean write(PacketFlow flow, Packet<?> packet, ByteBuf raw) {
        ClientPacketListener listener = Minecraft.getInstance().getConnection();
        if (listener == null) {
            return false;
        }
        if (bound != listener) {
            serverbound = GameProtocols.SERVERBOUND_TEMPLATE.bind(RegistryFriendlyByteBuf.decorator(listener.registryAccess()));
            clientbound = GameProtocols.CLIENTBOUND_TEMPLATE.bind(RegistryFriendlyByteBuf.decorator(listener.registryAccess()));
            bound = listener;
        }
        ProtocolInfo<?> info = flow == PacketFlow.SERVERBOUND ? serverbound : clientbound;
        try {
            ((StreamCodec) info.codec()).encode(raw, packet);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** No chunk waits in the batched sender: the server pairs an entity with a player only over a chunk it has sent. */
    static boolean chunksSent(net.minecraft.server.level.ServerPlayer player) {
        return ((dev.mcpn.recorder.mc.mixin.PlayerChunkSenderAccessor) player.connection.chunkSender).recorder$pendingChunks().isEmpty();
    }
}
