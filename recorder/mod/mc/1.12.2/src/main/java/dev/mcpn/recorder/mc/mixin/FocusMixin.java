package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.Recorder;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

/**
 * Whether a held attack goes on: before 1.13 handleKeybinds asks whether the window has the focus too, which the desktop
 * decides. A recorded player is at the window.
 */
@Mixin(Minecraft.class)
public class FocusMixin {
    @ModifyArg(method = "handleKeybinds", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/Minecraft;continueAttack(Z)V"))
    private boolean recorder$focused(boolean attacking) {
        Minecraft mc = (Minecraft) (Object) this;
        Recorder recorder = Recorder.get();
        return attacking || recorder != null && recorder.active() && mc.screen == null && mc.options.keyAttack.isDown();
    }
}
