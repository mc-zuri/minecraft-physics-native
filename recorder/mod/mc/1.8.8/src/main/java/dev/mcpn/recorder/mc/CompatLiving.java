package dev.mcpn.recorder.mc;

import net.minecraft.world.entity.LivingEntity;

/** No vertical input and no flying speed attribute before 1.12. */
final class CompatLiving {
    private CompatLiving() {
    }

    /** No empty stack before 1.11: there is no stack. */
    static boolean present(net.minecraft.world.item.ItemStack stack) {
        return stack != null;
    }

    static int count(net.minecraft.world.item.ItemStack stack) {
        return stack.count;
    }

    static void giveChest(net.minecraft.world.entity.Entity e) {
        if (e instanceof net.minecraft.world.entity.animal.horse.AbstractHorse horse) {
            horse.setHasChest(true);
            // as AbstractChestedHorse.addChest: the container grows with the flag, or the menu's chest slots have no storage
            ((dev.mcpn.recorder.mc.mixin.AbstractHorseAccessor) horse).recorder$createInventory();
        }
    }

    /** (a rocket boosts nothing before 1.11) */
    static LivingEntity attachedTo(net.minecraft.world.entity.projectile.FireworkRocketEntity rocket) {
        return null;
    }

    /**
     * Whether the client simulates this ridden entity. Before 1.11 a pig is its rider's by being ridden: only its travel
     * asks for the carrot on a stick, and a pig that goes without one takes the server's positions.
     */
    static boolean localControl(net.minecraft.world.entity.Entity ridden) {
        // (a mob moves on the server alone before 1.9: the client only turns a saddled horse to its rider, and a pig's
        // steering is an AI goal, which the server runs)
        if (ridden instanceof net.minecraft.world.entity.animal.horse.AbstractHorse horse) {
            return horse.isSaddled();
        }
        return ridden instanceof net.minecraft.world.entity.vehicle.Boat;
    }

    /** (no such flag before 1.10) */
    static boolean noGravity(net.minecraft.world.entity.Entity e) {
        return false;
    }

    static void setNoGravity(net.minecraft.world.entity.Entity e, boolean off) {
    }

    /** (no auto-jump before 1.10) */
    static int autoJumpTime(net.minecraft.client.player.LocalPlayer p) {
        return 0;
    }

    static boolean autoJumpEnabled(net.minecraft.client.player.LocalPlayer p) {
        return false;
    }

    private static final String[] SLOTS = {"mainhand", "feet", "legs", "chest", "head"};

    /** Slots are numbers before 1.9, and there is no off hand. */
    static void eachEquipped(LivingEntity living, java.util.function.BiConsumer<String, net.minecraft.world.item.ItemStack> visit) {
        for (int i = 0; i < SLOTS.length; i++) {
            visit.accept(SLOTS[i], living.getItemBySlot(i));
        }
    }

    static void equip(LivingEntity living, String slot, net.minecraft.world.item.ItemStack stack) {
        int index = java.util.Arrays.asList(SLOTS).indexOf(slot);
        if (index < 0 && living instanceof net.minecraft.world.entity.player.Player player) {
            // (no off hand before 1.9: what a case holds there, arrows for a bow, is in reach in the inventory)
            player.inventory.setItem(9, stack);
        } else if (living instanceof net.minecraft.world.entity.player.Player player) {
            // (a player's own setter takes the armor's index, from the boots: the held item is the inventory's)
            if (index == 0) {
                player.inventory.setItem(player.inventory.selected, stack);
            } else {
                player.setItemSlot(index - 1, stack);
            }
        } else {
            living.setItemSlot(index, stack);
        }
    }

    static net.minecraft.world.entity.Entity vehicle(net.minecraft.world.entity.Entity e) {
        return e.vehicle;
    }

    /** One rider at most before 1.9. */
    static java.util.List<net.minecraft.world.entity.Entity> passengers(net.minecraft.world.entity.Entity e) {
        return e.rider == null ? java.util.List.of() : java.util.List.of(e.rider);
    }

    static void stopRiding(net.minecraft.world.entity.Entity e) {
        e.startRiding(null);
    }

    static void eject(net.minecraft.world.entity.Entity e) {
        if (e.rider != null) {
            e.rider.startRiding(null);
        }
    }

    /** (no elytra before 1.9) */
    static boolean fallFlying(LivingEntity living) {
        return false;
    }

    static int fallFlyTicks(LivingEntity living) {
        return 0;
    }

    static int useRemaining(LivingEntity living) {
        return living instanceof net.minecraft.world.entity.player.Player player ? player.getRemainingUseTime() : 0;
    }

    /** (the client sends where it is every tick before 1.9, on the ground or not) */
    static boolean lastOnGround(net.minecraft.client.player.LocalPlayer p) {
        return p.onGround;
    }

    static boolean awaitingTeleport(net.minecraft.server.level.ServerPlayer p) {
        return !((dev.mcpn.recorder.mc.mixin.ServerGamePacketListenerImplAccessor) p.connection).recorder$moved();
    }

    /** (a teleport has no id before 1.9) */
    static void alignTeleport(net.minecraft.server.level.ServerPlayer p) {
    }

    static float yya(LivingEntity living) {
        return 0.0F;
    }

    static Double flyingSpeed(LivingEntity living) {
        return null;
    }
}
