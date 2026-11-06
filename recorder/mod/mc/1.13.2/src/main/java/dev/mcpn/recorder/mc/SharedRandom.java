package dev.mcpn.recorder.mc;

import java.lang.reflect.Field;
import java.util.Random;

/** Mth's own random, which a case seeds: what before 1.14 draws from Math.random, no seed reaches, draws from it. */
public final class SharedRandom {
    private static final Random RANDOM = lookUp();

    private SharedRandom() {
    }

    private static Random lookUp() {
        try {
            Field field = net.minecraft.util.Mth.class.getDeclaredField("RANDOM");
            field.setAccessible(true);
            return (Random) field.get(null);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    public static double next() {
        return RANDOM.nextDouble();
    }
}
