package dev.mcpn.recorder.mc;

/** Before 1.17: rotations and the inventory are fields, and there is no powder snow. */
public final class CompatEntity {
    /** Entity.mainSupportingBlockPos and onGroundNoBlocks exist (1.20+). */
    static final boolean SUPPORTING_BLOCK = false;

    /** Entity.verticalCollisionBelow exists (1.18.2+). */
    static final boolean COLLISION_BELOW = false;

    private CompatEntity() {
    }

    public static boolean onGround(net.minecraft.world.entity.Entity entity) {
        return entity.onGround;
    }

    public static net.minecraft.server.level.ServerLevel level(net.minecraft.server.level.ServerPlayer player) {
        return player.getLevel();
    }

    public static String supportingBlock(net.minecraft.world.entity.Entity entity, java.util.function.Function<net.minecraft.core.BlockPos, String> write) {
        return "null";
    }

    public static boolean onGroundNoBlocks(net.minecraft.world.entity.Entity entity) {
        return false;
    }

    public static float maxUpStep(net.minecraft.world.entity.Entity entity) {
        return entity.maxUpStep;
    }

    public static boolean collisionBelow(net.minecraft.world.entity.Entity entity) {
        return false;
    }

    /** Entity.minorHorizontalCollision exists (1.18+). */
    static final boolean MINOR_COLLISION = false;

    public static boolean minorCollision(net.minecraft.world.entity.Entity entity) {
        return false;
    }

    public static net.minecraft.world.entity.player.Inventory inventory(net.minecraft.world.entity.player.Player player) {
        return player.inventory;
    }

    public static net.minecraft.world.entity.player.Abilities abilities(net.minecraft.world.entity.player.Player player) {
        return player.abilities;
    }

    public static float yRot(net.minecraft.world.entity.Entity entity) {
        return entity.yRot;
    }

    public static float xRot(net.minecraft.world.entity.Entity entity) {
        return entity.xRot;
    }

    public static void setYRot(net.minecraft.world.entity.Entity entity, float value) {
        entity.yRot = value;
    }

    public static void setXRot(net.minecraft.world.entity.Entity entity, float value) {
        entity.xRot = value;
    }

    public static int blockX(net.minecraft.world.entity.Entity entity) {
        return net.minecraft.util.Mth.floor(entity.getX());
    }

    public static int blockZ(net.minecraft.world.entity.Entity entity) {
        return net.minecraft.util.Mth.floor(entity.getZ());
    }

    public static boolean removed(net.minecraft.world.entity.Entity entity) {
        return entity.removed;
    }

    public static void discard(net.minecraft.world.entity.Entity entity) {
        entity.remove();
    }

    /** Powder snow and freezing exist (1.17+). */
    static final boolean POWDER_SNOW = false;

    public static boolean inPowderSnow(net.minecraft.world.entity.Entity entity) {
        return false;
    }

    public static boolean wasInPowderSnow(net.minecraft.world.entity.Entity entity) {
        return false;
    }

    public static int ticksFrozen(net.minecraft.world.entity.Entity entity) {
        return 0;
    }

    public static int ticksRequired(net.minecraft.world.entity.Entity entity) {
        return 0;
    }

    public static void setTicksFrozen(net.minecraft.world.entity.Entity entity, int ticks) {
        // (none)
    }

    public static void resetFlyDistance(net.minecraft.world.entity.Entity entity) {
        // (none)
    }

    public static void resetWalk(net.minecraft.world.entity.Entity entity) {
        entity.walkDistO = 0;
        entity.walkDist = 0;
    }

    /** What a mount the rider controls still interpolates to: from 1.21.2 it goes on (LivingEntity.aiStep no longer clears it). */
    static void writeLerp(net.minecraft.world.entity.LivingEntity entity, dev.mcpn.recorder.Json.Obj out) {
        // (cleared for a controlled entity before 1.21.2)
    }

    public static int selected(net.minecraft.world.entity.player.Player player) {
        return player.inventory.selected;
    }

    public static void setSelected(net.minecraft.world.entity.player.Player player, int slot) {
        player.inventory.selected = slot;
    }

    public static boolean local(net.minecraft.world.entity.Entity entity) {
        return entity.isControlledByLocalInstance();
    }

    static void moveTo(net.minecraft.world.entity.Entity entity, double x, double y, double z, float yRot, float xRot) {
        entity.moveTo(x, y, z, yRot, xRot);
    }

    static boolean horseJumping(net.minecraft.world.entity.animal.horse.AbstractHorse horse) {
        return ((dev.mcpn.recorder.mc.mixin.AbstractHorseAccessor) horse).recorder$isJumpingField();
    }

    static boolean wasShiftKeyDown(dev.mcpn.recorder.mc.mixin.LocalPlayerAccessor local) {
        return local.recorder$wasShiftKeyDown();
    }

    /** What decides whether the entity is a collider. */
    static dev.mcpn.recorder.Json.Obj writeCollider(net.minecraft.world.entity.Entity entity, dev.mcpn.recorder.Json.Obj out) {
        return out;
    }

    static String profileName(net.minecraft.world.entity.player.Player player) {
        return player.getGameProfile().getName();
    }

    /** Forced, as a command's ride is. */
    static boolean startRiding(net.minecraft.world.entity.Entity entity, net.minecraft.world.entity.Entity vehicle) {
        return entity.startRiding(vehicle, true);
    }

    /** Whether the client said it has loaded in: before that the server drops its movement (from 1.21.2). */
    static boolean clientLoaded(net.minecraft.server.level.ServerPlayer player) {
        return true;
    }

    /** What a mount that is neither a horse nor steered by an item has. */
    static void writeMount(net.minecraft.world.entity.LivingEntity entity, dev.mcpn.recorder.Json.Obj out) {
        // (none before the nautilus)
    }

    static double waterHeight(net.minecraft.world.entity.Entity entity) {
        return ((dev.mcpn.recorder.mc.mixin.EntityAccessor) entity).recorder$waterHeight();
    }

    /** No height of lava before 1.16: whether it touches. */
    static double lavaHeight(net.minecraft.world.entity.Entity entity) {
        return entity.isInLava() ? 1.0 : 0.0;
    }

    static boolean eyeInWater(net.minecraft.world.entity.Entity entity) {
        return entity.isUnderLiquid(net.minecraft.tags.FluidTags.WATER);
    }

    static boolean eyeInLava(net.minecraft.world.entity.Entity entity) {
        return entity.isUnderLiquid(net.minecraft.tags.FluidTags.LAVA);
    }

    static boolean onClimbable(net.minecraft.world.entity.LivingEntity entity) {
        return entity.onLadder();
    }

    /** A pig: the steering had no class of its own, and there is no strider. */
    static void writeSteering(net.minecraft.world.entity.LivingEntity living, dev.mcpn.recorder.Json.Obj m) {
        if (living instanceof net.minecraft.world.entity.animal.Pig pig) {
            dev.mcpn.recorder.mc.mixin.PigAccessor a = (dev.mcpn.recorder.mc.mixin.PigAccessor) pig;
            m.bool("saddled", pig.hasSaddle()).bool("boosting", a.recorder$boosting()).num("boostTime", a.recorder$boostTime())
                .num("boostTimeTotal", a.recorder$boostTimeTotal());
        }
    }
}
