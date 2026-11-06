package dev.mcpn.recorder.mc.mixin;

import net.minecraft.server.network.ServerCommonPacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * The integrated server treats the player as a dedicated server treats any player: the
 * singleplayer owner skips the "moved too quickly" checks, so the corrections a mineflayer bot
 * would get on a server would never show. Keep-alives run on the wall clock, which would put
 * packets into the recording at nondeterministic ticks; they are not sent.
 */
@Mixin(ServerCommonPacketListenerImpl.class)
public class ServerCommonPacketListenerMixin {
    @Inject(method = "isSingleplayerOwner", at = @At("HEAD"), cancellable = true)
    private void recorder$dedicatedChecks(CallbackInfoReturnable<Boolean> cir) {
        cir.setReturnValue(false);
    }

    @Inject(method = "keepConnectionAlive", at = @At("HEAD"), cancellable = true)
    private void recorder$noKeepAlive(CallbackInfo ci) {
        ci.cancel();
    }
}
