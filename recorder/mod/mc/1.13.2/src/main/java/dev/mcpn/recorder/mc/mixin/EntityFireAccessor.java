package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(Entity.class)
public interface EntityFireAccessor {
    @Accessor("remainingFireTicks")
    int recorder$remainingFireTicks();

    /** What Entity.makeStuckInBlock sets: the mapping's name is 1.14's for a field that means something else there. */
    @Accessor("inLava")
    boolean recorder$inCobweb();
}
