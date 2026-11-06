package dev.mcpn.recorder.mc;

import net.minecraft.core.component.DataComponents;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.component.UseEffects;

/** How the item in use slows the player: its use effects (LocalPlayer.itemUseSpeedMultiplier). */
final class CompatUse {
    static final boolean SPEED = true;

    private CompatUse() {
    }

    static float speed(Player player) {
        return player.getUseItem().getOrDefault(DataComponents.USE_EFFECTS, UseEffects.DEFAULT).speedMultiplier();
    }
}
