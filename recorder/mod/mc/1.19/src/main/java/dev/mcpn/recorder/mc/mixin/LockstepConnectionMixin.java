package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.Lockstep;
import dev.mcpn.recorder.mc.PacketCapture;
import java.util.concurrent.atomic.AtomicLong;
import net.minecraft.network.Connection;
import io.netty.util.concurrent.GenericFutureListener;
import net.minecraft.network.protocol.Packet;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Packets a connection sent (handed to its channel) and received (queued for the game thread).
 * Lockstep compares one end's sent with the other end's received; the client's sends are also
 * recorded, with the phase that sent them.
 */
@Mixin(Connection.class)
public class LockstepConnectionMixin implements Lockstep.Counted {
    @Unique
    private final AtomicLong recorder$sentCount = new AtomicLong();
    @Unique
    private final AtomicLong recorder$receivedCount = new AtomicLong();

    @Inject(method = "send(Lnet/minecraft/network/protocol/Packet;Lio/netty/util/concurrent/GenericFutureListener;)V", at = @At("HEAD"))
    private void recorder$recordSend(Packet<?> packet, GenericFutureListener<?> listener, CallbackInfo ci) {
        PacketCapture.sent((Connection) (Object) this, packet);
    }

    @Inject(method = "sendPacket", at = @At("HEAD"))
    private void recorder$countSent(CallbackInfo ci) {
        recorder$sentCount.incrementAndGet();
    }

    @Inject(method = "channelRead0(Lio/netty/channel/ChannelHandlerContext;Lnet/minecraft/network/protocol/Packet;)V", at = @At("RETURN"))
    private void recorder$countReceived(CallbackInfo ci) {
        recorder$receivedCount.incrementAndGet();
        Lockstep.packetArrived(this);
    }

    @Override
    public long recorder$sent() {
        return recorder$sentCount.get();
    }

    @Override
    public long recorder$received() {
        return recorder$receivedCount.get();
    }

    @Override
    public boolean recorder$open() {
        return ((Connection) (Object) this).isConnected();
    }
}
