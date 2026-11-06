package dev.mcpn.recorder.mc.mixin;

import net.minecraft.client.gui.screens.inventory.SignEditScreen;
import net.minecraft.world.level.block.entity.SignBlockEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Feature cases: the sign the editor writes into (before 1.16 it has no lines of its own; removed sends the sign's). */
@Mixin(SignEditScreen.class)
public interface AbstractSignEditScreenAccessor {
    @Accessor("sign")
    SignBlockEntity recorder$sign();
}
