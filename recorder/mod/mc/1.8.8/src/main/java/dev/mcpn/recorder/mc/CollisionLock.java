package dev.mcpn.recorder.mc;

/** Before 1.9 a block works out its boxes on its own bounds, on the one object the client and the integrated server share. */
public final class CollisionLock {
    public static final Object LOCK = new Object();

    private CollisionLock() {
    }
}
