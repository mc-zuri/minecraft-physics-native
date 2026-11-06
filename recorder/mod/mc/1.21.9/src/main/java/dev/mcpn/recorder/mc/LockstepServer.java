package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Lockstep;
import dev.mcpn.recorder.mc.mixin.BlockableEventLoopAccessor;
import dev.mcpn.recorder.mc.mixin.ServerCommonPacketListenerImplAccessor;
import java.util.List;
import java.util.function.BooleanSupplier;
import net.minecraft.network.Connection;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

/** The integrated server as Lockstep needs it: its packets and tasks run in managedBlock, as in vanilla's wait. */
public final class LockstepServer implements Lockstep.Server {
    private final MinecraftServer server;

    public LockstepServer(MinecraftServer server) {
        this.server = server;
    }

    @Override
    public Object playerConnection() {
        List<ServerPlayer> players = server.getPlayerList().getPlayers();
        if (players.size() != 1) {
            return null;
        }
        Connection connection = ((ServerCommonPacketListenerImplAccessor) players.get(0).connection).recorder$connection();
        return connection != null && connection.isMemoryConnection() ? connection : null;
    }

    @Override
    public boolean lightIdle() {
        var light = server.overworld().getChunkSource().getLightEngine();
        light.tryScheduleUpdate();
        return LightFence.settled(light) && !light.hasLightWork() && !((dev.mcpn.recorder.mc.mixin.ThreadedLevelLightEngineAccessor) light).recorder$scheduled().get();
    }

    @Override
    public int pendingTasks() {
        return ((BlockableEventLoopAccessor) (Object) server).recorder$pendingRunnables().size();
    }

    @Override
    public void runTasksUntil(BooleanSupplier done) {
        // From 1.21.9 packets wait in their own queue, which only waitUntilNextTick (the lockstep's wait replaces it)
        // handles. The fence counts a packet once it is queued, so the queue runs after done is read: whatever done
        // counted is handled. What handling it started (tasks, light) is asked again before the wait ends.
        server.managedBlock(() -> {
            boolean ready = done.getAsBoolean();
            server.packetProcessor().processQueuedPackets();
            return ready && done.getAsBoolean();
        });
    }
}
