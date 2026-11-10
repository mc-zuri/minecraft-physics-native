package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.level.block.Block;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

/** Block.setBoundingBox(float...), the bounds a 1.8 block keeps on its one shared object (CollisionLockMixin pins an anvil's). */
@Mixin(Block.class)
public interface BlockBoundsInvoker {
    @Invoker("setBoundingBox")
    void recorder$setBounds(float minX, float minY, float minZ, float maxX, float maxY, float maxZ);
}
