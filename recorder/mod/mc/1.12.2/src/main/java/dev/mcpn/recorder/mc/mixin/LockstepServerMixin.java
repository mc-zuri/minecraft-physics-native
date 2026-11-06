package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.Lockstep;
import dev.mcpn.recorder.mc.BridgeImpl;
import dev.mcpn.recorder.mc.LockstepServer;
import net.minecraft.server.MinecraftServer;
import org.spongepowered.asm.mixin.Mixin;
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
    @Inject(method = "tickServer", at = @At("TAIL"))
    private void recorder$serverTicked(CallbackInfo ci) {
        MinecraftServer server = (MinecraftServer) (Object) this;
        if (!server.isDedicatedServer()) {
            BridgeImpl.serverTicked(server);
        }
    }

    @Inject(method = "run", at = @At(value = "INVOKE", target = "Lnet/minecraft/server/MinecraftServer;tickServer()V", shift = At.Shift.AFTER))
    private void recorder$lockstepTicked(CallbackInfo ci) {
        if (!((MinecraftServer) (Object) this).isDedicatedServer()) {
            Lockstep.serverTicked();
        }
    }

    /** The loop runs as many ticks as its clock says: under lockstep one a time round. */
    @Redirect(method = "run", at = @At(value = "INVOKE", target = "Lnet/minecraft/server/MinecraftServer;getTimeMillis()J"))
    private long recorder$lockstepClock() {
        return Lockstep.serverClock(MinecraftServer.getTimeMillis());
    }

    @Redirect(method = "run", at = @At(value = "INVOKE", target = "Ljava/lang/Thread;sleep(J)V"))
    private void recorder$lockstepWait(long millis) throws InterruptedException {
        MinecraftServer server = (MinecraftServer) (Object) this;
        if (server.isDedicatedServer() || !Lockstep.serverGate(new LockstepServer(server))) {
            Thread.sleep(millis);
        }
    }
}
