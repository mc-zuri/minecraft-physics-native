package dev.mcpn.recorder.mc.mixin;

import net.minecraft.server.level.ServerChunkCache;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.chunk.LevelChunk;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** What /forceload does from 1.13: a chunk of an area never leaves, to be generated or read again mid-run. */
@Mixin(ServerChunkCache.class)
public class KeepChunksMixin {

    @Inject(method = "unload", at = @At("HEAD"), cancellable = true)
    private void recorder$keep(LevelChunk chunk, CallbackInfo ci) {
        ChunkPos pos = chunk.getPos();
        if (dev.mcpn.recorder.mc.LegacyState.FORCED.contains(ChunkPos.asLong(pos.x, pos.z))) {
            ci.cancel();
        }
    }
}
