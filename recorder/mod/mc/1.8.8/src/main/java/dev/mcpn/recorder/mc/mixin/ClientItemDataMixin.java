package dev.mcpn.recorder.mc.mixin;

import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.world.item.ItemStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/**
 * A memory connection hands a packet over as it is, and before 1.9 entity data keeps the stack itself: the client's item
 * holds the server's stack, and a pickup empties it under the client whenever the threads meet. A client has its own.
 */
@Mixin(SynchedEntityData.class)
public class ClientItemDataMixin {
    @Redirect(method = "assignValues", at = @At(value = "INVOKE", target = "Lnet/minecraft/network/syncher/SynchedEntityData$DataItem;getValue()Ljava/lang/Object;"))
    private Object recorder$own(SynchedEntityData.DataItem item) {
        Object value = item.getValue();
        return value instanceof ItemStack stack ? stack.copy() : value;
    }
}
