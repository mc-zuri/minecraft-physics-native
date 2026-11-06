package dev.mcpn.recorder.mc;

/** The entity API from 1.21.2. */
public final class CompatEntity {
    /** Entity.mainSupportingBlockPos and onGroundNoBlocks exist (1.20+). */
    static final boolean SUPPORTING_BLOCK = true;

    /** Entity.verticalCollisionBelow exists (1.18.2+). */
    static final boolean COLLISION_BELOW = true;

    private CompatEntity() {
    }

    public static boolean onGround(net.minecraft.world.entity.Entity entity) {
        return entity.onGround();
    }

    public static net.minecraft.server.level.ServerLevel level(net.minecraft.server.level.ServerPlayer player) {
        return (net.minecraft.server.level.ServerLevel) player.level();
    }

    public static String supportingBlock(net.minecraft.world.entity.Entity entity, java.util.function.Function<net.minecraft.core.BlockPos, String> write) {
        return entity.mainSupportingBlockPos.map(write).orElse("null");
    }

    public static boolean onGroundNoBlocks(net.minecraft.world.entity.Entity entity) {
        return ((dev.mcpn.recorder.mc.mixin.EntityAccessor) entity).recorder$onGroundNoBlocks();
    }

    public static float maxUpStep(net.minecraft.world.entity.Entity entity) {
        return entity.maxUpStep();
    }

    public static boolean collisionBelow(net.minecraft.world.entity.Entity entity) {
        return entity.verticalCollisionBelow;
    }

    /** Entity.minorHorizontalCollision exists (1.18+). */
    static final boolean MINOR_COLLISION = true;

    public static boolean minorCollision(net.minecraft.world.entity.Entity entity) {
        return entity.minorHorizontalCollision;
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
        // (no walkDist from 1.21.2)
    }

    /** What a mount the rider controls still interpolates to: from 26.3 a path of steps, given as where its next one puts it. */
    static void writeLerp(net.minecraft.world.entity.LivingEntity entity, dev.mcpn.recorder.Json.Obj out) {
        var handler = entity.getInterpolation();
        if (handler == null || !handler.hasActiveInterpolation()) {
            return;
        }
        try {
            var data = field(net.minecraft.world.entity.SteppedInterpolationHandler.class, "interpolationData").get(handler);
            var target = ((net.minecraft.core.PositionAndRotation) data).position();
            var last = (net.minecraft.core.PositionAndRotation) field(net.minecraft.world.entity.AbstractInterpolationHandler.class, "lastPositionAndRotation").get(handler);
            // the handler moves all of it along with the entity's own move of the tick before, unless that runs into
            // something (adjustInterpolationTargetFromDeltas)
            var moved = entity.position().subtract(last.position());
            var shift = moved.lengthSqr() > 9.999999747378752E-6 && entity.level().noCollision(entity, entity.getDimensions(entity.getPose()).makeBoundingBox(target.add(moved)))
                ? moved : net.minecraft.world.phys.Vec3.ZERO;
            // getNewPositionAndRotation, read without it: that drops the steps it passes, and with the last of them the
            // interpolation itself
            var position = target;
            var from = ((net.minecraft.core.PositionAndRotation) field(data.getClass(), "lastStepPosRot").get(data)).position();
            float ticks = field(data.getClass(), "currentStepTicks").getFloat(data);
            for (Object step : (java.util.List<?>) field(data.getClass(), "remainingSteps").get(data)) {
                int offset = field(step.getClass(), "tickOffset").getInt(step);
                var to = ((net.minecraft.core.PositionAndRotation) step).position();
                if (ticks < offset) {
                    position = from.lerp(to, ticks / offset);
                    break;
                }
                ticks -= offset;
                from = to;
            }
            position = position.add(shift);
            out.vec("lerpNext", position.x, position.y, position.z);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    private static java.lang.reflect.Field field(Class<?> owner, String name) throws ReflectiveOperationException {
        var field = owner.getDeclaredField(name);
        field.setAccessible(true);
        return field;
    }

    public static int selected(net.minecraft.world.entity.player.Player player) {
        return player.getInventory().getSelectedSlot();
    }

    public static void setSelected(net.minecraft.world.entity.player.Player player, int slot) {
        player.getInventory().setSelectedSlot(slot);
    }

    public static boolean local(net.minecraft.world.entity.Entity entity) {
        return entity.isLocalInstanceAuthoritative();
    }

    static boolean saddled(net.minecraft.world.entity.LivingEntity entity, net.minecraft.world.entity.ItemBasedSteering steering) {
        return !entity.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.SADDLE).isEmpty();
    }

    static void moveTo(net.minecraft.world.entity.Entity entity, double x, double y, double z, float yRot, float xRot) {
        entity.snapTo(x, y, z, yRot, xRot);
    }

    static boolean horseJumping(net.minecraft.world.entity.animal.horse.AbstractHorse horse) {
        return horse.isJumping();
    }

    static boolean wasShiftKeyDown(dev.mcpn.recorder.mc.mixin.LocalPlayerAccessor local) {
        return ((net.minecraft.client.player.LocalPlayer) (Object) local).getLastSentInput().shift();
    }

    /** What decides whether the entity is a collider. */
    static dev.mcpn.recorder.Json.Obj writeCollider(net.minecraft.world.entity.Entity entity, dev.mcpn.recorder.Json.Obj out) {
        if (entity instanceof net.minecraft.world.entity.animal.HappyGhast ghast) {
            out.bool("baby", ghast.isBaby()).bool("staysStill", ghast.staysStill());
        }
        return out;
    }

    static String profileName(net.minecraft.world.entity.player.Player player) {
        return player.getGameProfile().name();
    }

    /** Forced, as a command's ride is. */
    static boolean startRiding(net.minecraft.world.entity.Entity entity, net.minecraft.world.entity.Entity vehicle) {
        return entity.startRiding(vehicle, true, true);
    }

    /** Whether the client said it has loaded in: before that the server drops its movement (from 1.21.2). */
    static boolean clientLoaded(net.minecraft.server.level.ServerPlayer player) {
        return player.connection.hasClientLoaded();
    }

    /** What a mount that is neither a horse nor steered by an item has. */
    static void writeMount(net.minecraft.world.entity.LivingEntity entity, dev.mcpn.recorder.Json.Obj out) {
        if (entity instanceof net.minecraft.world.entity.animal.nautilus.AbstractNautilus nautilus) {
            dev.mcpn.recorder.mc.mixin.AbstractNautilusAccessor a = (dev.mcpn.recorder.mc.mixin.AbstractNautilusAccessor) nautilus;
            out.bool("saddled", nautilus.isSaddled()).bool("tamed", nautilus.isTame()).bool("dashing", nautilus.isDashing())
                .num("dashCooldown", a.recorder$dashCooldown()).num("playerJumpPendingScale", a.recorder$playerJumpPendingScale())
                .bool("horseJumping", nautilus.isJumping());
        }
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
