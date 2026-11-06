package dev.mcpn.recorder.mc;

import java.util.Random;

/**
 * What before 1.14 draws from Math.random draws from this, seeded each case: Mth has no random of its own in 1.8. The
 * client and the server each have one, so how their draws interleave does not show in either.
 */
public final class SharedRandom {
    private static final Random CLIENT = new Random();
    private static final Random SERVER = new Random();

    private SharedRandom() {
    }

    static void seed(long seed) {
        CLIENT.setSeed(seed);
        SERVER.setSeed(~seed);
    }

    public static double next() {
        return (Thread.currentThread().getName().equals("Server thread") ? SERVER : CLIENT).nextDouble();
    }
}
