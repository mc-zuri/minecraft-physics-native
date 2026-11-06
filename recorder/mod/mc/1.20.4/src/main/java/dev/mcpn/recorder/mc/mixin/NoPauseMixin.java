package dev.mcpn.recorder.mc.mixin;

import net.minecraft.client.Minecraft;
import net.minecraft.client.server.IntegratedServer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/**
 * A pausing screen (a command block's, a book's) stops a singleplayer game only: the recorder plays a dedicated server's
 * client, which plays on. (And the integrated server reads the client's pause from its own thread, so how many of its
 * ticks a pause took would be a race.)
 */
@Mixin(Minecraft.class)
public class NoPauseMixin {
    @Redirect(method = "runTick", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/server/IntegratedServer;isPublished()Z"))
    private boolean recorder$published(IntegratedServer server) {
        return true;
    }
}
