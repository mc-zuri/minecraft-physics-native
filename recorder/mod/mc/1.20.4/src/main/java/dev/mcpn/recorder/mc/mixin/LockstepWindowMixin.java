package dev.mcpn.recorder.mc.mixin;

import com.mojang.blaze3d.platform.Window;
import dev.mcpn.recorder.Lockstep;
import dev.mcpn.recorder.mc.BridgeImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** A hidden window, which under lockstep shows one frame every recorder.lockstep.frameMs. */
@Mixin(Window.class)
public class LockstepWindowMixin {
    /** Recording opens several clients; none needs to be seen or take the focus. */
    @Inject(method = "<init>", at = @At(value = "INVOKE", target = "Lorg/lwjgl/glfw/GLFW;glfwCreateWindow(IILjava/lang/CharSequence;JJ)J", remap = false))
    private void recorder$hidden(CallbackInfo ci) {
        org.lwjgl.glfw.GLFW.glfwWindowHint(org.lwjgl.glfw.GLFW.GLFW_VISIBLE, org.lwjgl.glfw.GLFW.GLFW_FALSE);
    }

    @Inject(method = "updateDisplay", at = @At("HEAD"), cancellable = true)
    private void recorder$skipFrame(CallbackInfo ci) {
        if (Lockstep.skipFrame(BridgeImpl.RENDER)) {
            ci.cancel();
        }
    }
}
