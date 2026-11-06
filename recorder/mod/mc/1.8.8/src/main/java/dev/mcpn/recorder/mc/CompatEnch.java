package dev.mcpn.recorder.mc;

import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.EnchantmentHelper;

/** Enchantments. */
final class CompatEnch {
    private CompatEnch() {
    }

    static int depthStrider(LivingEntity entity) {
        return EnchantmentHelper.getDepthStrider(entity);
    }

    static int soulSpeed(LivingEntity entity) {
        // (from 1.16)
        return 0;
    }

    static int frostWalker(LivingEntity entity) {
        // (from 1.9)
        return 0;
    }

    static int fireProtection(LivingEntity entity) {
        return EnchantmentHelper.getEnchantmentLevel(net.minecraft.world.item.enchantment.Enchantment.FIRE_PROTECTION.id, entity.getArmorStacks());
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
