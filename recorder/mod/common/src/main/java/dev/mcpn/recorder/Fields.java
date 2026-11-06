package dev.mcpn.recorder;

import java.lang.reflect.Field;

/** Counters a case must not inherit from the one before it, in releases that may not have them. */
public final class Fields {
    private Fields() {
    }

    /** Sets an int field of `owner` on `target` to 0, if this release has it. */
    public static void zero(Object target, Class<?> owner, String name) {
        Field field = find(owner, name);
        if (field != null) {
            try {
                if (field.getType() == short.class) {
                    field.setShort(target, (short) 0);
                } else {
                    field.setInt(target, 0);
                }
            } catch (IllegalAccessException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    /** Sets an int field of `owner` on `target`, if this release has it. */
    public static void setInt(Object target, Class<?> owner, String name, int value) {
        Field field = find(owner, name);
        if (field != null) {
            try {
                field.setInt(target, value);
            } catch (IllegalAccessException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    /** An int field of `owner` on `target`, 0 if this release does not have it. */
    public static int getInt(Object target, Class<?> owner, String name) {
        Field field = find(owner, name);
        try {
            return field == null ? 0 : field.getInt(target);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Seeds an entity's random, whichever class this release has for it. */
    public static void seedRandom(Object entity, Class<?> entityClass, long seed) {
        Object random = get(entity, entityClass, "random");
        try {
            random.getClass().getMethod("setSeed", long.class).invoke(random, seed);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The state of an entity's random (Random.seed, LegacyRandomSource.seed), -1 where it keeps none of that kind. */
    public static long randomSeed(Object entity, Class<?> entityClass) {
        Object random = get(entity, entityClass, "random");
        return get(random, random.getClass(), "seed") instanceof java.util.concurrent.atomic.AtomicLong seed ? seed.get() : -1;
    }

    /** PrimedTnt's fuse: a field while it has one (the synced value can stand still), else getFuse. */
    public static int fuse(Object tnt) {
        return readInt(tnt, new String[] {"getFuse", "getLife"}, new String[] {"life", "DATA_FUSE_ID"});
    }

    /** ExperienceOrb's value: a synced value by getValue from 1.21.5, a field before it. */
    public static int orbValue(Object orb) {
        return readInt(orb, new String[] {"getValue"}, new String[] {"value"});
    }

    private static int readInt(Object target, String[] getters, String[] fields) {
        for (String name : fields) {
            Field field = find(target.getClass(), name);
            if (field != null && field.getType() == int.class && !java.lang.reflect.Modifier.isStatic(field.getModifiers())) {
                return getInt(target, target.getClass(), name);
            }
        }
        for (String name : getters) {
            try {
                java.lang.reflect.Method getter = target.getClass().getMethod(name);
                if (getter.getReturnType() == int.class) {
                    return (Integer) getter.invoke(target);
                }
            } catch (NoSuchMethodException e) {
                // the next way of keeping it
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            }
        }
        throw new IllegalStateException("no " + fields[0] + " on " + target.getClass());
    }

    /** Copies one object field of `owner` on `target` to another, if this release has them. */
    public static void copy(Object target, Class<?> owner, String from, String to) {
        Field source = find(owner, from);
        Field destination = find(owner, to);
        if (source != null && destination != null) {
            try {
                destination.set(target, source.get(target));
            } catch (IllegalAccessException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    /** Sets float fields of `owner` on `target` to 0, if this release has them. */
    public static void zeroFloats(Object target, Class<?> owner, String... names) {
        for (String name : names) {
            Field field = find(owner, name);
            if (field != null) {
                try {
                    field.setFloat(target, 0.0F);
                } catch (IllegalAccessException e) {
                    throw new IllegalStateException(e);
                }
            }
        }
    }

    /** An object field of `owner` on `target`, null if this release does not have it. */
    public static Object get(Object target, Class<?> owner, String name) {
        Field field = find(owner, name);
        try {
            return field == null ? null : field.get(target);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Forgets a player's stats, and so before 1.12 its achievements, which are said in the chat the first time. */
    public static void clearStats(Object player, Class<?> playerClass) {
        Object stats = get(player, playerClass, "stats");
        if (stats != null) {
            Object held = get(stats, stats.getClass(), "stats");
            if (held instanceof java.util.Map<?, ?> map) {
                map.clear();
            }
        }
    }

    /** The level's ticking block entities by release: what ticks, what joins it next (from 1.17 tickers, known by their position). */
    private static final String[][] TICK_LISTS = {
        {"blockEntityTickers", "pendingBlockEntityTickers"},
        {"tickableBlockEntities", "pendingBlockEntities"},
        {"tickingBlockEntities", "pendingBlockEntities"},
    };

    /** Where each block entity stands in the order the level ticks them: by the entry itself and, for a ticker, its position. */
    public static java.util.Map<Object, Integer> tickOrder(Object level, Class<?> levelClass) {
        for (String[] names : TICK_LISTS) {
            if (get(level, levelClass, names[0]) instanceof java.util.List<?> ticking) {
                java.util.Map<Object, Integer> order = new java.util.HashMap<>();
                add(order, ticking);
                if (get(level, levelClass, names[1]) instanceof java.util.List<?> joining) {
                    add(order, joining);
                }
                return order;
            }
        }
        throw new IllegalStateException("no list of ticking block entities on " + levelClass);
    }

    private static void add(java.util.Map<Object, Integer> order, java.util.List<?> entries) {
        for (Object entry : entries) {
            int at = order.size();
            order.put(entry, at);
            try {
                java.lang.reflect.Method pos = entry.getClass().getMethod("getPos");
                pos.setAccessible(true);
                order.put(pos.invoke(entry), at);
            } catch (NoSuchMethodException e) {
                // a block entity before 1.17: the entry is all there is
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    /** Clears a double[] field of `owner` on `target`, if this release has it. */
    public static void zeroDoubles(Object target, Class<?> owner, String name) {
        if (get(target, owner, name) instanceof double[] values) {
            java.util.Arrays.fill(values, 0.0);
        }
    }

    /** Ends the cooldowns of a player's held items (Player.cooldowns, ItemCooldowns.cooldowns), from 1.9. */
    public static void clearCooldowns(Object player, Class<?> playerClass) {
        Object cooldowns = get(player, playerClass, "cooldowns");
        if (cooldowns != null) {
            ((java.util.Map<?, ?>) get(cooldowns, cooldowns.getClass(), "cooldowns")).clear();
        }
    }

    private static Field find(Class<?> owner, String name) {
        for (Class<?> at = owner; at != null; at = at.getSuperclass()) {
            try {
                Field field = at.getDeclaredField(name);
                field.setAccessible(true);
                return field;
            } catch (NoSuchFieldException e) {
                // on up: the field may be its parent's
            }
        }
        return null;
    }
}
