package dev.mcpn.recorder.mc.mixin;

import net.minecraft.client.KeyMapping;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** A key had no setter before 1.15. */
@Mixin(KeyMapping.class)
public interface KeyMappingAccessor {
    @Accessor("isDown")
    void recorder$setDown(boolean down);
}
