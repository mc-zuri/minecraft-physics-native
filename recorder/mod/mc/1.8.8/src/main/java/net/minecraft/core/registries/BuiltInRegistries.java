package net.minecraft.core.registries;

import java.lang.reflect.Field;
import java.util.Map;
import net.minecraft.core.DefaultedRegistry;
import net.minecraft.core.MappedRegistry;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.level.block.Block;

/** The name 1.19.3 gave the built-in registries: effects and enchantments are only maps by name before 1.9. */
public final class BuiltInRegistries {
    public static final DefaultedRegistry<ResourceLocation, Block> BLOCK = Block.REGISTRY;
    public static final MappedRegistry<ResourceLocation, Item> ITEM = Item.REGISTRY;
    public static final ByName<MobEffect> MOB_EFFECT = new ByName<>(MobEffect.class, "STATUS_EFFECTS_BY_ID");
    public static final ByName<Enchantment> ENCHANTMENT = new ByName<>(Enchantment.class, "ENCHANTMENT_MAP");

    private BuiltInRegistries() {
    }

    public static final class ByName<T> {
        private final Map<ResourceLocation, T> map;

        @SuppressWarnings("unchecked")
        private ByName(Class<?> owner, String field) {
            try {
                Field found = owner.getDeclaredField(field);
                found.setAccessible(true);
                map = (Map<ResourceLocation, T>) found.get(null);
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            }
        }

        public T get(ResourceLocation id) {
            return map.get(id);
        }

        public ResourceLocation getKey(T value) {
            for (Map.Entry<ResourceLocation, T> entry : map.entrySet()) {
                if (entry.getValue() == value) {
                    return entry.getKey();
                }
            }
            return null;
        }
    }
}
