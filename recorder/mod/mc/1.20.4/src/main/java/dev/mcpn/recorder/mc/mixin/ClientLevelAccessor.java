package dev.mcpn.recorder.mc.mixin;

import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.level.entity.EntityTickList;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(ClientLevel.class)
public interface ClientLevelAccessor {
    /** The entities the client ticks, in the order it ticks them. */
    @Accessor("tickingEntities")
    EntityTickList recorder$tickingEntities();
}
