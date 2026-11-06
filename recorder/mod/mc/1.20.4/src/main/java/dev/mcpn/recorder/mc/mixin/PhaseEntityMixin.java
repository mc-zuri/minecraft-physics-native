package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.Phases120;
import dev.mcpn.recorder.schema.Phases;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.MoverType;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Entity.move's head, for the local player's own move inside travel: the requested movement. */
@Mixin(Entity.class)
public class PhaseEntityMixin {
    @Inject(method = "move", at = @At("HEAD"))
    private void recorder$beforeMove(MoverType type, Vec3 movement, CallbackInfo ci) {
        if (type == MoverType.SELF) {
            Phases120.inTravel(this, Phases.BEFORE_MOVE);
            Phases120.vehicleMove(this, true);
        }
    }

    /** The ridden vehicle's own move ends (Phases120.vehicleMove). */
    @Inject(method = "move", at = @At("TAIL"))
    private void recorder$vehicleAfterMove(MoverType type, Vec3 movement, CallbackInfo ci) {
        if (type == MoverType.SELF) {
            Phases120.vehicleMove(this, false);
        }
    }
}
