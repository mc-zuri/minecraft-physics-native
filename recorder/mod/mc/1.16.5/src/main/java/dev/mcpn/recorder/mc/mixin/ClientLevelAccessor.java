package dev.mcpn.recorder.mc.mixin;

import it.unimi.dsi.fastutil.ints.Int2ObjectMap;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(ClientLevel.class)
public interface ClientLevelAccessor {
    /** The entities the client ticks, in the order it ticks them. */
    @Accessor("entitiesById")
    Int2ObjectMap<Entity> recorder$entitiesById();
}
