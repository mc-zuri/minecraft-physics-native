package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.PacketCapture;
import net.minecraft.network.PacketListener;
import net.minecraft.network.protocol.Packet;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/**
 * Every packet handled on a game thread: from 1.21.9 in the entry of the PacketProcessor queue, its
 * only Packet.handle call. The client's are recorded with the player's state after each.
 */
@Mixin(targets = "net.minecraft.network.PacketProcessor$ListenerAndPacket")
public class PacketHandleMixin {
    @Redirect(method = "handle", at = @At(value = "INVOKE", target = "Lnet/minecraft/network/protocol/Packet;handle(Lnet/minecraft/network/PacketListener;)V"))
    @SuppressWarnings({"unchecked", "rawtypes"})
    private void recorder$handle(Packet packet, PacketListener listener) {
        PacketCapture.handle(listener, packet, () -> packet.handle(listener));
    }
}
