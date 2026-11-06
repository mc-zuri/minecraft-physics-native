package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Fields;
import dev.mcpn.recorder.Json;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.boss.enderdragon.EnderDragon;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/**
 * What a dragon's flight started from and left, its parts and its wings' pushes, for the replay of the dragon
 * (DragonFlightMixin). Everything of the dragon's own goes by name: 1.8 has no phases, and its flight history is a field before
 * 1.21.2 and a class after.
 */
public final class DragonSnap {
    private DragonSnap() {
    }

    /** The delays the parts read (26.3 EnderDragon.java:265, 293). */
    private static final int HISTORY = 17;

    private static final class Tick {
        String from;
        String to;
        final List<String> pushes = new ArrayList<>();
    }

    private static final Map<Entity, Tick> TICKS = new java.util.WeakHashMap<>();

    static boolean isDragon(Entity e) {
        return e instanceof EnderDragon;
    }

    public static boolean server(Entity e) {
        return Fields.get(e, Entity.class, "level") instanceof net.minecraft.server.level.ServerLevel;
    }

    private static Object call(Object on, String name) {
        for (Class<?> at = on.getClass(); at != null; at = at.getSuperclass()) {
            try {
                Method method = at.getDeclaredMethod(name);
                method.setAccessible(true);
                return method.invoke(on);
            } catch (NoSuchMethodException e) {
                // on up
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            }
        }
        throw new IllegalStateException("no " + name + " on " + on.getClass());
    }

    /** The phase of a dragon that has them. */
    private static Object phase(Entity dragon) {
        Object manager = Fields.get(dragon, EnderDragon.class, "phaseManager");
        return manager == null ? null : call(manager, "getCurrentPhase");
    }

    /** The target 1.8's dragon keeps, which it has no phase to ask. */
    private static Json.Obj target(Json.Obj o, String key, Entity dragon) {
        double x = (Double) Fields.get(dragon, EnderDragon.class, "field_3742");
        double y = (Double) Fields.get(dragon, EnderDragon.class, "field_3751");
        double z = (Double) Fields.get(dragon, EnderDragon.class, "field_3752");
        return o.vec(key, x, y, z);
    }

    private static Json.Obj state(Entity dragon) {
        Vec3 pos = CompatMove.position(dragon);
        Vec3 vel = CompatMove.velocity(dragon);
        AABB box = dragon.getBoundingBox();
        return new Json.Obj().vec("pos", pos.x, pos.y, pos.z).vec("vel", vel.x, vel.y, vel.z).num("yRot", CompatEntity.yRot(dragon))
            .num("yRotA", (Float) Fields.get(dragon, EnderDragon.class, "yRotA"))
            .bool("inWall", (Boolean) Fields.get(dragon, EnderDragon.class, "inWall"))
            .raw("box", Json.doubles(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ));
    }

    /** DragonFlightMixin, before 1.8's AI: its flight begins from what this tick starts with. */
    public static void beforeLegacyAi(Entity dragon) {
        if (phase(dragon) == null) {
            Tick tick = new Tick();
            tick.from = target(state(dragon), "steering", dragon).text();
            TICKS.put(dragon, tick);
        }
    }

    /** DragonFlightMixin, as the flight asks its phase for the target. */
    public static void beforeFlight(Entity dragon) {
        Object phase = phase(dragon);
        Tick tick = new Tick();
        Object target = call(phase, "getFlyTargetLocation");
        if (target instanceof Vec3 at) {
            // (the speeds as the tick asks them: the turn after the climb, which changes no horizontal motion)
            tick.from = state(dragon).vec("target", at.x, at.y, at.z).num("flySpeed", (Float) call(phase, "getFlySpeed"))
                .num("turnSpeed", (Float) call(phase, "getTurnSpeed")).text();
        }
        TICKS.put(dragon, tick);
    }

    /** DragonFlightMixin, where aiStep sets the body's yaw: after the flight, and its blocks' effects. */
    public static void afterFlight(Entity dragon) {
        Tick tick = TICKS.computeIfAbsent(dragon, d -> new Tick());
        Json.Obj to = state(dragon);
        if (phase(dragon) == null) {
            target(to, "target", dragon);
        }
        tick.to = to.text();
    }

    /** DragonFlightMixin, at a wing's push. */
    public static void push(Entity dragon, Entity pushed, double x, double y, double z) {
        Tick tick = TICKS.computeIfAbsent(dragon, d -> new Tick());
        Vec3 pos = CompatMove.position(pushed);
        AABB box = pushed.getBoundingBox();
        tick.pushes.add(new Json.Obj().num("id", pushed.getId()).vec("impulse", x, y, z).vec("pos", pos.x, pos.y, pos.z)
            .raw("box", Json.doubles(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ)).text());
    }

    /** DragonFlightHistory, or the positions before 1.21.2: newest first, as [y, yaw]. */
    private static String history(Entity dragon) {
        List<String> samples = new ArrayList<>();
        Object history = Fields.get(dragon, EnderDragon.class, "flightHistory");
        if (history != null) {
            for (int delay = 0; delay < HISTORY; delay++) {
                Object sample;
                try {
                    Method get = history.getClass().getMethod("get", int.class);
                    sample = get.invoke(history, delay);
                } catch (ReflectiveOperationException e) {
                    throw new IllegalStateException(e);
                }
                samples.add(Json.doubles((Double) call(sample, "y"), (Float) call(sample, "yRot")));
            }
        } else {
            double[][] positions = (double[][]) Fields.get(dragon, EnderDragon.class, "positions");
            int pointer = Fields.getInt(dragon, EnderDragon.class, "posPointer");
            for (int delay = 0; delay < HISTORY; delay++) {
                double[] sample = positions[pointer - delay & 63];
                samples.add(Json.doubles(sample[1], sample[0]));
            }
        }
        return "[" + String.join(",", samples) + "]";
    }

    /** What the tick of a dragon left, on the entity of the server's view: its parts are placed by now. */
    static void write(Json.Obj o, EnderDragon dragon) {
        Tick tick = TICKS.remove(dragon);
        if (tick == null || tick.to == null) {
            return;
        }
        List<String> parts = new ArrayList<>();
        for (Object part : (Object[]) Fields.get(dragon, EnderDragon.class, "subEntities")) {
            Entity e = (Entity) part;
            AABB box = e.getBoundingBox();
            Vec3 pos = CompatMove.position(e);
            parts.add(new Json.Obj().num("id", e.getId()).vec("pos", pos.x, pos.y, pos.z)
                .raw("box", Json.doubles(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ)).text());
        }
        Object phase = phase(dragon);
        Json.Obj view = new Json.Obj().raw("to", tick.to).raw("history", history(dragon)).raw("parts", "[" + String.join(",", parts) + "]")
            .raw("pushes", "[" + String.join(",", tick.pushes) + "]")
            .bool("sitting", phase != null && (Boolean) call(phase, "isSitting")).num("hurtTime", dragon.hurtTime);
        o.raw("dragon", (tick.from == null ? view : view.raw("from", tick.from)).text());
    }
}
