package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.ServerOpsImpl;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * A quiet build runs no block's placement logic, and a tall one no light (ServerOpsImpl.skipLight). BlockState is an interface before 1.14:
 * its one caller is hooked.
 */
@Mixin(LevelChunk.class)
public class BlockStateBaseMixin {
    @Redirect(method = "setBlockState", at = @At(value = "INVOKE", target = "Lnet/minecraft/world/level/block/state/BlockState;onPlace(Lnet/minecraft/world/level/Level;Lnet/minecraft/core/BlockPos;Lnet/minecraft/world/level/block/state/BlockState;)V"))
    private void recorder$quietBuild(BlockState state, Level level, BlockPos pos, BlockState oldState) {
        if (!ServerOpsImpl.building) {
            state.onPlace(level, pos, oldState);
        }
    }

    @Inject(method = "method_3917", at = @At("HEAD"), cancellable = true)
    private void recorder$quietSkyLight(int x, int y, int z, BlockState state, CallbackInfo ci) {
        if (ServerOpsImpl.skipLight()) {
            ci.cancel();
        }
    }

    @Inject(method = "calculateSkyLight", at = @At("HEAD"), cancellable = true)
    private void recorder$quietColumns(CallbackInfo ci) {
        if (ServerOpsImpl.skipLight()) {
            ci.cancel();
        }
    }
}
