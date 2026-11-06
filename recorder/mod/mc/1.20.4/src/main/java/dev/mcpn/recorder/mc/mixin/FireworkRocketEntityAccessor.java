package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.projectile.FireworkRocketEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(FireworkRocketEntity.class)
public interface FireworkRocketEntityAccessor {
    @Accessor("life")
    int recorder$life();

    @Accessor("lifetime")
    int recorder$lifetime();

    @Accessor("attachedToEntity")
    LivingEntity recorder$attachedToEntity();
}
