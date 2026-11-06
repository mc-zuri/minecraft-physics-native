package dev.mcpn.recorder.mc.mixin;

import net.minecraft.server.network.ServerGamePacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(ServerGamePacketListenerImpl.class)
public interface ServerGamePacketListenerImplAccessor {
    /** The client has confirmed the last teleport: there is no id before 1.9. */
    @Accessor("field_8944")
    boolean recorder$moved();
}
