package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.Lockstep;
import dev.mcpn.recorder.mc.BridgeImpl;
import dev.mcpn.recorder.mc.LockstepServer;
import net.minecraft.Util;
import net.minecraft.server.MinecraftServer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * The server's half of the lockstep: the run loop ticks, then waits in waitUntilNextTick for its
 * clock. Under lockstep that wait is for the client's tick instead. After each tick the recorder
 * takes the server's view of the player and the area's entities.
 */
@Mixin(MinecraftServer.class)
public class LockstepServerMixin {
    @Shadow
    private long nextTickTime;

    @Inject(method = "tickServer", at = @At("TAIL"))
    private void recorder$serverTicked(CallbackInfo ci) {
        MinecraftServer server = (MinecraftServer) (Object) this;
        if (!server.isDedicatedServer()) {
            BridgeImpl.serverTicked(server);
        }
    }

    @Inject(method = "run", at = @At(value = "INVOKE", target = "Lnet/minecraft/server/MinecraftServer;tickServer(Ljava/util/function/BooleanSupplier;)V", shift = At.Shift.AFTER))
    private void recorder$lockstepTicked(CallbackInfo ci) {
        if (!((MinecraftServer) (Object) this).isDedicatedServer()) {
            Lockstep.serverTicked();
            // the gate is in the wait, and a tick that took long (an autosave) leaves no time to wait: the server would
            // run on, catching up with the clock, without the client
            if (Lockstep.engaged()) {
                this.nextTickTime = Util.getMillis();
            }
        }
    }

    /** The loop sleeps out what is left of the tick: under lockstep the gate is the wait. */
    @Redirect(method = "run", at = @At(value = "INVOKE", target = "Ljava/lang/Thread;sleep(J)V"))
    private void recorder$lockstepWait(long millis) throws InterruptedException {
        MinecraftServer server = (MinecraftServer) (Object) this;
        if (server.isDedicatedServer() || !Lockstep.serverGate(new LockstepServer(server))) {
            Thread.sleep(millis);
        } else {
            // the next tick is due now: the loop adds one tick to this, so it neither catches up nor skips ticks
            this.nextTickTime = Util.getMillis();
        }
    }
}
