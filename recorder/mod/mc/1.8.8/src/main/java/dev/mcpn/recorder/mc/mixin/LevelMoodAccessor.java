package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.level.Level;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(Level.class)
public interface LevelMoodAccessor {
    @Accessor("field_4534")
    void recorder$setMoodCountdown(int ticks);
}
