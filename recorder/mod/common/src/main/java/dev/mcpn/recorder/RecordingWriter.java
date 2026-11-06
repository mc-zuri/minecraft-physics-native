package dev.mcpn.recorder;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPOutputStream;

/**
 * One recording: `<case>.jsonl.gz`, a header line, one line per client tick, a footer line
 * (recorder/schema/recording.ts). Player state is delta-encoded against one running state that
 * carries through each row in order: the previous row's post, each server packet's after, pre,
 * the phases in the order they ran, post. A keyframe (the whole pre, "kf":true) is written on the
 * first row and every {@link #KEYFRAME_EVERY} rows.
 */
public final class RecordingWriter implements AutoCloseable {
    public static final int KEYFRAME_EVERY = 200;

    private final Path file;
    private final Path partial;
    private final BufferedWriter out;
    private Json.Obj running = new Json.Obj();
    private int rows;

    public RecordingWriter(Path file, Json.Obj header) {
        this.file = file;
        this.partial = file.resolveSibling(file.getFileName() + ".part");
        try {
            Files.createDirectories(file.getParent());
            out = new BufferedWriter(new OutputStreamWriter(new GZIPOutputStream(Files.newOutputStream(partial), 1 << 16),
                StandardCharsets.UTF_8), 1 << 16);
            header.put("kind", Json.str("header"));
            line(header);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** A server packet the client handled before the tick. */
    public record PacketIn(long seq, String name, int id, String bytes, Json.Obj after) {
    }

    /** A packet the client sent during the tick (or while handling a server packet). */
    public record PacketOut(long seq, String phase, String name, int id, String bytes, Long responseTo) {
    }

    /** One client tick. */
    public static final class Row {
        public int t;
        public final List<PacketIn> s2c = new ArrayList<>();
        public Json.Obj pre;
        public Json.Obj input;
        /** Phase name -> snapshot, in the order the phases ran. */
        public final List<Map.Entry<String, Json.Obj>> phases = new ArrayList<>();
        /** The ridden vehicle at the points of its own move, whole: "vehicleBeforeMove", then "vehicleAfterMove", then "...#1" for a second move. */
        public final List<Map.Entry<String, Json.Obj>> vehiclePhases = new ArrayList<>();
        public final List<PacketOut> c2s = new ArrayList<>();
        public Json.Obj post;
        public boolean playerTicked;
        /** The server tick between the previous client tick and this one. */
        public String server;
        /** Extra per-row facts (corrections, block changes...). */
        public final Json.Obj extra = new Json.Obj();
    }

    public void row(Row row) {
        Json.Obj line = new Json.Obj().num("t", row.t);
        if (!row.s2c.isEmpty()) {
            List<String> packets = new ArrayList<>(row.s2c.size());
            for (PacketIn p : row.s2c) {
                Json.Obj packet = new Json.Obj().num("seq", p.seq()).str("name", p.name()).num("id", p.id()).str("b", p.bytes());
                if (p.after() != null) {
                    Json.Obj delta = p.after().delta(running);
                    if (!delta.isEmpty()) {
                        packet.obj("after", delta);
                    }
                    running = p.after();
                }
                packets.add(packet.text());
            }
            line.raw("s2c", Json.array(packets));
        }
        boolean keyframe = rows % KEYFRAME_EVERY == 0;
        line.obj("pre", keyframe ? row.pre : row.pre.delta(running));
        if (keyframe) {
            line.bool("kf", true);
        }
        running = row.pre;
        line.obj("in", row.input);
        if (!row.phases.isEmpty()) {
            Json.Obj phases = new Json.Obj();
            for (Map.Entry<String, Json.Obj> phase : row.phases) {
                phases.obj(phase.getKey(), phase.getValue().delta(running));
                running = phase.getValue();
            }
            line.obj("ph", phases);
        }
        if (!row.vehiclePhases.isEmpty()) {
            Json.Obj vehicle = new Json.Obj();
            Map<String, Integer> seen = new java.util.HashMap<>();
            for (Map.Entry<String, Json.Obj> phase : row.vehiclePhases) {
                int occurrence = seen.merge(phase.getKey(), 1, Integer::sum) - 1;
                vehicle.obj(occurrence == 0 ? phase.getKey() : phase.getKey() + "#" + occurrence, phase.getValue());
            }
            line.obj("vph", vehicle);
        }
        if (!row.c2s.isEmpty()) {
            List<String> packets = new ArrayList<>(row.c2s.size());
            for (PacketOut p : row.c2s) {
                Json.Obj packet = new Json.Obj().num("seq", p.seq()).str("phase", p.phase()).str("name", p.name()).num("id", p.id())
                    .str("b", p.bytes());
                if (p.responseTo() != null) {
                    packet.num("re", p.responseTo());
                }
                packets.add(packet.text());
            }
            line.raw("c2s", Json.array(packets));
        }
        line.obj("post", row.post.delta(running));
        running = row.post;
        if (!row.playerTicked) {
            line.bool("playerTicked", false);
        }
        if (row.server != null) {
            line.raw("srv", row.server);
        }
        line.putAll(row.extra);
        line(line);
        rows++;
    }

    /** Ends the recording; the file appears under its final name only once complete. */
    public void finish(Json.Obj footer) {
        footer.put("kind", Json.str("footer"));
        footer.num("rows", rows);
        line(footer);
        close();
        try {
            Files.move(partial, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Drops an unfinished recording. */
    public void abort() {
        close();
        try {
            Files.deleteIfExists(partial);
        } catch (IOException ignored) {
            // nothing to keep
        }
    }

    private void line(Json.Obj obj) {
        try {
            out.write(obj.text());
            out.write('\n');
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public void close() {
        try {
            out.close();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
