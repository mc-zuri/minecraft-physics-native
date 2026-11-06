package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.PacketCapture;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.PacketListener;
import net.minecraft.network.protocol.Packet;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** A bundle's packets are handled one by one inside handleBundlePacket, not through PacketUtils. */
@Mixin(ClientPacketListener.class)
public class ClientPacketListenerMixin {
    @Redirect(method = "handleBundlePacket", at = @At(value = "INVOKE", target = "Lnet/minecraft/network/protocol/Packet;handle(Lnet/minecraft/network/PacketListener;)V"))
    @SuppressWarnings({"unchecked", "rawtypes"})
    private void recorder$handleBundled(Packet packet, PacketListener listener) {
        PacketCapture.handle(listener, packet, () -> packet.handle(listener));
    }
}
