package dev.mcpn.recorder.mc.mixin;

import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.item.FallingBlockEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/**
 * In 1.18 and 1.18.1 the client keeps a landed block for 50 ms of the wall clock after its removal
 * packet, frozen and under the crosshair: the ticks of a lockstep run spent on it depended on the
 * machine. It counts the game's own time instead, at the 50 ms a tick takes. No other release has
 * the call, and nothing happens there.
 */
@Mixin(FallingBlockEntity.class)
public class FallingBlockClockMixin {
    @Redirect(method = {"tick", "setRemoved"}, at = @At(value = "INVOKE", target = "Ljava/lang/System;currentTimeMillis()J"), require = 0)
    private long recorder$gameClock() {
        return Minecraft.getInstance().level.getGameTime() * 50L;
    }
}
