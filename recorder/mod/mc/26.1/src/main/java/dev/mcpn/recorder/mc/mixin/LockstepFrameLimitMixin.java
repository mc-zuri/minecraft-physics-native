package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.Lockstep;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Under lockstep the frame limiter does not sleep. */
@Mixin(net.minecraft.client.FramerateLimiter.class)
public class LockstepFrameLimitMixin {
    @Inject(method = "limitDisplayFPS", at = @At("HEAD"), cancellable = true)
    private static void recorder$noFrameLimit(CallbackInfo ci) {
        if (Lockstep.skipFrameLimit()) {
            ci.cancel();
        }
    }
}
