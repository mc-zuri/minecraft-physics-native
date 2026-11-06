package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.BridgeImpl;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.LevelLoadingScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * The terrain screen waits until the section at the player has been compiled for rendering, else
 * 30 s. The recorder draws nothing, so sections never compile and every world join cost the full
 * timeout: the screen closes as soon as the client has the player's chunk instead.
 */
@Mixin(LevelLoadingScreen.class)
public class ReceivingLevelScreenMixin {
    @Inject(method = "tick", at = @At("HEAD"), cancellable = true)
    private void recorder$closeOnChunk(CallbackInfo ci) {
        Minecraft mc = Minecraft.getInstance();
        if (BridgeImpl.RENDER || mc.player == null || mc.level == null) {
            return;
        }
        if (mc.level.hasChunk(dev.mcpn.recorder.mc.CompatEntity.blockX(mc.player) >> 4, dev.mcpn.recorder.mc.CompatEntity.blockZ(mc.player) >> 4)) {
            ((LevelLoadingScreen) (Object) this).onClose();
            ci.cancel();
        }
    }
}
