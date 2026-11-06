package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.entity.LivingEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/**
 * The way a hit pushes what stands exactly where the hit came from, which vanilla draws by Math.random, no seed reaching
 * it: in hurt, in knockback from 1.21. It draws from the hurt entity's own random, which a case seeds. (Later releases do.)
 */
@Mixin(LivingEntity.class)
public class KnockbackRandomMixin {
    @Redirect(method = {"hurt", "knockback"}, at = @At(value = "INVOKE", target = "Ljava/lang/Math;random()D"), require = 0)
    private double recorder$seeded() {
        return ((LivingEntity) (Object) this).getRandom().nextDouble();
    }
}
