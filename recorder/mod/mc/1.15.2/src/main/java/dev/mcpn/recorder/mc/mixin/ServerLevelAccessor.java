package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.level.Level;
import net.minecraft.world.level.storage.LevelData;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** The level's data was the base class's before 1.16. */
@Mixin(Level.class)
public interface ServerLevelAccessor {
    @Accessor("levelData")
    LevelData recorder$serverLevelData();
}
