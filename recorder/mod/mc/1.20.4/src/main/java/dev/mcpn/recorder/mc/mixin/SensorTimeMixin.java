package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.entity.ai.sensing.Sensor;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * A brain's sensor first looks after a delay drawn from a static random of its own, which no seed reaches until 26.3 draws it
 * from the mob: a frog would start moving on another tick on each run. Where that random is there, every sensor starts at once.
 */
@Mixin(Sensor.class)
public class SensorTimeMixin {
    @Shadow
    private long timeToTick;

    @Inject(method = "<init>(I)V", at = @At("TAIL"))
    private void recorder$start(int scanRate, CallbackInfo info) {
        if (dev.mcpn.recorder.Fields.get(this, Sensor.class, "RANDOM") != null) {
            this.timeToTick = 0;
        }
    }
}
