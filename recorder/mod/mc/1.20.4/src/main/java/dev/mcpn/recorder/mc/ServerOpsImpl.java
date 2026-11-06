package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Bridge;
import dev.mcpn.recorder.Json;
import dev.mcpn.recorder.Log;
import dev.mcpn.recorder.Recorder;
import dev.mcpn.recorder.model.Scenario;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.TagParser;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Difficulty;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.ai.attributes.Attribute;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.AttributeModifier;
import net.minecraft.world.entity.player.Abilities;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/** The integrated server's side of the recorder. Every method runs on the server thread. */
public final class ServerOpsImpl implements Bridge.ServerOps {
    /** setBlock flags while building: tell the clients, no neighbour updates, no drops. */
    private static final int QUIET = 2 | 16 | 32;
    /** How far around the area entities are cleared. */
    private static final int ENTITY_MARGIN = 16;

    /** True while an area is built (BlockStateBaseMixin keeps placed blocks from reacting). */
    public static volatile boolean building;
    /** The area's blocks as the server holds them after building, for BridgeImpl.clientMismatch. */
    static volatile Captured captured;
    /** The current area's absolute box, and per origin the union of every box built there (cleared before each build). */
    private static volatile int[] currentBox;
    private static final Map<String, int[]> BUILT = new HashMap<>();
    /** The current area's absolute origin. */
    private static volatile int[] origin = BridgeImpl.ORIGIN.clone();

    /** The absolute origin of the area being recorded. */
    static int[] origin() {
        return origin.clone();
    }
    /** The server's own teleports (setup, actions) are not corrections. */
    private static boolean teleporting;
    private static final Map<Object, Double> BASELINE = new HashMap<>();
    /** Summons by the scenario's ref. */
    private static final Map<String, Entity> SUMMONS = new HashMap<>();

    record Captured(int[] min, int[] max, BlockState[] states) {
    }

    private final MinecraftServer server;

    ServerOpsImpl(MinecraftServer server) {
        this.server = server;
    }

    /** The world's difficulty now. */
    private static String difficulty = "peaceful";
    /** Whether a landing, a fire or the cold hurts now: only in a mortal case, whose health is what it records. */
    private static boolean mortalDamage = false;

    private ServerPlayer player() {
        return server.getPlayerList().getPlayers().get(0);
    }

    private ServerLevel level() {
        return CompatEntity.level(player());
    }

    private static int[] abs(int[] rel) {
        int[] o = origin;
        return new int[] {o[0] + rel[0], o[1] + rel[1], o[2] + rel[2]};
    }

    private static Vec3 abs(double[] rel) {
        int[] o = origin;
        return new Vec3(o[0] + rel[0], o[1] + rel[1], o[2] + rel[2]);
    }

    /** The current area's absolute box (for the server's entity view), or null. */
    static AABB areaBox() {
        int[] b = currentBox;
        return b == null ? null : new AABB(b[0], b[1], b[2], b[3] + 1, b[4] + 1, b[5] + 1);
    }

    // ---------------------------------------------------------------------------------------------

    @Override
    public void configureWorld() {
        ServerLevel level = level();
        GameRules rules = level.getGameRules();
        CompatServer.stopWorldRules(rules, server);
        CompatServer.stopRandomTicks(rules, server);
        CompatServer.stopDamageRules(rules, server);
        CompatServer.stopFreezeDamage(rules, server);
        CompatServer.stopVines(rules, server);
        CompatServer.stopDropRules(rules, server);
        CompatMove.peaceful(server);
        CompatServer.setDayTime(level, 6000);
        CompatServer.clearWeather(level);
        // keep the area's chunks loaded for the whole run, so no case streams chunks
        int[] o = BridgeImpl.ORIGIN;
        for (int cx = (o[0] >> 4) - 3; cx <= (o[0] >> 4) + 3; cx++) {
            for (int cz = (o[2] >> 4) - 3; cz <= (o[2] >> 4) + 3; cz++) {
                CompatMove.forceChunk(level, cx, cz);
            }
        }
        ServerPlayer player = player();
        for (Map.Entry<String, Object> attribute : CompatAttr.all()) {
            AttributeInstance instance = CompatAttr.instance(player, attribute.getValue());
            if (instance != null) {
                BASELINE.put(attribute.getValue(), instance.getBaseValue());
            }
        }
        List<Entity> loaded = new ArrayList<>();
        CompatMove.entities(level).forEach(loaded::add);
        for (Entity e : loaded) {
            if (e != null && !(e instanceof Player)) {
                CompatEntity.discard(e);
            }
        }
        // (somewhere every release has: a case that moves it puts it back)
        runCommand("setworldspawn 0 100 0");
        Log.info("world configured: %d player attributes", BASELINE.size());
    }

    @Override
    public String prepare(Scenario scenario) {
        ServerPlayer player = player();
        // ServerGamePacketListenerImpl kicks a player floating too long unless the server allows flight
        CompatServer.setFlightAllowed(server, scenario.setup.allowFlight);
        teleporting = true;
        try {
            CompatLiving.stopRiding(player);
        } finally {
            teleporting = false;
        }
        // what would otherwise wear out at the pace of the ticks between two cases, which no case sets: the input a rider
        // sent (ServerPlayer.setPlayerInput), which aiStep fades by 0.98 and travel turns into the server's velocity, and the
        // arrows the last case left, whose countdown ends in a packet (LivingEntity.tick)
        player.xxa = 0.0F;
        player.zza = 0.0F;
        player.setArrowCount(0);
        player.removeArrowTime = 0;
        player.removeAllEffects();
        CompatLiving.setNoGravity(player, false);
        for (Map.Entry<Object, Double> base : BASELINE.entrySet()) {
            AttributeInstance instance = CompatAttr.instance(player, base.getKey());
            if (instance != null) {
                CompatAttr.clearModifiers(instance);
                instance.setBaseValue(base.getValue());
            }
        }
        CompatEntity.inventory(player).clearContent();
        // an advancement is sent the first time a case earns it: which case that is would follow the run order
        runCommand("advancement revoke @s everything");
        resetFeatures(player);
        CompatEntity.setSelected(player, 0);
        player.connection.send(CompatServer.carriedItem(0));
        player.getFoodData().setFoodLevel(20);
        player.getFoodData().setSaturation(5.0F);
        // how far the next food point or health point is
        dev.mcpn.recorder.Fields.zero(player.getFoodData(), net.minecraft.world.food.FoodData.class, "tickTimer");
        dev.mcpn.recorder.Fields.zeroFloats(player.getFoodData(), net.minecraft.world.food.FoodData.class, "exhaustionLevel");
        player.setScore(0);
        CompatEntity.setTicksFrozen(player, 0);
        player.clearFire();
        player.setAirSupply(CompatMove.maxAir(player));
        player.fallDistance = 0.0F;
        player.stopUsingItem();
        player.setHealth(player.getMaxHealth());
        setGameMode(player, "survival");
        // (the respawn packet says what it was, and cannot say nothing on 1.16)
        dev.mcpn.recorder.Fields.copy(player.gameMode, net.minecraft.server.level.ServerPlayerGameMode.class, "gameModeForPlayer", "previousGameModeForPlayer");
        dev.mcpn.recorder.Fields.clearStats(player, ServerPlayer.class);
        Abilities abilities = CompatEntity.abilities(player);
        abilities.mayfly = false;
        abilities.flying = false;
        abilities.setFlyingSpeed(0.05F);
        abilities.setWalkingSpeed(0.1F);
        abilities.invulnerable = true;
        player.onUpdateAbilities();

        origin = scenario.area.origin != null ? scenario.area.origin.clone() : BridgeImpl.ORIGIN.clone();
        int[] box = scenario.area.box;
        int[] min = abs(new int[] {box[0], box[1], box[2]});
        int[] max = abs(new int[] {box[3], box[4], box[5]});
        currentBox = new int[] {min[0], min[1], min[2], max[0], max[1], max[2]};
        tallBox = max[1] - min[1] >= TALL;
        String at = java.util.Arrays.toString(origin);
        int[] built = BUILT.get(at);
        int[] clear = built == null ? currentBox : union(built, currentBox);
        BUILT.put(at, clear);
        clearEntities(clear);
        clearOtherLevels();
        SUMMONS.clear();

        ServerLevel level = level();
        List<BlockState> fills = new ArrayList<>();
        for (Scenario.Fill fill : scenario.area.fills) {
            BlockState state = resolve(fill.block);
            if (state == null) {
                return "no block " + fill.block;
            }
            fills.add(state);
        }
        // the quiet fills before the first one that updates its neighbours, whose order cannot be changed past it
        int quiet = 0;
        while (quiet < fills.size() && !scenario.area.fills.get(quiet).update) {
            quiet++;
        }
        building = true;
        try {
            // the box as it must end up (air, then those fills in order), written only where the world differs:
            // a case on the area of the case before it rewrites only what that case changed
            rebuild(level, clear, scenario.area.fills.subList(0, quiet), fills.subList(0, quiet));
        } finally {
            building = false;
        }
        for (int i = quiet; i < fills.size(); i++) {
            Scenario.Fill fill = scenario.area.fills.get(i);
            building = !fill.update;
            try {
                fill(level, abs(fill.from), abs(fill.to), fills.get(i), fill.update ? 3 : QUIET);
            } finally {
                building = false;
            }
        }
        if (tallBox) {
            CompatTallBox.settle(level, clear);
        }
        clearEntities(clear);
        loadChunks(level, min, max);
        // the current area only (the union cleared above may reach past what the client loads)
        capture(level, min, max);
        return null;
    }

    /** Writes the box's target states (air under the quiet fills) where the world holds something else. */
    private static void rebuild(ServerLevel level, int[] box, List<Scenario.Fill> specs, List<BlockState> states) {
        int sx = box[3] - box[0] + 1;
        int sy = box[4] - box[1] + 1;
        int sz = box[5] - box[2] + 1;
        BlockState air = net.minecraft.world.level.block.Blocks.AIR.defaultBlockState();
        BlockState[] target = new BlockState[sx * sy * sz];
        java.util.Arrays.fill(target, air);
        for (int i = 0; i < specs.size(); i++) {
            Scenario.Fill fill = specs.get(i);
            if (fill.update) {
                continue;
            }
            int[] a = abs(fill.from);
            int[] b = abs(fill.to);
            int x0 = Math.max(box[0], Math.min(a[0], b[0])), x1 = Math.min(box[3], Math.max(a[0], b[0]));
            int y0 = Math.max(box[1], Math.min(a[1], b[1])), y1 = Math.min(box[4], Math.max(a[1], b[1]));
            int z0 = Math.max(box[2], Math.min(a[2], b[2])), z1 = Math.min(box[5], Math.max(a[2], b[2]));
            for (int x = x0; x <= x1; x++) {
                for (int y = y0; y <= y1; y++) {
                    for (int z = z0; z <= z1; z++) {
                        target[((x - box[0]) * sy + (y - box[1])) * sz + (z - box[2])] = states.get(i);
                    }
                }
            }
        }
        for (int x = 0; x < sx; x++) {
            for (int y = 0; y < sy; y++) {
                for (int z = 0; z < sz; z++) {
                    dev.mcpn.recorder.Lockstep.serverTaskStep();
                    BlockState want = target[(x * sy + y) * sz + z];
                    // (no mutable position: until 1.12.2 the chunk keeps the one it is given as the key of a block entity,
                    // 1.12.2 Chunk.java:672, and the next cell's moved it: the entity was lost to getBlockEntity)
                    BlockPos pos = new BlockPos(box[0] + x, box[1] + y, box[2] + z);
                    // a block entity is made anew even when its state is right: its own state (a sculk sensor's
                    // pending vibration, a cooldown) would carry over from whatever case ran here before
                    if (level.getBlockState(pos) != want || level.getBlockEntity(pos) != null) {
                        CompatServer.clear(level.getBlockEntity(pos));
                        if (level.getBlockEntity(pos) != null) {
                            level.setBlock(pos, air, QUIET);
                        }
                        level.setBlock(pos, want, QUIET);
                    }
                }
            }
        }
        // and the ticks the blocks scheduled (a sculk sensor's return to inactive, a flowing liquid's spread)
        net.minecraft.world.level.levelgen.structure.BoundingBox bounds =
            new net.minecraft.world.level.levelgen.structure.BoundingBox(box[0], box[1], box[2], box[3], box[4], box[5]);
        CompatServer.clearTicks(level, bounds);
    }

    /** The chunks the area can bring into view, kept loaded: forced on first use, never released. */
    private static final java.util.Set<Long> FORCED = new java.util.HashSet<>();

    /**
     * Loads (generates and lights) every chunk within the view distance of the area before the case starts, and keeps
     * it loaded: a chunk the player first brings into view during a case would be generated and lit on worker threads,
     * and arrive on whichever tick they finish.
     */
    /**
     * Whether every chunk an area forced is ticking: a loaded chunk gets there on worker threads, and the server sends a
     * chunk that comes into view only once it is, so a case's start teleport would see chunks of a first-used area late.
     */
    static boolean forcedChunksTicking(ServerLevel level) {
        for (long chunk : FORCED) {
            if (!CompatServer.chunkTicking(level, chunk)) {
                return false;
            }
        }
        return true;
    }

    private void loadChunks(ServerLevel level, int[] min, int[] max) {
        int reach = server.getPlayerList().getViewDistance() + 1;
        for (int cx = (min[0] >> 4) - reach; cx <= (max[0] >> 4) + reach; cx++) {
            for (int cz = (min[2] >> 4) - reach; cz <= (max[2] >> 4) + reach; cz++) {
                if (FORCED.add(net.minecraft.world.level.ChunkPos.asLong(cx, cz))) {
                    CompatMove.forceChunk(level, cx, cz);
                }
                level.getChunk(cx, cz);
                dev.mcpn.recorder.Lockstep.serverTaskStep();
            }
        }
    }

    private static int[] union(int[] a, int[] b) {
        return new int[] {Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]),
            Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])};
    }

    private void clearEntities(int[] box) {
        // (and under it: what fell through a case's floor, or came back from a portal, is in the view the next case keeps)
        AABB area = new AABB(box[0], -256.0, box[2], box[3] + 1, box[4] + 1, box[5] + 1).inflate(ENTITY_MARGIN);
        for (Entity e : level().getEntities((Entity) null, area, e -> !(e instanceof Player))) {
            CompatLiving.eject(e);
            CompatEntity.discard(e);
        }
    }

    /**
     * What a portal took out of the case that sent it: left there, a cart goes with its chunk and comes back when a later
     * case loads that chunk, on the worker threads' timing, with its age counted from then.
     */
    private void clearOtherLevels() {
        for (ServerLevel other : CompatMove.levels(server)) {
            if (other != level()) {
                List<Entity> loaded = new ArrayList<>();
                CompatMove.entities(other).forEach(loaded::add);
                for (Entity e : loaded) {
                    if (e != null && !(e instanceof Player)) {
                        CompatEntity.discard(e);
                    }
                }
            }
        }
    }

    private static void fill(ServerLevel level, int[] min, int[] max, BlockState state, int flags) {
        for (int x = Math.min(min[0], max[0]); x <= Math.max(min[0], max[0]); x++) {
            for (int y = Math.min(min[1], max[1]); y <= Math.max(min[1], max[1]); y++) {
                for (int z = Math.min(min[2], max[2]); z <= Math.max(min[2], max[2]); z++) {
                    BlockPos pos = new BlockPos(x, y, z);
                    if (level.getBlockState(pos) != state) {
                        CompatServer.clear(level.getBlockEntity(pos));
                        level.setBlock(pos, state, flags);
                    }
                }
            }
        }
    }

    private static void capture(ServerLevel level, int[] min, int[] max) {
        BlockState[] states = new BlockState[(max[0] - min[0] + 1) * (max[1] - min[1] + 1) * (max[2] - min[2] + 1)];
        BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
        int i = 0;
        for (int x = min[0]; x <= max[0]; x++) {
            for (int y = min[1]; y <= max[1]; y++) {
                for (int z = min[2]; z <= max[2]; z++) {
                    states[i++] = level.getBlockState(pos.set(x, y, z));
                }
            }
        }
        captured = new Captured(min, max, states);
    }

    static BlockState resolve(String state) {
        String id = state.contains("[") ? state.substring(0, state.indexOf('[')) : state;
        if (!BuiltInRegistries.BLOCK.containsKey(CompatNames.id(id))) {
            return null;
        }
        try {
            return CompatServer.parseBlock(state);
        } catch (Exception e) {
            throw new IllegalArgumentException("bad block state '" + state + "': " + e.getMessage(), e);
        }
    }

    @Override
    public void dismount() {
        teleporting = true;
        try {
            CompatLiving.stopRiding(player());
        } finally {
            teleporting = false;
        }
    }

    @Override
    public void teleport(double[] relativePos, float yRot, float xRot) {
        ServerPlayer player = player();
        Vec3 pos = abs(relativePos);
        teleporting = true;
        try {
            CompatLiving.stopRiding(player);
            CompatMove.setVelocity(player, Vec3.ZERO);
            player.fallDistance = 0.0F;
            CompatServer.teleportAbsolute(player, level(), pos.x, pos.y, pos.z, yRot, xRot);
        } finally {
            teleporting = false;
        }
    }

    @Override
    public String setup(Scenario scenario) {
        if (scenario.mortal != mortalDamage) {
            mortalDamage = scenario.mortal;
            CompatServer.mortalDamage(level().getGameRules(), server, mortalDamage);
        }
        String wanted = scenario.difficulty != null ? scenario.difficulty : "peaceful";
        if (!wanted.equals(difficulty)) {
            difficulty = wanted;
            runCommand("difficulty " + wanted);
        }
        ServerPlayer player = player();
        Scenario.Setup setup = scenario.setup;
        setGameMode(player, setup.gameMode);
        Abilities abilities = CompatEntity.abilities(player);
        if (setup.abilities != null) {
            if (setup.abilities.mayfly != null) {
                abilities.mayfly = setup.abilities.mayfly;
            }
            if (setup.abilities.flying != null) {
                abilities.flying = setup.abilities.flying;
            }
            if (setup.abilities.flyingSpeed != null) {
                abilities.setFlyingSpeed(setup.abilities.flyingSpeed);
            }
            if (setup.abilities.walkingSpeed != null) {
                abilities.setWalkingSpeed(setup.abilities.walkingSpeed);
            }
        }
        abilities.invulnerable = !scenario.mortal;
        player.onUpdateAbilities();
        player.getFoodData().setFoodLevel(setup.food);
        if (setup.effects != null) {
            for (Scenario.Effect effect : setup.effects) {
                String skip = addEffect(player, effect);
                if (skip != null) {
                    return skip;
                }
            }
        }
        if (setup.attributes != null) {
            for (Scenario.Attribute attribute : setup.attributes) {
                String skip = setAttribute(player, attribute);
                if (skip != null) {
                    return skip;
                }
            }
        }
        if (setup.equipment != null) {
            for (Map.Entry<String, Scenario.Item> entry : setup.equipment.entrySet()) {
                String skip = equip(player, entry.getKey(), entry.getValue());
                if (skip != null) {
                    return skip;
                }
            }
        }
        if (setup.inventory != null) {
            for (Map.Entry<String, Scenario.Item> entry : setup.inventory.entrySet()) {
                ItemStack stack = stack(entry.getValue());
                if (stack == null) {
                    return "no item " + entry.getValue().id;
                }
                CompatEntity.inventory(player).setItem(Integer.parseInt(entry.getKey()), stack);
            }
            CompatEntity.setSelected(player, setup.selectedSlot);
        }
        if (setup.summons != null) {
            for (Scenario.Summon summon : setup.summons) {
                String skip = summon(summon);
                if (skip != null) {
                    return skip;
                }
            }
        }
        if (setup.mount != null) {
            Entity vehicle = SUMMONS.get(setup.mount);
            if (vehicle == null || !CompatEntity.startRiding(player, vehicle)) {
                return "cannot mount " + setup.mount;
            }
        }
        if (setup.commands != null) {
            for (String command : setup.commands) {
                runCommand(command);
            }
        }
        return null;
    }

    private void runCommand(String command) {
        CompatMove.runCommand(server, player(), command);
    }

    /** What a feature case leaves in the game, for the next one. */
    private void resetFeatures(ServerPlayer player) {
        net.minecraft.world.scores.Scoreboard scoreboard = CompatMove.scoreboard(server);
        for (net.minecraft.world.scores.Objective objective : List.copyOf(scoreboard.getObjectives())) {
            scoreboard.removeObjective(objective);
        }
        for (net.minecraft.world.scores.PlayerTeam team : List.copyOf(scoreboard.getPlayerTeams())) {
            scoreboard.removePlayerTeam(team);
        }
        CompatMove.clearBossBars(server);
        if (player.containerMenu != player.inventoryMenu) {
            player.closeContainer();
        }
        CompatMove.clearExperience(player);
        clearEnchantmentSeed(player);
        clearRespawnPoint(player);
    }

    /** What an enchanting table offers next: each enchantment draws a new one, for whichever case comes after. */
    private static void clearEnchantmentSeed(ServerPlayer player) {
        try {
            java.lang.reflect.Field seed = net.minecraft.world.entity.player.Player.class.getDeclaredField("enchantmentSeed");
            seed.setAccessible(true);
            seed.setInt(player, 0);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    /** ServerPlayer.setRespawnPosition with nothing to respawn at: its arguments change from release to release. */
    private static void clearRespawnPoint(ServerPlayer player) {
        for (java.lang.reflect.Method method : ServerPlayer.class.getMethods()) {
            if (!method.getName().equals("setRespawnPosition")) {
                continue;
            }
            Object[] args = new Object[method.getParameterCount()];
            try {
                for (int i = 0; i < args.length; i++) {
                    Class<?> type = method.getParameterTypes()[i];
                    args[i] = type == boolean.class ? (Object) false : type == float.class ? (Object) 0.0F
                        : type.getSimpleName().equals("ResourceKey") ? overworld() : null;
                }
                method.invoke(player, args);
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            }
            return;
        }
        throw new IllegalStateException("no ServerPlayer.setRespawnPosition");
    }

    /** Level.OVERWORLD, a dimension's key (there is none to name before 1.16, nor a method that takes one). */
    private static Object overworld() throws ReflectiveOperationException {
        return net.minecraft.world.level.Level.class.getField("OVERWORLD").get(null);
    }

    /**
     * What ticks in a block entity from when it was built, which a case's settling makes a different count of ticks ago:
     * before 1.17, a chest recounting who has it open and an ender chest telling its viewers every 20 ticks.
     */
    private static void alignBlockEntities(ServerLevel level, int[] box) {
        if (interval(net.minecraft.world.level.block.entity.ChestBlockEntity.class) == null) {
            return;
        }
        BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
        for (int x = box[0]; x <= box[3]; x++) {
            for (int y = box[1]; y <= box[4]; y++) {
                for (int z = box[2]; z <= box[5]; z++) {
                    net.minecraft.world.level.block.entity.BlockEntity entity = level.getBlockEntity(pos.set(x, y, z));
                    java.lang.reflect.Field interval = entity == null ? null : interval(entity.getClass());
                    if (interval != null) {
                        try {
                            interval.setInt(entity, 0);
                        } catch (IllegalAccessException e) {
                            throw new IllegalStateException(e);
                        }
                    }
                }
            }
        }
    }

    /** Before 1.17 the level ticks a list of its own: a block rebuilt in place can leave its old block entity in it, ticking on. */
    private static void dropStaleBlockEntities(ServerLevel level) {
        for (String name : List.of("tickingBlockEntities", "tickableBlockEntities", "blockEntities", "blockEntityList")) {
            Object list = dev.mcpn.recorder.Fields.get(level, net.minecraft.world.level.Level.class, name);
            if (list instanceof List<?> held) {
                // (looking one up can change the lists)
                List<Object> stale = new ArrayList<>();
                for (Object entity : List.copyOf(held)) {
                    net.minecraft.world.level.block.entity.BlockEntity blockEntity = (net.minecraft.world.level.block.entity.BlockEntity) entity;
                    if (level.getBlockEntity(blockEntity.getBlockPos()) != blockEntity) {
                        stale.add(entity);
                    }
                }
                held.removeAll(stale);
            }
        }
    }

    /** The class's tickInterval, or null. */
    private static java.lang.reflect.Field interval(Class<?> type) {
        for (Class<?> c = type; c != null; c = c.getSuperclass()) {
            try {
                java.lang.reflect.Field field = c.getDeclaredField("tickInterval");
                field.setAccessible(true);
                return field;
            } catch (NoSuchFieldException e) {
                // (its parent's, if any)
            }
        }
        return null;
    }

    /** The random behind UUIDs nothing else seeds (a boss bar's), where the release has one. */
    private static void seedSharedRandom(long seed) {
        try {
            java.lang.reflect.Field shared = net.minecraft.util.Mth.class.getDeclaredField("RANDOM");
            shared.setAccessible(true);
            Object random = shared.get(null);
            random.getClass().getMethod("setSeed", long.class).invoke(random, seed);
        } catch (NoSuchFieldException e) {
            // (none: the caller's random makes them)
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    @Override
    public boolean fishBiting() {
        Object hook = dev.mcpn.recorder.Fields.get(player(), net.minecraft.world.entity.player.Player.class, "fishing");
        return hook != null && dev.mcpn.recorder.Fields.getInt(hook, hook.getClass(), "nibble") > 0;
    }

    @Override
    public void alignStart() {
        ServerLevel level = level();
        ServerPlayer player = player();
        CompatServer.setDayTime(level, 6000);
        ((dev.mcpn.recorder.mc.mixin.ServerLevelAccessor) level).recorder$serverLevelData().setGameTime(ALIGNED_GAME_TIME);
        ((dev.mcpn.recorder.mc.mixin.MinecraftServerAccessor) server).recorder$setTickCount(ALIGNED_TICK);
        dropStaleBlockEntities(level);
        alignBlockEntities(level, currentBox);
        // (the draws the setup made, however many it took)
        CompatMove.seed(level, entitySeedBase);
        player.getRandom().setSeed(entitySeedBase);
        seedSharedRandom(entitySeedBase);
        // (a mob draws on its own for as long as the setup takes)
        for (Entity entity : CompatMove.entities(level)) {
            if (entity != null) {
                dev.mcpn.recorder.Fields.seedRandom(entity, Entity.class, entitySeedBase ^ entity.getId());
            }
        }
        player.tickCount = 0;
        resetPistonDeltas(player);
        // (peaceful adds to it from 1.21, on the player's own ticks)
        player.getFoodData().setSaturation(5.0F);
    }

    /**
     * How far this tick's pistons have moved an entity, from 1.11. It clears only when the game time changes (26.3
     * Entity.java:1150-1153), and every case restarts the game time: a case would go on from a push of an earlier case at
     * the same time, which nothing records. So a case starts from none.
     */
    static void resetPistonDeltas(Entity entity) {
        dev.mcpn.recorder.Fields.zeroDoubles(entity, Entity.class, "pistonDeltas");
    }

    @Override
    public void align(long seed) {
        ServerLevel level = level();
        ServerPlayer player = player();
        CompatServer.setDayTime(level, 6000);
        ((dev.mcpn.recorder.mc.mixin.ServerLevelAccessor) level).recorder$serverLevelData().setGameTime(ALIGNED_GAME_TIME);
        CompatMove.seed(level, seed);
        player.getRandom().setSeed(seed);
        entitySeedBase = seed;
        entityIdBase = 1_000_000 + (int) ((seed ^ seed >>> 32) & 0x3FFFF) * 4096;
        seedSharedRandom(seed);
        alignBlockEntities(level, currentBox);
        // what packets carry of how many menus the player has opened and how often this one changed (state ids, 1.17.1)
        // (rain fades over some ticks, into the next case)
        dev.mcpn.recorder.Fields.zeroFloats(level, net.minecraft.world.level.Level.class, "rainLevel", "oRainLevel", "thunderLevel", "oThunderLevel");
        dev.mcpn.recorder.Fields.zero(player, ServerPlayer.class, "containerCounter");
        dev.mcpn.recorder.Fields.clearCooldowns(player, net.minecraft.world.entity.player.Player.class);
        dev.mcpn.recorder.Fields.zero(player.inventoryMenu, net.minecraft.world.inventory.AbstractContainerMenu.class, "stateId");
        dev.mcpn.recorder.Fields.zero(player.inventoryMenu, net.minecraft.world.inventory.AbstractContainerMenu.class, "changeUid");
        clientEntityCount = 0;
        entityCount = 0;
        CompatLiving.alignTeleport(player);
        CompatFeature.stand(player);
        ((dev.mcpn.recorder.mc.mixin.PlayerListAccessor) server.getPlayerList()).recorder$setSendAllPlayerInfoIn(0);
        // the phases of the periodic packets: the time every 20 server ticks, the player's tracked changes
        // (attributes, entity data) every updateInterval ticks
        ((dev.mcpn.recorder.mc.mixin.MinecraftServerAccessor) server).recorder$setTickCount(ALIGNED_TICK);
        CompatMove.alignTracker(level, player);
        player.tickCount = 0;
        // the walked distances the step game events follow (a sculk sensor hears them): what ran before would
        // decide on which tick of the case the first step sounds
        resetSteps(player);
    }

    /** Entity's step bookkeeping as a new entity has it. */
    static void resetSteps(net.minecraft.world.entity.Entity e) {
        CompatEntity.resetWalk(e);
        e.moveDist = 0;
        CompatEntity.resetFlyDistance(e);
        ((dev.mcpn.recorder.mc.mixin.EntityAccessor) e).recorder$setNextStep(1.0F);
    }

    /** How high a box is left unlit while it is built, before 1.14: see skipLight. */
    private static final int TALL = 32;
    private static boolean tallBox;

    /**
     * Before 1.14 each block built relights its column on the server thread, which takes a tall box over a minute, so a
     * tall box is left unlit. Only those: frosted ice melts by its light, and the physics of a tall box reads none.
     * What it skips also keeps the height map, which says what sees the sky: CompatTallBox puts that right afterwards.
     */
    public static boolean skipLight() {
        return building && tallBox;
    }

    /** The game time every case starts from (the time packet carries it). */
    static final long ALIGNED_GAME_TIME = 1_000_000L;
    /** The seeds of the server entities a case makes: its seed, then their order (null before the first case). */
    private static volatile Long entitySeedBase;
    private static long entityCount;

    /** The seed of the next server entity, or null outside a case. */
    public static Long nextEntitySeed() {
        Long base = entitySeedBase;
        return base == null ? null : base * 6364136223846793005L + 1442695040888963407L * ++entityCount;
    }

    /**
     * The id of the server entity {@link #nextEntitySeed} last seeded: the case's own block of ids, so neither the cases
     * before it nor what the client made (the client and the integrated server share the id counter) show in them.
     */
    public static int lastEntityId() {
        return entityIdBase + (int) entityCount;
    }

    private static int entityIdBase;
    private static long clientEntityCount;

    /** The seed of the next client entity, or null outside a case (client thread: what a client mob draws for itself). */
    public static Long nextClientEntitySeed() {
        Long base = entitySeedBase;
        return base == null ? null : ~base * 6364136223846793005L + 1442695040888963407L * ++clientEntityCount;
    }

    /** The server tick count every case starts from (a multiple of 20: the time packet's period). */
    private static final int ALIGNED_TICK = 72000;

    @Override
    public String action(Scenario.Action a) {
        ServerPlayer player = player();
        switch (a.op) {
            case "velocity" -> {
                Entity target = a.target == null ? player : SUMMONS.get(a.target);
                if (target == null) {
                    return "unknown summon " + a.target;
                }
                CompatMove.setVelocity(target, a.vel[0], a.vel[1], a.vel[2]);
                target.hurtMarked = true;
            }
            case "knockback" -> CompatServer.knockback(player, a.strength, a.dx, a.dz);
            case "teleport" -> {
                Set<String> relative = a.relative == null ? Set.of() : new java.util.HashSet<>(a.relative);
                teleporting = true;
                try {
                    CompatServer.teleport(player, level(), a.pos, origin, relative, a.yRot == null ? 0 : a.yRot, a.xRot == null ? 0 : a.xRot);
                } finally {
                    teleporting = false;
                }
            }
            case "explode" -> {
                Vec3 pos = abs(a.pos);
                CompatServer.explode(level(), pos.x, pos.y, pos.z, a.power);
            }
            case "setBlock", "fill" -> {
                BlockState state = resolve(a.block);
                if (state == null) {
                    return "no block " + a.block;
                }
                int[] from = "setBlock".equals(a.op) ? toInts(a.pos) : a.from;
                int[] to = "setBlock".equals(a.op) ? toInts(a.pos) : a.to;
                fill(level(), abs(from), abs(to), state, a.update ? 3 : QUIET);
            }
            case "effect" -> {
                return addEffect(player, a.effect);
            }
            case "removeEffect" -> {
                Object effect = CompatAttr.effectById(a.id);
                if (effect == null) {
                    return "no effect " + a.id;
                }
                CompatAttr.removeEffect(player, effect);
            }
            case "attribute" -> {
                return setAttribute(player, a.attribute);
            }
            case "abilities" -> {
                Abilities abilities = CompatEntity.abilities(player);
                if (a.mayfly != null) {
                    abilities.mayfly = a.mayfly;
                }
                if (a.flying != null) {
                    abilities.flying = a.flying;
                }
                if (a.flyingSpeed != null) {
                    abilities.setFlyingSpeed(a.flyingSpeed);
                }
                if (a.walkingSpeed != null) {
                    abilities.setWalkingSpeed(a.walkingSpeed);
                }
                player.onUpdateAbilities();
            }
            case "gameMode" -> setGameMode(player, a.gameMode);
            case "summon" -> {
                return summon(a.summon);
            }
            case "mount" -> {
                Entity vehicle = SUMMONS.get(a.ref);
                if (vehicle == null || !CompatEntity.startRiding(player, vehicle)) {
                    return "cannot mount " + a.ref;
                }
            }
            case "dismount" -> CompatLiving.stopRiding(player);
            case "remove" -> {
                Entity e = SUMMONS.remove(a.ref);
                if (e != null) {
                    CompatEntity.discard(e);
                }
            }
            case "equip" -> {
                return equip(player, a.slot, a.item);
            }
            case "command" -> runCommand(a.command);
            case "resourcePack" -> CompatPack.send(player, a.url, a.packHash, a.required, a.prompt, a.pop);
            case "tabList" -> CompatFeature.tabList(player, a.header, a.footer);
            case "kick" -> CompatFeature.kick(player, a.reason);
            case "blockDamage" -> {
                // an id no entity has: the server sends the progress to every player near, as for another's digging
                int[] at = abs(toInts(a.pos));
                level().destroyBlockProgress(-1000000, new net.minecraft.core.BlockPos(at[0], at[1], at[2]), a.stage);
            }
            case "respawnPoint" -> {
                int[] at = abs(toInts(a.pos));
                // (forced, as the command makes it: exactly there, and without a bed)
                runCommand("spawnpoint @p " + at[0] + " " + at[1] + " " + at[2]);
            }
            case "clearEffects" -> player.removeAllEffects();
            case "noGravity" -> CompatLiving.setNoGravity(player, a.noGravity);
            case "food" -> {
                player.getFoodData().setFoodLevel(a.food);
                player.getFoodData().setSaturation(5.0F);
            }
            default -> throw new IllegalArgumentException("unknown server action " + a.op);
        }
        return null;
    }

    private static int[] toInts(double[] values) {
        return new int[] {(int) Math.floor(values[0]), (int) Math.floor(values[1]), (int) Math.floor(values[2])};
    }

    @Override
    public void velocity(double[] vel) {
        ServerPlayer player = player();
        CompatMove.setVelocity(player, vel[0], vel[1], vel[2]);
        player.hurtMarked = true;
    }

    private static void setGameMode(ServerPlayer player, String mode) {
        GameType type = GameType.byName(mode,null);
        if (type == null) {
            throw new IllegalArgumentException("unknown game mode '" + mode + "'");
        }
        player.setGameMode(type);
    }

    private static String addEffect(ServerPlayer player, Scenario.Effect e) {
        Object effect = CompatAttr.effectById(e.id);
        if (effect == null) {
            return "no effect " + e.id;
        }
        int duration = e.duration < 0 ? CompatServer.INFINITE_EFFECT : e.duration;
        player.addEffect(CompatAttr.effect(effect, duration, e.amplifier, e.ambient != null && e.ambient, e.visible == null || e.visible));
        return null;
    }

    private static String setAttribute(ServerPlayer player, Scenario.Attribute a) {
        AttributeInstance instance = CompatAttr.instance(player, CompatAttr.byId(a.id));
        if (instance == null) {
            return "no attribute " + a.id;
        }
        if (a.base != null) {
            instance.setBaseValue(a.base);
        }
        if (a.modifiers != null) {
            for (Scenario.Modifier m : a.modifiers) {
                CompatAttr.addModifier(instance, m);
            }
        }
        return null;
    }

    private static String equip(ServerPlayer player, String slot, Scenario.Item item) {
        ItemStack stack = stack(item);
        if (stack == null) {
            return "no item " + item.id;
        }
        CompatLiving.equip(player, slot, stack);
        return null;
    }

    /** The item as a stack, or null when the release lacks it or one of its enchantments. */
    private static ItemStack stack(Scenario.Item item) {
        ResourceLocation id = CompatNames.id(item.id);
        if (!BuiltInRegistries.ITEM.containsKey(id)) {
            return null;
        }
        ItemStack stack = CompatMove.stack(CompatServer.item(id), item.count, item.damage);
        if (item.enchantments != null) {
            for (Map.Entry<String, Integer> e : item.enchantments.entrySet()) {
                if (!CompatEnch.enchant(stack, e.getKey(), e.getValue())) {
                    return null;
                }
            }
        }
        return stack;
    }

    private String summon(Scenario.Summon s) {
        Entity e = createEntity(s.type);
        if (e == null) {
            return "no entity " + s.type;
        }
        if (s.nbt != null) {
            try {
                CompatServer.mergeNbt(e, s.nbt);
            } catch (Exception ex) {
                throw new IllegalArgumentException("bad nbt " + s.nbt, ex);
            }
        }
        Vec3 pos = abs(s.pos);
        CompatEntity.moveTo(e, pos.x, pos.y, pos.z, s.yRot == null ? 0 : s.yRot, s.xRot == null ? 0 : s.xRot);
        // LivingEntity's constructor turns the head (and so the body) by Math.random(), which no seed reaches: the body
        // seats a rider (a llama's offset follows it), so both face the summon's way
        if (e instanceof net.minecraft.world.entity.LivingEntity living) {
            living.setYHeadRot(CompatEntity.yRot(living));
            living.setYBodyRot(CompatEntity.yRot(living));
        }
        if (s.vel != null) {
            CompatMove.setVelocity(e, s.vel[0], s.vel[1], s.vel[2]);
        }
        if (s.noAi && e instanceof Mob mob) {
            mob.setNoAi(true);
        }
        if (s.noGravity != null) {
            CompatLiving.setNoGravity(e, s.noGravity);
        }
        String skip = ready(e, s);
        if (skip != null) {
            return skip;
        }
        level().addFreshEntity(e);
        SUMMONS.put(s.ref, e);
        return null;
    }

    /**
     * The entity for a modern id. Before 1.21.2 every boat is one "boat" (or "chest_boat") entity with a wood
     * variant, the bamboo raft its bamboo variant.
     */
    private Entity createEntity(String id) {
        Entity boat = CompatBoat.create(level(), id);
        if (boat != null) {
            return boat;
        }
        var type = CompatServer.entityType(id);
        return type.isEmpty() ? null : CompatServer.create(type.get(), level());
    }

    /** Tames, saddles, equips and chests a mount, and fixes its attributes (random horse stats would vary). */
    private static String ready(Entity e, Scenario.Summon s) {
        if (s.ready && e instanceof net.minecraft.world.entity.animal.horse.AbstractHorse horse) {
            horse.setTamed(true);
        }
        if (s.chested) {
            CompatLiving.giveChest(e);
        }
        if (s.ready) {
            CompatServer.tame(e);
            CompatServer.saddle(e);
        }
        if (s.equipment != null && e instanceof net.minecraft.world.entity.LivingEntity living) {
            for (Map.Entry<String, String> entry : s.equipment.entrySet()) {
                ResourceLocation id = CompatNames.id(entry.getValue());
                if (!BuiltInRegistries.ITEM.containsKey(id)) {
                    return "no item " + entry.getValue();
                }
                ItemStack stack = new ItemStack(CompatServer.item(id));
                if (entry.getKey().equals("saddle")) {
                    CompatServer.saddle(e);
                } else if (entry.getKey().equals("body")) {
                    if (e instanceof net.minecraft.world.entity.animal.horse.AbstractHorse horse) {
                        CompatServer.equipHorseArmor(horse, stack);
                    } else if (!CompatServer.equipBody(living, stack)) {
                        return "cannot put " + entry.getValue() + " on a " + s.type;
                    }
                } else {
                    CompatLiving.equip(living, entry.getKey(), stack);
                }
            }
        }
        if (s.attributes != null) {
            for (Map.Entry<String, Double> base : s.attributes.entrySet()) {
                if (base.getKey().equals("fixed:step_height")) {
                    // no attribute before 1.20.5: each entity type fixes it, so only its own value can be honoured
                    if (CompatEntity.maxUpStep(e) != base.getValue().floatValue()) {
                        return "step_height " + base.getValue() + " is not the " + s.type + "'s own (" + CompatEntity.maxUpStep(e) + ")";
                    }
                    continue;
                }
                AttributeInstance instance = !(e instanceof net.minecraft.world.entity.LivingEntity living)
                    ? null : CompatAttr.instance(living, CompatAttr.byId(base.getKey()));
                if (instance == null) {
                    return "the " + s.type + " has no attribute " + base.getKey();
                }
                instance.setBaseValue(base.getValue());
            }
        }
        return null;
    }

    /** ServerGamePacketListenerImpl.teleport HEAD: a teleport the recorder did not ask for corrects the client. */
    public static void onServerTeleport(double x, double y, double z, float yRot, float xRot, int relative) {
        if (teleporting) {
            return;
        }
        Recorder recorder = Recorder.get();
        if (recorder != null) {
            recorder.serverCorrection(new Json.Obj().vec("pos", x, y, z).num("yRot", yRot).num("xRot", xRot)
                .num("relative", relative).text());
        }
    }
}
