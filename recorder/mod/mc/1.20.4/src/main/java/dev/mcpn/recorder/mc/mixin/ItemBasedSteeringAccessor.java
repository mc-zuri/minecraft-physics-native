package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.entity.ItemBasedSteering;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(ItemBasedSteering.class)
public interface ItemBasedSteeringAccessor {
    @Accessor("boosting")
    boolean recorder$boosting();

    @Accessor("boostTime")
    int recorder$boostTime();

    @Invoker("boostTimeTotal")
    int recorder$boostTimeTotal();
}
