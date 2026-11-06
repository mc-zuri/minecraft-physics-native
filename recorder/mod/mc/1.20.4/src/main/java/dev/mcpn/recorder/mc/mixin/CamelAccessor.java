package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.entity.animal.camel.Camel;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(Camel.class)
public interface CamelAccessor {
    @Accessor("dashCooldown")
    int recorder$dashCooldown();

}
