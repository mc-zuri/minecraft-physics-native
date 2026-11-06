package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Json;
import dev.mcpn.recorder.model.Scenario;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.ai.attributes.Attribute;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.AttributeModifier;

/** Attributes and effects: what a key is differs by release, so a key is an Object here. */
final class CompatAttr {
    private CompatAttr() {
    }

    /** Every attribute by name. */
    static List<Map.Entry<String, Object>> all() {
        List<Map.Entry<String, Object>> all = new ArrayList<>();
        BuiltInRegistries.ATTRIBUTE.forEach(a -> all.add(Map.entry(PlayerSnap.id(BuiltInRegistries.ATTRIBUTE.getKey(a)), a)));
        return all;
    }

    static Object byId(String id) {
        return BuiltInRegistries.ATTRIBUTE.get(CompatNames.id(id));
    }

    static AttributeInstance instance(LivingEntity entity, Object attribute) {
        return attribute == null ? null : entity.getAttribute((Attribute) attribute);
    }

    static void clearModifiers(AttributeInstance instance) {
        for (AttributeModifier m : List.copyOf(instance.getModifiers())) {
            instance.removeModifier(m.getId());
        }
    }

    /** The modifiers as JSON, sorted by id. */
    static List<String> modifiers(AttributeInstance instance) {
        List<AttributeModifier> modifiers = new ArrayList<>(instance.getModifiers());
        modifiers.sort(Comparator.comparing(m -> m.getId().toString()));
        List<String> out = new ArrayList<>();
        for (AttributeModifier m : modifiers) {
            out.add(new Json.Obj().str("id", m.getId().toString()).num("amount", m.getAmount())
                .str("operation", operation(m.getOperation())).text());
        }
        return out;
    }

    /** The operation's 1.21 name, so recordings of every release name it the same way. */
    private static String operation(AttributeModifier.Operation operation) {
        return switch (operation) {
            case ADDITION -> "add_value";
            case MULTIPLY_BASE -> "add_multiplied_base";
            case MULTIPLY_TOTAL -> "add_multiplied_total";
        };
    }

    static void addModifier(AttributeInstance instance, Scenario.Modifier m) {
        UUID id = UUID.fromString(m.uuid);
        instance.removeModifier(id);
        instance.addPermanentModifier(new AttributeModifier(id, m.key, m.amount, switch (m.operation) {
            case "add_value" -> AttributeModifier.Operation.ADDITION;
            case "add_multiplied_base" -> AttributeModifier.Operation.MULTIPLY_BASE;
            case "add_multiplied_total" -> AttributeModifier.Operation.MULTIPLY_TOTAL;
            default -> throw new IllegalArgumentException("operation " + m.operation);
        }));
    }

    static String effectId(MobEffectInstance effect) {
        return PlayerSnap.id(BuiltInRegistries.MOB_EFFECT.getKey(effect.getEffect()));
    }

    static Object effectById(String id) {
        return BuiltInRegistries.MOB_EFFECT.get(CompatNames.id(id));
    }

    static void removeEffect(LivingEntity entity, Object effect) {
        entity.removeEffect((MobEffect) effect);
    }

    static MobEffectInstance effect(Object effect, int duration, int amplifier, boolean ambient, boolean visible) {
        return new MobEffectInstance((MobEffect) effect, duration, amplifier, ambient, visible);
    }

    private static final UUID SPRINTING = UUID.fromString("662A6B8D-DA3E-4C1C-8813-96EA6097278D");

    /** LivingEntity's sprint modifier is on. */
    static boolean sprinting(AttributeInstance movement) {
        return movement.getModifier(SPRINTING) != null;
    }

    static AttributeInstance jumpStrength(LivingEntity entity) {
        return entity.getAttribute(net.minecraft.world.entity.ai.attributes.Attributes.JUMP_STRENGTH);
    }
}
