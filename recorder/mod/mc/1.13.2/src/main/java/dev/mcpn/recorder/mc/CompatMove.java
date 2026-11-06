package dev.mcpn.recorder.mc;

import java.nio.file.Path;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

/** Before 1.14 an entity keeps its motion and size in public fields, has no pose, and a thread takes futures. */
final class CompatMove {
    private CompatMove() {
    }

    static Vec3 velocity(Entity e) {
        return new Vec3(e.velocityX, e.velocityY, e.velocityZ);
    }

    static void setVelocity(Entity e, Vec3 velocity) {
        setVelocity(e, velocity.x, velocity.y, velocity.z);
    }

    static void setVelocity(Entity e, double x, double y, double z) {
        e.velocityX = x;
        e.velocityY = y;
        e.velocityZ = z;
    }

    /** Only a cobweb slows a move before 1.14, by Entity.move's own constants. */
    static Vec3 stuck(Entity e) {
        return ((dev.mcpn.recorder.mc.mixin.EntityFireAccessor) e).recorder$inCobweb() ? new Vec3(0.25, (double) 0.05F, 0.25) : Vec3.ZERO;
    }

    static Vec3 position(Entity e) {
        return new Vec3(e.x, e.y, e.z);
    }

    static float bbWidth(Entity e) {
        return e.width;
    }

    static float bbHeight(Entity e) {
        return e.height;
    }

    /** No poses: a player's box follows its sneaking, swimming and gliding flags. */
    static String pose(Entity e) {
        return e.isSneaking() ? "crouching" : "standing";
    }

    static int fireTicks(Entity e) {
        return ((dev.mcpn.recorder.mc.mixin.EntityFireAccessor) e).recorder$remainingFireTicks();
    }

    static boolean crouching(LocalPlayer p) {
        return p.isSneaking();
    }

    /** Before 1.14 KeyboardInput.tick slows on the key it has just read, not on last tick's sneaking. */
    static boolean movingSlowly(LocalPlayer p) {
        return p.input != null && p.input.sneakKeyDown;
    }

    static boolean onClientThread(Minecraft mc) {
        return Thread.currentThread() == ((dev.mcpn.recorder.mc.mixin.MinecraftThreadAccessor) mc).recorder$gameThread();
    }

    static String blockState(BlockState state) {
        return net.minecraft.commands.arguments.blocks.BlockStateParser.serialize(state, null);
    }

    static net.minecraft.world.phys.shapes.VoxelShape collisionShape(BlockState state, Minecraft mc, net.minecraft.core.BlockPos pos) {
        return state.getCollisionShape(mc.level, pos);
    }

    static String fluid(BlockState state) {
        if (state.getFluidState().isEmpty()) {
            return null;
        }
        return PlayerSnap.id(net.minecraft.core.registries.BuiltInRegistries.FLUID.getKey(state.getFluidState().getType())).replace("flowing_", "");
    }

    static List<net.minecraft.world.phys.AABB> collisionBoxes(BlockState state, Minecraft mc, net.minecraft.core.BlockPos pos) {
        return collisionShape(state, mc, pos).move(pos.getX(), pos.getY(), pos.getZ()).toAabbs();
    }

    static Iterable<ServerLevel> levels(MinecraftServer server) {
        return server.getAllLevels();
    }

    static ServerLevel overworld(MinecraftServer server) {
        return server.getLevel(net.minecraft.world.level.dimension.DimensionType.OVERWORLD);
    }

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
        for (net.minecraft.server.bossevents.CustomBossEvent bar : List.copyOf(bars.getEvents())) {
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
        return true;
    }

    static Path savesDir(Minecraft mc) {
        return mc.gameDirectory.toPath().resolve("saves");
    }

    static boolean hasChunk(Minecraft mc, int x, int z) {
        // (not the cache's getChunk: it gives an empty chunk for one it does not have)
        return mc.level.hasChunk(x, z, false);
    }

    /**
     * A chunk the client forgets takes the entities in it out of the level, the player too, and until the client puts it
     * back it is not ticked: every 30 client ticks by itself (Minecraft.joinPlayerCounter), which is what it does here.
     */
    static boolean playerInLevel(Minecraft mc) {
        if (mc.level.loadedEntities.contains(mc.player)) {
            return true;
        }
        mc.level.loadEntity(mc.player);
        return false;
    }

    static void alignClient(Minecraft mc) {
        ((dev.mcpn.recorder.mc.mixin.MinecraftThreadAccessor) mc).recorder$setJoinPlayerCounter(0);
    }

    /** (1.13 keeps no last section to ask: the chunks a move brings are not compared before 1.20.2) */
    static boolean viewMoved(ServerPlayer player) {
        return true;
    }

    static void onServerThread(MinecraftServer server, Runnable task) {
        server.submit(task);
    }

    /** The modern name of an open container: before 1.14 there is no registry of them, and only the screen tells. */
    static String menuType(net.minecraft.client.gui.screens.inventory.AbstractContainerScreen screen) {
        String name = screen.getClass().getSimpleName();
        return switch (name) {
            // (a chest's rows of 9 above the player's 36 slots)
            case "ContainerScreen" -> "generic_9x" + (screen.menu.slots.size() - 36) / 9;
            case "CraftingScreen" -> "crafting";
            case "FurnaceScreen" -> "furnace";
            case "EnchantmentScreen" -> "enchantment";
            case "HopperScreen" -> "hopper";
            case "DispenserScreen" -> "generic_3x3";
            case "BrewingStandScreen" -> "brewing_stand";
            case "BeaconScreen" -> "beacon";
            case "ShulkerBoxScreen" -> "shulker_box";
            default -> name;
        };
    }

    static void peaceful(MinecraftServer server) {
        server.setDifficulty(net.minecraft.world.Difficulty.PEACEFUL);
    }

    static void forceChunk(ServerLevel level, int x, int z) {
        CompatServer.runCommand(level.getServer(), level.getServer().createCommandSourceStack().withSuppressedOutput(),
            "forceload add " + (x << 4) + " " + (z << 4));
    }

    static List<Entity> entities(ServerLevel level) {
        return level.loadedEntities;
    }

    /** The period of the player's tracked changes starts now. */
    static void alignTracker(ServerLevel level, ServerPlayer player) {
        net.minecraft.server.level.ServerEntity tracked = ((dev.mcpn.recorder.mc.mixin.EntityTrackerAccessor) level.getEntityTracker()).recorder$tracked().get(player.getId());
        if (tracked != null) {
            tracked.tickCount = 0;
        }
    }
}
