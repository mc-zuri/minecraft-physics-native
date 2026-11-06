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
        return ridden.isControlledByLocalInstance()
            && !(ridden instanceof net.minecraft.world.entity.animal.Pig pig && !pig.canBeControlledByRider());
    }

    static boolean noGravity(net.minecraft.world.entity.Entity e) {
        return e.isNoGravity();
    }

    static void setNoGravity(net.minecraft.world.entity.Entity e, boolean off) {
        e.setNoGravity(off);
    }

    static int autoJumpTime(net.minecraft.client.player.LocalPlayer p) {
        return ((dev.mcpn.recorder.mc.mixin.LocalPlayerAccessor) p).recorder$autoJumpTime();
    }

    static boolean autoJumpEnabled(net.minecraft.client.player.LocalPlayer p) {
        return ((dev.mcpn.recorder.mc.mixin.LocalPlayerAccessor) p).recorder$autoJumpEnabled();
    }

    /** Each slot's name and what is in it. */
    static void eachEquipped(LivingEntity living, java.util.function.BiConsumer<String, net.minecraft.world.item.ItemStack> visit) {
        for (net.minecraft.world.entity.EquipmentSlot slot : net.minecraft.world.entity.EquipmentSlot.values()) {
            visit.accept(slot.getName(), living.getItemBySlot(slot));
        }
    }

    static void equip(LivingEntity living, String slot, net.minecraft.world.item.ItemStack stack) {
        living.setItemSlot(net.minecraft.world.entity.EquipmentSlot.byName(slot), stack);
    }

    static net.minecraft.world.entity.Entity vehicle(net.minecraft.world.entity.Entity e) {
        return e.getVehicle();
    }

    static java.util.List<net.minecraft.world.entity.Entity> passengers(net.minecraft.world.entity.Entity e) {
        return e.getPassengers();
    }

    static void stopRiding(net.minecraft.world.entity.Entity e) {
        e.stopRiding();
    }

    static void eject(net.minecraft.world.entity.Entity e) {
        e.ejectPassengers();
    }

    static boolean fallFlying(LivingEntity living) {
        return living.isFallFlying();
    }

    static int fallFlyTicks(LivingEntity living) {
        return living.getFallFlyingTicks();
    }

    static int useRemaining(LivingEntity living) {
        return living.getUseItemRemainingTicks();
    }

    static boolean lastOnGround(net.minecraft.client.player.LocalPlayer p) {
        return ((dev.mcpn.recorder.mc.mixin.LocalPlayerAccessor) p).recorder$lastOnGround();
    }

    /** Whether the server waits for the client to confirm a teleport. */
    static boolean awaitingTeleport(net.minecraft.server.level.ServerPlayer p) {
        return ((dev.mcpn.recorder.mc.mixin.ServerGamePacketListenerImplAccessor) p.connection).recorder$awaitingPositionFromClient() != null;
    }

    /** The teleport counter the client confirms by: it would carry across cases. */
    static void alignTeleport(net.minecraft.server.level.ServerPlayer p) {
        ((dev.mcpn.recorder.mc.mixin.ServerGamePacketListenerImplAccessor) p.connection).recorder$setAwaitingTeleport(0);
    }

    static float yya(LivingEntity living) {
        return 0.0F;
    }

    static Double flyingSpeed(LivingEntity living) {
        return null;
    }
}
