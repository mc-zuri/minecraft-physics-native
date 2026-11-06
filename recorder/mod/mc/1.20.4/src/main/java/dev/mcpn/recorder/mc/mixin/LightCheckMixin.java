package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.LightFence;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ThreadedLevelLightEngine;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** The columns whose light has work on its way: see LightFence. */
@Mixin(ThreadedLevelLightEngine.class)
public class LightCheckMixin {
    @Inject(method = "checkBlock", at = @At("HEAD"))
    private void recorder$checked(BlockPos pos, CallbackInfo ci) {
        LightFence.checked(pos.getX() >> 4, pos.getZ() >> 4);
    }
}
