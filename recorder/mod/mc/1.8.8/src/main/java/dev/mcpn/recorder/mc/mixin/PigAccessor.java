package dev.mcpn.recorder.mc.mixin;

import net.minecraft.entity.ai.goal.PlayerControlGoal;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** A pig's boost is in the goal that steers it, before 1.9. */
@Mixin(PlayerControlGoal.class)
public interface PigAccessor {
    @Accessor("field_5352")
    boolean recorder$boosting();

    @Accessor("field_5353")
    int recorder$boostTime();

    @Accessor("field_5354")
    int recorder$boostTimeTotal();
}
