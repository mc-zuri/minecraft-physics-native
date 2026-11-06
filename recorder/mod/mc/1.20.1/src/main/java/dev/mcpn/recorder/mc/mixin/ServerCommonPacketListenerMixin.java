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

    @Inject(method = "isSingleplayerOwner", at = @At("HEAD"), cancellable = true)
    private void recorder$dedicatedChecks(CallbackInfoReturnable<Boolean> cir) {
        cir.setReturnValue(false);
    }

    @Inject(method = "tick", at = @At("HEAD"))
    private void recorder$noKeepAlive(CallbackInfo ci) {
        keepAliveTime = Util.getMillis();
    }
}
