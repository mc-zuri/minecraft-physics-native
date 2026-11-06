package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.BridgeImpl;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Draws nothing once in the world; the game still ticks. Menus keep rendering because the
 * loading overlay only finishes while it is drawn. -Drecorder.render=true keeps rendering.
 */
@Mixin(GameRenderer.class)
public class GameRendererMixin {
    @Inject(method = "render", at = @At("HEAD"), cancellable = true)
    private void recorder$skipRender(CallbackInfo ci) {
        Minecraft mc = Minecraft.getInstance();
        if (!BridgeImpl.RENDER && mc.level != null) {
            // LevelRenderer.renderLevel drains the client's light update queue every frame; without frames
            // it would only grow until the client runs out of memory
            if (mc.getConnection() != null && mc.getConnection().getLevel() != null) {
                dev.mcpn.recorder.mc.CompatLevel.pollClientLight(mc.level);
            }
            ci.cancel();
        }
    }
}
