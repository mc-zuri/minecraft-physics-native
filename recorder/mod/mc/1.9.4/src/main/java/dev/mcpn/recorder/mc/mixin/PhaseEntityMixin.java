package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.Phases120;
import dev.mcpn.recorder.schema.Phases;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Entity.move's head, for the local player's own move inside travel: the requested movement. */
@Mixin(Entity.class)
public class PhaseEntityMixin {
    @Inject(method = "move", at = @At("HEAD"))
    private void recorder$beforeMove(double x, double y, double z, CallbackInfo ci) {
        // (no mover type before 1.11: only the player's own move is inside travel)
        Phases120.inTravel(this, Phases.BEFORE_MOVE);
        Phases120.vehicleMove(this, true);
    }

    /** (the client's player has no move of its own before 1.10, which came with auto-jump) */
    @Inject(method = "move", at = @At("TAIL"))
    private void recorder$afterMove(double x, double y, double z, CallbackInfo ci) {
        Phases120.inTravel(this, Phases.AFTER_MOVE);
        Phases120.vehicleMove(this, false);
    }
}
