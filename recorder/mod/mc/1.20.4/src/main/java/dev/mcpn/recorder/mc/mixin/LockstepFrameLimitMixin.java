package dev.mcpn.recorder.mc.mixin;

import com.mojang.blaze3d.systems.RenderSystem;
import dev.mcpn.recorder.Lockstep;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Under lockstep the frame limiter does not sleep. */
@Mixin(RenderSystem.class)
public class LockstepFrameLimitMixin {
    @Inject(method = "limitDisplayFPS", at = @At("HEAD"), cancellable = true)
    private static void recorder$noFrameLimit(CallbackInfo ci) {
        if (Lockstep.skipFrameLimit()) {
            ci.cancel();
        }
    }
}
