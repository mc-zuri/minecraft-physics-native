package dev.mcpn.recorder.mc.mixin;

import java.util.Queue;
import net.minecraft.util.thread.BlockableEventLoop;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(BlockableEventLoop.class)
public interface BlockableEventLoopAccessor {
    @Accessor("pendingRunnables")
    Queue<?> recorder$pendingRunnables();

    @Invoker("runAllTasks")
    void recorder$runAllTasks();
}
