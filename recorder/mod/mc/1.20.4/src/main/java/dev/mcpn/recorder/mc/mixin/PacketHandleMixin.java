package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.PacketCapture;
import net.minecraft.network.PacketListener;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketUtils;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/**
 * Every packet handled on a game thread: in 1.20.4 the handling runs in the lambda
 * PacketUtils.ensureRunningOnSameThread schedules, its only Packet.handle call. The client's are
 * recorded with the player's state after each.
 */
@Mixin(PacketUtils.class)
public class PacketHandleMixin {
    @Redirect(method = "*", at = @At(value = "INVOKE", target = "Lnet/minecraft/network/protocol/Packet;handle(Lnet/minecraft/network/PacketListener;)V"))
    @SuppressWarnings({"unchecked", "rawtypes"})
    private static void recorder$handle(Packet packet, PacketListener listener) {
        PacketCapture.handle(listener, packet, () -> packet.handle(listener));
    }
}
