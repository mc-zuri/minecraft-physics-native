package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.Lockstep;
import dev.mcpn.recorder.mc.BridgeImpl;
import net.minecraft.client.Minecraft;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.Connection;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * The client's half of the lockstep: Minecraft.runTick asks it how many ticks to run where it
 * reads its clock, and handles packets and tasks only on the frames that tick.
 */
@Mixin(Minecraft.class)
public class LockstepClientMixin {
    @Redirect(method = "runTick", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/DeltaTracker$Timer;advanceTime(JZ)I"))
    private int recorder$lockstepTicks(DeltaTracker.Timer timer, long currentMs, boolean advance) {
        int ticks = Lockstep.clientTicks(recorder$connection(), BridgeImpl.canLockstep(), timer.advanceTime(currentMs, advance));
        // a failed lockstep runs no more ticks, so the recorder's tick hook never sees it: end the run from the frame
        if (Lockstep.failure() != null) {
            dev.mcpn.recorder.Recorder recorder = dev.mcpn.recorder.Recorder.get();
            if (recorder != null) {
                recorder.lockstepFailed();
            }
        }
        return ticks;
    }

    /** From 1.21.9 packets wait in their own queue, handled just before the tasks. */
    @Redirect(method = "runTick", at = @At(value = "INVOKE", target = "Lnet/minecraft/network/PacketProcessor;processQueuedPackets()V"))
    private void recorder$lockstepPackets(net.minecraft.network.PacketProcessor processor) {
        if (Lockstep.clientFrameWork()) {
            processor.processQueuedPackets();
        }
    }

    @Redirect(method = "runTick", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/Minecraft;runAllTasks()V"))
    private void recorder$lockstepTasks(Minecraft minecraft) {
        if (Lockstep.clientFrameWork()) {
            ((BlockableEventLoopAccessor) (Object) minecraft).recorder$runAllTasks();
        }
    }

    @Inject(method = "runTick", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/Minecraft;tick()V", shift = At.Shift.AFTER))
    private void recorder$lockstepTicked(boolean renderLevel, CallbackInfo ci) {
        Lockstep.clientTicked();
    }

    /** The client's memory connection in a singleplayer world, else null. */
    @Unique
    private Object recorder$connection() {
        Minecraft mc = (Minecraft) (Object) this;
        ClientPacketListener listener = mc.getConnection();
        Connection connection = listener == null ? null : listener.getConnection();
        return connection != null && connection.isMemoryConnection() && mc.level != null && mc.player != null
            && mc.getSingleplayerServer() != null ? connection : null;
    }
}
