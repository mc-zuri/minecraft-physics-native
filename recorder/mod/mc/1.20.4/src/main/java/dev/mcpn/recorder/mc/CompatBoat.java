package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Json;
import java.util.Locale;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;

/** Boats and the input they read. */
final class CompatBoat {
    private CompatBoat() {
    }

    static void write(Entity e, Json.Obj v) {
        if (e instanceof net.minecraft.world.entity.vehicle.Boat boat) {
            dev.mcpn.recorder.mc.mixin.BoatAccessor b = (dev.mcpn.recorder.mc.mixin.BoatAccessor) boat;
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
                .str("variant", CompatServer.boatVariant(boat)));
        }
    }

    /** The boat a scenario names, or null when the id is an ordinary entity. */
    static Entity create(ServerLevel level, String id) {
        java.util.regex.Matcher boat = java.util.regex.Pattern.compile("^(?:([a-z_]+?)_(chest_)?boat|bamboo_(chest_)?raft)$").matcher(id);
        if (!boat.matches()) {
            return null;
        }
        boolean chest = boat.group(2) != null || boat.group(3) != null;
        String wood = boat.group(1) != null ? boat.group(1) : "bamboo";
        net.minecraft.world.entity.vehicle.Boat.Type variant = net.minecraft.world.entity.vehicle.Boat.Type.byName(wood);
        // (byName answers oak for a wood it does not know)
        if (!variant.getName().equals(wood)) {
            return null;
        }
        Entity e = CompatServer.boatType(chest).create(level);
        if (e instanceof net.minecraft.world.entity.vehicle.Boat b) {
            CompatServer.setBoatVariant(b, variant);
        }
        return e;
    }

    static boolean inputJumping(LocalPlayer p) {
        return p.input.jumping;
    }

    static boolean inputShift(LocalPlayer p) {
        return p.input.shiftKeyDown;
    }

    static float inputLeft(LocalPlayer p) {
        return p.input.leftImpulse;
    }

    static float inputForward(LocalPlayer p) {
        return p.input.forwardImpulse;
    }
}
