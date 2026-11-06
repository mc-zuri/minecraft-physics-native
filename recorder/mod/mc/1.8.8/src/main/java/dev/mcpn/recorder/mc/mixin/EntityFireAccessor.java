package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(Entity.class)
public interface EntityFireAccessor {
    @Accessor("remainingFireTicks")
    int recorder$remainingFireTicks();

    @Accessor("inWeb")
    boolean recorder$inCobweb();
}
