package dev.mcpn.recorder;

import com.google.gson.JsonElement;
import com.google.gson.JsonParser;
import dev.mcpn.recorder.model.Scenario;
import dev.mcpn.recorder.schema.PlayerFields;
import java.util.Set;

/** Evaluates a scenario condition on the player's snapshot after a tick. */
public final class Conditions {
    private Conditions() {
    }

    /** The view of the player a condition reads; the snapshot's JSON values parsed on demand. */
    public static final class View {
        final Json.Obj snapshot;
        final Set<String> contacts;
        final double[] origin;
        /** The path so far: highest and lowest area-local y, horizontal distance from the start (NaN when unknown). */
        double highest = Double.NaN;
        double lowest = Double.NaN;
        double distance = Double.NaN;

        public View(Json.Obj snapshot, Set<String> contacts, int[] origin) {
            this.snapshot = snapshot;
            this.contacts = contacts;
            this.origin = new double[] {origin[0], origin[1], origin[2]};
        }

        public View path(double highest, double lowest, double distance) {
            this.highest = highest;
            this.lowest = lowest;
            this.distance = distance;
            return this;
        }

        /** Asked only of what needs it, as it takes the server's view. */
        public java.util.function.BooleanSupplier fishBiting;

        boolean bool(String key) {
            return "true".equals(snapshot.get(key));
        }

        double number(String key) {
            String text = snapshot.get(key);
            if (text == null) {
                return Double.NaN;
            }
            JsonElement value = JsonParser.parseString(text);
            return value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber() ? value.getAsDouble() : Double.NaN;
        }

        double[] vec(String key) {
            String text = snapshot.get(key);
            if (text == null) {
                return new double[] {Double.NaN, Double.NaN, Double.NaN};
            }
            var array = JsonParser.parseString(text).getAsJsonArray();
            return new double[] {array.get(0).getAsDouble(), array.get(1).getAsDouble(), array.get(2).getAsDouble()};
        }
    }

    public static boolean test(Scenario.Condition c, View view) {
        return switch (c.op) {
            case "onGround" -> view.bool(PlayerFields.ON_GROUND);
            case "fishBiting" -> view.fishBiting != null && view.fishBiting.getAsBoolean();
            case "inWater" -> view.bool(PlayerFields.IS_IN_WATER);
            case "inLava" -> view.bool(PlayerFields.IS_IN_LAVA);
            case "fallFlying" -> view.bool(PlayerFields.FALL_FLYING);
            case "collidedHorizontally" -> view.bool(PlayerFields.HORIZONTAL_COLLISION);
            case "const" -> c.holds;
            case "stopped" -> {
                double[] v = view.vec(PlayerFields.VEL);
                yield Math.abs(v[0]) <= c.epsilon && Math.abs(v[2]) <= c.epsilon && (view.bool(PlayerFields.ON_GROUND) || Math.abs(v[1]) <= c.epsilon);
            }
            case "touching" -> view.contacts.contains(c.how + ":" + c.block);
            case "cmp" -> compare(value(c.field, view), c.cmp, c.value);
            case "and" -> c.all.stream().allMatch(x -> test(x, view));
            case "or" -> c.any.stream().anyMatch(x -> test(x, view));
            case "not" -> !test(c.cond, view);
            default -> throw new IllegalArgumentException("unknown condition " + c.op);
        };
    }

    private static double value(String field, View view) {
        return switch (field) {
            case "x" -> view.vec(PlayerFields.POS)[0] - view.origin[0];
            case "y" -> view.vec(PlayerFields.POS)[1] - view.origin[1];
            case "z" -> view.vec(PlayerFields.POS)[2] - view.origin[2];
            case "vx" -> view.vec(PlayerFields.VEL)[0];
            case "vy" -> view.vec(PlayerFields.VEL)[1];
            case "vz" -> view.vec(PlayerFields.VEL)[2];
            case "fallDistance" -> view.number(PlayerFields.FALL_DISTANCE);
            case "health" -> view.number(PlayerFields.HEALTH);
            case "highest" -> view.highest;
            case "lowest" -> view.lowest;
            case "distance" -> view.distance;
            default -> throw new IllegalArgumentException("unknown condition field " + field);
        };
    }

    private static boolean compare(double a, String cmp, double b) {
        return switch (cmp) {
            case "<" -> a < b;
            case "<=" -> a <= b;
            case ">" -> a > b;
            case ">=" -> a >= b;
            default -> throw new IllegalArgumentException("unknown comparison " + cmp);
        };
    }
}
