package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.Recorder;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** The client tick's head and tail: the recorder applies the input, then records the row. */
@Mixin(Minecraft.class)
public class MinecraftMixin {
    @Inject(method = "tick", at = @At("HEAD"))
    private void recorder$tickStart(CallbackInfo ci) {
        Recorder recorder = Recorder.get();
        if (recorder != null) {
            recorder.tickStart();
        }
    }

    @Inject(method = "tick", at = @At("TAIL"))
    private void recorder$tickEnd(CallbackInfo ci) {
        Recorder recorder = Recorder.get();
        if (recorder != null) {
            recorder.tickEnd();
        }
    }

    /** The recorder runs with the window in the background: never pause for it. */
    @Inject(method = "pauseGame", at = @At("HEAD"), cancellable = true)
    private void recorder$noPause(boolean pauseOnly, CallbackInfo ci) {
        Recorder recorder = Recorder.get();
        if (recorder != null && recorder.active()) {
            ci.cancel();
        }
    }
}
