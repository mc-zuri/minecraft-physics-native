package dev.mcpn.recorder.mc.mixin;

import net.minecraft.client.multiplayer.ChunkBatchSizeCalculator;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * The client tells the server how many chunks a tick it can take, measured on the wall clock (1.20.2+), and the
 * server paces its chunk batches by it: which tick a chunk (and the client's ChunkBatchReceived ack) lands on would
 * follow the machine's speed. A fixed rate makes it follow the ticks.
 */
@Mixin(ChunkBatchSizeCalculator.class)
public class ChunkBatchSizeCalculatorMixin {
    /** Chunks a tick: enough that an area's chunks arrive within a few ticks. */
    private static final float RECORDER_CHUNKS_PER_TICK = 64.0F;

    @Inject(method = "getDesiredChunksPerTick", at = @At("HEAD"), cancellable = true)
    private void recorder$fixedRate(CallbackInfoReturnable<Float> cir) {
        cir.setReturnValue(RECORDER_CHUNKS_PER_TICK);
    }
}
