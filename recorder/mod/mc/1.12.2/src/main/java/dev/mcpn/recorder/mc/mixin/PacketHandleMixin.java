package dev.mcpn.recorder.mc.mixin;

import com.google.common.util.concurrent.ListenableFuture;
import dev.mcpn.recorder.mc.PacketCapture;
import net.minecraft.network.PacketListener;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketUtils;
import net.minecraft.util.thread.BlockableEventLoop;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** Before 1.13 the handling is an anonymous task: the task is what is wrapped, on its way to the thread. */
@Mixin(PacketUtils.class)
public class PacketHandleMixin {
    @Redirect(method = "ensureRunningOnSameThread", at = @At(value = "INVOKE", target = "Lnet/minecraft/util/thread/BlockableEventLoop;submit(Ljava/lang/Runnable;)Lcom/google/common/util/concurrent/ListenableFuture;"))
    private static ListenableFuture<Object> recorder$handle(BlockableEventLoop executor, Runnable task, Packet<?> packet, PacketListener listener, BlockableEventLoop same) {
        return executor.submit(() -> PacketCapture.handle(listener, packet, task));
    }
}
