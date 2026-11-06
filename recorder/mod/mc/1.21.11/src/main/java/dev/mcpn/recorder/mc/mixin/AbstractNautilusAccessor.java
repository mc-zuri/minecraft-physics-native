package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.entity.animal.nautilus.AbstractNautilus;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(AbstractNautilus.class)
public interface AbstractNautilusAccessor {
    @Accessor("dashCooldown")
    int recorder$dashCooldown();

    @Accessor("playerJumpPendingScale")
    float recorder$playerJumpPendingScale();
}
