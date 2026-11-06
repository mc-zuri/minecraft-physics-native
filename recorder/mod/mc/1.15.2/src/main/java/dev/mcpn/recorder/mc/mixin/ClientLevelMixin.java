package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.Recorder;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.commands.arguments.blocks.BlockStateParser;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Every block the client's level changes, so the replay's world changes where the client's did. Before 1.19 there is no
 * single server-verified path: a section update sets its blocks through Level.setBlock (setKnownState does too).
 */
@Mixin(Level.class)
public class ClientLevelMixin {
    @Inject(method = "setBlock(Lnet/minecraft/core/BlockPos;Lnet/minecraft/world/level/block/state/BlockState;I)Z", at = @At("RETURN"))
    private void recorder$blockChanged(BlockPos pos, BlockState state, int flags, CallbackInfoReturnable<Boolean> cir) {
        if (!((Object) this instanceof ClientLevel) || !cir.getReturnValue()) {
            return;
        }
        Recorder recorder = Recorder.get();
        if (recorder != null && recorder.active()) {
            recorder.blockChanged(pos.getX(), pos.getY(), pos.getZ(), BlockStateParser.serialize(state).replace("minecraft:", ""));
        }
    }
}
