package dev.mcpn.recorder.mc.mixin;

import net.minecraft.server.level.ServerEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** A tracked entity's tick counter: its changes (the player's attributes too) go out every updateInterval ticks of it. */
@Mixin(ServerEntity.class)
public interface ServerEntityAccessor {
    @Accessor("tickCount")
    void recorder$setTickCount(int tickCount);
}
