package dev.mcpn.recorder.mc;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

/** Before 1.13 blocks are ids and metadata, there are no voxel shapes or fluid states, and a level has a dimension number. */
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

    /** "#id:meta": what a state is before the flattening, and all the replay needs of it. */
    static String blockState(BlockState state) {
        return LegacyState.of(state);
    }



    /** (only a fluid block holds one before 1.13: its own name says) */
    static String fluid(BlockState state) {
        return null;
    }

    /** What the state itself puts in a move's way: getCollisionBox is its outline, and a fence's is a metre high. */
    static List<net.minecraft.world.phys.AABB> collisionBoxes(BlockState state, Minecraft mc, net.minecraft.core.BlockPos pos) {
        net.minecraft.world.phys.AABB cell = new net.minecraft.world.phys.AABB(pos.getX() - 1, pos.getY() - 1, pos.getZ() - 1, pos.getX() + 2, pos.getY() + 3, pos.getZ() + 2);
        List<net.minecraft.world.phys.AABB> boxes = new ArrayList<>();
        state.addCollisionBoxesToList(mc.level, pos, cell, boxes, mc.player);
        return boxes;
    }

    static Iterable<ServerLevel> levels(MinecraftServer server) {
        return List.of(server.levels);
    }

    static ServerLevel overworld(MinecraftServer server) {
        return server.getWorld(0);
    }

    static void seedLevel(ServerLevel level) {
        level.random.setSeed(level.getGameTime());
        // (the stream behind a random position: a random tick's, the snow of 1.20.1 Level.getBlockRandomPos)
        dev.mcpn.recorder.Fields.setInt(level, net.minecraft.world.level.Level.class, "randValue", (int) level.getGameTime() * 0x9E3779B9);
    }

    static boolean underWater(Entity e) {
        return e.isUnderLiquid(net.minecraft.world.level.material.Material.WATER);
    }

    /** (no swimming before 1.13) */
    static boolean swimming(Entity e) {
        return false;
    }

    static String pistonFacing(net.minecraft.world.level.block.piston.PistonMovingBlockEntity piston) {
        return piston.getFacing().getName();
    }

    static BlockState pistonMoved(net.minecraft.world.level.block.piston.PistonMovingBlockEntity piston) {
        return piston.getPushedBlock();
    }

    /** As later releases name it: the replay knows entities by those. */
    static String entityId(Entity e) {
        return LegacyState.modernEntity(e);
    }

    static int maxAir(ServerPlayer player) {
        return 300;
    }

    /** (no /bossbar before 1.13) */
    static void clearBossBars(MinecraftServer server) {
    }

    static net.minecraft.world.scores.Scoreboard scoreboard(MinecraftServer server) {
        return server.getWorld(0).getScoreboard();
    }

    /** The player is the sender: @s names it, and there is no source to give a position. */
    static void runCommand(MinecraftServer server, ServerPlayer player, String command) {
        server.getCommands().execute(player, command);
    }

    static void clearExperience(ServerPlayer player) {
        player.experienceLevel = 0;
        player.experienceProgress = 0.0F;
        player.totalExperience = 0;
    }

    static void seed(ServerLevel level, long seed) {
        level.random.setSeed(seed);
    }

    /** An item's variant is its damage before 1.13. */
    static net.minecraft.world.item.ItemStack stack(net.minecraft.world.item.Item item, int count, int damage) {
        return new net.minecraft.world.item.ItemStack(item, count, damage);
    }

    /** (no riptide before 1.13) */
    static int spinTicks(LocalPlayer p) {
        return 0;
    }

    /** (nothing keeps last tick's eyes before 1.13) */
    static boolean wasEyeInWater(LocalPlayer p) {
        return false;
    }

    /** What a chunk stores: a door's half keeps part of its state in the other, which a state can name and the client not get. */
    static boolean sameBlock(BlockState client, BlockState server) {
        return net.minecraft.world.level.block.Block.getId(client) == net.minecraft.world.level.block.Block.getId(server);
    }

    static boolean noOverlay(Minecraft mc) {
        return true;
    }

    static Path savesDir(Minecraft mc) {
        return mc.gameDirectory.toPath().resolve("saves");
    }

    static boolean hasChunk(Minecraft mc, int x, int z) {
        return !mc.level.getChunk(x, z).isEmpty();
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

    /** No forceload before 1.13: the chunk is loaded and KeepChunksMixin keeps it. */
    static void forceChunk(ServerLevel level, int x, int z) {
        LegacyState.FORCED.add(net.minecraft.world.level.ChunkPos.asLong(x, z));
        level.getChunk(x, z);
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
