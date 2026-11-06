package dev.mcpn.recorder.mc.mixin;

import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(ServerGamePacketListenerImpl.class)
public interface ServerGamePacketListenerImplAccessor {
    @Accessor("awaitingPositionFromClient")
    Vec3 recorder$awaitingPositionFromClient();

    /** The teleport counter the client confirms by: it would carry across cases. */
    @Accessor("awaitingTeleport")
    void recorder$setAwaitingTeleport(int id);
}
