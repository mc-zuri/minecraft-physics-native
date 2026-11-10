package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.CollisionLock;
import java.util.List;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/**
 * Before 1.9 a block works out its boxes by setting its own bounds, one by one, on the one object the client and the
 * integrated server share: a cauldron the two threads meet at once gave the server's move a wrong box, and it corrected
 * the player. On a dedicated server there is no second thread.
 */
@Mixin(Level.class)
public class CollisionLockMixin {
    @Redirect(method = {"doesBoxCollide", "method_3608"}, at = @At(value = "INVOKE", target = "Lnet/minecraft/world/level/block/Block;appendCollisionBoxes(Lnet/minecraft/world/level/Level;Lnet/minecraft/core/BlockPos;Lnet/minecraft/world/level/block/state/BlockState;Lnet/minecraft/world/phys/AABB;Ljava/util/List;Lnet/minecraft/world/entity/Entity;)V"))
    private void recorder$oneAtATime(Block block, Level level, BlockPos pos, BlockState state, AABB box, List<AABB> list, Entity entity) {
        synchronized (CollisionLock.LOCK) {
            // An anvil collides by the bounds its shared object holds (AnvilBlock has no collision box of its own, 1.8.9
            // Block.java:514), which the last crosshair ray or outline set for the anvil it met: what the player's move
            // meets then hangs on where the camera last looked. The recorder pins them to the cube a block starts with
            // (Block.java:290), which a client that has met no anvil holds, so that a case records the same each time.
            if (block instanceof net.minecraft.world.level.block.AnvilBlock) {
                ((BlockBoundsInvoker) block).recorder$setBounds(0.0F, 0.0F, 0.0F, 1.0F, 1.0F, 1.0F);
            }
            block.appendCollisionBoxes(level, pos, state, box, list, entity);
        }
    }
}
