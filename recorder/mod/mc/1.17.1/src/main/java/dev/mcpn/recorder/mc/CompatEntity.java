package dev.mcpn.recorder.mc;

/** Before 1.18: no minorHorizontalCollision. */
public final class CompatEntity {
    /** Entity.mainSupportingBlockPos and onGroundNoBlocks exist (1.20+). */
    static final boolean SUPPORTING_BLOCK = false;

    /** Entity.verticalCollisionBelow exists (1.18.2+). */
    static final boolean COLLISION_BELOW = false;

    private CompatEntity() {
    }

    public static boolean onGround(net.minecraft.world.entity.Entity entity) {
        return entity.isOnGround();
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
        return player.getInventory();
    }

    public static net.minecraft.world.entity.player.Abilities abilities(net.minecraft.world.entity.player.Player player) {
        return player.getAbilities();
    }

    public static float yRot(net.minecraft.world.entity.Entity entity) {
        return entity.getYRot();
    }

    public static float xRot(net.minecraft.world.entity.Entity entity) {
        return entity.getXRot();
    }

    public static void setYRot(net.minecraft.world.entity.Entity entity, float value) {
        entity.setYRot(value);
    }

    public static void setXRot(net.minecraft.world.entity.Entity entity, float value) {
        entity.setXRot(value);
    }

    public static int blockX(net.minecraft.world.entity.Entity entity) {
        return entity.getBlockX();
    }

    public static int blockZ(net.minecraft.world.entity.Entity entity) {
        return entity.getBlockZ();
    }

    public static boolean removed(net.minecraft.world.entity.Entity entity) {
        return entity.isRemoved();
    }

    public static void discard(net.minecraft.world.entity.Entity entity) {
        entity.discard();
    }

    /** Powder snow and freezing exist (1.17+). */
    static final boolean POWDER_SNOW = true;

    public static boolean inPowderSnow(net.minecraft.world.entity.Entity entity) {
        return entity.isInPowderSnow;
    }

    public static boolean wasInPowderSnow(net.minecraft.world.entity.Entity entity) {
        return entity.wasInPowderSnow;
    }

    public static int ticksFrozen(net.minecraft.world.entity.Entity entity) {
        return entity.getTicksFrozen();
    }

    public static int ticksRequired(net.minecraft.world.entity.Entity entity) {
        return entity.getTicksRequiredToFreeze();
    }

    public static void setTicksFrozen(net.minecraft.world.entity.Entity entity, int ticks) {
        entity.setTicksFrozen(ticks);
    }

    public static void resetFlyDistance(net.minecraft.world.entity.Entity entity) {
        entity.flyDist = 0;
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
        return player.getInventory().selected;
    }

    public static void setSelected(net.minecraft.world.entity.player.Player player, int slot) {
        player.getInventory().selected = slot;
    }

    public static boolean local(net.minecraft.world.entity.Entity entity) {
        return entity.isControlledByLocalInstance();
    }

    static boolean saddled(net.minecraft.world.entity.LivingEntity entity, net.minecraft.world.entity.ItemBasedSteering steering) {
        return steering.hasSaddle();
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
        return entity.getFluidHeight(net.minecraft.tags.FluidTags.WATER);
    }

    static double lavaHeight(net.minecraft.world.entity.Entity entity) {
        return entity.getFluidHeight(net.minecraft.tags.FluidTags.LAVA);
    }

    static boolean eyeInWater(net.minecraft.world.entity.Entity entity) {
        return entity.isEyeInFluid(net.minecraft.tags.FluidTags.WATER);
    }

    static boolean eyeInLava(net.minecraft.world.entity.Entity entity) {
        return entity.isEyeInFluid(net.minecraft.tags.FluidTags.LAVA);
    }

    static boolean onClimbable(net.minecraft.world.entity.LivingEntity entity) {
        return entity.onClimbable();
    }

    /** A mount steered with an item on a stick. */
    static void writeSteering(net.minecraft.world.entity.LivingEntity living, dev.mcpn.recorder.Json.Obj m) {
        net.minecraft.world.entity.ItemBasedSteering steering = living instanceof net.minecraft.world.entity.animal.Pig pig
            ? ((dev.mcpn.recorder.mc.mixin.PigAccessor) pig).recorder$steering()
            : living instanceof net.minecraft.world.entity.monster.Strider strider ? ((dev.mcpn.recorder.mc.mixin.StriderAccessor) strider).recorder$steering() : null;
        if (steering != null) {
            dev.mcpn.recorder.mc.mixin.ItemBasedSteeringAccessor st = (dev.mcpn.recorder.mc.mixin.ItemBasedSteeringAccessor) steering;
            m.bool("saddled", saddled(living, steering)).bool("boosting", st.recorder$boosting()).num("boostTime", st.recorder$boostTime())
                .num("boostTimeTotal", st.recorder$boostTimeTotal());
        }
        if (living instanceof net.minecraft.world.entity.monster.Strider strider) {
            // cold off the warm blocks: Strider.tick sets it before it moves (both sides, unless its AI is off)
            // and what its speed is made of, to tell it with and without the suffocating modifier (Strider.setSuffocating)
            m.bool("suffocating", strider.isSuffocating())
                .num("movementSpeedBase", strider.getAttributeBaseValue(net.minecraft.world.entity.ai.attributes.Attributes.MOVEMENT_SPEED))
                .raw("movementSpeedModifiers", dev.mcpn.recorder.Json.array(CompatAttr.modifiers(CompatAttr.instance(strider, net.minecraft.world.entity.ai.attributes.Attributes.MOVEMENT_SPEED))));
        }
    }
}
