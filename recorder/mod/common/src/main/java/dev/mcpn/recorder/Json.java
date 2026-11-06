package dev.mcpn.recorder;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * JSON text in the recording's number rules: doubles in their shortest round-trip form
 * (Double.toString on Java 19+), floats widened to doubles first (so Math.fround reads them back
 * exactly), -0.0 kept, NaN and the infinities as the strings "NaN", "+Inf", "-Inf". Values are
 * turned into text when they are put, so two snapshots compare by their text, exactly.
 */
public final class Json {
    private Json() {
    }

    public static String num(double value) {
        if (Double.isNaN(value)) {
            return "\"NaN\"";
        }
        if (Double.isInfinite(value)) {
            return value > 0 ? "\"+Inf\"" : "\"-Inf\"";
        }
        // shortest round-trip since JDK 19 (JDK-4511638); "-0.0" and "1.0E-5" are valid JSON numbers
        return Double.toString(value);
    }

    public static String num(float value) {
        return num((double) value);
    }

    public static String num(int value) {
        return Integer.toString(value);
    }

    public static String num(long value) {
        return Long.toString(value);
    }

    public static String bool(boolean value) {
        return value ? "true" : "false";
    }

    public static String str(String value) {
        if (value == null) {
            return "null";
        }
        StringBuilder out = new StringBuilder(value.length() + 2).append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        return out.append('"').toString();
    }

    public static String vec(double x, double y, double z) {
        return "[" + num(x) + "," + num(y) + "," + num(z) + "]";
    }

    public static String ints(int... values) {
        StringBuilder out = new StringBuilder("[");
        for (int i = 0; i < values.length; i++) {
            if (i > 0) {
                out.append(',');
            }
            out.append(values[i]);
        }
        return out.append(']').toString();
    }

    public static String doubles(double... values) {
        StringBuilder out = new StringBuilder("[");
        for (int i = 0; i < values.length; i++) {
            if (i > 0) {
                out.append(',');
            }
            out.append(num(values[i]));
        }
        return out.append(']').toString();
    }

    public static String array(Collection<String> texts) {
        return "[" + String.join(",", texts) + "]";
    }

    /** An ordered JSON object whose values are already JSON text. */
    public static class Obj extends LinkedHashMap<String, String> {
        public Obj raw(String key, String json) {
            put(key, json);
            return this;
        }

        public Obj num(String key, double value) {
            return raw(key, Json.num(value));
        }

        public Obj num(String key, float value) {
            return raw(key, Json.num(value));
        }

        public Obj num(String key, int value) {
            return raw(key, Json.num(value));
        }

        public Obj num(String key, long value) {
            return raw(key, Json.num(value));
        }

        public Obj bool(String key, boolean value) {
            return raw(key, Json.bool(value));
        }

        public Obj str(String key, String value) {
            return raw(key, Json.str(value));
        }

        public Obj vec(String key, double x, double y, double z) {
            return raw(key, Json.vec(x, y, z));
        }

        public Obj obj(String key, Obj value) {
            return raw(key, value.text());
        }

        public String text() {
            StringBuilder out = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<String, String> entry : entrySet()) {
                if (!first) {
                    out.append(',');
                }
                first = false;
                out.append(Json.str(entry.getKey())).append(':').append(entry.getValue());
            }
            return out.append('}').toString();
        }

        /** The entries of this object that differ from (or are missing in) `before`; null for a field that went away. */
        public Obj delta(Map<String, String> before) {
            Obj out = new Obj();
            for (Map.Entry<String, String> entry : entrySet()) {
                if (!entry.getValue().equals(before.get(entry.getKey()))) {
                    out.put(entry.getKey(), entry.getValue());
                }
            }
            for (String key : before.keySet()) {
                if (!containsKey(key)) {
                    out.put(key, "null");
                }
            }
            return out;
        }
    }
}
