package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Json;
import java.util.Locale;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;

/** From 1.21.2 a boat is an entity type per wood. */
final class CompatBoat {
    private CompatBoat() {
    }

    static void write(Entity e, Json.Obj v) {
        if (e instanceof net.minecraft.world.entity.vehicle.AbstractBoat boat) {
            dev.mcpn.recorder.mc.mixin.BoatAccessor b = (dev.mcpn.recorder.mc.mixin.BoatAccessor) boat;
            // the interpolation a position packet starts, which 1.21.2 - 1.21.4 run on a controlled boat too (AbstractBoat.tickLerp);
            // read by name, as 1.21.5 moves it to an InterpolationHandler this class is not built for
            int steps = (Integer) field(boat, "lerpSteps");
            Json.Obj lerp = steps > 0
                ? new Json.Obj().num("steps", steps).vec("to", (Double) field(boat, "lerpX"), (Double) field(boat, "lerpY"), (Double) field(boat, "lerpZ"))
                    .num("yRot", (Double) field(boat, "lerpYRot"))
                : null;
            v.obj("boat", new Json.Obj()
                .str("status", b.recorder$status() == null ? null : b.recorder$status().name().toLowerCase(Locale.ROOT))
                .str("oldStatus", b.recorder$oldStatus() == null ? null : b.recorder$oldStatus().name().toLowerCase(Locale.ROOT))
                .num("deltaRotation", b.recorder$deltaRotation()).num("waterLevel", b.recorder$waterLevel())
                .num("landFriction", b.recorder$landFriction())
                .bool("inputLeft", b.recorder$inputLeft()).bool("inputRight", b.recorder$inputRight())
                .bool("inputUp", b.recorder$inputUp()).bool("inputDown", b.recorder$inputDown())
                .num("outOfControlTicks", b.recorder$outOfControlTicks()).num("lastYd", b.recorder$lastYd())
                .bool("aboveBubbleColumn", b.recorder$isAboveBubbleColumn())
                .bool("bubbleColumnDirectionIsDown", b.recorder$bubbleColumnDirectionIsDown())
                .num("bubbleTime", b.recorder$bubbleTime()).num("bubbleMultiplier", b.recorder$bubbleMultiplier())
                .bool("paddleLeft", boat.getPaddleState(0)).bool("paddleRight", boat.getPaddleState(1))
                .raw("paddlePhases", Json.doubles(b.recorder$paddlePositions()[0], b.recorder$paddlePositions()[1]))
                .bool("silent", boat.isSilent())
                .raw("lerp", lerp == null ? "null" : lerp.text())
                .str("variant", net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE.getKey(boat.getType()).getPath()));
        }
    }

    private static Object field(Object on, String name) {
        try {
            java.lang.reflect.Field f = net.minecraft.world.entity.vehicle.AbstractBoat.class.getDeclaredField(name);
            f.setAccessible(true);
            return f.get(on);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The boat a scenario names, or null when the id is an ordinary entity. */
    static Entity create(ServerLevel level, String id) {
        return null;
    }

    static boolean inputJumping(LocalPlayer p) {
        return p.input.keyPresses.jump();
    }

    static boolean inputShift(LocalPlayer p) {
        return p.input.keyPresses.shift();
    }

    static float inputLeft(LocalPlayer p) {
        return p.input.leftImpulse;
    }

    static float inputForward(LocalPlayer p) {
        return p.input.forwardImpulse;
    }
}
