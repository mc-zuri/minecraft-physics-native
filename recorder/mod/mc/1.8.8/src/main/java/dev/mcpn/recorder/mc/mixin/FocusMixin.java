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
    @org.spongepowered.asm.mixin.Shadow
    public boolean focused;

    /** A screen closing gives the focus back only to a window that has it. */
    @org.spongepowered.asm.mixin.injection.Inject(method = "tick", at = @At("HEAD"))
    private void recorder$atTheWindow(org.spongepowered.asm.mixin.injection.callback.CallbackInfo ci) {
        Recorder recorder = Recorder.get();
        if (recorder != null && recorder.active() && ((Minecraft) (Object) this).screen == null) {
            focused = true;
        }
    }

    @ModifyArg(method = "tick", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/Minecraft;continueAttack(Z)V"))
    private boolean recorder$focused(boolean attacking) {
        Minecraft mc = (Minecraft) (Object) this;
        Recorder recorder = Recorder.get();
        return attacking || recorder != null && recorder.active() && mc.screen == null && mc.options.keyAttack.isDown();
    }
}
