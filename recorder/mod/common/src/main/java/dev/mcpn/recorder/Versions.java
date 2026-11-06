package dev.mcpn.recorder;

/** Release names and ranges as recorder/scenarios/dsl/names.ts reads them (">=1.19.4 <1.21"). */
public final class Versions {
    private Versions() {
    }

    public static int compare(String a, String b) {
        String[] pa = a.split("\\.");
        String[] pb = b.split("\\.");
        for (int i = 0; i < Math.max(pa.length, pb.length); i++) {
            int x = i < pa.length ? Integer.parseInt(pa[i]) : 0;
            int y = i < pb.length ? Integer.parseInt(pb[i]) : 0;
            if (x != y) {
                return Integer.compare(x, y);
            }
        }
        return 0;
    }

    /** Whether the release is in the range (space-separated comparators); "" or "*" is every release. */
    public static boolean inRange(String version, String range) {
        if (range == null || range.isBlank() || range.trim().equals("*")) {
            return true;
        }
        for (String part : range.trim().split("\\s+")) {
            String op = part.startsWith(">=") || part.startsWith("<=") ? part.substring(0, 2)
                : part.startsWith(">") || part.startsWith("<") || part.startsWith("=") ? part.substring(0, 1) : "=";
            int d = compare(version, part.substring(op.equals("=") && !part.startsWith("=") ? 0 : op.length()));
            boolean ok = switch (op) {
                case ">=" -> d >= 0;
                case "<=" -> d <= 0;
                case ">" -> d > 0;
                case "<" -> d < 0;
                default -> d == 0;
            };
            if (!ok) {
                return false;
            }
        }
        return true;
    }
}
