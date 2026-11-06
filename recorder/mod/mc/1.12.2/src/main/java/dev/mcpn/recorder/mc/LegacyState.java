package dev.mcpn.recorder.mc;

import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;

/** A block state before the flattening, as its numbers: minecraft-data has no properties to name it by. */
public final class LegacyState {
    /** The chunks of the areas, which stay loaded (KeepChunksMixin). */
    public static final java.util.Set<Long> FORCED = java.util.concurrent.ConcurrentHashMap.newKeySet();

    private LegacyState() {
    }

    public static String of(BlockState state) {
        int id = Block.getId(state);
        return "#" + (id & 4095) + ":" + (id >> 12 & 15);
    }
}
