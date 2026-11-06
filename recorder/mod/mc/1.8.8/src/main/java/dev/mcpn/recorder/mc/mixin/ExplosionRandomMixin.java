package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.ServerOpsImpl;
import java.util.Random;
import net.minecraft.world.level.Explosion;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * 1.8's explosion draws the blocks it breaks from an unseeded random of its own (from 1.9 the level's, which a case
 * seeds), so two runs of a case differ in their craters. It is seeded by the case here, as a server entity is.
 */
@Mixin(Explosion.class)
public class ExplosionRandomMixin {
    @Shadow
    @Final
    private Random random;

    @Inject(method = "<init>*", at = @At("TAIL"))
    private void recorder$seed(CallbackInfo ci) {
        Long seed = ServerOpsImpl.nextEntitySeed();
        if (seed != null) {
            this.random.setSeed(seed);
        }
    }
}
