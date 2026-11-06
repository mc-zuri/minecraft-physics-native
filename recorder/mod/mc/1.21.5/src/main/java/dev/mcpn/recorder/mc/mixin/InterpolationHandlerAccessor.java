package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.entity.InterpolationHandler;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(InterpolationHandler.class)
public interface InterpolationHandlerAccessor {
    @Accessor("previousTickPosition")
    Vec3 recorder$previousTickPosition();
}
