package dev.mcpn.recorder.mc;

import java.nio.file.Path;
import java.util.Locale;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

/** What an entity and the game threads are from 1.14 on: the legacy adapters say it their own way. */
final class CompatMove {
    private CompatMove() {
    }

    static Vec3 velocity(Entity e) {
        return e.getDeltaMovement();
    }

    static void setVelocity(Entity e, Vec3 velocity) {
        e.setDeltaMovement(velocity);
    }

    static void setVelocity(Entity e, double x, double y, double z) {
        e.setDeltaMovement(x, y, z);
    }

    static Vec3 stuck(Entity e) {
        return ((dev.mcpn.recorder.mc.mixin.EntityAccessor) e).recorder$stuckSpeedMultiplier();
    }

    static Vec3 position(Entity e) {
        return e.position();
    }

    static float bbWidth(Entity e) {
        return e.getBbWidth();
    }

    static float bbHeight(Entity e) {
        return e.getBbHeight();
    }

    static String pose(Entity e) {
        return e.getPose().name().toLowerCase(Locale.ROOT);
    }

    static int fireTicks(Entity e) {
        return e.getRemainingFireTicks();
    }

    static boolean crouching(LocalPlayer p) {
        return p.isCrouching();
    }

    static boolean movingSlowly(LocalPlayer p) {
        return p.isMovingSlowly();
    }

    static boolean onClientThread(Minecraft mc) {
        return mc.isSameThread();
    }

    static String blockState(BlockState state) {
        return net.minecraft.commands.arguments.blocks.BlockStateParser.serialize(state);
    }

    /** The shape the player meets. */
    static net.minecraft.world.phys.shapes.VoxelShape collisionShape(BlockState state, Minecraft mc, net.minecraft.core.BlockPos pos) {
        return state.getCollisionShape(mc.level, pos, net.minecraft.world.phys.shapes.CollisionContext.of(mc.player));
    }

    /** The fluid a block holds besides itself (a waterlogged block, kelp), or null. */
    static String fluid(BlockState state) {
        if (state.getFluidState().isEmpty()) {
            return null;
        }
        return PlayerSnap.id(net.minecraft.core.registries.BuiltInRegistries.FLUID.getKey(state.getFluidState().getType())).replace("flowing_", "");
    }

    /** The boxes the player meets, in the world. */
    static java.util.List<net.minecraft.world.phys.AABB> collisionBoxes(BlockState state, Minecraft mc, net.minecraft.core.BlockPos pos) {
        return collisionShape(state, mc, pos).move(pos.getX(), pos.getY(), pos.getZ()).toAabbs();
    }

    static Iterable<ServerLevel> levels(MinecraftServer server) {
        return server.getAllLevels();
    }

    static ServerLevel overworld(MinecraftServer server) {
        return server.overworld();
    }

    /** The level's next tick starts from its game time. */
    static void seedLevel(ServerLevel level) {
        level.getRandom().setSeed(level.getGameTime());
        // (the stream behind a random position: a random tick's, the snow of 1.20.1 Level.getBlockRandomPos)
        dev.mcpn.recorder.Fields.setInt(level, net.minecraft.world.level.Level.class, "randValue", (int) level.getGameTime() * 0x9E3779B9);
    }

    static boolean underWater(Entity e) {
        return e.isUnderWater();
    }

    static boolean swimming(Entity e) {
        return e.isSwimming();
    }

    static String pistonFacing(net.minecraft.world.level.block.piston.PistonMovingBlockEntity piston) {
        return piston.getDirection().getName();
    }

    static BlockState pistonMoved(net.minecraft.world.level.block.piston.PistonMovingBlockEntity piston) {
        return piston.getMovedState();
    }

    static String entityId(Entity e) {
        return PlayerSnap.id(net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()));
    }

    static int maxAir(ServerPlayer player) {
        return player.getMaxAirSupply();
    }

    static void clearBossBars(MinecraftServer server) {
        net.minecraft.server.bossevents.CustomBossEvents bars = server.getCustomBossEvents();
        for (net.minecraft.server.bossevents.CustomBossEvent bar : java.util.List.copyOf(bars.getEvents())) {
            bar.removeAllPlayers();
            bars.remove(bar);
        }
    }

    static net.minecraft.world.scores.Scoreboard scoreboard(MinecraftServer server) {
        return server.getScoreboard();
    }

    static void runCommand(MinecraftServer server, ServerPlayer player, String command) {
        CompatServer.runCommand(server, CompatServer.fullPermission(server.createCommandSourceStack()).withSuppressedOutput()
            .withEntity(player).withPosition(position(player)), command);
    }

    static void clearExperience(ServerPlayer player) {
        player.setExperienceLevels(0);
        player.setExperiencePoints(0);
        player.totalExperience = 0;
    }

    static void seed(ServerLevel level, long seed) {
        level.getRandom().setSeed(seed);
    }

    static net.minecraft.world.item.ItemStack stack(net.minecraft.world.item.Item item, int count, int damage) {
        return new net.minecraft.world.item.ItemStack(item, count);
    }

    static int spinTicks(LocalPlayer p) {
        return ((dev.mcpn.recorder.mc.mixin.LivingEntityAccessor) p).recorder$autoSpinAttackTicks();
    }

    static boolean wasEyeInWater(LocalPlayer p) {
        return ((dev.mcpn.recorder.mc.mixin.EntityAccessor) p).recorder$wasEyeInWater();
    }

    static boolean sameBlock(BlockState client, BlockState server) {
        return client == server;
    }

    static boolean noOverlay(Minecraft mc) {
        return mc.getOverlay() == null;
    }

    static Path savesDir(Minecraft mc) {
        return mc.getLevelSource().getBaseDir();
    }

    static boolean hasChunk(Minecraft mc, int x, int z) {
        return mc.level.getChunkSource().hasChunk(x, z);
    }

    /** The level ticks the player: see the legacy adapters. */
    static boolean playerInLevel(Minecraft mc) {
        return true;
    }

    /** What counts client ticks and would carry the cases before this one into it. */
    static void alignClient(Minecraft mc) {
    }

    /** The server has moved the player's chunk view to where the player is. */
    static boolean viewMoved(ServerPlayer player) {
        return player.getLastSectionPos().x() == CompatEntity.blockX(player) >> 4 && player.getLastSectionPos().z() == CompatEntity.blockZ(player) >> 4;
    }

    static void onServerThread(MinecraftServer server, Runnable task) {
        server.execute(task);
    }

    static void peaceful(MinecraftServer server) {
        server.setDifficulty(net.minecraft.world.Difficulty.PEACEFUL, true);
    }

    static void forceChunk(ServerLevel level, int x, int z) {
        level.setChunkForced(x, z, true);
    }

    static Iterable<? extends Entity> entities(ServerLevel level) {
        return level.getAllEntities();
    }

    /** The period of the player's tracked changes starts now. */
    static void alignTracker(ServerLevel level, ServerPlayer player) {
        Object tracked = ((dev.mcpn.recorder.mc.mixin.ChunkMapAccessor) level.getChunkSource().chunkMap).recorder$entityMap().get(player.getId());
        if (tracked != null) {
            ((dev.mcpn.recorder.mc.mixin.ServerEntityAccessor) ((dev.mcpn.recorder.mc.mixin.TrackedEntityAccessor) tracked).recorder$serverEntity())
                .recorder$setTickCount(0);
        }
    }
}
