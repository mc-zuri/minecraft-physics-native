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
import net.minecraft.world.entity.monster.SharedMonsterAttributes;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.AttributeModifier;

/** SharedMonsterAttributes and effects: what a key is differs by release, so a key is an Object here. */
final class CompatAttr {
    private CompatAttr() {
    }

    /** Every attribute by name. */
    private static final List<Attribute> ALL = List.of(SharedMonsterAttributes.MAX_HEALTH, SharedMonsterAttributes.FOLLOW_RANGE,
        SharedMonsterAttributes.KNOCKBACK_RESISTANCE, SharedMonsterAttributes.MOVEMENT_SPEED,
        SharedMonsterAttributes.ATTACK_DAMAGE, SharedMonsterAttributes.ATTACK_SPEED,
        SharedMonsterAttributes.ARMOR, SharedMonsterAttributes.ARMOR_TOUGHNESS, SharedMonsterAttributes.LUCK);

    /** SharedMonsterAttributes had no registry before 1.16. */
    static List<Map.Entry<String, Object>> all() {
        List<Map.Entry<String, Object>> all = new ArrayList<>();
        ALL.forEach(a -> all.add(Map.entry(a.getName(), a)));
        return all;
    }

    static Object byId(String id) {
        String name = id.substring(id.indexOf(':') + 1);
        // (a mob's own attribute, its holder's constant out of reach, by the name its instance goes by)
        return ALL.stream().filter(a -> a.getName().equals(name)).<Object>map(a -> a).findFirst().orElse(name);
    }

    static AttributeInstance instance(LivingEntity entity, Object attribute) {
        return attribute == null ? null : attribute instanceof String name ? entity.getAttributes().getInstance(name) : entity.getAttribute((Attribute) attribute);
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
    private static String operation(int operation) {
        return switch (operation) {
            case 0 -> "add_value";
            case 1 -> "add_multiplied_base";
            default -> "add_multiplied_total";
        };
    }

    static void addModifier(AttributeInstance instance, Scenario.Modifier m) {
        UUID id = UUID.fromString(m.uuid);
        instance.removeModifier(id);
        instance.addModifier(new AttributeModifier(id, m.key, m.amount, switch (m.operation) {
            case "add_value" -> 0;
            case "add_multiplied_base" -> 1;
            case "add_multiplied_total" -> 2;
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
        return entity.getAttributes().getInstance("horse.jumpStrength");
    }
}
