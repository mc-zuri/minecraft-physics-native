package dev.mcpn.recorder.mc.mixin;

import net.minecraft.server.MinecraftServer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** The server's tick counter: the time packet goes out every 20 ticks of it. ALIGN fixes its phase. */
@Mixin(MinecraftServer.class)
public interface MinecraftServerAccessor {
    @Accessor("tickCount")
    void recorder$setTickCount(int tickCount);
}
