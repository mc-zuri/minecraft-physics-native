package dev.mcpn.recorder;

import java.util.Locale;

/** Recorder output on stdout: `[recorder] text` for people, `@rec {json}` lines for recorder/runner. */
public final class Log {
    private Log() {
    }

    public static void info(String format, Object... args) {
        System.out.println("[recorder] " + (args.length == 0 ? format : String.format(Locale.ROOT, format, args)));
    }

    /** One machine-readable event for the runner: `@rec {"e":"<event>",...}`. */
    public static void event(String event, Json.Obj fields) {
        Json.Obj line = new Json.Obj().str("e", event);
        line.putAll(fields);
        System.out.println("@rec " + line.text());
        System.out.flush();
    }
}
