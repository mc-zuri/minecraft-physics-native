package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.Phases120;
import dev.mcpn.recorder.schema.Phases;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.MoverType;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Phase points in LivingEntity's tick, for the local player only (Phases120.at checks). */
@Mixin(LivingEntity.class)
public class PhaseLivingEntityMixin {
    @Inject(method = "baseTick", at = @At("TAIL"))
    private void recorder$afterBaseTick(CallbackInfo ci) {
        Phases120.at(this, Phases.AFTER_BASE_TICK);
    }

    @Inject(method = "aiStep", at = @At("HEAD"))
    private void recorder$beforeLivingAiStep(CallbackInfo ci) {
        Phases120.at(this, Phases.BEFORE_LIVING_AI_STEP);
    }
}
