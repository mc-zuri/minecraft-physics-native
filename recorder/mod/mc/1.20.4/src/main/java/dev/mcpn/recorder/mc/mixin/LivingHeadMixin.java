package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.entity.LivingEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/**
 * The way LivingEntity's constructor turns a new entity, which no seed reaches and only summon() puts right: what an item
 * or a spawn egg makes keeps it in its head, and that is in the packet that adds it. (Later releases do not draw it.)
 */
@Mixin(LivingEntity.class)
public class LivingHeadMixin {
    @Redirect(method = "<init>", at = @At(value = "INVOKE", target = "Ljava/lang/Math;random()D"), require = 0)
    private double recorder$turn() {
        return 0.0;
    }
}
