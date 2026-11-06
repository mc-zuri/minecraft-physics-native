package dev.mcpn.recorder.mc;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import net.minecraft.server.level.ThreadedLevelLightEngine;
import net.minecraft.world.level.ChunkPos;

/**
 * Whether the light work the last round started has finished. A checked block's task goes through a dispatcher thread
 * first, and until it reaches the light engine neither its queue nor its flags show it: a marker sent down the same way
 * for each column has come out behind it. (ThreadedLevelLightEngine.waitForPendingTasks, which older releases do not have,
 * is such a marker.)
 */
public final class LightFence {
    private static final Set<Long> CHECKED = ConcurrentHashMap.newKeySet();
    private static final List<CompletableFuture<Void>> MARKERS = new ArrayList<>();

    private LightFence() {
    }

    /** ThreadedLevelLightEngine.checkBlock: this column's light has work coming. */
    public static void checked(int x, int z) {
        CHECKED.add(ChunkPos.asLong(x, z));
    }

    /** Server thread: whether what was checked has come through. */
    static boolean settled(ThreadedLevelLightEngine light) {
        if (!CHECKED.isEmpty()) {
            List<Long> columns = List.copyOf(CHECKED);
            CHECKED.removeAll(columns);
            for (long column : columns) {
                MARKERS.add(marker(light, ChunkPos.getX(column), ChunkPos.getZ(column)));
            }
        }
        MARKERS.removeIf(CompletableFuture::isDone);
        return MARKERS.isEmpty();
    }

    private static CompletableFuture<Void> marker(ThreadedLevelLightEngine light, int x, int z) {
        CompletableFuture<Void> done = new CompletableFuture<>();
        try {
            Method add = addTask();
            Object after = add.getParameterTypes()[2].getEnumConstants()[1];
            add.invoke(light, x, z, after, (Runnable) () -> done.complete(null));
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
        return done;
    }

    private static Method addTask() {
        for (Method method : ThreadedLevelLightEngine.class.getDeclaredMethods()) {
            Class<?>[] types = method.getParameterTypes();
            if (method.getName().equals("addTask") && types.length == 4 && types[2].isEnum() && types[3] == Runnable.class) {
                method.setAccessible(true);
                return method;
            }
        }
        throw new IllegalStateException("no ThreadedLevelLightEngine.addTask");
    }
}
