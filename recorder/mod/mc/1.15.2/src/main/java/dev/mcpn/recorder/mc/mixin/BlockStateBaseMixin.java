package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.ServerOpsImpl;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * While an area is built, placed blocks do not react (a fluid schedules no flow, a piston does not
 * check its power, a falling block does not schedule its fall): the area is exactly its fills.
 */
@Mixin(BlockState.class)
public class BlockStateBaseMixin {
    @Inject(method = "onPlace", at = @At("HEAD"), cancellable = true)
    private void recorder$quietBuild(Level level, BlockPos pos, BlockState oldState, boolean movedByPiston, CallbackInfo ci) {
        if (ServerOpsImpl.building) {
            ci.cancel();
        }
    }
}
