package dev.mcpn.recorder.mc.mixin;

import com.mojang.blaze3d.platform.Window;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

/** A hidden window (LockstepClientMixin paces its frames from 26.1). */
@Mixin(Window.class)
public class LockstepWindowMixin {
    /** Recording opens several clients; none needs to be seen or take the focus (SDL_WINDOW_HIDDEN). */
    @ModifyArg(method = "createWindow", at = @At(value = "INVOKE", target = "Lcom/mojang/renderpearl/api/device/GpuBackend;createWindow(Ljava/lang/String;IIJ)J", remap = false), index = 3)
    private long recorder$hidden(long flags) {
        return flags | 8L;
    }
}
