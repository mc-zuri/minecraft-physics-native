package dev.mcpn.recorder.mc;

import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.EnchantmentHelper;
import net.minecraft.world.item.enchantment.Enchantments;

/** Enchantments. */
final class CompatEnch {
    private CompatEnch() {
    }

    static int depthStrider(LivingEntity entity) {
        return EnchantmentHelper.getDepthStrider(entity);
    }

    static int soulSpeed(LivingEntity entity) {
        return EnchantmentHelper.getEnchantmentLevel(Enchantments.SOUL_SPEED, entity);
    }

    static int frostWalker(LivingEntity entity) {
        return EnchantmentHelper.getEnchantmentLevel(Enchantments.FROST_WALKER, entity);
    }

    static int fireProtection(LivingEntity entity) {
        return EnchantmentHelper.getEnchantmentLevel(Enchantments.FIRE_PROTECTION, entity);
    }

    /** Whether the release has it. */
    static boolean enchant(ItemStack stack, String id, int level) {
        var enchantment = net.minecraft.core.registries.BuiltInRegistries.ENCHANTMENT.get(CompatNames.id(id));
        if (enchantment == null) {
            return false;
        }
        stack.enchant(enchantment, level);
        return true;
    }
}
