package dev.mcpn.recorder.mc.mixin;

import net.minecraft.server.players.PlayerList;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** The countdown to the tab list's latency update (every 600 ticks): ALIGN fixes its phase. */
@Mixin(PlayerList.class)
public interface PlayerListAccessor {
    @Accessor("sendAllPlayerInfoIn")
    void recorder$setSendAllPlayerInfoIn(int ticks);
}
