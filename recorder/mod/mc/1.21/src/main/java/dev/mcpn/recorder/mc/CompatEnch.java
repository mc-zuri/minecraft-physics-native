package dev.mcpn.recorder.mc;

import net.minecraft.core.Holder;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.item.enchantment.EnchantmentHelper;
import net.minecraft.world.item.enchantment.Enchantments;

/** Enchantments are a data registry from 1.21: their holders come from the level's registries. */
final class CompatEnch {
    private CompatEnch() {
    }

    private static int level(LivingEntity entity, ResourceKey<Enchantment> key) {
        var lookup = entity.registryAccess().lookupOrThrow(Registries.ENCHANTMENT);
        Holder<Enchantment> holder = lookup.getOrThrow(key);
        return EnchantmentHelper.getEnchantmentLevel(holder, entity);
    }

    static int depthStrider(LivingEntity entity) {
        return level(entity, Enchantments.DEPTH_STRIDER);
    }

    static int soulSpeed(LivingEntity entity) {
        return level(entity, Enchantments.SOUL_SPEED);
    }

    static int frostWalker(LivingEntity entity) {
        return level(entity, Enchantments.FROST_WALKER);
    }

    static int fireProtection(LivingEntity entity) {
        return level(entity, Enchantments.FIRE_PROTECTION);
    }

    /** Whether the release has it. */
    static boolean enchant(ItemStack stack, String id, int level) {
        var server = net.minecraft.client.Minecraft.getInstance().getSingleplayerServer();
        var key = ResourceKey.create(Registries.ENCHANTMENT, CompatNames.id(id));
        var holder = server.registryAccess().lookupOrThrow(Registries.ENCHANTMENT).get(key);
        if (holder.isEmpty()) {
            return false;
        }
        stack.enchant(holder.get(), level);
        return true;
    }
}
