package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.ServerOpsImpl;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.Level;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** The block light of a changed block, which a quiet build leaves: see BlockStateBaseMixin. */
@Mixin(Level.class)
public class QuietLightMixin {
    @Inject(method = "method_8568", at = @At("HEAD"), cancellable = true)
    private void recorder$quietLight(BlockPos pos, CallbackInfoReturnable<Boolean> cir) {
        if (ServerOpsImpl.skipLight()) {
            cir.setReturnValue(false);
        }
    }
}
