package dev.mcpn.recorder;

import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.locks.LockSupport;
import java.util.function.BooleanSupplier;

/**
 * Lockstep between the client and its integrated server (ported from physics-data-generator's
 * dev.physrec.Lockstep). Neither waits for the 50 ms clock; each round is one client tick, then
 * one server tick:
 *
 * <ol>
 *   <li>The client ticks once every packet of the server's last tick has reached it. The frame
 *   that ticks handles those packets and its queued tasks, then runs Minecraft.tick, where the
 *   recorder applies the input and records the state. Frames that do not tick handle nothing.
 *   The server runs nothing while the client handles those packets ({@link #holdServer}).</li>
 *   <li>The server ticks once every packet the client sent up to the end of its tick has reached
 *   it and the tasks the client gave it are done.</li>
 * </ol>
 *
 * <p>Arrival is counted on the connections ({@link Counted}): packets one end sent against packets
 * the other end received; no packet is added. A side waiting for the other spins briefly, then
 * parks; the other side unparks it when it publishes its round and again when the last packet of
 * the round arrives ({@link #packetArrived}), so a round costs the two ticks' work, not a park
 * granularity (at least 1 ms on Windows).
 *
 * <p>Unlike physics-data-generator, a timeout does not fall back to real time: real-time ticking
 * would make the recording nondeterministic, so the client fails ({@link #failure}) and the runner
 * gives its remaining scenarios to a new one.
 */
public final class Lockstep {
    public static final boolean ENABLED = !"false".equals(System.getProperty("recorder.lockstep"));
    private static final long TIMEOUT_NANOS = Long.getLong("recorder.lockstep.timeoutMs", 60000L) * 1_000_000L;
    private static final long FRAME_NANOS = Long.getLong("recorder.lockstep.frameMs", 250L) * 1_000_000L;
    /** How long one frame waits for the round before it returns to the loop (which polls window events). */
    private static final long FRAME_WAIT_NANOS = 20_000_000L;
    /** How many frames of the other side a failure says. */
    private static final int STUCK_FRAMES = 6;
    /** How long a client waits for the server to stop between two tasks. */
    private static final long HOLD_WAIT_NANOS = 1_000_000_000L;
    /** How long a waiting side spins before it parks. */
    private static final long SPIN_NANOS = Long.getLong("recorder.lockstep.spinMicros", 100L) * 1_000L;

    /** A connection's packet counts (each adapter's connection mixin). */
    public interface Counted {
        long recorder$sent();

        long recorder$received();

        boolean recorder$open();
    }

    /** The integrated server as lockstep needs it (each adapter's LockstepServer). */
    public interface Server {
        /** The only player's connection, a {@link Counted} memory connection, or null. */
        Object playerConnection();

        int pendingTasks();

        /** Runs the server's queued tasks until done is true, parking between them (an unpark wakes it). */
        void runTasksUntil(BooleanSupplier done);

        /**
         * Whether the light engine, which runs on its own thread, has caught up: a block tick reads the light (a frosted
         * block melts by it), so a round must not start on a light that may or may not have arrived.
         */
        boolean lightIdle();
    }

    private static volatile boolean engaged;
    private static volatile Runnable beforeServerTick;
    private static volatile int generation;
    private static volatile String failure;
    private static volatile Counted clientConnection;
    private static volatile Counted serverConnection;
    private static volatile long clientFence;
    private static volatile long clientRoundDone;
    private static volatile long serverFence;
    private static volatile long serverRoundDone;
    private static volatile boolean serverHeld;
    private static volatile boolean serverHolding;
    private static volatile long answersSent;
    private static volatile long answersHandled;
    private static volatile Thread clientThread;
    private static volatile Thread serverThread;
    private static volatile long serverTaskSteps;

    // client thread
    private static boolean clientEngaged;
    /** The server loop's clock under lockstep, before 1.13. */
    private static long serverClock;
    private static int clientGeneration;
    private static long clientRound;
    private static boolean tickThisFrame;
    private static long sentBeforeFrame;
    private static long lastFrame;
    private static long roundStart;
    private static long clientWaitNanos;
    private static long statsTicks;
    private static long statsStart;

    // server thread
    private static boolean afterTick;
    private static long serverRound;
    private static long serverWaitNanos;

    private Lockstep() {
    }

    /** Why lockstep failed (the run must stop), or null. */
    public static String failure() {
        return failure;
    }

    /** Client thread: whether this frame's loop runs under lockstep. */
    public static boolean engaged() {
        return clientEngaged;
    }

    /** Rounds per second and waits so far, for the runner's heartbeat. */
    public static Json.Obj stats() {
        double seconds = Math.max(1e-9, (System.nanoTime() - statsStart) / 1e9);
        return new Json.Obj().num("rounds", statsTicks).num("roundsPerSecond", Math.round(statsTicks / seconds))
            .num("serverTaskSteps", serverTaskSteps)
            .num("clientWaitMs", statsTicks == 0 ? 0.0 : clientWaitNanos / 1e6 / statsTicks)
            .num("serverWaitMs", statsTicks == 0 ? 0.0 : serverWaitNanos / 1e6 / statsTicks);
    }

    /**
     * Client thread, where the loop reads the clock: the number of ticks to run, given vanilla's.
     * Under lockstep 1 once the server's last tick has fully arrived, else 0 after a short wait.
     */
    public static int clientTicks(Object connection, boolean canStart, int vanilla) {
        tickThisFrame = false;
        releaseServer();
        if (!ENABLED || failure != null) {
            clientEngaged = false;
            return failure != null ? 0 : vanilla;
        }
        clientThread = Thread.currentThread();
        Counted counted = connection instanceof Counted c && c.recorder$open() ? c : null;
        if (counted == null) {
            if (clientConnection != null) {
                stop("the client left the world");
            }
            clientEngaged = false;
            return vanilla;
        }
        if (clientConnection != counted) {
            if (!canStart) {
                return vanilla;
            }
            clientConnection = counted;
        }
        if (!engaged) {
            clientEngaged = false;
            return vanilla;
        }
        if (!clientEngaged || clientGeneration != generation) {
            clientEngaged = true;
            clientGeneration = generation;
            clientRound = 0;
            roundStart = System.nanoTime();
            statsStart = roundStart;
            statsTicks = 0;
            clientWaitNanos = 0;
            Log.info("lockstep on: the client and the integrated server tick in turn");
        }
        long waitStart = System.nanoTime();
        while (!clientMayTick(counted)) {
            long now = System.nanoTime();
            if (!engaged) {
                clientEngaged = false;
                return 0;
            }
            if (now - roundStart > TIMEOUT_NANOS) {
                fail(String.format(Locale.ROOT, "the server has not finished round %d in %d ms (round %d done, %d of %d packets)%s",
                    clientRound, (now - roundStart) / 1_000_000L, serverRoundDone, counted.recorder$received(), serverFence, stuckAt(serverThread)));
                return 0;
            }
            if (now - waitStart > FRAME_WAIT_NANOS) {
                clientWaitNanos += now - waitStart;
                return 0;
            }
            if (now - waitStart < SPIN_NANOS) {
                Thread.onSpinWait();
            } else {
                LockSupport.parkNanos(200_000L);
            }
        }
        clientWaitNanos += System.nanoTime() - waitStart;
        tickThisFrame = true;
        holdServer();
        return 1;
    }

    /**
     * Client thread, before it handles the server's last tick: what it answers there (a vehicle's move, 26.3
     * ClientPacketListener.java:1988) the server may answer in turn (ServerGamePacketListenerImpl.java:509), and that
     * reached this same frame or the next by how far the frame had got: first difference of pm_ride_horse_lifted on
     * 26.2 and pm_ride_boat_lifted on 26.1.2. Held, the server handles the answer once the frame's packets are done, and
     * what it says goes with the next round, as it nearly always did. The tick waits for that ({@link #releaseServer}): an
     * answer that came after a server task of the tick's start was a different case (1.8.8's mv_top_stone_neg_in_1e7, the
     * client's echo of a correction after the start teleport, two more moves of the server's player).
     */
    private static void holdServer() {
        Counted connection = clientConnection;
        sentBeforeFrame = connection != null ? connection.recorder$sent() : 0;
        serverHeld = true;
        LockSupport.unpark(serverThread);
        long start = System.nanoTime();
        while (!serverHolding && engaged && failure == null && System.nanoTime() - start < HOLD_WAIT_NANOS) {
            Thread.onSpinWait();
        }
    }

    /** Client thread: the frame's packets are handled ({@link #holdServer}). */
    public static void releaseServer() {
        if (!serverHeld) {
            return;
        }
        Counted connection = clientConnection;
        long sent = connection != null ? connection.recorder$sent() : sentBeforeFrame;
        answersSent = sent;
        serverHeld = false;
        LockSupport.unpark(serverThread);
        if (sent == sentBeforeFrame) {
            return;
        }
        long start = System.nanoTime();
        while (answersHandled < sent && engaged && failure == null && System.nanoTime() - start < HOLD_WAIT_NANOS) {
            Thread.onSpinWait();
        }
    }

    /** Server thread, between its tasks. */
    private static void awaitRelease() {
        if (!serverHeld) {
            return;
        }
        serverHolding = true;
        long start = System.nanoTime();
        while (serverHeld && engaged && failure == null && System.nanoTime() - start < TIMEOUT_NANOS) {
            LockSupport.parkNanos(50_000L);
        }
        serverHolding = false;
    }

    /** Server thread, between its tasks: everything the client sent up to its release is handled. */
    private static void noteAnswers(Server server) {
        long sent = answersSent;
        if (answersHandled < sent && serverConnection.recorder$received() >= sent && server.pendingTasks() == 0) {
            answersHandled = sent;
        }
    }

    private static boolean clientMayTick(Counted connection) {
        return serverRoundDone >= clientRound && connection.recorder$received() >= serverFence;
    }

    /** Client thread: the frame handles packets and tasks (under lockstep only the frames that tick). */
    public static boolean clientFrameWork() {
        return !clientEngaged || tickThisFrame;
    }

    /** Client thread, after Minecraft.tick in the loop: the client's half of the round is done. */
    public static void clientTicked() {
        if (!clientEngaged || !tickThisFrame) {
            return;
        }
        clientRound++;
        Counted connection = clientConnection;
        if (connection != null) {
            clientFence = connection.recorder$sent();
        }
        clientRoundDone = clientRound;
        LockSupport.unpark(serverThread);
        roundStart = System.nanoTime();
        statsTicks++;
    }

    /**
     * Netty thread, after a connection received a packet: wakes the side waiting for it once the
     * other side's round has fully arrived.
     */
    public static void packetArrived(Counted connection) {
        if (!engaged) {
            return;
        }
        if (connection == clientConnection) {
            if (connection.recorder$received() >= serverFence) {
                LockSupport.unpark(clientThread);
            }
        } else if (connection == serverConnection && connection.recorder$received() >= clientFence) {
            LockSupport.unpark(serverThread);
        }
    }

    /** Client thread, where the frame is shown: skip it (every frame but one each recorder.lockstep.frameMs). */
    public static boolean skipFrame(boolean render) {
        if (!clientEngaged || render) {
            return false;
        }
        long now = System.nanoTime();
        if (now - lastFrame < FRAME_NANOS) {
            return true;
        }
        lastFrame = now;
        return false;
    }

    /** Client thread: the frame limiter's sleep is skipped. */
    public static boolean skipFrameLimit() {
        return clientEngaged;
    }

    /** Client thread: whether this frame ran a lockstep tick. */
    public static boolean tickedThisFrame() {
        return clientEngaged && tickThisFrame;
    }

    /**
     * Client thread: under lockstep the server runs the task at once (it waits for the round), so wait for it. The budget
     * is for a task that stops moving ({@link #serverTaskStep}): a first use of a wide area generates and lights its
     * chunks in the one task, which took 69 s on an idle 1.15.2 and was not stuck.
     */
    public static void awaitServerTask(CompletableFuture<?> task) {
        if (!clientEngaged || !engaged) {
            return;
        }
        releaseServer();
        LockSupport.unpark(serverThread);
        long step = serverTaskSteps;
        long stepStart = System.nanoTime();
        while (true) {
            try {
                task.get(1L, TimeUnit.SECONDS);
                return;
            } catch (ExecutionException e) {
                // the caller reads the failure from the future
                return;
            } catch (TimeoutException e) {
                long now = System.nanoTime();
                if (serverTaskSteps != step) {
                    step = serverTaskSteps;
                    stepStart = now;
                } else if (now - stepStart > TIMEOUT_NANOS) {
                    fail("a server task has not moved in " + TIMEOUT_NANOS / 1_000_000L + " ms" + stuckAt(serverThread));
                    return;
                }
                // (this thread is the one that says the client is alive)
                Recorder.get().waiting();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    /** Server thread, in a long task: it has got further, which a client waiting for it counts as alive. */
    public static void serverTaskStep() {
        serverTaskSteps = serverTaskSteps + 1;
    }

    /** Server thread, after each tick of the run loop. */
    public static void serverTicked() {
        if (!ENABLED) {
            return;
        }
        serverThread = Thread.currentThread();
        afterTick = true;
        if (engaged) {
            serverFence = serverConnection.recorder$sent();
            serverRoundDone = serverRound;
            LockSupport.unpark(clientThread);
        }
    }

    /**
     * Server thread, where a run loop that catches up with its clock reads it (before 1.13): under lockstep it moves one
     * tick a read, so the loop runs one tick each time round.
     */
    public static long serverClock(long real) {
        if (!clientEngaged) {
            serverClock = 0;
            return real;
        }
        serverClock = serverClock == 0 ? real : serverClock + 50L;
        return serverClock;
    }

    /**
     * Server thread, where the run loop waits for its clock after a tick: true when lockstep did
     * the wait (the next tick is due now), false for vanilla's wait.
     */
    public static boolean serverGate(Server server) {
        if (!ENABLED) {
            return false;
        }
        serverThread = Thread.currentThread();
        boolean tickWait = afterTick;
        afterTick = false;
        if (!tickWait || failure != null) {
            return false;
        }
        if (!engaged && !start(server)) {
            return false;
        }
        long waitStart = System.nanoTime();
        boolean[] ready = new boolean[1];
        long[] step = {serverTaskSteps};
        long[] moved = {waitStart};
        server.runTasksUntil(() -> {
            awaitRelease();
            if (!engaged || !serverConnection.recorder$open()) {
                return true;
            }
            noteAnswers(server);
            ready[0] = serverMayTick(server);
            // (the client's server tasks run in this wait: the budget starts again where a long one moved last)
            long now = System.nanoTime();
            if (serverTaskSteps != step[0]) {
                step[0] = serverTaskSteps;
                moved[0] = now;
            }
            return ready[0] || now - moved[0] > TIMEOUT_NANOS;
        });
        long waited = System.nanoTime() - waitStart;
        if (!engaged) {
            return false;
        }
        if (!serverConnection.recorder$open()) {
            stop("the player's connection closed");
            return false;
        }
        if (!ready[0]) {
            fail(String.format(Locale.ROOT, "the client has not finished round %d in %d ms (round %d done, %d of %d packets, %d tasks, light %s)%s",
                serverRound + 1, waited / 1_000_000L, clientRoundDone, serverConnection.recorder$received(), clientFence,
                server.pendingTasks(), server.lightIdle() ? "idle" : "busy", stuckAt(clientThread)));
            return false;
        }
        serverRound++;
        serverWaitNanos += waited;
        Runnable before = beforeServerTick;
        if (before != null) {
            beforeServerTick = null;
            before.run();
        }
        return true;
    }

    /**
     * Runs a task on the server thread once it has handled everything the client sent, right before its tick: a task
     * posted the usual way races the client's last packets to the server's queue. False when there is no lockstep.
     */
    public static boolean beforeNextServerTick(Runnable task) {
        if (!engaged) {
            return false;
        }
        beforeServerTick = task;
        return true;
    }

    private static boolean serverMayTick(Server server) {
        return clientRoundDone > serverRound && serverConnection.recorder$received() >= clientFence
            && server.pendingTasks() == 0 && server.lightIdle();
    }

    private static boolean start(Server server) {
        if (clientConnection == null || !(server.playerConnection() instanceof Counted own) || !own.recorder$open()) {
            return false;
        }
        serverConnection = own;
        serverRound = 0;
        serverWaitNanos = 0;
        clientFence = 0;
        clientRoundDone = 0;
        answersSent = 0;
        answersHandled = 0;
        serverFence = own.recorder$sent();
        serverRoundDone = 0;
        generation++;
        engaged = true;
        LockSupport.unpark(clientThread);
        return true;
    }

    private static void stop(String why) {
        if (engaged || clientEngaged) {
            Log.info("lockstep off: %s (%s)", why, stats().text());
        }
        engaged = false;
        clientConnection = null;
        LockSupport.unpark(serverThread);
    }

    /** Where the other side is, for the failure: load shows as work under way, a hang as a wait. */
    private static String stuckAt(Thread thread) {
        if (thread == null) {
            return "";
        }
        StackTraceElement[] stack = thread.getStackTrace();
        StringBuilder all = new StringBuilder(thread.getName());
        StringBuilder top = new StringBuilder();
        for (int i = 0; i < stack.length; i++) {
            all.append("\n\tat ").append(stack[i]);
            if (i < STUCK_FRAMES) {
                top.append(i == 0 ? "" : " < ").append(stack[i].getClassName()).append('.').append(stack[i].getMethodName());
            }
        }
        Log.info("the other side: %s", all);
        return "; " + thread.getName() + " at " + top;
    }

    private static void fail(String why) {
        failure = why;
        Log.info("lockstep failed: %s", why);
        stop(why);
    }
}
