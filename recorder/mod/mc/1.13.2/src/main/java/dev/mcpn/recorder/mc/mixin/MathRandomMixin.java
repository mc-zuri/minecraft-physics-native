package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.SharedRandom;
import net.minecraft.world.entity.ExperienceOrb;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.item.PrimedTnt;
import net.minecraft.world.inventory.FurnaceResultSlot;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** How a new orb, item and TNT fly and how a furnace rounds its experience, which are Math.random before 1.14. */
@Mixin({ExperienceOrb.class, ItemEntity.class, PrimedTnt.class, FurnaceResultSlot.class})
public class MathRandomMixin {
    @Redirect(method = {"*", "<init>*"}, at = @At(value = "INVOKE", target = "Ljava/lang/Math;random()D"), require = 0)
    private static double recorder$seeded() {
        return SharedRandom.next();
    }
}
