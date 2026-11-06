package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Lockstep;
import dev.mcpn.recorder.mc.mixin.ServerCommonPacketListenerImplAccessor;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.FutureTask;
import java.util.concurrent.locks.LockSupport;
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

    /** (light runs on the thread that changes the block) */
    @Override
    public boolean lightIdle() {
        return true;
    }

    @Override
    public int pendingTasks() {
        Queue<FutureTask<?>> queue = server.queue;
        synchronized (queue) {
            return queue.size();
        }
    }

    /** The tasks (packets among them) the server would run at the head of its next tick, as they come. */
    @Override
    public void runTasksUntil(BooleanSupplier done) {
        Queue<FutureTask<?>> queue = server.queue;
        while (!done.getAsBoolean()) {
            FutureTask<?> task;
            synchronized (queue) {
                task = queue.poll();
            }
            if (task == null) {
                LockSupport.parkNanos(100_000L);
                continue;
            }
            task.run();
        }
    }
}
