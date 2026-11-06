package dev.mcpn.recorder.mc.mixin;

import java.util.concurrent.atomic.AtomicBoolean;
import net.minecraft.server.level.ThreadedLevelLightEngine;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(ThreadedLevelLightEngine.class)
public interface ThreadedLevelLightEngineAccessor {
    /** An update is on its way to, or running on, the light thread. */
    @Accessor("scheduled")
    AtomicBoolean recorder$scheduled();
}
