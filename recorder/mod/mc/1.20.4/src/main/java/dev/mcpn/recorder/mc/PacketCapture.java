package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Recorder;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.Connection;
import net.minecraft.network.ConnectionProtocol;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.PacketListener;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.network.protocol.game.ClientGamePacketListener;
import net.minecraft.network.protocol.game.ClientboundPlayerPositionPacket;

/**
 * The client's packets in both directions, as the bytes the PLAY codec would put on the wire (a
 * 1.20.4 memory connection hands packet objects over without encoding them, so they are encoded
 * here the way PacketEncoder does: the varint packet id, then Packet.write). Under lockstep the
 * server waits while the client handles its packets, so the objects are not changing underneath.
 */
public final class PacketCapture {
    private PacketCapture() {
    }

    /** The packet's id and bytes in the PLAY protocol, or null when it has no PLAY id (configuration...). */
    static byte[] encode(PacketFlow flow, Packet<?> packet) {
        ByteBuf raw = Unpooled.buffer();
        try {
            if (!CompatNet.write(flow, packet, raw)) {
                return unwritten(packet, null);
            }
            byte[] bytes = new byte[raw.readableBytes()];
            raw.getBytes(raw.readerIndex(), bytes);
            return bytes;
        } catch (Exception e) {
            return unwritten(packet, e);
        } finally {
            raw.release();
        }
    }

    /** Outside a recording a packet of another protocol goes by; in one, a game packet without its bytes is no recording. */
    private static byte[] unwritten(Packet<?> packet, Exception cause) {
        Recorder recorder = Recorder.get();
        if (recorder != null && recorder.active()) {
            throw new IllegalStateException("no bytes for " + name(packet), cause);
        }
        return null;
    }

    /** The packet's id: the varint its bytes start with, or -1. */
    static int id(PacketFlow flow, Packet<?> packet) {
        byte[] bytes = encode(flow, packet);
        if (bytes == null) {
            return -1;
        }
        int value = 0;
        for (int i = 0; i < Math.min(5, bytes.length); i++) {
            value |= (bytes[i] & 0x7F) << (7 * i);
            if ((bytes[i] & 0x80) == 0) {
                break;
            }
        }
        return value;
    }

    static String name(Packet<?> packet) {
        return packet.getClass().getSimpleName();
    }

    /** A packet handled on a game thread: the client's game packets are recorded around their handling. */
    public static void handle(PacketListener listener, Packet<?> packet, Runnable handle) {
        Recorder recorder = Recorder.get();
        if (recorder == null || !(listener instanceof ClientGamePacketListener) || CompatNet.isBundle(packet)) {
            handle.run();
            return;
        }
        byte[] bytes = encode(PacketFlow.CLIENTBOUND, packet);
        recorder.beforeHandle();
        try {
            handle.run();
        } finally {
            recorder.afterHandle(name(packet), id(PacketFlow.CLIENTBOUND, packet), bytes,
                packet instanceof ClientboundPlayerPositionPacket);
        }
    }

    /** Connection.send HEAD: a packet the client sends (the server's connection is not recorded here). */
    public static void sent(Connection connection, Packet<?> packet) {
        Recorder recorder = Recorder.get();
        if (recorder == null || !recorder.active()) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        ClientPacketListener listener = mc.getConnection();
        if (listener == null || listener.getConnection() != connection) {
            return;
        }
        if (!CompatMove.onClientThread(mc)) {
            // a send from another thread (none in play under lockstep) would make the order nondeterministic
            dev.mcpn.recorder.Log.info("packet %s sent from thread %s", name(packet), Thread.currentThread().getName());
        }
        recorder.sent(name(packet), id(PacketFlow.SERVERBOUND, packet), encode(PacketFlow.SERVERBOUND, packet));
    }
}
