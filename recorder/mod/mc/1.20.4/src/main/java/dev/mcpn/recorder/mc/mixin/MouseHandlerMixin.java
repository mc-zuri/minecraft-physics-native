package dev.mcpn.recorder.mc.mixin;

import net.minecraft.client.MouseHandler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * The scenario sets the player's rotation each tick; the mouse turns it on frames. Even unmoved, turnPlayer calls
 * Entity.turn(0, 0), and a ridden boat then clamps the rider's yaw (Boat.onPassengerTurned) on whichever frames run
 * while the hidden window counts as active: a wall-clock effect between ticks. The mouse does not turn the player.
 */
@Mixin(MouseHandler.class)
public class MouseHandlerMixin {
    @Inject(method = "turnPlayer", at = @At("HEAD"), cancellable = true)
    private void recorder$noMouseTurn(CallbackInfo ci) {
        ci.cancel();
    }

    /** A held attack key digs only while the mouse is grabbed, which follows the window's focus, here nobody's to give. */
    @Inject(method = "isMouseGrabbed", at = @At("HEAD"), cancellable = true)
    private void recorder$atTheWindow(org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable<Boolean> cir) {
        dev.mcpn.recorder.Recorder recorder = dev.mcpn.recorder.Recorder.get();
        if (recorder != null && recorder.active()) {
            cir.setReturnValue(true);
        }
    }
}
