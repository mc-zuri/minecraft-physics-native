package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.BridgeImpl;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.LevelRenderer;
import net.minecraft.core.BlockPos;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/**
 * The client tells the server it loaded in once the section at the player has compiled, else after 30 s. The recorder
 * draws nothing, so sections never compile and the server would drop the player's movement until a wall clock ran out,
 * into the first case: the player's chunk arriving counts instead.
 */
@Mixin(targets = "net.minecraft.client.multiplayer.LevelLoadTracker$WaitingForPlayerChunk")
public class LevelLoadTrackerMixin {
    @Redirect(method = "isReady", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/renderer/LevelRenderer;isSectionCompiledAndVisible(Lnet/minecraft/core/BlockPos;)Z"))
    private boolean recorder$chunkArrived(LevelRenderer renderer, BlockPos pos) {
        return BridgeImpl.RENDER ? renderer.isSectionCompiledAndVisible(pos) : Minecraft.getInstance().level.hasChunk(pos.getX() >> 4, pos.getZ() >> 4);
    }
}
