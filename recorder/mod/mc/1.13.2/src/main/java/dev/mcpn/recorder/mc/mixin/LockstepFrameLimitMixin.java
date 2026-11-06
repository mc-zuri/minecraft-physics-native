package dev.mcpn.recorder.mc.mixin;

import com.mojang.blaze3d.platform.Window;
import dev.mcpn.recorder.Lockstep;
import org.lwjgl.glfw.GLFW;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** The frame limit is a wait for events inside the buffer swap before 1.14. */
@Mixin(Window.class)
public class LockstepFrameLimitMixin {
    @Redirect(method = "updateDisplay", at = @At(value = "INVOKE", target = "Lorg/lwjgl/glfw/GLFW;glfwWaitEventsTimeout(D)V"), remap = false)
    private void recorder$noFrameLimit(double timeout) {
        if (Lockstep.skipFrameLimit()) {
            GLFW.glfwPollEvents();
        } else {
            GLFW.glfwWaitEventsTimeout(timeout);
        }
    }
}
