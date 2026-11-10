package dev.mcpn.recorder.mc;

import com.mojang.authlib.GameProfile;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import net.minecraft.network.Connection;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;

/**
 * A second player for the recorded one to hit: a server player with no client, on a connection with no channel (whatever
 * is sent to it waits and is dropped). The client sees it as a remote player, whose hurt says true on the client
 * (RemotePlayer.hurtClient, 26.3 RemotePlayer.java:31; 1.8.9 OtherClientPlayerEntity.damage), so the attacker's own side
 * of a hit is the client's to run. It is no member of the player list: nothing ticks it, and it stands where it was put.
 */
final class FakeTarget {
    private static final List<ServerPlayer> SPAWNED = new ArrayList<>();

    private FakeTarget() {
    }

    static ServerPlayer spawn(MinecraftServer server, ServerLevel level, ServerPlayer viewer, double x, double y, double z, float yRot) {
        GameProfile profile = new GameProfile(UUID.nameUUIDFromBytes(("recorder-target-" + SPAWNED.size()).getBytes()), "Target" + SPAWNED.size());
        ServerPlayer target = create(server, level, profile);
        CompatEntity.moveTo(target, x, y, z, yRot, 0);
        target.setYHeadRot(yRot);
        target.setYBodyRot(yRot);
        // (the client adds a player only once the list told it of that player: ClientPacketListener.handleAddPlayer)
        viewer.connection.send(info(target));
        level.addNewPlayer(target);
        SPAWNED.add(target);
        return target;
    }

    /** Every target spawned, gone from its level and from the viewer's list. */
    static void removeAll(ServerPlayer viewer) {
        for (ServerPlayer target : SPAWNED) {
            CompatEntity.discard(target);
            viewer.connection.send(remove(target));
        }
        SPAWNED.clear();
    }

    private static ServerPlayer create(MinecraftServer server, ServerLevel level, GameProfile profile) {
        ServerPlayer target = new ServerPlayer(server, level, profile, net.minecraft.server.level.ClientInformation.createDefault());
        new net.minecraft.server.network.ServerGamePacketListenerImpl(server, connection(), target,
            net.minecraft.server.network.CommonListenerCookie.createInitial(profile));
        return target;
    }

    /**
     * 1.20.2 - 1.20.4: the listener's Connection.setListener reads the protocol from the channel, so the connection gets a
     * channel that says play, closed (what is sent then waits, as with no channel).
     */
    private static Connection connection() {
        Connection connection = new Connection(PacketFlow.SERVERBOUND);
        io.netty.channel.embedded.EmbeddedChannel channel = new io.netty.channel.embedded.EmbeddedChannel();
        channel.attr(Connection.ATTRIBUTE_SERVERBOUND_PROTOCOL).set(net.minecraft.network.ConnectionProtocol.PLAY.codec(PacketFlow.SERVERBOUND));
        channel.attr(Connection.ATTRIBUTE_CLIENTBOUND_PROTOCOL).set(net.minecraft.network.ConnectionProtocol.PLAY.codec(PacketFlow.CLIENTBOUND));
        channel.close();
        try {
            java.lang.reflect.Field field = Connection.class.getDeclaredField("channel");
            field.setAccessible(true);
            field.set(connection, channel);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
        return connection;
    }

    private static net.minecraft.network.protocol.Packet<?> info(ServerPlayer target) {
        return net.minecraft.network.protocol.game.ClientboundPlayerInfoUpdatePacket.createPlayerInitializing(List.of(target));
    }

    private static net.minecraft.network.protocol.Packet<?> remove(ServerPlayer target) {
        return new net.minecraft.network.protocol.game.ClientboundPlayerInfoRemovePacket(List.of(target.getUUID()));
    }
}
