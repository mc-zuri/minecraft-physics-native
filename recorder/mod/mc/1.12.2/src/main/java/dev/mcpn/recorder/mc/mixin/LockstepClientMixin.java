package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.Lockstep;
import dev.mcpn.recorder.mc.BridgeImpl;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Timer;
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
    @Unique
    private static int recorder$ticks;

    /** Before 1.16 the timer keeps its ticks in a field, which the loop reads. */
    @Redirect(method = "runGameLoop", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/Timer;advanceTime()V"))
    private void recorder$lockstepClock(Timer timer) {
        timer.advanceTime();
        recorder$ticks = Lockstep.clientTicks(recorder$connection(), BridgeImpl.canLockstep(), timer.ticks);
        // a failed lockstep runs no more ticks, so the recorder's tick hook never sees it: end the run from the frame
        if (Lockstep.failure() != null) {
            dev.mcpn.recorder.Recorder recorder = dev.mcpn.recorder.Recorder.get();
            if (recorder != null) {
                recorder.lockstepFailed();
            }
        }
    }

    @Redirect(method = "runGameLoop", at = @At(value = "FIELD", target = "Lnet/minecraft/client/Timer;ticks:I", opcode = org.objectweb.asm.Opcodes.GETFIELD))
    private int recorder$lockstepTicks(Timer timer) {
        return recorder$ticks;
    }

    /** The loop empties its queue itself: nothing to run is no work. */
    @Redirect(method = "runGameLoop", at = @At(value = "INVOKE", target = "Ljava/util/Queue;isEmpty()Z"))
    private boolean recorder$lockstepTasks(java.util.Queue<?> tasks) {
        return !Lockstep.clientFrameWork() || tasks.isEmpty();
    }

    @Inject(method = "runGameLoop", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/Minecraft;tick()V", shift = At.Shift.AFTER))
    private void recorder$lockstepTicked(CallbackInfo ci) {
        Lockstep.clientTicked();
    }

    @Inject(method = "updateDisplay", at = @At("HEAD"), cancellable = true)
    private void recorder$skipFrame(CallbackInfo ci) {
        if (Lockstep.skipFrame(BridgeImpl.RENDER)) {
            ci.cancel();
        }
    }

    @Redirect(method = "runGameLoop", at = @At(value = "INVOKE", target = "Lorg/lwjgl/opengl/Display;sync(I)V", remap = false))
    private void recorder$noFrameLimit(int limit) {
        if (!Lockstep.skipFrameLimit()) {
            org.lwjgl.opengl.Display.sync(limit);
        }
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
