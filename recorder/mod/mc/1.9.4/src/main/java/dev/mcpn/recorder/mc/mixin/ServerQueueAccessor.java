package dev.mcpn.recorder.mc.mixin;

import java.util.Queue;
import java.util.concurrent.FutureTask;
import net.minecraft.server.MinecraftServer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(MinecraftServer.class)
public interface ServerQueueAccessor {
    @Accessor("queue")
    Queue<FutureTask<?>> recorder$queue();
}
