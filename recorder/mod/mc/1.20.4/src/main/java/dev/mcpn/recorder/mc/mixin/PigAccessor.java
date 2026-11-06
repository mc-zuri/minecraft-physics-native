package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.entity.ItemBasedSteering;
import net.minecraft.world.entity.animal.Pig;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(Pig.class)
public interface PigAccessor {
    @Accessor("steering")
    ItemBasedSteering recorder$steering();

}
