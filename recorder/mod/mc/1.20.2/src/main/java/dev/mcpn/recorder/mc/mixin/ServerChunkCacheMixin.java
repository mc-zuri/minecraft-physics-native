package dev.mcpn.recorder.mc.mixin;

import java.util.Collections;
import java.util.List;
import java.util.Random;
import net.minecraft.server.level.ServerChunkCache;
import net.minecraft.server.level.ServerLevel;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/**
 * Before 1.20.3 tickChunks shuffles its chunks with an unseeded random, and each chunk's random ticks draw from the
 * level's random in that order: which block a tick melts or grows would change from run to run. Seeded by the game time.
 */
@Mixin(ServerChunkCache.class)
public class ServerChunkCacheMixin {
    @Shadow
    @Final
    ServerLevel level;

    @Redirect(method = "tickChunks", at = @At(value = "INVOKE", target = "Ljava/util/Collections;shuffle(Ljava/util/List;)V"))
    private void recorder$seededShuffle(List<?> chunks) {
        Collections.shuffle(chunks, new Random(level.getGameTime()));
    }
}
