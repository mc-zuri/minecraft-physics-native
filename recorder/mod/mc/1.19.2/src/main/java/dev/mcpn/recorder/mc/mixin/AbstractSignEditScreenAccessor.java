package dev.mcpn.recorder.mc.mixin;

import net.minecraft.client.gui.screens.inventory.SignEditScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Feature cases: the lines the sign editor sends when it closes. */
@Mixin(SignEditScreen.class)
public interface AbstractSignEditScreenAccessor {
    @Accessor("messages")
    String[] recorder$messages();
}
