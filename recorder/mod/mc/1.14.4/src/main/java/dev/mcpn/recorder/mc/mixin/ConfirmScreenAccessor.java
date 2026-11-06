package dev.mcpn.recorder.mc.mixin;

import it.unimi.dsi.fastutil.booleans.BooleanConsumer;
import net.minecraft.client.gui.screens.ConfirmScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Feature cases: answers a confirmation (the server resource pack prompt) as its Yes/No buttons do. */
@Mixin(ConfirmScreen.class)
public interface ConfirmScreenAccessor {
    @Accessor("callback")
    BooleanConsumer recorder$callback();
}
