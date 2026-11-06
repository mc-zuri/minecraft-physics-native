package dev.mcpn.recorder;

import com.google.gson.Gson;
import dev.mcpn.recorder.model.Scenario;
import dev.mcpn.recorder.schema.PlayerFields;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

/**
 * One scenario, driven by the client tick (Recorder calls {@link #tickStart} at Minecraft.tick
 * HEAD and {@link #tickEnd} at its TAIL):
 *
 * <pre>PREPARE -> SYNC -> SETTLE -> SETUP -> WAIT_START -> BODY -> DONE</pre>
 *
 * <ol>
 *   <li>PREPARE (server): reset the player, rebuild the area at the origin, capture it, teleport to the start.</li>
 *   <li>SYNC: until the client holds every block the server captured and every chunk in view, and the teleport arrived.</li>
 *   <li>SETTLE: until the player has rested on the ground for {@link #SETTLE_TICKS} ticks.</li>
 *   <li>SETUP (server): align timers and randomness, apply the setup, teleport exactly to the start.</li>
 *   <li>WAIT_START: until the teleport arrived (and the player stands, for a grounded start).</li>
 *   <li>BODY: the steps, one row per client tick.</li>
 * </ol>
 */
public final class ScenarioRunner {
    static final int SETTLE_TICKS = 5;
    static final int SYNC_MAX_TICKS = 400;
    static final int SETTLE_MAX_TICKS = 400;
    static final int MAX_RESETTLES = 3;
    /** A client's first case waits until the player has run normal ticks: it starts from a new player's defaults else. */
    static final int WARM_UP_TICKS = 40;
    private static boolean warmedUp;
    static final int START_MAX_TICKS = 200;
    static final double AREA_MARGIN = 2;
    private static final Gson GSON = new Gson();

    enum State { PREPARE, SYNC, SETTLE, SETUP, WAIT_START, BODY, DONE }

    private final Bridge bridge;
    private final Recorder recorder;
    final Scenario scenario;
    private final long seed;
    private State state = State.PREPARE;
    private int stateTicks;
    private long positionPacketsAtTeleport;
    private int stillTicks;
    private int resettles;
    private Json.Obj lastSnapshot;

    // body
    private RecordingWriter writer;
    private RecordingWriter.Row row;
    private int bodyTick;
    private int stepIndex;
    private int stepTicks;
    private boolean stepStarted;
    private final Set<String> held = new LinkedHashSet<>();
    private float yRot;
    private float xRot;
    private final Set<String> touched = new TreeSet<>();
    private int corrections;
    /** The path so far (area-local): highest and lowest feet y, the start, the horizontal distance from it. */
    private double highest = Double.NEGATIVE_INFINITY;
    private double lowest = Double.POSITIVE_INFINITY;
    private double[] startPos;
    private double distance;
    private String invalid;

    /** The outcome: "ok", "invalid", "skipped" or "error", and why. */
    String status;
    String reason;
    long startNanos = System.nanoTime();

    ScenarioRunner(Bridge bridge, Recorder recorder, Scenario scenario, long seed) {
        this.bridge = bridge;
        this.recorder = recorder;
        this.scenario = scenario;
        this.seed = seed;
    }

    boolean done() {
        return state == State.DONE;
    }

    boolean inBody() {
        return state == State.BODY;
    }

    boolean allowsScreens() {
        return scenario.features && state == State.BODY;
    }

    boolean recording() {
        return state == State.BODY && row != null;
    }

    RecordingWriter.Row row() {
        return row;
    }

    void correction() {
        if (state == State.BODY) {
            corrections++;
        }
    }

    private static final int DEAD_RETRY_TICKS = 40;
    /** What a crosshair step saw, for the next row. */
    private Json.Obj crosshair;

    private void enter(State next) {
        state = next;
        stateTicks = 0;
        stillTicks = 0;
    }

    private void finish(String status, String reason) {
        this.status = status;
        this.reason = reason;
        if (writer != null) {
            if ("ok".equals(status) || "invalid".equals(status)) {
                Json.Obj footer = new Json.Obj().str("status", status);
                if (reason != null) {
                    footer.str("reason", reason);
                }
                footer.raw("touched", Json.array(touched.stream().map(Json::str).toList()));
                footer.num("corrections", corrections);
                footer.num("wallMs", (System.nanoTime() - startNanos) / 1_000_000L);
                writer.finish(footer);
            } else {
                writer.abort();
            }
            writer = null;
        }
        row = null;
        bridge.applyKeys(Set.of());
        enter(State.DONE);
    }

    void abort(String why) {
        finish("error", why);
    }

    // ---------------------------------------------------------------------------------------------

    /** Minecraft.tick HEAD. */
    void tickStart() {
        stateTicks++;
        switch (state) {
            case PREPARE -> {
                if (bridge.playerDead()) {
                    if (stateTicks % DEAD_RETRY_TICKS == 1) {
                        Scenario.Client respawn = new Scenario.Client();
                        respawn.type = "respawn";
                        bridge.clientAction(respawn);
                    } else if (stateTicks > SETTLE_MAX_TICKS) {
                        finish("error", "the player never respawned");
                    }
                    return;
                }
                bridge.applyKeys(Set.of());
                // a case can end with the player riding. The teleport below moves a client still on its vehicle, whose
                // rideTick puts it straight back; the vehicle's removal reaches it only a tick later, and so the next case
                // starts where the vehicle was (before 1.19.4 no teleport follows the passengers packet: 1.13.2
                // TrackedEntityInstance.java:129, ClientPlayNetworkHandler.java:645, 859-866; 1.20.4
                // EntityTrackerEntry.java:84-88). So the client leaves the vehicle first.
                if ("true".equals(bridge.snapshot().get(PlayerFields.PASSENGER))) {
                    if (stateTicks > SETTLE_MAX_TICKS) {
                        finish("error", "the player never left its vehicle");
                    } else {
                        bridge.onServer(Bridge.ServerOps::dismount);
                    }
                    return;
                }
                bridge.setAutoJump(false);
                String[] skip = new String[1];
                bridge.onServer(ops -> {
                    skip[0] = ops.prepare(scenario);
                    if (skip[0] == null) {
                        ops.teleport(restPosition(), scenario.start.yRot, scenario.start.xRot);
                    }
                });
                if (skip[0] != null) {
                    finish("skipped", skip[0]);
                    return;
                }
                positionPacketsAtTeleport = recorder.positionPackets();
                enter(State.SYNC);
            }
            case SETUP -> {
                bridge.setAutoJump(scenario.setup.autoJump);
                bridge.selectSlot(scenario.setup.selectedSlot);
                bridge.alignClient(restPosition());
                // what the rest left must not decide when the body starts: a first tick after a far teleport can drift
                // before the floor arrives, and the server corrects it or not
                lastSnapshot = null;
                stillTicks = 0;
                String[] skip = new String[1];
                bridge.onServer(ops -> {
                    ops.align(seed);
                    // the start teleport before the setup: a teleport dismounts, and the setup mounts
                    ops.teleport(scenario.start.pos, scenario.start.yRot, scenario.start.xRot);
                    skip[0] = ops.setup(scenario);
                });
                if (skip[0] != null) {
                    finish("skipped", skip[0]);
                    return;
                }
                positionPacketsAtTeleport = recorder.positionPackets();
                yRot = scenario.start.yRot;
                xRot = scenario.start.xRot;
                enter(State.WAIT_START);
            }
            case BODY -> bodyTickStart();
            default -> {
            }
        }
    }

    /** Minecraft.tick TAIL. */
    void tickEnd() {
        switch (state) {
            case SYNC -> {
                String mismatch = bridge.clientMismatch();
                if (mismatch == null && recorder.positionPackets() > positionPacketsAtTeleport && bridge.chunksHeld()
                    && (warmedUp || stateTicks >= WARM_UP_TICKS)) {
                    warmedUp = true;
                    enter(State.SETTLE);
                } else if (stateTicks > SYNC_MAX_TICKS) {
                    finish("error", "the client never matched the server: " + (mismatch != null ? mismatch : bridge.chunksHeld() ? "no teleport" : "chunks in view never arrived"));
                }
            }
            case SETTLE -> {
                if (!scenario.start.settle) {
                    enter(State.SETUP);
                    return;
                }
                Json.Obj now = bridge.snapshot();
                boolean still = lastSnapshot != null && resting(now, lastSnapshot);
                lastSnapshot = now;
                stillTicks = still ? stillTicks + 1 : 0;
                if (stillTicks >= SETTLE_TICKS) {
                    if (resettles < MAX_RESETTLES && drifted(now)) {
                        // the first tick after a far teleport can run before the floor arrives: the player moved a little
                        // and the server may or may not have corrected it. It starts the setup from the exact rest.
                        resettles++;
                        lastSnapshot = null;
                        stillTicks = 0;
                        bridge.onServer(ops -> ops.teleport(restPosition(), scenario.start.yRot, scenario.start.xRot));
                        positionPacketsAtTeleport = recorder.positionPackets();
                        enter(State.SYNC);
                        return;
                    }
                    enter(State.SETUP);
                } else if (stateTicks > SETTLE_MAX_TICKS) {
                    finish("error", "the player never came to rest at the start");
                }
            }
            case WAIT_START -> {
                if (recorder.positionPackets() <= positionPacketsAtTeleport) {
                    if (stateTicks > START_MAX_TICKS) {
                        finish("error", "the start teleport never arrived");
                    }
                    return;
                }
                Json.Obj now = bridge.snapshot();
                boolean mounted = scenario.setup.mount != null;
                if (mounted && !"true".equals(now.get(PlayerFields.PASSENGER))) {
                    if (stateTicks > START_MAX_TICKS) {
                        finish("error", "the player never sat on its mount");
                    }
                    return;
                }
                boolean rests = lastSnapshot != null && resting(now, lastSnapshot);
                lastSnapshot = now;
                stillTicks = rests ? stillTicks + 1 : 0;
                boolean ready;
                if (mounted) {
                    // a mount settles where it stands; one that never comes to rest (a boat bobbing) starts anyway
                    ready = !scenario.start.settle || stillTicks >= SETTLE_TICKS || stateTicks > START_MAX_TICKS;
                } else {
                    ready = !scenario.start.grounded || stillTicks >= 2;
                }
                if (ready) {
                    if (scenario.start.vel != null) {
                        bridge.onServer(ops -> ops.velocity(scenario.start.vel));
                    }
                    bridge.alignStart();
                    startBody();
                } else if (stateTicks > START_MAX_TICKS) {
                    finish("error", "the player did not stand at the start");
                }
            }
            case BODY -> bodyTickEnd();
            default -> {
            }
        }
    }

    /** The player rests: it has not moved horizontally, and rose or fell less than {@link #REST_DY} (on a slime block it bounces a hair every tick). */
    static final double REST_DY = 0.1;

    private boolean resting(Json.Obj now, Json.Obj before) {
        Conditions.View a = new Conditions.View(now, Set.of(), bridge.origin());
        Conditions.View b = new Conditions.View(before, Set.of(), bridge.origin());
        double[] p = a.vec(PlayerFields.POS);
        double[] q = b.vec(PlayerFields.POS);
        return p[0] == q[0] && p[2] == q[2] && Math.abs(p[1] - q[1]) < REST_DY;
    }

    /** Whether the player rests off the exact rest position, across the ground. */
    private boolean drifted(Json.Obj now) {
        double[] p = new Conditions.View(now, Set.of(), bridge.origin()).vec(PlayerFields.POS);
        double[] rest = restPosition();
        int[] origin = bridge.origin();
        return p[0] != origin[0] + rest[0] || p[2] != origin[2] + rest[2];
    }

    private double[] restPosition() {
        return scenario.start.rest != null ? scenario.start.rest : scenario.start.pos;
    }

    // ---------------------------------------------------------------------------------------------
    // body

    private void startBody() {
        bridge.clearPassengerVelocity();
        Json.Obj header = recorder.header(scenario);
        writer = new RecordingWriter(recorder.outputFile(scenario), header);
        enter(State.BODY);
        bodyTick = 0;
        stepIndex = 0;
        stepStarted = false;
        held.clear();
        recorder.clearPending();
    }

    private void bodyTickStart() {
        // instant steps, until one that takes this tick
        while (stepIndex < scenario.body.size()) {
            Scenario.Step step = scenario.body.get(stepIndex);
            if (!TICKING.contains(step.op)) {
                if (!instant(step)) {
                    return;
                }
                stepIndex++;
                continue;
            }
            if (!stepStarted) {
                stepStarted = true;
                stepTicks = 0;
                stillTicks = 0;
                if ("press".equals(step.op)) {
                    held.addAll(step.keys);
                }
                if (!"until".equals(step.op) && !"stable".equals(step.op) && !"stopped".equals(step.op) && step.ticks == 0) {
                    if ("press".equals(step.op)) {
                        step.keys.forEach(held::remove);
                    }
                    stepStarted = false;
                    stepIndex++;
                    continue;
                }
            }
            if ("turn".equals(step.op)) {
                yRot += step.dyRot / step.ticks;
                xRot += step.dxRot / step.ticks;
            }
            break;
        }
        if (stepIndex >= scenario.body.size()) {
            complete();
            return;
        }
        bridge.applyKeys(held);
        bridge.applyRotation(yRot, xRot);
        row = new RecordingWriter.Row();
        row.t = bodyTick;
        if (crosshair != null) {
            row.extra.obj("crosshair", crosshair);
            crosshair = null;
        }
        recorder.beginRow(row);
        row.pre = bridge.snapshot();
        if (startPos == null) {
            // the path starts where the body starts, not after its first tick
            trackPos(new Conditions.View(row.pre, java.util.Set.of(), bridge.origin()).vec(PlayerFields.POS));
        }
        row.input = new Json.Obj()
            .raw("keys", Json.array(held.stream().map(Json::str).toList()))
            .num("yRot", yRot).num("xRot", xRot);
    }

    private static final Set<String> TICKING = Set.of("press", "turn", "ticks", "until", "stable", "stopped", "screen");
    /** stable: the velocity changed less than this on each axis (physics-data-generator's STABLE_DELTA). */
    static final double STABLE_DELTA = 0.01;
    /** stopped: the position moved less than this on every axis (physics-data-generator's STILL). */
    static final double STILL = 1.0E-7;

    /** Runs an instant step; false when it ended the scenario (skipped). */
    private boolean instant(Scenario.Step step) {
        switch (step.op) {
            case "hold" -> held.addAll(step.keys);
            case "release" -> step.keys.forEach(held::remove);
            case "releaseAll" -> held.clear();
            case "look" -> {
                yRot = step.yRot;
                xRot = step.xRot;
            }
            case "selectSlot" -> bridge.selectSlot(step.slot);
            case "client" -> {
                if (step.client.at != null) {
                    int[] origin = bridge.origin();
                    step.client.world = new int[] {origin[0] + step.client.at[0], origin[1] + step.client.at[1], origin[2] + step.client.at[2]};
                }
                if ("crosshair".equals(step.client.type)) {
                    crosshair = bridge.crosshair();
                }
                bridge.clientAction(step.client);
            }
            case "server" -> {
                String[] skip = new String[1];
                bridge.onServer(ops -> skip[0] = ops.action(step.action));
                if (skip[0] != null) {
                    finish("skipped", skip[0]);
                    return false;
                }
                if ("kick".equals(step.action.op)) {
                    // the case ends with the connection, and how soon the client notices is a race
                    finish("ok", null);
                    return false;
                }
            }
            default -> throw new IllegalArgumentException("unknown step " + step.op);
        }
        return true;
    }

    private void bodyTickEnd() {
        if (row == null) {
            return;
        }
        row.post = bridge.snapshot();
        recorder.endRow(row);
        writer.row(row);
        Conditions.View view = new Conditions.View(row.post, bridge.contacts(), bridge.origin());
        view.fishBiting = bridge::fishBiting;
        touched.addAll(view.contacts);
        trackPath(view);
        checkArea(row.post);
        row = null;
        bodyTick++;
        if (invalid != null) {
            finish("invalid", invalid);
            return;
        }
        Scenario.Step step = scenario.body.get(stepIndex);
        stepTicks++;
        boolean next = switch (step.op) {
            case "press" -> {
                if (stepTicks >= step.ticks) {
                    step.keys.forEach(held::remove);
                    // (seen now: a press of the same key in the next step is another click, not more of this one)
                    bridge.applyKeys(held);
                    yield true;
                }
                yield false;
            }
            case "turn", "ticks" -> stepTicks >= step.ticks;
            case "screen" -> {
                if (bridge.screen().startsWith(step.screen)) {
                    yield true;
                }
                if (stepTicks >= step.max) {
                    if (!step.soft) {
                        finish("invalid", "screen " + step.screen + " did not open within " + step.max + " ticks: " + bridge.screen());
                        yield false;
                    }
                    yield true;
                }
                yield false;
            }
            case "until" -> {
                if (Conditions.test(step.cond, view)) {
                    yield true;
                }
                if (stepTicks >= step.max) {
                    if (!step.soft) {
                        finish("invalid", "until " + GSON.toJson(step.cond) + " did not hold within " + step.max + " ticks");
                        yield false;
                    }
                    yield true;
                }
                yield false;
            }
            case "stable", "stopped" -> {
                boolean done;
                if (lastSnapshot == null) {
                    done = false;
                } else if ("stable".equals(step.op)) {
                    // the velocity no longer changes (a flow carrying the player counts); on the ground the vertical
                    // velocity need not settle (slime flips it every tick)
                    double[] v = view.vec(PlayerFields.VEL);
                    double[] w = new Conditions.View(lastSnapshot, Set.of(), bridge.origin()).vec(PlayerFields.VEL);
                    done = stepTicks >= Math.max(1, step.ticks) && Math.abs(v[0] - w[0]) < STABLE_DELTA && Math.abs(v[2] - w[2]) < STABLE_DELTA
                        && ("true".equals(view.snapshot.get(PlayerFields.ON_GROUND)) || Math.abs(v[1] - w[1]) < STABLE_DELTA);
                } else {
                    double[] p = view.vec(PlayerFields.POS);
                    double[] q = new Conditions.View(lastSnapshot, Set.of(), bridge.origin()).vec(PlayerFields.POS);
                    boolean still = Math.max(Math.abs(p[0] - q[0]), Math.max(Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]))) < STILL;
                    stillTicks = still ? stillTicks + 1 : 0;
                    done = stillTicks >= Math.max(1, step.ticks);
                }
                if (done) {
                    yield true;
                }
                if (stepTicks >= step.max) {
                    if (step.soft) {
                        yield true;
                    }
                    finish("invalid", "not " + step.op + " within " + step.max + " ticks");
                }
                yield false;
            }
            default -> false;
        };
        lastSnapshot = view.snapshot;
        if (state != State.BODY) {
            return;
        }
        if (next) {
            stepIndex++;
            stepStarted = false;
            stillTicks = 0;
        }
    }

    private void trackPath(Conditions.View view) {
        trackPos(view.vec(PlayerFields.POS));
        view.path(highest, lowest, distance);
    }

    private void trackPos(double[] pos) {
        int[] origin = bridge.origin();
        double[] local = {pos[0] - origin[0], pos[1] - origin[1], pos[2] - origin[2]};
        if (startPos == null) {
            startPos = local;
        }
        highest = Math.max(highest, local[1]);
        lowest = Math.min(lowest, local[1]);
        distance = Math.hypot(local[0] - startPos[0], local[2] - startPos[2]);
    }

    private void checkArea(Json.Obj post) {
        Conditions.View view = new Conditions.View(post, Set.of(), bridge.origin());
        double[] pos = view.vec(PlayerFields.POS);
        int[] origin = bridge.origin();
        int[] box = scenario.area.box;
        boolean inside = true;
        for (int axis = 0; axis < 3; axis++) {
            double rel = pos[axis] - origin[axis];
            inside &= rel >= box[axis] - AREA_MARGIN && rel <= box[axis + 3] + 1 + AREA_MARGIN;
        }
        if (!Double.isFinite(pos[0] + pos[1] + pos[2])) {
            invalid = "the position is not finite";
        } else if (!inside && scenario.expect.stream().anyMatch(e -> "staysInArea".equals(e.op))) {
            invalid = "the player left the area";
        }
    }

    private void complete() {
        List<String> failed = new ArrayList<>();
        for (Scenario.Expectation e : scenario.expect) {
            switch (e.op) {
                case "touched" -> {
                    if (!touched.contains(e.how + ":" + e.block)) {
                        failed.add("never " + e.how + " " + e.block);
                    }
                }
                case "corrections" -> {
                    if (!e.allowed && corrections > 0) {
                        failed.add(corrections + " server correction(s)");
                    }
                }
                case "final" -> {
                    if (lastSnapshot != null && !Conditions.test(e.cond, new Conditions.View(lastSnapshot, bridge.contacts(), bridge.origin())
                        .path(highest, lowest, distance))) {
                        failed.add("final condition " + GSON.toJson(e.cond) + " does not hold");
                    }
                }
                default -> {
                }
            }
        }
        if (corrections > 0 && scenario.expect.stream().noneMatch(e -> "corrections".equals(e.op))) {
            failed.add(corrections + " server correction(s)");
        }
        finish(failed.isEmpty() ? "ok" : "invalid", failed.isEmpty() ? null : String.join("; ", failed));
    }
}
