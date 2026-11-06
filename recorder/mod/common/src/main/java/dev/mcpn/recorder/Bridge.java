package dev.mcpn.recorder;

import dev.mcpn.recorder.model.Scenario;
import java.nio.file.Path;
import java.util.Set;
import java.util.function.Consumer;

/**
 * What the version-neutral recorder needs from one Minecraft version (each mc/&lt;version&gt;
 * adapter's BridgeImpl). Client methods run on the client thread; {@link #onServer} runs a task
 * on the integrated server's thread and waits for it.
 */
public interface Bridge {
    String gameVersion();

    int protocolVersion();

    Path gameDirectory();

    /** The title screen is up and a world can be created. */
    boolean readyToStartWorld();

    /** Creates and joins the recorder's world (void flat, fixed seed). */
    void startWorld();

    /** In the singleplayer world with no screen open. */
    boolean inWorld();

    /** The client has a world, with or without a screen over it. */
    boolean worldLoaded();

    /** Closes any screen that opened (pause, death...); returns what was open, or null. */
    String closeScreens();

    /** Does what a client action says, through the client's own code paths. */
    void clientAction(Scenario.Client action);

    /** A fish bites the player's hook. */
    boolean fishBiting();

    /** The player died in a case before this one, and waits to respawn. */
    boolean playerDead();

    /** The moment the body starts, how long the setup took being what ran before's to decide. */
    void alignStart();

    /** What the client's crosshair hits now: {miss}, {block, face, at} or {entity, at}. */
    dev.mcpn.recorder.Json.Obj crosshair();

    /** The open screen's name: none, death, sign, book, merchant, container:... */
    String screen();

    /** Sets the keys held for the next tick (the rest are released). */
    void applyKeys(Set<String> keys);

    void applyRotation(float yRot, float xRot);

    float yRot();

    float xRot();

    void selectSlot(int slot);

    void setAutoJump(boolean enabled);

    /**
     * Fixes the client's counters whose phase decides packets (the player's tick count, the move packet reminder), and
     * the last position it sent: the rest position, as `rest` (area-relative) says, whatever the settling left.
     */
    void alignClient(double[] rest);

    /** A passenger's own velocity is a leftover no physics reads, from whichever tick it mounted on: cleared before the body. */
    void clearPassengerVelocity();

    /** Every recorded field of the local player (recorder/schema/fields.ts PLAYER_FIELDS). */
    Json.Obj snapshot();

    /**
     * A snapshot at a phase inside the player's tick: the scene around the player is taken anew at the phase that
     * starts the tick and reused by the later ones.
     */
    default Json.Obj phaseSnapshot(String phase) {
        return snapshot();
    }

    /** The blocks the player stands on, is in and pushes against: "on:stone", "in:cobweb", "against:glass". */
    Set<String> contacts();

    /** Null when the client holds exactly the blocks the server captured after building; else what differs. */
    String clientMismatch();

    /** The local player's entity id, UUID and name, for the recording header. */
    Json.Obj playerIdentity();

    /**
     * The world's blocks over the area box (relative to the origin) as they are when the body starts: what the player
     * meets, after neighbour updates, setup commands and settling. {from, to, palette, runs}: x outermost, then y, then
     * z; runs is [paletteIndex, count, ...].
     */
    Json.Obj worldBlocks(int[] box);

    /** The view distance the server sends chunks by (the integrated server's follows the client's render distance). */
    int viewDistance();

    /**
     * Whether the client holds every chunk the server's view distance gives it around the player. A chunk still on its
     * way would arrive in the body, at a tick that depends on what the server did before (a chunk's load and light run
     * on worker threads; before 1.20.2 nothing paces them).
     */
    boolean chunksHeld();

    /** The world's absolute origin the area's relative coordinates start from. */
    int[] origin();

    /** Runs a task on the server thread; under lockstep it runs at once and this waits for it. */
    void onServer(Consumer<ServerOps> task);

    /** The packets this version's client knows how to name (for the header). */
    default String packetNames() {
        return "mojmap";
    }

    void quit(int code);

    /** The integrated server's side. Every method runs on the server thread. */
    interface ServerOps {
        /** One-time world setup: game rules, time, weather, entity cleanup, forced chunks. */
        void configureWorld();

        /**
         * Resets the player (effects, attributes, inventory, food, fire, freeze, air, fall distance, game
         * mode, abilities), clears entities in and around the area, clears the area's box and places its
         * fills, then captures it for {@link Bridge#clientMismatch}. Returns a skip reason, or null.
         */
        String prepare(Scenario scenario);

        /** Takes the player off its vehicle, where the vehicle is. */
        void dismount();

        /** Teleports the player (absolute, area-relative coordinates), stopping it and resetting fall distance. */
        void teleport(double[] relativePos, float yRot, float xRot);

        /** Applies the scenario's setup (effects, attributes, equipment, abilities, summons, mount). Returns a skip reason, or null. */
        String setup(Scenario scenario);

        /** Fixes timers and randomness so the case does not depend on what ran before it. */
        void align(long seed);

        /** The server's side of {@link Bridge#fishBiting}. */
        boolean fishBiting();

        /** The server's half of {@link Bridge#alignStart}. */
        void alignStart();

        /** Runs one body action. Returns a skip reason, or null. */
        String action(Scenario.Action action);

        /** Sets the player's velocity (sends it to the client). */
        void velocity(double[] vel);
    }
}
