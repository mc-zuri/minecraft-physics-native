package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.Phases120;
import dev.mcpn.recorder.schema.Phases;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Around Player.travel: the travel vector is recorded at beforeTravel, the moves inside it are the player's own. */
@Mixin(Player.class)
public class PhasePlayerMixin {
    @Inject(method = "travel", at = @At("HEAD"))
    private void recorder$beforeTravel(Vec3 travelVector, CallbackInfo ci) {
        Phases120.travel(this, true, Phases.BEFORE_TRAVEL);
    }

    @Inject(method = "travel", at = @At("TAIL"))
    private void recorder$afterTravel(Vec3 travelVector, CallbackInfo ci) {
        Phases120.travel(this, false, Phases.AFTER_TRAVEL);
    }
}
