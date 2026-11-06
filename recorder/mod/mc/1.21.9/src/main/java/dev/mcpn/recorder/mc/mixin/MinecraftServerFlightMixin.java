package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.CompatServer;
import net.minecraft.server.MinecraftServer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** The setting of a dedicated server, which an integrated server no longer has. */
@Mixin(MinecraftServer.class)
public class MinecraftServerFlightMixin {
    @Inject(method = "allowFlight", at = @At("HEAD"), cancellable = true)
    private void recorder$allowFlight(CallbackInfoReturnable<Boolean> cir) {
        cir.setReturnValue(CompatServer.flightAllowed);
    }
}
