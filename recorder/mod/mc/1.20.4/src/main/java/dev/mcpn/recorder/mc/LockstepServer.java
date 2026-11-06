package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Lockstep;
import dev.mcpn.recorder.mc.mixin.BlockableEventLoopAccessor;
import dev.mcpn.recorder.mc.mixin.ServerCommonPacketListenerImplAccessor;
import java.util.List;
import java.util.function.BooleanSupplier;
import net.minecraft.network.Connection;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

/** The integrated server as Lockstep needs it: its tasks run in managedBlock, as in vanilla's wait. */
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
        server.managedBlock(done);
    }
}
