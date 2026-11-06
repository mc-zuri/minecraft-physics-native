package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Json;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;

/** What the projectile replay needs of a server entity, past its motion and box. */
final class CompatProjectile {
    /** The projectile families, by their ids from 1.8 on. */
    private static final java.util.regex.Pattern SAVED = java.util.regex.Pattern.compile(
        "arrow|trident|snowball|egg|pearl|potion|bottle|exp|fireball|skull|wind_charge|spit|bullet|firework|bobber|hook");

    private CompatProjectile() {
    }

    static void extras(Json.Obj o, Entity e) {
        // (1.8 has no getRootVehicle)
        Entity root = e;
        while (CompatLiving.vehicle(root) != null) {
            root = CompatLiving.vehicle(root);
        }
        o.num("age", e.tickCount).num("root", root.getId())
            .bool("pickable", e.isPickable()).bool("alive", e.isAlive()).bool("noPhysics", e.noPhysics);
        if (e instanceof LivingEntity living) {
            // (hurtTime answers a hit that took no health, as a snowball's)
            o.num("health", living.getHealth()).num("hurtTime", living.hurtTime);
        }
        String type = CompatMove.entityId(e).toLowerCase(java.util.Locale.ROOT);
        if (SAVED.matcher(type).find()) {
            // (its own UUID is no state, and before the recorder's seeding reaches it, on 1.8, a random one)
            o.str("nbt", CompatServer.nbtText(e).replaceAll("\\bUUID(Most|Least):-?\\d+L,?", "").replaceAll("\\bUUID:\\[I;[^\\]]*\\],?", ""));
        }
    }
}
