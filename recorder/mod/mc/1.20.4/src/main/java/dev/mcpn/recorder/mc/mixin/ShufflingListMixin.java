package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.ServerOpsImpl;
import net.minecraft.util.RandomSource;
import net.minecraft.world.entity.ai.behavior.ShufflingList;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/**
 * A mob's brain picks among its behaviours through ShufflingList, which shuffles with a random of its own made by
 * RandomSource.create(): no seed reaches it, so a mob with AI (a camel after its rider gets off) would do something
 * else on each run. During a case it is seeded like the entities' randoms, by the case and the order it is made in.
 */
@Mixin(ShufflingList.class)
public class ShufflingListMixin {
    @Redirect(method = "<init>*", at = @At(value = "INVOKE", target = "Lnet/minecraft/util/RandomSource;create()Lnet/minecraft/util/RandomSource;"))
    private RandomSource recorder$seeded() {
        Long seed = ServerOpsImpl.nextEntitySeed();
        return seed == null ? RandomSource.create() : RandomSource.create(seed);
    }
}
