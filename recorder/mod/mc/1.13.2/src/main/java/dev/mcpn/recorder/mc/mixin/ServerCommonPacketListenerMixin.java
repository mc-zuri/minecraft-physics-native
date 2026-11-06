package dev.mcpn.recorder.mc.mixin;

import net.minecraft.Util;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * As the 1.20.2+ adapter's, on the game listener, which holds these itself before the common listener exists. The
 * keep-alive is inline in tick: its clock is held at now, so its 15 seconds never pass.
 */
@Mixin(ServerGamePacketListenerImpl.class)
public class ServerCommonPacketListenerMixin {
    @Shadow
    private long keepAliveTime;

    /** The move handlers ask this, then the owner's name, to leave out their checks: a dedicated server's client has them. */
    @org.spongepowered.asm.mixin.injection.Redirect(method = {"handleMovePlayer", "handleMoveVehicle"}, at = @At(value = "INVOKE", target = "Lnet/minecraft/server/MinecraftServer;isSingleplayer()Z"))
    private boolean recorder$dedicatedChecks(net.minecraft.server.MinecraftServer server) {
        return false;
    }

    @Inject(method = "tick", at = @At("HEAD"))
    private void recorder$noKeepAlive(CallbackInfo ci) {
        keepAliveTime = Util.getMillis();
    }
}
