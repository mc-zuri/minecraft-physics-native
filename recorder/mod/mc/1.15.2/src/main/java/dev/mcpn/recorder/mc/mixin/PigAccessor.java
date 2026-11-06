package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.entity.animal.Pig;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(Pig.class)
public interface PigAccessor {
    @Accessor("boosting")
    boolean recorder$boosting();

    @Accessor("boostTime")
    int recorder$boostTime();

    @Accessor("boostTimeTotal")
    int recorder$boostTimeTotal();
}
