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
        // (ItemStack.getDescriptionId is gone from 1.21.2: the item's own, which the stack's gave before)
        Object id = call(stack, "getDescriptionId");
        if (id == null) {
            Object item = call(stack, "getItem");
            id = item == null ? null : call(item, "getDescriptionId");
        }
        return new Json.Obj().str("item", String.valueOf(id))
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
        Json.Obj source = sourceContainer(e);
        if (source != null) {
            out.obj("container", source);
        }
        List<String> near = nearContainers(e);
        if (!near.isEmpty()) {
            out.raw("containers", Json.array(near));
        }
    }

    /** The method of `owner` (or its superclasses) named `name` whose parameters the `candidates` fill, by type, and its call. */
    private static Object invokeMatching(Class<?> owner, Object on, String name, Object... candidates) {
        for (Class<?> c = owner; c != null; c = c.getSuperclass()) {
            for (Method m : c.getDeclaredMethods()) {
                if (!m.getName().equals(name)) {
                    continue;
                }
                Class<?>[] types = m.getParameterTypes();
                Object[] args = new Object[types.length];
                boolean filled = true;
                for (int i = 0; i < types.length && filled; i++) {
                    filled = false;
                    for (Object candidate : candidates) {
                        if (types[i].isInstance(candidate)) {
                            args[i] = candidate;
                            filled = true;
                            break;
                        }
                    }
                }
                if (filled) {
                    try {
                        m.setAccessible(true);
                        return m.invoke(on, args);
                    } catch (ReflectiveOperationException e) {
                        throw new IllegalStateException(e);
                    }
                }
            }
        }
        return null;
    }

    private static Object blockPos(int x, int y, int z) {
        try {
            return Class.forName("net.minecraft.core.BlockPos").getConstructor(int.class, int.class, int.class).newInstance(x, y, z);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String pos(Object blockPos) {
        return "[" + call(blockPos, "getX") + "," + call(blockPos, "getY") + "," + call(blockPos, "getZ") + "]";
    }

    /** The level a server's entity is in, or null on a client, which cannot see into containers and block entities. */
    private static Object serverLevel(Entity e) {
        Object level = read(e, "level", "world");
        return level == null || level.getClass().getSimpleName().equals("ClientLevel") ? null : level;
    }

    /**
     * What a hopper cart takes from when it takes from a container: HopperBlockEntity.getSourceContainer, at the block over
     * its hopper (getLevelY is the cart's y and half a block, in every release), with the slots HopperBlockEntity.getSlots
     * gives it from below in their order; a slot a WorldlyContainer will not give through its bottom is null.
     */
    private static Json.Obj sourceContainer(Entity e) {
        Object level = serverLevel(e);
        if (level == null) {
            return null;
        }
        Vec3 at = CompatMove.position(e);
        Object pos = blockPos((int) Math.floor(at.x), (int) Math.floor(at.y + 0.5 + 1.0), (int) Math.floor(at.z));
        Object state = invokeMatching(level.getClass(), level, "getBlockState", pos);
        try {
            Class<?> hopperEntity = Class.forName("net.minecraft.world.level.block.entity.HopperBlockEntity");
            Object source = invokeMatching(hopperEntity, null, "getSourceContainer", level, e, pos, state);
            if (source == null) {
                return null;
            }
            return described(source, pos);
        } catch (ReflectiveOperationException absent) {
            throw new IllegalStateException(absent);
        }
    }

    /**
     * The block containers over the cells about the one over a hopper cart's hopper, a block each way: where its next tick
     * can take it, whose take comes after its move (MinecartHopper.tick, super.tick then the suck), so that the tick it
     * reaches a container on has the container as it was. HopperBlockEntity.getContainerAt of each cell, at the cell
     * (Level, BlockPos from 1.13, Level and the cell's middle before it); the cell over the hopper is `container`.
     */
    private static List<String> nearContainers(Entity e) {
        List<String> out = new ArrayList<>();
        Object level = serverLevel(e);
        if (level == null) {
            return out;
        }
        Vec3 at = CompatMove.position(e);
        int x = (int) Math.floor(at.x);
        int y = (int) Math.floor(at.y + 0.5 + 1.0);
        int z = (int) Math.floor(at.z);
        try {
            Class<?> hopperEntity = Class.forName("net.minecraft.world.level.block.entity.HopperBlockEntity");
            Class<?> blockPosClass = Class.forName("net.minecraft.core.BlockPos");
            Method byPos = null;
            Method byPoint = null;
            for (Method m : hopperEntity.getDeclaredMethods()) {
                if (!m.getName().equals("getContainerAt")) {
                    continue;
                }
                Class<?>[] types = m.getParameterTypes();
                if (types.length == 2 && types[0].isInstance(level) && types[1] == blockPosClass) {
                    byPos = m;
                } else if (types.length == 4 && types[0].isInstance(level) && types[1] == double.class && types[2] == double.class && types[3] == double.class) {
                    byPoint = m;
                }
            }
            for (int dy = -1; dy <= 1; dy++) {
                for (int dx = -1; dx <= 1; dx++) {
                    for (int dz = -1; dz <= 1; dz++) {
                        if (dx == 0 && dy == 0 && dz == 0) {
                            continue;
                        }
                        Object pos = blockPos(x + dx, y + dy, z + dz);
                        Object found;
                        if (byPos != null) {
                            byPos.setAccessible(true);
                            found = byPos.invoke(null, level, pos);
                        } else if (byPoint != null) {
                            byPoint.setAccessible(true);
                            found = byPoint.invoke(null, level, x + dx + 0.5, y + dy + 0.5, z + dz + 0.5);
                        } else {
                            return out;
                        }
                        // (the cart is a container entity itself, in the cells about its own)
                        if (found != null && found != e) {
                            out.add(described(found, pos).text());
                        }
                    }
                }
            }
            return out;
        } catch (ReflectiveOperationException absent) {
            throw new IllegalStateException(absent);
        }
    }

    /** A container as a hopper below it sees it: its block, and the slots HopperBlockEntity.getSlots gives from below. */
    private static Json.Obj described(Object source, Object pos) {
        try {
            Class<?> container = Class.forName("net.minecraft.world.Container");
            Class<?> direction = Class.forName("net.minecraft.core.Direction");
            Object down = direction.getField("DOWN").get(null);
            Method get = container.getMethod("getItem", int.class);
            Class<?> worldly = Class.forName("net.minecraft.world.WorldlyContainer");
            int[] open;
            if (worldly.isInstance(source)) {
                open = (int[]) worldly.getMethod("getSlotsForFace", direction).invoke(source, down);
            } else {
                open = new int[(Integer) container.getMethod("getContainerSize").invoke(source)];
                for (int i = 0; i < open.length; i++) {
                    open[i] = i;
                }
            }
            List<String> slots = new ArrayList<>();
            for (int slot : open) {
                Object item = get.invoke(source, slot);
                boolean refused = worldly.isInstance(source) && !Boolean.TRUE.equals(worldly
                    .getMethod("canTakeItemThroughFace", int.class, Class.forName("net.minecraft.world.item.ItemStack"), direction)
                    .invoke(source, slot, item, down));
                Json.Obj stack = refused ? null : stack(item);
                slots.add(stack == null ? "null" : stack.text());
            }
            return new Json.Obj().raw("pos", pos(pos)).raw("slots", Json.array(slots));
        } catch (ReflectiveOperationException absent) {
            throw new IllegalStateException(absent);
        }
    }

    /**
     * The scoreboard team an entity is on, which the pushes select by from 1.9 (EntitySelector.pushableBy): its name, and
     * its Team.CollisionRule by its command name, always before 1.9 where there is none.
     */
    static void writeTeam(Entity e, Json.Obj out) {
        Object team = invokeMatching(Entity.class, e, "getTeam");
        if (team == null) {
            return;
        }
        Object name = invokeMatching(team.getClass(), team, "getName");
        Object rule = invokeMatching(team.getClass(), team, "getCollisionRule");
        // (by its place in the enum, ALWAYS, NEVER, PUSH_OTHER_TEAMS, PUSH_OWN_TEAM in every release from 1.9, 1.12.2 and 26.3
        // Team.java: the names of its constants are not the same under every release's mapping)
        String[] names = {"always", "never", "pushOtherTeams", "pushOwnTeam"};
        String ruleName = rule == null ? "always" : names[((Enum<?>) rule).ordinal()];
        Json.Obj written = new Json.Obj().str("name", String.valueOf(name)).str("collisionRule", ruleName);
        // (PlayerTeam.allowFriendlyFire, which from 26.3 keeps a TNT cart's blast off its allies: written only where it is off)
        if (Boolean.FALSE.equals(invokeMatching(team.getClass(), team, "isAllowFriendlyFire"))) {
            written.bool("allowFriendlyFire", false);
        }
        out.obj("team", written);
    }

    /** A spawner cart's BaseSpawner: what its serverTick counts down, and how near a player has to be. */
    private static void spawner(Entity e, Json.Obj out) {
        Object spawner = read(e, "spawner");
        if (spawner == null || !e.getClass().getSimpleName().equals("MinecartSpawner")) {
            return;
        }
        out.obj("spawner", new Json.Obj().num("delay", (Integer) read(spawner, "spawnDelay"))
            .num("minDelay", (Integer) read(spawner, "minSpawnDelay")).num("maxDelay", (Integer) read(spawner, "maxSpawnDelay"))
            .num("range", (Integer) read(spawner, "requiredPlayerRange")));
    }

    /**
     * The end gateways about a server's cart, which no client can see into: each one's block, the block it sends to (the exit
     * portal under ExactTeleport, else what its own findExitPosition finds; absent where it has no exit), its cooldown and age.
     */
    private static void gateways(Entity e, Json.Obj out) {
        Object level = serverLevel(e);
        if (level == null) {
            return;
        }
        Vec3 at = CompatMove.position(e);
        Vec3 vel = CompatMove.velocity(e);
        int reach = 2 + (int) Math.ceil(Math.max(Math.abs(vel.x), Math.abs(vel.z)));
        List<String> found = new ArrayList<>();
        for (int x = (int) Math.floor(at.x) - reach; x <= (int) Math.floor(at.x) + reach; x++) {
            for (int y = (int) Math.floor(at.y) - 1; y <= (int) Math.floor(at.y) + 2; y++) {
                for (int z = (int) Math.floor(at.z) - reach; z <= (int) Math.floor(at.z) + reach; z++) {
                    Object pos = blockPos(x, y, z);
                    Object entity = invokeMatching(level.getClass(), level, "getBlockEntity", pos);
                    if (entity == null || !entity.getClass().getSimpleName().equals("TheEndGatewayBlockEntity")) {
                        continue;
                    }
                    Object exitPortal = read(entity, "exitPortal");
                    Object exit = exitPortal;
                    if (exitPortal != null && !Boolean.TRUE.equals(read(entity, "exactTeleport"))) {
                        // (an instance method of its own exit portal to 1.16.5, a static one of the level and the exit portal from 1.17)
                        exit = invokeMatching(entity.getClass(), entity, "findExitPosition", level, exitPortal);
                    }
                    Json.Obj gateway = new Json.Obj().raw("pos", pos(pos))
                        .num("cooldown", (Integer) read(entity, "teleportCooldown")).num("age", (Long) read(entity, "age"));
                    if (exit != null) {
                        gateway.raw("exit", pos(exit));
                    }
                    found.add(gateway.text());
                }
            }
        }
        if (!found.isEmpty()) {
            out.raw("gateways", Json.array(found));
        }
    }

    /** Abilities.instabuild of a player: getAbilities() from 1.17, the abilities field before. */
    private static boolean creative(Player player) {
        Object abilities = call(player, "getAbilities");
        if (abilities == null) {
            abilities = read(player, "abilities");
        }
        return abilities != null && Boolean.TRUE.equals(read(abilities, "instabuild"));
    }

    /**
     * Entity.boardingCooldown from 1.9, the ticks before a cart can pick up what just left a vehicle: written only while it
     * runs, for every entity.
     */
    static void writeBoarding(Entity e, Json.Obj out) {
        if (read(e, "boardingCooldown") instanceof Integer cooldown && cooldown > 0) {
            out.num("boardingCooldown", cooldown);
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
            // (from 1.21.2 the blast's power, which the NBT sets: written only where it is not the 4 and 1 of a new cart)
            if (read(e, "explosionPowerBase") instanceof Float power && power != 4.0F) {
                out.num("explosionPowerBase", power);
            }
            if (read(e, "explosionSpeedFactor") instanceof Float factor && factor != 1.0F) {
                out.num("explosionSpeedFactor", factor);
            }
            // (from 1.21.5 the hurt that lit it, whose attacker its blast keeps: only whether that is a creative player counts)
            Object ignition = read(e, "ignitionSource");
            Object attacker = ignition == null ? null : call(ignition, "getEntity");
            if (attacker instanceof Player player && creative(player)) {
                out.bool("creativeIgnition", true);
            }
        }
        // (Entity.isInvulnerable, which keeps all but a creative player's hit off: written only where it holds. 26.3 renames
        // the field permanentlyInvulnerable and adds a temporary invulnerableTime to the method; 1.8 has the field alone)
        Object invulnerable = call(e, "isInvulnerable");
        if (invulnerable == null) {
            invulnerable = read(e, "invulnerable");
        }
        if (Boolean.TRUE.equals(invulnerable)) {
            out.bool("invulnerable", true);
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
            // (from 1.21 the portal it is in, by its block, and the block it went in at)
            Object portal = read(process, "portal");
            String kind = portal == null ? "" : portal.getClass().getSimpleName();
            out.str("portal", kind.equals("EndGatewayBlock") ? "gateway" : kind.equals("EndPortalBlock") ? "end" : "nether");
            Object entry = read(process, "entryPosition");
            if (entry != null) {
                out.raw("portalEntry", pos(entry));
            }
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
        spawner(e, m);
        gateways(e, m);
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
