package dev.mcpn.recorder.mc;

import net.minecraft.world.entity.player.Player;

/** How an item in use slows the player: a fixed 0.2 before 1.21.11. */
final class CompatUse {
    /** Items say how much (UseEffects, 1.21.11+). */
    static final boolean SPEED = false;

    private CompatUse() {
    }

    static float speed(Player player) {
        return 0.2F;
    }
}
