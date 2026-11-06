package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Recorder;
import net.minecraft.client.Minecraft;

/** Routes the phase mixins to the recorder, for the local player only (the hooks also fire for every other entity). */
public final class Phases120 {
    private Phases120() {
    }

    private static Recorder forLocalPlayer(Object entity) {
        Recorder recorder = Recorder.get();
        if (recorder == null || !recorder.active()) {
            return null;
        }
        Minecraft mc = Minecraft.getInstance();
        return mc.player != null && entity == mc.player && CompatMove.onClientThread(mc) ? recorder : null;
    }

    public static void at(Object entity, String phase) {
        Recorder recorder = forLocalPlayer(entity);
        if (recorder != null) {
            recorder.phase(phase);
        }
    }

    /** A phase inside the player's travel only (its own moves; a piston's or a shulker's are not). */
    public static void inTravel(Object entity, String phase) {
        Recorder recorder = forLocalPlayer(entity);
        if (recorder != null && recorder.inTravel()) {
            recorder.phase(phase);
        }
    }

    /**
     * The ridden vehicle's own move (Entity.move of the player's vehicle, on the client), for a rider's row: the vehicle at its
     * head and its tail. Nothing of the player's phases changes: this reads a snapshot and writes it to the row apart.
     */
    public static void vehicleMove(Object entity, boolean starts) {
        Recorder recorder = Recorder.get();
        if (recorder == null || !recorder.active()) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || !CompatMove.onClientThread(mc) || entity != CompatLiving.vehicle(mc.player)) {
            return;
        }
        recorder.vehiclePhase(starts ? "vehicleBeforeMove" : "vehicleAfterMove", PlayerSnap.vehicle((net.minecraft.world.entity.Entity) entity));
    }

    public static void travel(Object entity, boolean starts, String phase) {
        Recorder recorder = forLocalPlayer(entity);
        if (recorder == null) {
            return;
        }
        if (starts) {
            recorder.phase(phase);
            recorder.travel(true);
        } else {
            recorder.travel(false);
            recorder.phase(phase);
        }
    }
}
