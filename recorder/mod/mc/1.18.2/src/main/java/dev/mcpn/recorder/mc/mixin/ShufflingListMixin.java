package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.ServerOpsImpl;
import java.util.Random;
import net.minecraft.world.entity.ai.behavior.ShufflingList;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** As the 1.19 adapter's, on the java.util.Random these releases use. */
@Mixin(ShufflingList.class)
public class ShufflingListMixin {
    @Redirect(method = "<init>*", at = @At(value = "NEW", target = "()Ljava/util/Random;"))
    private Random recorder$seeded() {
        Long seed = ServerOpsImpl.nextEntitySeed();
        return seed == null ? new Random() : new Random(seed);
    }
}
