package net.minecraft.core.registries;

import net.minecraft.core.DefaultedRegistry;
import net.minecraft.core.MappedRegistry;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.level.block.Block;

/** The name 1.19.3 gave the built-in registries, on the registries each class keeps before 1.13. */
public final class BuiltInRegistries {
    public static final DefaultedRegistry<ResourceLocation, Block> BLOCK = Block.REGISTRY;
    public static final MappedRegistry<ResourceLocation, Item> ITEM = Item.REGISTRY;
    public static final MappedRegistry<ResourceLocation, MobEffect> MOB_EFFECT = MobEffect.REGISTRY;
    public static final MappedRegistry<ResourceLocation, Enchantment> ENCHANTMENT = Enchantment.REGISTRY;

    private BuiltInRegistries() {
    }
}
