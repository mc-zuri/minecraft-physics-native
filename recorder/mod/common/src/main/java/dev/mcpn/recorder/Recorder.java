package dev.mcpn.recorder;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.mcpn.recorder.model.Scenario;
import dev.mcpn.recorder.schema.Phases;
import dev.mcpn.recorder.schema.PlayerFields;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.AbstractMap;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

/**
 * The recorder: starts the world, runs the scenarios one after the other, and assembles each
 * client tick's row from what the adapter's hooks report: server packets handled before the tick
 * ({@link #beforeHandle}/{@link #afterHandle}), phase snapshots inside it ({@link #phase}), packets
 * the client sent ({@link #sent}) and the server's tick before it ({@link #serverTicked}).
 *
 * <p>Properties (-Drecorder.*): scenarios (the build's out/scenarios/&lt;version&gt; directory),
 * out (recordings directory), filter (id globs, comma separated), shard and shards (this client
 * runs every shards-th scenario from shard), exit (default true), render (default false).
 */
public final class Recorder {
    public static final String SCHEMA = "1";
    private static final Gson GSON = new Gson();
    private static final int WARMUP_TICKS = 20;

    private static Recorder instance;

    private final Bridge bridge;
    private final Path out;
    private final List<Scenario> scenarios;
    private final Deque<Scenario> queue;
    private final AtomicLong seq = new AtomicLong();
    private final AtomicLong positionPackets = new AtomicLong();
    public final boolean render = Boolean.getBoolean("recorder.render");
    private final boolean exit = !"false".equals(System.getProperty("recorder.exit"));

    private enum Stage { TITLE, LOADING, WARMUP, RUNNING, FINISHED }

    private Stage stage = Stage.TITLE;
    private int stageTicks;
    private ScenarioRunner runner;
    private int index;
    private int ok;
    private int invalid;
    private int skipped;
    private int errors;
    private long lastHeartbeat;

    // the tick being recorded (client thread)
    private RecordingWriter.Row row;
    private final List<RecordingWriter.PacketIn> pendingS2c = new ArrayList<>();
    /** Packets the client sent between ticks (responses while handling server packets). */
    private final List<RecordingWriter.PacketOut> pendingC2s = new ArrayList<>();
    /** Blocks the server changed on the client since the last row: [x, y, z, "state"] as JSON text. */
    private final List<String> pendingBlocks = new ArrayList<>();
    private boolean blocksTaken;
    private String phase = Phases.BETWEEN_TICKS;
    private Long handling;
    private boolean inTravel;
    private Set<String> fieldsWritten;

    // the server's tick (server thread writes, client thread reads; lockstep orders them)
    private volatile String pendingServer;
    /** The corrections of the server tick in pendingServer: they go to the row its view goes to. */
    private volatile String pendingCorrections;
    private final StringBuilder serverCorrections = new StringBuilder();

    private Recorder(Bridge bridge) {
        this.bridge = bridge;
        Path dir = Path.of(System.getProperty("recorder.scenarios", "scenarios"));
        this.out = Path.of(System.getProperty("recorder.out", "recordings"));
        this.scenarios = load(dir);
        this.queue = new ArrayDeque<>(scenarios);
        Log.info("%d scenario(s) from %s -> %s", scenarios.size(), dir, out);
    }

    public static void init(Bridge bridge) {
        instance = new Recorder(bridge);
    }

    /** The recorder, or null before init. */
    public static Recorder get() {
        return instance;
    }

    // ---------------------------------------------------------------------------------------------
    // loading

    private static List<Scenario> load(Path dir) {
        List<Scenario> all = new ArrayList<>();
        try {
            JsonObject index = JsonParser.parseString(Files.readString(dir.resolve("index.json"), StandardCharsets.UTF_8)).getAsJsonObject();
            Set<String> files = new TreeSet<>();
            for (var entry : index.getAsJsonArray("scenarios")) {
                files.add(entry.getAsJsonObject().get("file").getAsString());
            }
            for (String file : files) {
                all.addAll(Arrays.asList(GSON.fromJson(Files.readString(dir.resolve(file), StandardCharsets.UTF_8), Scenario[].class)));
            }
        } catch (IOException e) {
            throw new UncheckedIOException("no compiled scenarios in " + dir + " (node recorder/scenarios/build.ts)", e);
        }
        Pattern filter = glob(System.getProperty("recorder.filter", ""));
        int shard = Integer.getInteger("recorder.shard", 0);
        int shards = Integer.getInteger("recorder.shards", 1);
        Set<String> finished = finished();
        List<Scenario> selected = new ArrayList<>();
        int i = 0;
        for (Scenario s : all) {
            if (filter != null && !filter.matcher(s.id).matches()) {
                continue;
            }
            // a case that needs an experiment needs a world made with it (recorder.features), and such a world has it for
            // every case, so the two kinds run apart
            if (needsFeature(s) != !FEATURES.isEmpty()) {
                continue;
            }
            // (counted all the same: a new client has the shard the one it takes over from had)
            if (i++ % shards == shard && !finished.contains(s.id)) {
                selected.add(s);
            }
        }
        if (Boolean.getBoolean("recorder.shuffle")) {
            // a repeat in another order: what a case leaves behind for the next one shows as a difference
            java.util.Collections.shuffle(selected, new java.util.Random(shard + 1L));
        }
        // no world comes back after a case that ends the connection
        selected.sort(java.util.Comparator.comparing(s -> s.disconnects));
        return selected;
    }

    /** What a client that died got through, for the one taking over from it (recorder.skip, a file of ids). */
    private static Set<String> finished() {
        String file = System.getProperty("recorder.skip");
        try {
            return file == null ? Set.of() : Set.copyOf(Files.readAllLines(Path.of(file), StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static Pattern glob(String patterns) {
        if (patterns.isBlank()) {
            return null;
        }
        List<String> parts = new ArrayList<>();
        // as scenarios/build.ts idMatcher: ** any path, * within a segment, ? one character
        for (String p : patterns.split(",")) {
            StringBuilder regex = new StringBuilder();
            String glob = p.trim();
            for (int i = 0; i < glob.length(); i++) {
                char c = glob.charAt(i);
                if (c == '*' && i + 1 < glob.length() && glob.charAt(i + 1) == '*') {
                    regex.append(".*");
                    i++;
                } else if (c == '*') {
                    regex.append("[^/]*");
                } else if (c == '?') {
                    regex.append('.');
                } else {
                    regex.append(Pattern.quote(String.valueOf(c)));
                }
            }
            parts.add("(?:" + regex + ")");
        }
        return Pattern.compile(String.join("|", parts));
    }

    // ---------------------------------------------------------------------------------------------
    // the client tick

    /** Every frame once the lockstep has failed (no tick runs after it): ends the run as fatal, once. */
    public void lockstepFailed() {
        failRun("lockstep: " + Lockstep.failure());
    }

    /** Minecraft.tick HEAD. */
    public void tickStart() {
        Lockstep.releaseServer();
        stageTicks++;
        if (Lockstep.failure() != null) {
            failRun("lockstep: " + Lockstep.failure());
            return;
        }
        heartbeat();
        switch (stage) {
            case TITLE -> {
                if (bridge.readyToStartWorld()) {
                    Log.info("creating the world");
                    bridge.startWorld();
                    next(Stage.LOADING);
                }
            }
            case LOADING -> {
                if (bridge.inWorld()) {
                    next(Stage.WARMUP);
                }
            }
            case WARMUP -> {
                if (stageTicks >= WARMUP_TICKS && Lockstep.engaged()) {
                    bridge.onServer(Bridge.ServerOps::configureWorld);
                    Log.info("world configured, %s", Lockstep.ENABLED ? "lockstep engaged" : "real time");
                    next(Stage.RUNNING);
                } else if (stageTicks >= WARMUP_TICKS && !Lockstep.ENABLED) {
                    bridge.onServer(Bridge.ServerOps::configureWorld);
                    next(Stage.RUNNING);
                }
            }
            case RUNNING -> running();
            case FINISHED -> {
            }
        }
    }

    /** Minecraft.tick TAIL. */
    public void tickEnd() {
        if (stage == Stage.RUNNING && runner != null) {
            try {
                runner.tickEnd();
            } catch (RuntimeException e) {
                runner.abort(e.toString());
                Log.info("%s failed: %s", runner.scenario.id, e);
                e.printStackTrace(System.out);
            }
            if (runner.done()) {
                completed(runner);
                runner = null;
            }
        }
        phase = Phases.BETWEEN_TICKS;
        inTravel = false;
    }

    private void running() {
        String screen = screensAllowed() ? null : bridge.closeScreens();
        if (screen != null) {
            Log.info("closed screen %s", screen);
        }
        if (runner == null) {
            Scenario next = queue.poll();
            if (next == null) {
                finishRun();
                return;
            }
            index++;
            runner = new ScenarioRunner(bridge, this, next, seedOf(next));
            Log.event("start", new Json.Obj().str("id", next.id).num("index", index).num("total", scenarios.size()));
        }
        try {
            runner.tickStart();
        } catch (RuntimeException e) {
            runner.abort(e.toString());
            Log.info("%s failed: %s", runner.scenario.id, e);
            e.printStackTrace(System.out);
        }
        if (runner.done()) {
            boolean left = runner.scenario.disconnects;
            completed(runner);
            runner = null;
            if (left) {
                // no world comes back, and the client taking this one down waits on the server for ever
                for (Scenario rest = queue.poll(); rest != null; rest = queue.poll()) {
                    Log.event("result", new Json.Obj().str("id", rest.id).str("hash", rest.hash).str("status", "error")
                        .str("reason", "not run: an earlier case ended the connection"));
                    errors++;
                }
                finishRun();
            }
        }
    }

    private static long seedOf(Scenario s) {
        return s.id.hashCode() * 0x9E3779B97F4A7C15L ^ 42L;
    }

    private void completed(ScenarioRunner r) {
        switch (r.status) {
            case "ok" -> ok++;
            case "invalid" -> invalid++;
            case "skipped" -> skipped++;
            default -> errors++;
        }
        Json.Obj event = new Json.Obj().str("id", r.scenario.id).str("hash", r.scenario.hash).str("status", r.status)
            .num("wallMs", (System.nanoTime() - r.startNanos) / 1_000_000L);
        if (r.reason != null) {
            event.str("reason", r.reason);
        }
        Log.event("result", event);
        row = null;
        pendingS2c.clear();
    }

    private void finishRun() {
        next(Stage.FINISHED);
        Json.Obj summary = new Json.Obj().num("ok", ok).num("invalid", invalid).num("skipped", skipped).num("errors", errors);
        summary.obj("lockstep", Lockstep.stats());
        Log.event("done", summary);
        if (exit) {
            bridge.quit(errors > 0 ? 2 : 0);
        }
    }

    private void failRun(String why) {
        if (stage == Stage.FINISHED) {
            return;
        }
        if (runner != null) {
            runner.abort(why);
            completed(runner);
            runner = null;
        }
        next(Stage.FINISHED);
        Log.event("fatal", new Json.Obj().str("reason", why));
        bridge.quit(3);
    }

    private void next(Stage s) {
        stage = s;
        stageTicks = 0;
    }

    /** The client thread is waiting for the server: the runner still hears from it. */
    void waiting() {
        heartbeat();
    }

    private void heartbeat() {
        long now = System.nanoTime();
        if (now - lastHeartbeat < 1_000_000_000L) {
            return;
        }
        lastHeartbeat = now;
        Json.Obj beat = new Json.Obj().str("stage", stage.name().toLowerCase()).num("index", index).num("total", scenarios.size());
        if (runner != null) {
            beat.str("id", runner.scenario.id);
        }
        beat.obj("lockstep", Lockstep.stats());
        Log.event("heartbeat", beat);
    }

    // ---------------------------------------------------------------------------------------------
    // rows

    long positionPackets() {
        return positionPackets.get();
    }

    /** Whether a screen may stay open: the body of a feature case. */
    public boolean screensAllowed() {
        return runner != null && runner.allowsScreens();
    }

    void clearPending() {
        pendingS2c.clear();
        pendingC2s.clear();
        pendingBlocks.clear();
        pendingServer = null;
        pendingCorrections = null;
        synchronized (serverCorrections) {
            serverCorrections.setLength(0);
        }
    }

    void beginRow(RecordingWriter.Row r) {
        row = r;
        r.s2c.addAll(pendingS2c);
        pendingS2c.clear();
        r.c2s.addAll(pendingC2s);
        pendingC2s.clear();
        blocksTaken = false;
        r.server = pendingServer;
        pendingServer = null;
        if (pendingCorrections != null) {
            r.extra.raw("corrections", pendingCorrections);
            pendingCorrections = null;
        }
        phase = Phases.BETWEEN_TICKS;
    }

    void endRow(RecordingWriter.Row r) {
        checkFields(r.post);
        takeBlocks(r);
        row = null;
    }

    /** The experiments of the world this run makes (record.ts --features). */
    private static final List<String> FEATURES = java.util.Arrays.stream(System.getProperty("recorder.features", "").split(","))
        .filter(name -> !name.isEmpty()).toList();

    /** The build this client runs (record.ts, one line of JSON), which every header carries; null when started by hand. */
    private static final String PROVENANCE = readProvenance();

    private static String readProvenance() {
        String file = System.getProperty("recorder.provenance");
        if (file == null) {
            return null;
        }
        try {
            return java.nio.file.Files.readString(Path.of(file)).trim();
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException("no provenance at " + file, e);
        }
    }

    private static boolean needsFeature(Scenario s) {
        return s.tags != null && s.tags.stream().anyMatch(tag -> tag.startsWith("feature:"));
    }

    /** The recording header for a scenario (recording.ts RecordingHeader). */
    Json.Obj header(Scenario scenario) {
        checkFields(bridge.snapshot());
        Json.Obj world = new Json.Obj()
            .raw("origin", Json.ints(bridge.origin()))
            .raw("area", GSON.toJson(scenario.area))
            .str("dimension", "overworld")
            .raw("blocks", bridge.worldBlocks(scenario.area.box).text());
        Json.Obj server = new Json.Obj().bool("wire", false).str("ownerChecks", "dedicated")
            .bool("allowFlight", scenario.setup.allowFlight)
            // what the case ran with: one distance for a client's whole run, the release's own (see README, The view distance)
            .num("viewDistance", bridge.viewDistance());
        JsonArray phases = new JsonArray();
        for (String p : Phases.ORDER) {
            phases.add(p);
        }
        Json.Obj header = new Json.Obj()
            .num("schema", 1)
            .str("mc", bridge.gameVersion())
            .num("protocol", bridge.protocolVersion())
            .obj("scenario", new Json.Obj().str("id", scenario.id).str("hash", scenario.hash));
        if (PROVENANCE != null) {
            header.raw("provenance", PROVENANCE);
        }
        return header
            .raw("features", Json.array(FEATURES.stream().map(Json::str).toList()))
            .raw("fields", fieldsWritten == null ? "null" : Json.array(fieldsWritten.stream().sorted().map(Json::str).toList()))
            .raw("phases", phases.toString())
            .obj("world", world)
            .obj("server", server)
            .obj("player", bridge.playerIdentity())
            .raw("start", GSON.toJson(scenario.start))
            .raw("setup", GSON.toJson(scenario.setup))
            .raw("body", GSON.toJson(scenario.body));
    }

    Path outputFile(Scenario scenario) {
        return out.resolve(scenario.id + ".jsonl.gz");
    }

    /** The snapshot writes exactly the fields the registry has for this release (once per run). */
    private void checkFields(Json.Obj snapshot) {
        if (fieldsWritten != null) {
            return;
        }
        fieldsWritten = new TreeSet<>(snapshot.keySet());
        Set<String> expected = new TreeSet<>();
        for (String[] field : PlayerFields.ALL) {
            if (Versions.inRange(bridge.gameVersion(), field[2])) {
                expected.add(field[0]);
            }
        }
        Set<String> missing = new TreeSet<>(expected);
        missing.removeAll(fieldsWritten);
        Set<String> extra = new TreeSet<>(fieldsWritten);
        extra.removeAll(expected);
        if (!missing.isEmpty() || !extra.isEmpty()) {
            failRun("the snapshot does not match fields.ts: missing " + missing + ", extra " + extra);
        }
    }

    // ---------------------------------------------------------------------------------------------
    // hooks (client thread unless noted)

    private boolean recording() {
        return runner != null && runner.recording();
    }

    /** A phase point inside the local player's tick. */
    public void phase(String name) {
        phase = name;
        if (row != null && recording()) {
            if (Phases.TICK_START.equals(name)) {
                takeBlocks(row);
            }
            if (Phases.AFTER_BASE_TICK.equals(name)) {
                row.playerTicked = true;
            }
            row.phases.add(new AbstractMap.SimpleEntry<>(name, bridge.phaseSnapshot(name)));
        }
    }

    /** The ridden vehicle at a point of its own move. */
    public void vehiclePhase(String name, Json.Obj snapshot) {
        if (row != null && recording()) {
            row.vehiclePhases.add(new AbstractMap.SimpleEntry<>(name, snapshot));
        }
    }

    /** The current phase, to stamp packets the client sends with. */
    public String currentPhase() {
        return handling != null ? Phases.PACKET_HANDLING : phase;
    }

    public void travel(boolean inside) {
        inTravel = inside;
    }

    public boolean inTravel() {
        return inTravel;
    }

    /** Before the client handles a server packet (on the client thread). */
    public void beforeHandle() {
        handling = seq.incrementAndGet();
    }

    /** After the client handled a server packet. */
    public void afterHandle(String name, int id, byte[] bytes, boolean positionPacket) {
        long s = handling == null ? seq.incrementAndGet() : handling;
        handling = null;
        if (positionPacket) {
            positionPackets.incrementAndGet();
        }
        if (stage != Stage.RUNNING || runner == null || !runner.inBody()) {
            return;
        }
        String b64 = bytes == null ? "" : Base64.getEncoder().encodeToString(bytes);
        pendingS2c.add(new RecordingWriter.PacketIn(s, name, id, b64, bridge.worldLoaded() ? bridge.snapshot() : null));
    }

    /** A packet the client sent. */
    public void sent(String name, int id, byte[] bytes) {
        long s = seq.incrementAndGet();
        if (runner == null || !runner.inBody()) {
            return;
        }
        RecordingWriter.PacketOut packet = new RecordingWriter.PacketOut(s, currentPhase(), name, id,
            bytes == null ? "" : Base64.getEncoder().encodeToString(bytes), handling);
        if (row != null) {
            row.c2s.add(packet);
        } else {
            pendingC2s.add(packet);
        }
    }

    /** The riding jump the rider released this tick (LocalPlayer.aiStep: onPlayerJump), in percent. */
    public void ridingJump(int power) {
        if (row != null && recording()) {
            row.extra.num("ridingJump", power);
        }
    }

    /**
     * The blocks changed since the last player tick, for the row of the tick that starts from them: a client tick
     * predicts a block (handleKeybinds) after its row opens and before the player moves. A tick without a player takes
     * them at its end.
     */
    private void takeBlocks(RecordingWriter.Row r) {
        if (!blocksTaken && !pendingBlocks.isEmpty()) {
            r.extra.raw("blocks", Json.array(pendingBlocks));
            pendingBlocks.clear();
        }
        blocksTaken = true;
    }

    /** A block changed on the client (applied before the player tick that records it, as the packets are). */
    public void blockChanged(int x, int y, int z, String state) {
        if (runner == null || !runner.inBody()) {
            return;
        }
        // (a change during a tick, a piston's block event, goes to the next row: the world that tick starts from)
        pendingBlocks.add("[" + x + "," + y + "," + z + "," + Json.str(state) + "]");
    }

    /**
     * Server thread, at the end of each server tick: its view of the player and entities, and the corrections it sent.
     * Both go to the next client row (the one whose packets that tick sent): a correction is made while the server
     * handles the client's move, which can be before or after the client closes its row, so it is kept with its tick.
     */
    public void serverTicked(String serverJson) {
        if (runner != null && runner.inBody()) {
            synchronized (serverCorrections) {
                if (!serverCorrections.isEmpty()) {
                    pendingCorrections = "[" + serverCorrections + "]";
                    serverCorrections.setLength(0);
                }
            }
            pendingServer = serverJson;
        }
    }

    /** Server thread: the server corrected the client's position (ServerGamePacketListenerImpl.teleport). */
    public void serverCorrection(String json) {
        if (runner == null || !runner.inBody()) {
            return;
        }
        runner.correction();
        synchronized (serverCorrections) {
            if (!serverCorrections.isEmpty()) {
                serverCorrections.append(',');
            }
            serverCorrections.append(json);
        }
    }

    /** Whether hooks should do work (the world runs scenarios). */
    public boolean active() {
        return stage == Stage.RUNNING;
    }

    static Set<String> keys(List<String> keys) {
        return keys == null ? Set.of() : new HashSet<>(keys);
    }
}
