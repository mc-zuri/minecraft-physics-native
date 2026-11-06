package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.Phases120;
import dev.mcpn.recorder.schema.Phases;
import net.minecraft.client.player.LocalPlayer;
import org.objectweb.asm.Opcodes;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** The local player's own phase points (recorder/schema/phases.ts). */
@Mixin(LocalPlayer.class)
public class PhaseLocalPlayerMixin {
    @Inject(method = "tick", at = @At("HEAD"))
    private void recorder$tickStart(CallbackInfo ci) {
        Phases120.at(this, Phases.TICK_START);
    }

    /** After AbstractClientPlayer.tick (the whole entity tick and the pose update), before the packets are sent. */
    @Inject(method = "tick", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/player/AbstractClientPlayer;tick()V", shift = At.Shift.AFTER))
    private void recorder$beforeSend(CallbackInfo ci) {
        Phases120.at(this, Phases.BEFORE_SEND);
    }

    @Inject(method = "tick", at = @At("TAIL"))
    private void recorder$tickEnd(CallbackInfo ci) {
        Phases120.at(this, Phases.TICK_END);
    }

    /** After Input.tick and the item-use slowdown: the first thing after them is the box pushing out of blocks takes. */
    @Inject(method = "aiStep", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/player/LocalPlayer;getBoundingBox()Lnet/minecraft/world/phys/AABB;", ordinal = 0))
    private void recorder$afterInput(CallbackInfo ci) {
        Phases120.at(this, Phases.AFTER_INPUT);
    }

    @org.spongepowered.asm.mixin.Shadow
    private float jumpRidingScale;

    /** The riding jump the rider releases (in percent): the mount jumps with it at its next tick. */
    @Inject(method = "sendRidingJump", at = @At("HEAD"))
    private void recorder$ridingJump(CallbackInfo ci) {
        dev.mcpn.recorder.Recorder recorder = dev.mcpn.recorder.Recorder.get();
        if (recorder != null) {
            recorder.ridingJump((int) (jumpRidingScale * 100.0F));
        }
    }

    @Inject(method = "aiStep", at = @At("TAIL"))
    private void recorder$afterAiStep(CallbackInfo ci) {
        Phases120.at(this, Phases.AFTER_AI_STEP);
    }
}
