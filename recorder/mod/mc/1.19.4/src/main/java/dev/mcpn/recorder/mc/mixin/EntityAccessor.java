package dev.mcpn.recorder.mc.mixin;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
@Mixin(Entity.class)
public interface EntityAccessor {
    /** The distance to the next step sound and step game event (Entity.move): carried from case to case otherwise. */
    @Accessor("nextStep")
    void recorder$setNextStep(float distance);
    @Accessor("stuckSpeedMultiplier")
    Vec3 recorder$stuckSpeedMultiplier();
    @Accessor("wasEyeInWater")
    boolean recorder$wasEyeInWater();
}
