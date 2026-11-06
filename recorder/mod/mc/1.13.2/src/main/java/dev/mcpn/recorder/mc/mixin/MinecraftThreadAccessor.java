package dev.mcpn.recorder.mc.mixin;

import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(Minecraft.class)
public interface MinecraftThreadAccessor {
    @Accessor("gameThread")
    Thread recorder$gameThread();

    @Accessor("joinPlayerCounter")
    void recorder$setJoinPlayerCounter(int ticks);
}
