package dev.mcpn.recorder.mc.mixin;

import net.minecraft.entity.EntityTracker;
import net.minecraft.server.level.ServerEntity;
import net.minecraft.util.collection.IntObjectStorage;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(EntityTracker.class)
public interface EntityTrackerAccessor {
    @Accessor("trackedEntityIds")
    IntObjectStorage<ServerEntity> recorder$tracked();
}
