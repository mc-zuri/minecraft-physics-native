package dev.mcpn.recorder.mc.mixin;

import net.minecraft.client.gui.screens.ConfirmScreen;
import net.minecraft.client.gui.widget.IdentifiableBooleanConsumer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(ConfirmScreen.class)
public interface ConfirmAccessor {
    @Accessor("callback")
    IdentifiableBooleanConsumer recorder$callback();

    @Accessor("identifier")
    int recorder$identifier();
}
