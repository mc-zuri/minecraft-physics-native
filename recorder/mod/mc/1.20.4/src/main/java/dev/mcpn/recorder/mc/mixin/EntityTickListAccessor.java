package dev.mcpn.recorder.mc.mixin;

import it.unimi.dsi.fastutil.ints.Int2ObjectMap;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.entity.EntityTickList;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/**
 * The entities in tick order. EntityTickList.forEach refuses a second iteration while the level
 * ticks (the recorder snapshots inside the player's tick), so the map is read directly.
 */
@Mixin(EntityTickList.class)
public interface EntityTickListAccessor {
    @Accessor("active")
    Int2ObjectMap<Entity> recorder$active();
}
