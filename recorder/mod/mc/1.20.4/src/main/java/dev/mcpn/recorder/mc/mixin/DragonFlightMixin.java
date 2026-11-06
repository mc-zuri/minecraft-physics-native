package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.DragonSnap;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.boss.enderdragon.EnderDragon;
import org.objectweb.asm.Opcodes;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Around the flight in EnderDragon.aiStep, on the server: what the phase asked for, what the flight left, and what a wing
 * pushed. From 1.9 the flight starts where it asks its phase for the target; 1.8 has no phases, and the start of aiStep has
 * the target its AI is about to change.
 */
@Mixin(EnderDragon.class)
public class DragonFlightMixin {
    private static final String PHASE = "Lnet/minecraft/world/entity/boss/enderdragon/phases/DragonPhaseInstance;getFlyTargetLocation()Lnet/minecraft/world/phys/Vec3;";

    private Entity recorder$self() {
        return (Entity) (Object) this;
    }

    @Inject(method = "aiStep", at = @At("HEAD"))
    private void recorder$head(CallbackInfo info) {
        if (DragonSnap.server(recorder$self())) {
            DragonSnap.beforeLegacyAi(recorder$self());
        }
    }

    @Inject(method = "aiStep", require = 0, at = @At(value = "INVOKE", target = PHASE))
    private void recorder$beforeFlight(CallbackInfo info) {
        if (DragonSnap.server(recorder$self())) {
            DragonSnap.beforeFlight(recorder$self());
        }
    }

    @Inject(method = "aiStep", at = @At(value = "FIELD", opcode = Opcodes.PUTFIELD,
        target = "Lnet/minecraft/world/entity/boss/enderdragon/EnderDragon;yBodyRot:F"))
    private void recorder$afterFlight(CallbackInfo info) {
        if (DragonSnap.server(recorder$self())) {
            DragonSnap.afterFlight(recorder$self());
        }
    }

    @Redirect(method = "knockBack", at = @At(value = "INVOKE", target = "Lnet/minecraft/world/entity/Entity;push(DDD)V"))
    private void recorder$push(Entity pushed, double x, double y, double z) {
        DragonSnap.push(recorder$self(), pushed, x, y, z);
        pushed.push(x, y, z);
    }
}
