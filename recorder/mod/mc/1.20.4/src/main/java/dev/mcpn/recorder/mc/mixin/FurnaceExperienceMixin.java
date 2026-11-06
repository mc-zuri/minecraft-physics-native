package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.level.block.entity.AbstractFurnaceBlockEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/**
 * The roll that rounds a furnace's experience up or down, which no seed reaches: always up, one of the results vanilla
 * can give. (Later releases roll on the level's seeded random.)
 */
@Mixin(AbstractFurnaceBlockEntity.class)
public class FurnaceExperienceMixin {
    @Redirect(method = "*", at = @At(value = "INVOKE", target = "Ljava/lang/Math;random()D"), require = 0)
    private static double recorder$roll() {
        return 0.0;
    }
}
