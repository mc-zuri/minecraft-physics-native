package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Json;
import dev.mcpn.recorder.model.Scenario;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.ai.attributes.Attribute;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.AttributeModifier;

/** Modifiers by resource name from 1.21. */
final class CompatAttr {
    private CompatAttr() {
    }

    static List<Map.Entry<String, Object>> all() {
        List<Map.Entry<String, Object>> all = new ArrayList<>();
        BuiltInRegistries.ATTRIBUTE.holders().forEach(h -> all.add(Map.entry(h.key().location().getPath(), h)));
        return all;
    }

    static Object byId(String id) {
        return BuiltInRegistries.ATTRIBUTE.getHolder(CompatNames.id(id)).orElse(null);
    }

    @SuppressWarnings("unchecked")
    static AttributeInstance instance(LivingEntity entity, Object attribute) {
        return attribute == null ? null : entity.getAttribute((Holder<Attribute>) attribute);
    }

    static void clearModifiers(AttributeInstance instance) {
        for (AttributeModifier m : List.copyOf(instance.getModifiers())) {
            instance.removeModifier(m.id());
        }
    }

    static List<String> modifiers(AttributeInstance instance) {
        List<AttributeModifier> modifiers = new ArrayList<>(instance.getModifiers());
        modifiers.sort(Comparator.comparing(m -> m.id().toString()));
        List<String> out = new ArrayList<>();
        for (AttributeModifier m : modifiers) {
            out.add(new Json.Obj().str("id", m.id().toString()).num("amount", m.amount())
                .str("operation", operation(m.operation())).text());
        }
        return out;
    }

    private static String operation(AttributeModifier.Operation operation) {
        return switch (operation) {
            case ADD_VALUE -> "add_value";
            case ADD_MULTIPLIED_BASE -> "add_multiplied_base";
            case ADD_MULTIPLIED_TOTAL -> "add_multiplied_total";
        };
    }

    static void addModifier(AttributeInstance instance, Scenario.Modifier m) {
        net.minecraft.resources.ResourceLocation id = CompatNames.id("recorder:" + m.uuid.toLowerCase(java.util.Locale.ROOT));
        instance.removeModifier(id);
        instance.addPermanentModifier(new AttributeModifier(id, m.amount, switch (m.operation) {
            case "add_value" -> AttributeModifier.Operation.ADD_VALUE;
            case "add_multiplied_base" -> AttributeModifier.Operation.ADD_MULTIPLIED_BASE;
            case "add_multiplied_total" -> AttributeModifier.Operation.ADD_MULTIPLIED_TOTAL;
            default -> throw new IllegalArgumentException("operation " + m.operation);
        }));
    }

    static String effectId(MobEffectInstance effect) {
        return effect.getEffect().unwrapKey().map(k -> k.location().getPath()).orElse("?");
    }

    static Object effectById(String id) {
        return BuiltInRegistries.MOB_EFFECT.getHolder(CompatNames.id(id)).orElse(null);
    }

    @SuppressWarnings("unchecked")
    static void removeEffect(LivingEntity entity, Object effect) {
        entity.removeEffect((Holder<MobEffect>) effect);
    }

    @SuppressWarnings("unchecked")
    static MobEffectInstance effect(Object effect, int duration, int amplifier, boolean ambient, boolean visible) {
        return new MobEffectInstance((Holder<MobEffect>) effect, duration, amplifier, ambient, visible);
    }

    /** LivingEntity's sprint modifier is on. */
    static boolean sprinting(AttributeInstance movement) {
        return movement.getModifier(CompatNames.id("minecraft:sprinting")) != null;
    }

    static AttributeInstance jumpStrength(LivingEntity entity) {
        return entity.getAttribute(net.minecraft.world.entity.ai.attributes.Attributes.JUMP_STRENGTH);
    }
}
