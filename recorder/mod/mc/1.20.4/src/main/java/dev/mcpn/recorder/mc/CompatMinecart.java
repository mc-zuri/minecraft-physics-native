package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Json;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;

/**
 * What a minecart keeps that its entity snapshot lacks: what the server's tick reads next (the vehicle layer seeds its
 * rail engine from it) and, on a client, where its interpolation is going. The class and the fields have moved and been
 * renamed across the releases, none of them to a name a mixin could share, so this reads them by their names in each
 * release (the dev namespace is Mojang's in all of them, the classes' own on 26.x).
 */
final class CompatMinecart {
    private CompatMinecart() {
    }

    private static boolean isCart(Entity e) {
        for (Class<?> c = e.getClass(); c != null; c = c.getSuperclass()) {
            if (c.getSimpleName().equals("AbstractMinecart")) {
                return true;
            }
        }
        return false;
    }

    private static Field field(Class<?> owner, String... names) {
        for (Class<?> c = owner; c != null; c = c.getSuperclass()) {
            for (String name : names) {
                try {
                    Field f = c.getDeclaredField(name);
                    f.setAccessible(true);
                    return f;
                } catch (NoSuchFieldException absent) {
                    // the next name, or the superclass
                }
            }
        }
        return null;
    }

    private static Object read(Object from, String... names) {
        Field f = field(from.getClass(), names);
        try {
            return f == null ? null : f.get(from);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Object call(Object on, String name) {
        for (Class<?> c = on.getClass(); c != null; c = c.getSuperclass()) {
            for (Method m : c.getDeclaredMethods()) {
                if (m.getName().equals(name) && m.getParameterCount() == 0) {
                    try {
                        m.setAccessible(true);
                        return m.invoke(on);
                    } catch (ReflectiveOperationException e) {
                        throw new IllegalStateException(e);
                    }
                }
            }
        }
        // (26.x keeps some of an ItemStack's as an interface's default methods)
        try {
            return on.getClass().getMethod(name).invoke(on);
        } catch (NoSuchMethodException absent) {
            return null;
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Entity.getFirstPassenger, which 1.8 calls its rider. */
    private static Entity firstPassenger(Entity e) {
        Object list = call(e, "getPassengers");
        if (list instanceof List<?> passengers) {
            return passengers.isEmpty() ? null : (Entity) passengers.get(0);
        }
        return (Entity) read(e, "rider");
    }

    private static String vec(Vec3 v) {
        return Json.vec(v.x, v.y, v.z);
    }

    private static Json.Obj rider(Entity rider) {
        Vec3 vel = CompatMove.velocity(rider);
        Json.Obj out = new Json.Obj().num("id", rider.getId())
            .bool("player", rider instanceof Player).bool("living", rider instanceof LivingEntity)
            .num("yRot", CompatEntity.yRot(rider)).vec("vel", vel.x, vel.y, vel.z);
        Object zza = read(rider, "zza");
        out.num("zza", zza instanceof Float f ? f : 0.0F);
        // ServerPlayer's, from 1.21.2
        if (call0Exists(rider, "getLastClientMoveIntent")) {
            out.raw("moveIntent", vec((Vec3) call(rider, "getLastClientMoveIntent")));
        }
        return out;
    }

    private static boolean call0Exists(Object on, String name) {
        for (Class<?> c = on.getClass(); c != null; c = c.getSuperclass()) {
            for (Method m : c.getDeclaredMethods()) {
                if (m.getName().equals(name) && m.getParameterCount() == 0) {
                    return true;
                }
            }
        }
        return false;
    }

    /** The items a chest or hopper cart holds, as the comparator reads them (its drag), and whether its loot is still to roll. */
    private static void container(Entity e, Json.Obj out) {
        try {
            Class<?> container = Class.forName("net.minecraft.world.Container");
            if (!container.isInstance(e)) {
                return;
            }
            Class<?> menu = Class.forName("net.minecraft.world.inventory.AbstractContainerMenu");
            Method signal = menu.getMethod("getRedstoneSignalFromContainer", container);
            out.num("comparatorSignal", (Integer) signal.invoke(null, e));
            out.bool("hasLootTable", read(e, "lootTable") != null);
        } catch (ReflectiveOperationException absent) {
            throw new IllegalStateException(absent);
        }
    }

    private static void furnace(Entity e, Json.Obj out) {
        Object fuel = read(e, "fuel");
        if (fuel == null) {
            return;
        }
        out.num("fuel", (Integer) fuel);
        Object push = read(e, "push");
        if (push instanceof Vec3 v) {
            out.raw("push", vec(v));
        } else {
            out.vec("push", (Double) read(e, "xPush"), 0.0, (Double) read(e, "zPush"));
        }
    }

    /** The old path's interpolation, in the fields or handler its release keeps it in. */
    private static void lerp(Object owner, Object cart, Json.Obj out) {
        Object steps = read(owner, "lSteps", "lerpSteps");
        if (steps instanceof Integer count) {
            out.obj("lerp", new Json.Obj().num("steps", count)
                .vec("target", (Double) read(owner, "lx", "lerpX"), (Double) read(owner, "ly", "lerpY"), (Double) read(owner, "lz", "lerpZ"))
                .num("yRot", (Double) read(owner, "lyr", "lerpYRot")).num("xRot", (Double) read(owner, "lxr", "lerpXRot")));
            return;
        }
        Object handler = call(cart, "getInterpolation");
        Object data = handler == null ? null : read(handler, "interpolationData");
        Object remaining = data == null ? null : read(data, "remainingSteps", "steps");
        if (remaining instanceof Integer count) {
            // (fields to 1.21.11, a record's accessors in 26.x)
            Vec3 target = (Vec3) (call(data, "position") != null ? call(data, "position") : read(data, "position"));
            Object yRot = call(data, "yRot") != null ? call(data, "yRot") : read(data, "yRot");
            Object xRot = call(data, "xRot") != null ? call(data, "xRot") : read(data, "xRot");
            out.obj("lerp", new Json.Obj().num("steps", count).vec("target", target.x, target.y, target.z)
                .num("yRot", (Float) yRot).num("xRot", (Float) xRot));
        }
    }

    private static Json.Obj step(Object step) {
        Vec3 position = (Vec3) call(step, "position");
        Vec3 movement = (Vec3) call(step, "movement");
        return new Json.Obj().vec("position", position.x, position.y, position.z).vec("movement", movement.x, movement.y, movement.z)
            .num("yRot", (Float) call(step, "yRot")).num("xRot", (Float) call(step, "xRot")).num("weight", (Float) call(step, "weight"));
    }

    private static String steps(Object list) {
        List<String> out = new ArrayList<>();
        for (Object step : (List<?>) list) {
            out.add(step(step).text());
        }
        return Json.array(out);
    }

    /** The improved path's steps, on a client: what it is going through and what the server has sent since. */
    private static void clientSteps(Object behavior, Json.Obj out) {
        out.obj("steps", new Json.Obj().num("delay", (Integer) read(behavior, "lerpDelay"))
            .raw("pending", steps(read(behavior, "lerpSteps"))).raw("current", steps(read(behavior, "currentLerpSteps")))
            .num("totalWeight", (Double) read(behavior, "currentLerpStepsTotalWeight"))
            .obj("old", step(read(behavior, "oldLerp"))));
    }

    /**
     * The raw 48 bits behind Entity.random, the state its next draw starts from: java.util.Random's before 1.19,
     * LegacyRandomSource's after. Null when a release keeps it some other way.
     */
    private static Long randomSeed(Entity e) {
        Object random = read(e, "random");
        try {
            if (random instanceof java.util.Random) {
                // (java.base keeps it private from reflection; sun.misc.Unsafe reads it as it stands)
                Field theUnsafe = sun.misc.Unsafe.class.getDeclaredField("theUnsafe");
                theUnsafe.setAccessible(true);
                sun.misc.Unsafe unsafe = (sun.misc.Unsafe) theUnsafe.get(null);
                long offset = unsafe.objectFieldOffset(java.util.Random.class.getDeclaredField("seed"));
                return ((java.util.concurrent.atomic.AtomicLong) unsafe.getObject(random, offset)).get();
            }
        } catch (ReflectiveOperationException absent) {
            return null;
        }
        Object seed = read(random, "seed");
        return seed instanceof java.util.concurrent.atomic.AtomicLong state ? state.get() : null;
    }

    /** An ItemStack: null when empty (null itself before 1.11). */
    private static Json.Obj stack(Object stack) {
        if (stack == null || Boolean.TRUE.equals(call(stack, "isEmpty"))) {
            return null;
        }
        Object count = call(stack, "getCount");
        return new Json.Obj().str("item", String.valueOf(call(stack, "getDescriptionId")))
            .num("count", (Integer) (count != null ? count : read(stack, "count")))
            .num("maxStack", (Integer) call(stack, "getMaxStackSize"));
    }

    /** What an item entity holds, for the hopper carts near it. */
    static void writeItem(Entity e, Json.Obj o) {
        if (e.getClass().getSimpleName().equals("ItemEntity")) {
            Json.Obj stack = stack(call(e, "getItem"));
            if (stack != null) {
                o.obj("itemStack", stack);
            }
        }
    }

    private static void hopper(Entity e, Json.Obj out) {
        if (!e.getClass().getSimpleName().equals("MinecartHopper")) {
            return;
        }
        out.bool("enabled", (Boolean) read(e, "enabled"));
        try {
            Class<?> container = Class.forName("net.minecraft.world.Container");
            Method get = container.getMethod("getItem", int.class);
            List<String> slots = new ArrayList<>();
            for (int slot = 0; slot < 5; slot++) {
                Json.Obj stack = stack(get.invoke(e, slot));
                slots.add(stack == null ? "null" : stack.text());
            }
            out.raw("inventory", Json.array(slots));
        } catch (ReflectiveOperationException absent) {
            throw new IllegalStateException(absent);
        }
    }

    /** VehicleEntity's synced numbers and what each variant's side effects keep. */
    private static void effects(Entity e, Json.Obj out) {
        out.num("hurtTime", (Integer) call(e, "getHurtTime")).num("hurtDir", (Integer) call(e, "getHurtDir"))
            .num("damage", (Float) call(e, "getDamage"));
        Object fuse = read(e, "fuse");
        if (fuse instanceof Integer ticks) {
            out.num("fuse", ticks);
            Long seed = randomSeed(e);
            if (seed != null) {
                out.num("randomSeed", seed);
            }
        }
        Object lastActivated = read(e, "lastActivated");
        if (lastActivated instanceof Integer tick) {
            out.num("lastActivated", tick);
        }
        hopper(e, out);
        Object time = read(e, "portalTime");
        Object inside = read(e, "isInsidePortal");
        Object process = read(e, "portalProcess");
        if (process != null) {
            time = call(process, "getPortalTime");
            inside = call(process, "isInsidePortalThisTick");
        }
        if (time instanceof Integer ticks) {
            out.num("portalTime", ticks).bool("insidePortal", Boolean.TRUE.equals(inside));
        }
        if (read(e, "portalCooldown") instanceof Integer cooldown) {
            out.num("portalCooldown", cooldown);
        }
    }

    static void write(Entity e, Json.Obj v) {
        if (!isCart(e)) {
            return;
        }
        Vec3 stuck = CompatMove.stuck(e);
        Json.Obj m = new Json.Obj().bool("flipped", (Boolean) read(e, "flipped"))
            .bool("inWater", e.isInWater())
            .bool("horizontalCollision", e.horizontalCollision).bool("verticalCollision", e.verticalCollision)
            .bool("noGravity", CompatLiving.noGravity(e)).vec("stuckSpeedMultiplier", stuck.x, stuck.y, stuck.z)
            .num("fallDistance", e.fallDistance);
        Object onRails = read(e, "onRails");
        if (onRails instanceof Boolean on) {
            m.bool("onRails", on);
        }
        Object first = read(e, "firstTick");
        if (first instanceof Boolean on) {
            m.bool("firstTick", on);
        }
        furnace(e, m);
        container(e, m);
        effects(e, m);
        Entity rider = firstPassenger(e);
        if (rider != null) {
            m.obj("rider", rider(rider));
        }
        Object behavior = call(e, "getBehavior");
        Object clientSide = read(e, "level", "world");
        if (clientSide != null && clientSide.getClass().getSimpleName().equals("ClientLevel")) {
            if (behavior != null && behavior.getClass().getSimpleName().equals("NewMinecartBehavior")) {
                clientSteps(behavior, m);
            } else {
                lerp(behavior != null ? behavior : e, e, m);
            }
        }
        v.obj("minecart", m);
    }
}
