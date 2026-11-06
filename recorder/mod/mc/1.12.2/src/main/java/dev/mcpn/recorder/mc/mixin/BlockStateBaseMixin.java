package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.ServerOpsImpl;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** A quiet build runs no block's placement logic, and a tall one no light (ServerOpsImpl.skipLight). */
@Mixin(LevelChunk.class)
public class BlockStateBaseMixin {
    @Redirect(method = "setBlockState", at = @At(value = "INVOKE", target = "Lnet/minecraft/world/level/block/Block;onPlace(Lnet/minecraft/world/level/Level;Lnet/minecraft/core/BlockPos;Lnet/minecraft/world/level/block/state/BlockState;)V"))
    private void recorder$quietBuild(Block block, Level level, BlockPos pos, BlockState state) {
        if (!ServerOpsImpl.building) {
            block.onPlace(level, pos, state);
        }
    }

    @Inject(method = "lightBlock", at = @At("HEAD"), cancellable = true)
    private void recorder$quietSkyLight(int x, int y, int z, CallbackInfo ci) {
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
