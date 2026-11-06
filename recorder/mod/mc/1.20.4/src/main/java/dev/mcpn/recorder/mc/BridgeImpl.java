package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Bridge;
import dev.mcpn.recorder.Json;
import dev.mcpn.recorder.Lockstep;
import dev.mcpn.recorder.Recorder;
import dev.mcpn.recorder.mc.mixin.ServerGamePacketListenerImplAccessor;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.function.Consumer;
import java.util.stream.Stream;
import net.minecraft.SharedConstants;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/** The recorder's view of the 1.20.4 client (and, through ServerOpsImpl, its integrated server). */
public final class BridgeImpl implements Bridge {
    public static final boolean RENDER = Boolean.getBoolean("recorder.render");
    static final long SEED = 20260929L;
    static final String LEVEL = "recorder";
    /** Every area is built here (absolute block coordinates of the area's origin). */
    static final int[] ORIGIN = {0, 100, 0};

    private static BridgeImpl instance;
    private final Minecraft mc = Minecraft.getInstance();

    BridgeImpl() {
        instance = this;
    }

    /** Lockstep may start: the client is in the recorder's world. */
    public static boolean canLockstep() {
        if (instance == null) {
            return false;
        }
        // (a feature case plays on under the screens it opens)
        Recorder recorder = Recorder.get();
        return instance.inWorld() || instance.worldLoaded() && recorder != null && recorder.screensAllowed();
    }

    @Override
    public String gameVersion() {
        return CompatNames.gameVersion();
    }

    @Override
    public int protocolVersion() {
        return CompatNet.protocolVersion();
    }

    @Override
    public Path gameDirectory() {
        return mc.gameDirectory.toPath();
    }

    @Override
    public boolean readyToStartWorld() {
        // a first launch shows the accessibility onboarding screen instead of the title screen
        return CompatMove.noOverlay(mc) && mc.level == null
            && (mc.screen instanceof TitleScreen || CompatLevel.isOnboarding(mc.screen));
    }

    @Override
    public void startWorld() {
        CompatOptions.configure(mc);
        CompatLevel.muteSound(mc);
        deleteTree(CompatMove.savesDir(mc).resolve(LEVEL));
        CompatLevel.createLevel(mc, LEVEL, SEED);
    }

    @Override
    public boolean chunksHeld() {
        int radius = viewDistance();
        int cx = CompatEntity.blockX(mc.player) >> 4;
        int cz = CompatEntity.blockZ(mc.player) >> 4;
        // the server moves the player's chunk view in its own tick: until then a near start has every chunk already and
        // the move's center, forgotten chunks and new ones would come in the body
        net.minecraft.server.level.ServerPlayer server = mc.getSingleplayerServer().getPlayerList().getPlayer(mc.player.getUUID());
        if (server == null || !CompatMove.viewMoved(server) || !CompatMove.playerInLevel(mc)) {
            return false;
        }
        // (on the server's thread: it runs chunk tasks through the client's half of a round, and a read from here met its
        // chunk map in the middle of a rehash, an ArrayIndexOutOfBoundsException in Long2ObjectOpenHashMap.get)
        boolean[] ticking = new boolean[1];
        onServer(ops -> ticking[0] = ServerOpsImpl.forcedChunksTicking(CompatEntity.level(server)));
        if (!CompatEntity.clientLoaded(server) || !ticking[0] || !CompatNet.chunksSent(server)) {
            return false;
        }
        for (int dx = -radius; dx <= radius; dx++) {
            for (int dz = -radius; dz <= radius; dz++) {
                if (dx * dx + dz * dz <= radius * radius && !CompatMove.hasChunk(mc, cx + dx, cz + dz)) {
                    return false;
                }
            }
        }
        return true;
    }

    @Override
    public void clientAction(dev.mcpn.recorder.model.Scenario.Client action) {
        CompatClient.act(mc, action);
    }

    @Override
    public String screen() {
        return CompatClient.screen(mc);
    }

    @Override
    public boolean inWorld() {
        return worldLoaded() && mc.screen == null;
    }

    @Override
    public boolean fishBiting() {
        boolean[] biting = new boolean[1];
        onServer(ops -> biting[0] = ops.fishBiting());
        return biting[0];
    }

    @Override
    public boolean playerDead() {
        return mc.player != null && mc.player.getHealth() <= 0.0F;
    }

    @Override
    public void alignStart() {
        MinecraftServer server = mc.getSingleplayerServer();
        if (!dev.mcpn.recorder.Lockstep.beforeNextServerTick(() -> new ServerOpsImpl(server).alignStart())) {
            onServer(Bridge.ServerOps::alignStart);
        }
        mc.player.tickCount = 0;
        ServerOpsImpl.resetPistonDeltas(mc.player);
        CompatOptions.setGameTime(mc, ServerOpsImpl.ALIGNED_GAME_TIME);
    }

    @Override
    public dev.mcpn.recorder.Json.Obj crosshair() {
        return CompatFeature.crosshair(mc);
    }

    @Override
    public boolean worldLoaded() {
        return mc.player != null && mc.level != null && mc.getSingleplayerServer() != null;
    }

    @Override
    public String closeScreens() {
        if (mc.screen == null || mc.player == null) {
            return null;
        }
        String name = mc.screen.getClass().getSimpleName();
        mc.setScreen(null);
        return name;
    }

    private KeyMapping key(String name) {
        return switch (name) {
            case "forward" -> mc.options.keyUp;
            case "back" -> mc.options.keyDown;
            case "left" -> mc.options.keyLeft;
            case "right" -> mc.options.keyRight;
            case "jump" -> mc.options.keyJump;
            case "sneak" -> mc.options.keyShift;
            case "sprint" -> mc.options.keySprint;
            case "use" -> mc.options.keyUse;
            case "attack" -> mc.options.keyAttack;
            case "inventory" -> mc.options.keyInventory;
            case "drop" -> mc.options.keyDrop;
            case "swapHands" -> mc.options.keySwapOffhand;
            case "pickItem" -> mc.options.keyPickItem;
            default -> {
                if (name.startsWith("hotbar")) {
                    yield mc.options.keyHotbarSlots[Integer.parseInt(name.substring(6)) - 1];
                }
                throw new IllegalArgumentException("unknown key " + name);
            }
        };
    }

    private static final List<String> KEYS = List.of("forward", "back", "left", "right", "jump", "sneak", "sprint", "use", "attack",
        "inventory", "drop", "swapHands", "pickItem", "hotbar1", "hotbar2", "hotbar3", "hotbar4", "hotbar5", "hotbar6", "hotbar7",
        "hotbar8", "hotbar9");
    /** Keys that act on a click (KeyMapping.consumeClick) rather than while held. */
    private static final Set<String> CLICKED = Set.of("use", "attack", "inventory", "drop", "swapHands", "pickItem", "hotbar1",
        "hotbar2", "hotbar3", "hotbar4", "hotbar5", "hotbar6", "hotbar7", "hotbar8", "hotbar9");

    @Override
    public void applyKeys(Set<String> keys) {
        for (String name : KEYS) {
            KeyMapping mapping = key(name);
            boolean down = keys.contains(name);
            if (down && !mapping.isDown() && CLICKED.contains(name)) {
                KeyMapping.click(mapping.getDefaultKey());
            }
            mapping.setDown(down);
        }
    }

    @Override
    public void applyRotation(float yRot, float xRot) {
        LocalPlayer p = mc.player;
        CompatEntity.setYRot(p, yRot);
        CompatEntity.setXRot(p, xRot);
        p.yRotO = yRot;
        p.xRotO = xRot;
        p.setYHeadRot(yRot);
    }

    @Override
    public float yRot() {
        return CompatEntity.yRot(mc.player);
    }

    @Override
    public float xRot() {
        return CompatEntity.xRot(mc.player);
    }

    @Override
    public void selectSlot(int slot) {
        CompatEntity.setSelected(mc.player, slot);
    }

    @Override
    public void setAutoJump(boolean enabled) {
        CompatOptions.setAutoJump(mc, enabled);
    }

    @Override
    public void alignClient(double[] rest) {
        mc.player.tickCount = 0;
        CompatFeature.stand(mc.player);
        CompatMove.alignClient(mc);
        dev.mcpn.recorder.Fields.zero(mc.player, net.minecraft.client.player.LocalPlayer.class, "jumpRidingTicks");
        dev.mcpn.recorder.Fields.zeroFloats(mc.player, net.minecraft.client.player.LocalPlayer.class, "jumpRidingScale");
        dev.mcpn.recorder.Fields.zeroFloats(mc.level, net.minecraft.world.level.Level.class, "rainLevel", "oRainLevel", "thunderLevel", "oThunderLevel");
        // the waits after a click or a broken block, and the held items' cooldowns
        dev.mcpn.recorder.Fields.zero(mc, Minecraft.class, "missTime");
        dev.mcpn.recorder.Fields.zero(mc, Minecraft.class, "rightClickDelay");
        dev.mcpn.recorder.Fields.zero(mc.gameMode, net.minecraft.client.multiplayer.MultiPlayerGameMode.class, "destroyDelay");
        dev.mcpn.recorder.Fields.clearCooldowns(mc.player, net.minecraft.world.entity.player.Player.class);
        // what packets carry of how many blocks were predicted so far (1.19), and of the menu's changes (1.17.1)
        Object predictions = dev.mcpn.recorder.Fields.get(mc.level, net.minecraft.client.multiplayer.ClientLevel.class, "blockStatePredictionHandler");
        if (predictions != null) {
            dev.mcpn.recorder.Fields.zero(predictions, predictions.getClass(), "currentSequenceNr");
        }
        dev.mcpn.recorder.Fields.zero(mc.player.inventoryMenu, net.minecraft.world.inventory.AbstractContainerMenu.class, "stateId");
        dev.mcpn.recorder.Fields.zero(mc.player.inventoryMenu, net.minecraft.world.inventory.AbstractContainerMenu.class, "changeUid");
        // what reads the game time on the client (a camel's pose) must not depend on how long the case took to set up
        CompatOptions.setGameTime(mc, ServerOpsImpl.ALIGNED_GAME_TIME);
        dev.mcpn.recorder.mc.mixin.LocalPlayerAccessor local = (dev.mcpn.recorder.mc.mixin.LocalPlayerAccessor) mc.player;
        local.recorder$setPositionReminder(0);
        int[] o = ServerOpsImpl.origin();
        local.recorder$setXLast(o[0] + rest[0]);
        local.recorder$setYLast(o[1] + rest[1]);
        local.recorder$setZLast(o[2] + rest[2]);
        // what the rest left (a player sinks in water, as far as the rest tolerates) would go out in one more position
        // packet before the start teleport, and stay as the last sent position of a player the setup mounts
        mc.player.setPos(o[0] + rest[0], o[1] + rest[1], o[2] + rest[2]);
        CompatMove.setVelocity(mc.player, 0.0, 0.0, 0.0);
        ServerOpsImpl.resetSteps(mc.player);
    }

    @Override
    public void clearPassengerVelocity() {
        if (mc.player.isPassenger()) {
            CompatMove.setVelocity(mc.player, net.minecraft.world.phys.Vec3.ZERO);
        }
    }

    @Override
    public Json.Obj snapshot() {
        return PlayerSnap.take(mc);
    }

    @Override
    public Json.Obj phaseSnapshot(String phase) {
        return PlayerSnap.take(mc, dev.mcpn.recorder.schema.Phases.TICK_START.equals(phase));
    }

    @Override
    public Set<String> contacts() {
        Set<String> out = new TreeSet<>();
        LocalPlayer p = mc.player;
        AABB box = p.getBoundingBox();
        BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
        // in: every block the box overlaps
        each(box.deflate(1e-7), pos, state -> {
            out.add("in:" + PlayerSnap.id(BuiltInRegistries.BLOCK.getKey(state.getBlock())));
            // a waterlogged block or a water plant (kelp, seagrass) is in water too
            String fluid = CompatMove.fluid(state);
            if (fluid != null) {
                out.add("in:" + fluid);
            }
        });
        out.remove("in:air");
        out.remove("in:cave_air");
        out.remove("in:void_air");
        // on, under, against: blocks whose collision shape meets a thin probe on that side of the box (a fence the
        // player presses against is "against", not "on"; the probe's faces are exclusive, as AABB.intersects)
        if (CompatEntity.onGround(p)) {
            touching(new AABB(box.minX, box.minY - 1e-3, box.minZ, box.maxX, box.minY, box.maxZ), null, pos, "on:", out);
        }
        if (p.verticalCollision && !CompatEntity.onGround(p)) {
            touching(new AABB(box.minX, box.maxY, box.minZ, box.maxX, box.maxY + 1e-3, box.maxZ), null, pos, "under:", out);
        }
        if (p.horizontalCollision) {
            touching(box.inflate(1e-3, 0, 1e-3), box, pos, "against:", out);
        }
        return out;
    }

    /** Adds prefix+block for each block whose collision shape meets the probe and does not already meet `inside`. */
    private void touching(AABB probe, AABB inside, BlockPos.MutableBlockPos pos, String prefix, Set<String> out) {
        // (from the cell below too: a fence or wall stands out of its own; and the player's own shape, as powder snow's is
        // nothing to a context without boots)
        each(probe.expandTowards(0.0, -1.0, 0.0), pos, state -> {
            for (AABB part : CompatMove.collisionBoxes(state, mc, pos)) {
                if (part.intersects(probe) && (inside == null || !part.intersects(inside))) {
                    out.add(prefix + PlayerSnap.id(BuiltInRegistries.BLOCK.getKey(state.getBlock())));
                    return;
                }
            }
        });
    }

    private void each(AABB box, BlockPos.MutableBlockPos pos, Consumer<BlockState> visit) {
        for (int x = (int) Math.floor(box.minX); x <= (int) Math.floor(box.maxX); x++) {
            for (int y = (int) Math.floor(box.minY); y <= (int) Math.floor(box.maxY); y++) {
                for (int z = (int) Math.floor(box.minZ); z <= (int) Math.floor(box.maxZ); z++) {
                    visit.accept(mc.level.getBlockState(pos.set(x, y, z)));
                }
            }
        }
    }

    @Override
    public String clientMismatch() {
        ServerOpsImpl.Captured expected = ServerOpsImpl.captured;
        if (expected == null) {
            return "nothing captured";
        }
        // the chunks around the player must be there; a big area's far chunks arrive as the player moves (the server
        // sends what is within the view distance), so the blocks are compared where the client has their chunk
        int pcx = CompatEntity.blockX(mc.player) >> 4;
        int pcz = CompatEntity.blockZ(mc.player) >> 4;
        // the server's view distance for this client (the integrated server takes the client's render distance)
        int tracked = Math.max(1, CompatOptions.effectiveDistance(mc) - 1);
        for (int cx = pcx - 1; cx <= pcx + 1; cx++) {
            for (int cz = pcz - 1; cz <= pcz + 1; cz++) {
                if (!CompatMove.hasChunk(mc, cx, cz)) {
                    return "chunk " + cx + "," + cz + " not loaded";
                }
            }
        }
        BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
        int i = 0;
        for (int x = expected.min()[0]; x <= expected.max()[0]; x++) {
            for (int y = expected.min()[1]; y <= expected.max()[1]; y++) {
                for (int z = expected.min()[2]; z <= expected.max()[2]; z++) {
                    BlockState held = expected.states()[i++];
                    // the client keeps chunks a few rings past the server's view distance, and the server sends
                    // block changes only for the chunks it tracks for the player: only those can be compared
                    if (Math.max(Math.abs((x >> 4) - pcx), Math.abs((z >> 4) - pcz)) > tracked || !CompatMove.hasChunk(mc, x >> 4, z >> 4)) {
                        continue;
                    }
                    BlockState seen = mc.level.getBlockState(pos.set(x, y, z));
                    if (!CompatMove.sameBlock(seen, held)) {
                        return x + "," + y + "," + z + ": client " + seen + ", server " + held;
                    }
                }
            }
        }
        return null;
    }

    @Override
    public Json.Obj worldBlocks(int[] box) {
        // the server's world: the client lacks the chunks past its view distance (they come as chunk data later), and
        // what it has is what the server sent
        MinecraftServer server = mc.getSingleplayerServer();
        Json.Obj[] out = new Json.Obj[1];
        onServer(ops -> out[0] = encodeBlocks(CompatMove.overworld(server), box));
        return out[0];
    }

    private static Json.Obj encodeBlocks(net.minecraft.world.level.Level level, int[] box) {
        int[] o = ServerOpsImpl.origin();
        int[] from = {o[0] + box[0], o[1] + box[1], o[2] + box[2]};
        int[] to = {o[0] + box[3], o[1] + box[4], o[2] + box[5]};
        java.util.Map<BlockState, Integer> index = new java.util.LinkedHashMap<>();
        com.google.gson.JsonArray palette = new com.google.gson.JsonArray();
        StringBuilder runs = new StringBuilder("[");
        BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
        int current = -1;
        int count = 0;
        for (int x = from[0]; x <= to[0]; x++) {
            for (int y = from[1]; y <= to[1]; y++) {
                for (int z = from[2]; z <= to[2]; z++) {
                    BlockState state = level.getBlockState(pos.set(x, y, z));
                    Integer i = index.get(state);
                    if (i == null) {
                        i = index.size();
                        index.put(state, i);
                        palette.add(CompatMove.blockState(state).replace("minecraft:", ""));
                    }
                    if (i == current) {
                        count++;
                        continue;
                    }
                    if (count > 0) {
                        runs.append(runs.length() > 1 ? "," : "").append(current).append(',').append(count);
                    }
                    current = i;
                    count = 1;
                }
            }
        }
        runs.append(runs.length() > 1 ? "," : "").append(current).append(',').append(count).append(']');
        return new Json.Obj().raw("from", Json.ints(from)).raw("to", Json.ints(to)).raw("palette", palette.toString())
            .raw("runs", runs.toString());
    }

    @Override
    public int viewDistance() {
        // IntegratedServer.tickServer: the player list's view distance is max(2, render distance)
        return Math.max(2, CompatOptions.renderDistance(mc));
    }

    @Override
    public Json.Obj playerIdentity() {
        return new Json.Obj().num("id", mc.player.getId()).str("uuid", mc.player.getUUID().toString())
            .str("name", CompatEntity.profileName(mc.player));
    }

    @Override
    public int[] origin() {
        return ServerOpsImpl.origin();
    }

    @Override
    public void onServer(Consumer<ServerOps> task) {
        MinecraftServer server = mc.getSingleplayerServer();
        CompletableFuture<Void> done = new CompletableFuture<>();
        CompatMove.onServerThread(server, () -> {
            try {
                task.accept(new ServerOpsImpl(server));
                done.complete(null);
            } catch (Throwable t) {
                done.completeExceptionally(t);
            }
        });
        Lockstep.awaitServerTask(done);
        if (Lockstep.failure() != null && !done.isDone()) {
            // the server task timed out (the lockstep has failed): the run ends, nothing waits on it any longer
            throw new IllegalStateException("server task did not finish: " + Lockstep.failure());
        }
        try {
            done.get(60, java.util.concurrent.TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        } catch (ExecutionException e) {
            throw new IllegalStateException("server task failed: " + e.getCause(), e.getCause());
        } catch (java.util.concurrent.TimeoutException e) {
            throw new IllegalStateException("a server task did not finish in 60 s", e);
        }
    }

    @Override
    public void quit(int code) {
        // the code the run ends with, said before the halt: the halt's own exit status can be the crash below
        dev.mcpn.recorder.Log.event("exit", new dev.mcpn.recorder.Json.Obj().num("code", code));
        System.out.flush();
        System.err.flush();
        // Minecraft.stop leaves this client looping once the world is closed, and System.exit / halt end in a
        // fail-fast crash in LWJGL's native teardown on Windows (0xC0000409). The recordings are complete and
        // the runner reads the outcome from the @rec done/fatal line, so the process is halted as it stands.
        Runtime.getRuntime().halt(code);
    }

    /** Server thread, the end of each server tick: the server's view of the player and the area's entities. */
    public static void serverTicked(MinecraftServer server) {
        // what the level's random gives (a frosted block's melt, a random tick) must not depend on how many draws earlier
        // cases made: the level's next tick starts from its game time
        net.minecraft.server.level.ServerLevel overworld = CompatMove.overworld(server);
        CompatMove.seedLevel(overworld);
        Recorder recorder = Recorder.get();
        if (recorder == null || !recorder.active() || server.getPlayerList().getPlayers().size() != 1) {
            return;
        }
        ServerPlayer p = server.getPlayerList().getPlayers().get(0);
        Vec3 pos = CompatMove.position(p);
        Vec3 vel = CompatMove.velocity(p);
        Json.Obj s = new Json.Obj().num("tick", server.getTickCount())
            .vec("pos", pos.x, pos.y, pos.z).vec("vel", vel.x, vel.y, vel.z)
            .bool("onGround", CompatEntity.onGround(p)).num("fallDistance", p.fallDistance)
            .str("pose", CompatMove.pose(p)).num("health", p.getHealth())
            .bool("awaitingTeleport", CompatLiving.awaitingTeleport(p))
            // the server's own counts (the client clears its fire ticks every tick and gets the freeze ticks a tick
            // late through the entity data): what burns and freezes the player
            .num("remainingFireTicks", CompatMove.fireTicks(p)).num("ticksFrozen", CompatEntity.ticksFrozen(p));
        AABB area = ServerOpsImpl.areaBox();
        List<String> entities = new ArrayList<>();
        if (area != null) {
            ServerLevel level = CompatEntity.level(p);
            // (down to the bottom of any world and below: a cart is watched until it has fallen out of it)
            AABB watched = new AABB(area.minX, -256.0, area.minZ, area.maxX, area.maxY, area.maxZ);
            // (alive: 1.8 leaves one that changed dimension in its chunk, dead, moved to the far side's place)
            List<Entity> list = new ArrayList<>(level.getEntities((Entity) null, watched, e -> !(e instanceof Player) && e.isAlive()));
            list.sort(Comparator.comparingInt(Entity::getId));
            for (Entity e : list) {
                entities.add(PlayerSnap.serverEntity(e).text());
            }
        }
        s.raw("entities", Json.array(entities));
        recorder.serverTicked(s.text());
    }

    private static void deleteTree(Path dir) {
        if (!Files.exists(dir)) {
            return;
        }
        try (Stream<Path> paths = Files.walk(dir)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.delete(path);
                } catch (IOException e) {
                    throw new IllegalStateException("cannot delete " + path, e);
                }
            });
        } catch (IOException e) {
            throw new IllegalStateException("cannot delete " + dir, e);
        }
    }
}
