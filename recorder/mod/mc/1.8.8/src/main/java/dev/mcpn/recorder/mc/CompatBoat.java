package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Json;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.vehicle.Boat;

/** The boat before 1.9: one kind, no paddles and no status, and how hard the input pushes it is all it keeps. */
final class CompatBoat {
    private CompatBoat() {
    }

    static void write(Entity e, Json.Obj v) {
        if (e instanceof Boat boat) {
            // (what later boats keep, as the replay reads them: this one takes its rider's input as it is)
            v.obj("boat", new Json.Obj().num("speedMultiplier", ((dev.mcpn.recorder.mc.mixin.BoatAccessor) boat).recorder$speedMultiplier())
                .num("deltaRotation", 0.0F).num("waterLevel", 0.0).num("landFriction", 0.0F)
                .bool("inputLeft", false).bool("inputRight", false).bool("inputUp", false).bool("inputDown", false)
                .num("outOfControlTicks", 0.0F).num("lastYd", 0.0)
                .bool("aboveBubbleColumn", false).bool("bubbleColumnDirectionIsDown", false)
                .num("bubbleTime", 0).num("bubbleMultiplier", 0.0F)
                .bool("paddleLeft", false).bool("paddleRight", false)
                .raw("paddlePhases", Json.doubles(0.0, 0.0))
                .bool("silent", false).str("variant", "oak"));
        }
    }

    /** The boat a scenario names, or null when the id is an ordinary entity. */
    static Entity create(ServerLevel level, String id) {
        return id.equals("oak_boat") ? new Boat(level) : null;
    }

    static boolean inputJumping(LocalPlayer p) {
        return p.input.jumping;
    }

    static boolean inputShift(LocalPlayer p) {
        return p.input.sneakKeyDown;
    }

    static float inputLeft(LocalPlayer p) {
        return p.input.leftImpulse;
    }

    static float inputForward(LocalPlayer p) {
        return p.input.forwardImpulse;
    }
}
