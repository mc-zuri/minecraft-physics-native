package dev.mcpn.recorder.mc.mixin;

import net.minecraft.server.level.ServerChunkCache;
import net.minecraft.world.level.ChunkPos;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** What /forceload does from 1.13: a chunk of an area never leaves, to be generated or read again mid-run. */
@Mixin(ServerChunkCache.class)
public class KeepChunksMixin {

    @Inject(method = "scheduleUnload", at = @At("HEAD"), cancellable = true)
    private void recorder$keep(int x, int z, CallbackInfo ci) {
        if (dev.mcpn.recorder.mc.LegacyState.FORCED.contains(ChunkPos.asLong(x, z))) {
            ci.cancel();
        }
    }
}
