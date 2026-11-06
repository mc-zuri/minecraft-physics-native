package dev.mcpn.recorder.mc.mixin;

import net.minecraft.server.level.ServerChunkCache;
import org.spongepowered.asm.mixin.Mixin;

/** Nothing to do here: from 1.20.3 tickChunks shuffles with the level's own random (see the 1.20.2 adapter). */
@Mixin(ServerChunkCache.class)
public class ServerChunkCacheMixin {
}
