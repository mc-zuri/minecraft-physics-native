package net.minecraft.core.registries;

import net.minecraft.core.Registry;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.material.Fluid;

/** The name 1.19.3 gave the built-in registries, on the older Registry constants: the adapter's sources stay as they are. */
public final class BuiltInRegistries {
    public static final Registry<Block> BLOCK = Registry.BLOCK;
    public static final Registry<Fluid> FLUID = Registry.FLUID;
    public static final Registry<Item> ITEM = Registry.ITEM;
    public static final Registry<EntityType<?>> ENTITY_TYPE = Registry.ENTITY_TYPE;
    public static final Registry<MobEffect> MOB_EFFECT = Registry.MOB_EFFECT;
    public static final Registry<Enchantment> ENCHANTMENT = Registry.ENCHANTMENT;

    private BuiltInRegistries() {
    }
}
