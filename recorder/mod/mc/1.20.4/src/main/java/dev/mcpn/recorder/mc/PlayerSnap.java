package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Json;
import dev.mcpn.recorder.mc.mixin.EntityAccessor;
import dev.mcpn.recorder.mc.mixin.FireworkRocketEntityAccessor;
import dev.mcpn.recorder.mc.mixin.LivingEntityAccessor;
import dev.mcpn.recorder.mc.mixin.LocalPlayerAccessor;
import dev.mcpn.recorder.mc.mixin.PlayerAccessor;
import dev.mcpn.recorder.schema.PlayerFields;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.ai.attributes.Attribute;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.AttributeModifier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.player.Abilities;
import net.minecraft.world.entity.projectile.FireworkRocketEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.EnchantmentHelper;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.piston.PistonMovingBlockEntity;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/**
 * Every recorded field of the local player (recorder/schema/fields.ts PLAYER_FIELDS) as 1.20.4
 * keeps it. The recorder checks at startup that this writes exactly the registry's fields.
 */
public final class PlayerSnap {
    /** LivingEntity.SPEED_MODIFIER_SPRINTING_UUID. */
    static final double NEARBY = 16;

    private PlayerSnap() {
    }

    /** The scene (nearby entities, attached rockets, moving pistons) as taken last, reused inside the player's tick. */
    private static String[] scene;

    static Json.Obj take(Minecraft mc) {
        return take(mc, true);
    }

    /**
     * Every field; with freshScene false the scene the last snapshot took is reused (the player's own tick moves
     * nothing in it: the entities before the player have ticked, those after it have not).
     */
    static Json.Obj take(Minecraft mc, boolean freshScene) {
        LocalPlayer p = mc.player;
        LocalPlayerAccessor local = (LocalPlayerAccessor) p;
        LivingEntityAccessor living = (LivingEntityAccessor) p;
        EntityAccessor entity = (EntityAccessor) p;
        Json.Obj s = new Json.Obj();

        Vec3 pos = CompatMove.position(p);
        Vec3 vel = CompatMove.velocity(p);
        s.vec(PlayerFields.POS, pos.x, pos.y, pos.z);
        s.vec(PlayerFields.VEL, vel.x, vel.y, vel.z);
        s.num(PlayerFields.Y_ROT, CompatEntity.yRot(p));
        s.num(PlayerFields.X_ROT, CompatEntity.xRot(p));
        s.num(PlayerFields.Y_ROT_O, p.yRotO);
        s.num(PlayerFields.X_ROT_O, p.xRotO);
        Vec3 look = p.getViewVector(1.0F);
        s.vec(PlayerFields.LOOK, look.x, look.y, look.z);
        s.vec(PlayerFields.OLD_POS, p.xo, p.yo, p.zo);
        s.num(PlayerFields.BB_WIDTH, CompatMove.bbWidth(p));
        s.num(PlayerFields.BB_HEIGHT, CompatMove.bbHeight(p));
        AABB box = p.getBoundingBox();
        s.raw(PlayerFields.BOX, Json.doubles(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ));
        s.num(PlayerFields.EYE_HEIGHT, p.getEyeHeight());
        s.str(PlayerFields.POSE, CompatMove.pose(p));

        s.bool(PlayerFields.ON_GROUND, CompatEntity.onGround(p));
        s.bool(PlayerFields.HORIZONTAL_COLLISION, p.horizontalCollision);
        if (CompatEntity.MINOR_COLLISION) {
            s.bool(PlayerFields.MINOR_HORIZONTAL_COLLISION, CompatEntity.minorCollision(p));
        }
        s.bool(PlayerFields.VERTICAL_COLLISION, p.verticalCollision);
        if (CompatEntity.COLLISION_BELOW) {
            s.bool(PlayerFields.VERTICAL_COLLISION_BELOW, CompatEntity.collisionBelow(p));
        }
        if (CompatEntity.SUPPORTING_BLOCK) {
            s.raw(PlayerFields.MAIN_SUPPORTING_BLOCK_POS, CompatEntity.supportingBlock(p, PlayerSnap::blockPos));
            s.bool(PlayerFields.ON_GROUND_NO_BLOCKS, CompatEntity.onGroundNoBlocks(p));
        }
        Vec3 stuck = CompatMove.stuck(p);
        s.vec(PlayerFields.STUCK_SPEED_MULTIPLIER, stuck.x, stuck.y, stuck.z);
        s.num(PlayerFields.FALL_DISTANCE, p.fallDistance);

        s.bool(PlayerFields.IS_IN_WATER, p.isInWater());
        s.bool(PlayerFields.IS_IN_LAVA, p.isInLava());
        s.num(PlayerFields.FLUID_HEIGHT_WATER, CompatEntity.waterHeight(p));
        s.num(PlayerFields.FLUID_HEIGHT_LAVA, CompatEntity.lavaHeight(p));
        s.bool(PlayerFields.WAS_EYE_IN_WATER, CompatMove.wasEyeInWater(p));
        s.bool(PlayerFields.EYE_IN_WATER, CompatEntity.eyeInWater(p));
        s.bool(PlayerFields.EYE_IN_LAVA, CompatEntity.eyeInLava(p));
        s.bool(PlayerFields.IS_UNDER_WATER, CompatMove.underWater(p));
        if (CompatEntity.POWDER_SNOW) {
            s.bool(PlayerFields.IS_IN_POWDER_SNOW, CompatEntity.inPowderSnow(p));
        }
        if (CompatEntity.POWDER_SNOW) {
            s.bool(PlayerFields.WAS_IN_POWDER_SNOW, CompatEntity.wasInPowderSnow(p));
        }
        s.bool(PlayerFields.ON_CLIMBABLE, CompatEntity.onClimbable(p));
        s.bool(PlayerFields.NO_PHYSICS, p.noPhysics);
        s.bool(PlayerFields.NO_GRAVITY, CompatLiving.noGravity(p));
        s.num(PlayerFields.TICK_COUNT, p.tickCount);
        s.num(PlayerFields.REMAINING_FIRE_TICKS, CompatMove.fireTicks(p));
        if (CompatEntity.POWDER_SNOW) {
            s.num(PlayerFields.TICKS_FROZEN, CompatEntity.ticksFrozen(p));
            s.num(PlayerFields.TICKS_REQUIRED_TO_FREEZE, CompatEntity.ticksRequired(p));
        }
        s.bool(PlayerFields.IS_IN_WALL, p.isInWall());

        Json.Obj keys = new Json.Obj()
            .bool("forward", mc.options.keyUp.isDown()).bool("back", mc.options.keyDown.isDown())
            .bool("left", mc.options.keyLeft.isDown()).bool("right", mc.options.keyRight.isDown())
            .bool("jump", mc.options.keyJump.isDown()).bool("sneak", mc.options.keyShift.isDown())
            .bool("sprint", mc.options.keySprint.isDown());
        s.obj(PlayerFields.KEYS, keys);
        s.num(PlayerFields.LEFT_IMPULSE, CompatBoat.inputLeft(p));
        s.num(PlayerFields.FORWARD_IMPULSE, CompatBoat.inputForward(p));
        s.bool(PlayerFields.INPUT_JUMPING, CompatBoat.inputJumping(p));
        s.bool(PlayerFields.INPUT_SHIFT_KEY_DOWN, CompatBoat.inputShift(p));
        s.num(PlayerFields.XXA, p.xxa);
        s.num(PlayerFields.YYA, CompatLiving.yya(p));
        s.num(PlayerFields.ZZA, p.zza);
        s.bool(PlayerFields.JUMPING, living.recorder$jumping());
        s.num(PlayerFields.NO_JUMP_DELAY, living.recorder$noJumpDelay());
        s.num(PlayerFields.AUTO_JUMP_TIME, CompatLiving.autoJumpTime(p));
        s.bool(PlayerFields.AUTO_JUMP_ENABLED, CompatLiving.autoJumpEnabled(p));
        s.num(PlayerFields.SPRINT_TRIGGER_TIME, local.recorder$sprintTriggerTime());
        s.num(PlayerFields.JUMP_TRIGGER_TIME, ((PlayerAccessor) p).recorder$jumpTriggerTime());

        s.bool(PlayerFields.SHIFT_KEY_DOWN, p.isShiftKeyDown());
        s.bool(PlayerFields.CROUCHING, local.recorder$crouching());
        s.bool(PlayerFields.MOVING_SLOWLY, CompatMove.movingSlowly(p));
        s.bool(PlayerFields.STEPPING_CAREFULLY, p.isSteppingCarefully());
        s.bool(PlayerFields.SPRINTING, p.isSprinting());
        s.bool(PlayerFields.SWIMMING, CompatMove.swimming(p));
        s.bool(PlayerFields.FALL_FLYING, CompatLiving.fallFlying(p));
        s.num(PlayerFields.FALL_FLY_TICKS, CompatLiving.fallFlyTicks(p));
        s.num(PlayerFields.AUTO_SPIN_ATTACK_TICKS, CompatMove.spinTicks(p));
        s.bool(PlayerFields.USING_ITEM, p.isUsingItem());
        s.num(PlayerFields.USE_ITEM_REMAINING_TICKS, CompatLiving.useRemaining(p));
        if (CompatUse.SPEED) {
            s.num(PlayerFields.ITEM_USE_SPEED_MULTIPLIER, CompatUse.speed(p));
        }
        s.bool(PlayerFields.SLEEPING, p.isSleeping());
        s.bool(PlayerFields.PASSENGER, p.isPassenger());
        s.num(PlayerFields.VEHICLE_ID, CompatLiving.vehicle(p) == null ? -1 : CompatLiving.vehicle(p).getId());
        s.bool(PlayerFields.ALIVE, p.isAlive());
        s.bool(PlayerFields.REMOVED, CompatEntity.removed(p));
        s.num(PlayerFields.HEALTH, p.getHealth());
        s.num(PlayerFields.FOOD, p.getFoodData().getFoodLevel());
        s.str(PlayerFields.GAME_MODE, mc.gameMode == null ? null : mc.gameMode.getPlayerMode().getName());

        Abilities abilities = CompatEntity.abilities(p);
        s.bool(PlayerFields.FLYING, abilities.flying);
        s.bool(PlayerFields.MAYFLY, abilities.mayfly);
        s.num(PlayerFields.FLYING_SPEED, abilities.getFlyingSpeed());
        s.num(PlayerFields.WALKING_SPEED, abilities.getWalkingSpeed());
        s.bool(PlayerFields.INVULNERABLE, abilities.invulnerable);

        s.num(PlayerFields.SPEED, p.getSpeed());
        s.num(PlayerFields.MOVEMENT_SPEED, CompatAttr.instance(p, Attributes.MOVEMENT_SPEED).getValue());
        AttributeInstance movement = p.getAttribute(Attributes.MOVEMENT_SPEED);
        s.bool(PlayerFields.SPRINT_MODIFIER, movement != null && CompatAttr.sprinting(movement));
        s.obj(PlayerFields.ATTRIBUTES, attributes(p));
        s.raw(PlayerFields.EFFECTS, effects(p));
        s.num(PlayerFields.DEPTH_STRIDER, CompatEnch.depthStrider(p));
        s.num(PlayerFields.SOUL_SPEED, CompatEnch.soulSpeed(p));
        s.num(PlayerFields.FROST_WALKER, CompatEnch.frostWalker(p));
        s.num(PlayerFields.FIRE_PROTECTION, CompatEnch.fireProtection(p));
        s.obj(PlayerFields.EQUIPMENT, equipment(p));
        s.num(PlayerFields.SELECTED_SLOT, CompatEntity.selected(p));

        s.vec(PlayerFields.LAST_SENT_POS, local.recorder$xLast(), local.recorder$yLast(), local.recorder$zLast());
        s.num(PlayerFields.LAST_SENT_Y_ROT, local.recorder$yRotLast());
        s.num(PlayerFields.LAST_SENT_X_ROT, local.recorder$xRotLast());
        s.bool(PlayerFields.LAST_ON_GROUND, CompatLiving.lastOnGround(p));
        s.bool(PlayerFields.WAS_SHIFT_KEY_DOWN, CompatEntity.wasShiftKeyDown(local));
        s.bool(PlayerFields.WAS_SPRINTING, local.recorder$wasSprinting());
        s.num(PlayerFields.POSITION_REMINDER, local.recorder$positionReminder());
        s.num(PlayerFields.JUMP_RIDING_SCALE, local.recorder$jumpRidingScale());
        s.num(PlayerFields.JUMP_RIDING_TICKS, local.recorder$jumpRidingTicks());
        s.raw(PlayerFields.VEHICLE, CompatLiving.vehicle(p) == null ? "null" : vehicle(CompatLiving.vehicle(p)).text());

        if (freshScene || scene == null) {
            scene = scene(mc, p);
        }
        s.raw(PlayerFields.NEARBY_ENTITIES, scene[0]);
        s.raw(PlayerFields.ATTACHED_ROCKETS, scene[1]);
        s.raw(PlayerFields.MOVING_PISTONS, scene[2]);
        return s;
    }

    static String blockPos(BlockPos pos) {
        return Json.ints(pos.getX(), pos.getY(), pos.getZ());
    }

    static String id(net.minecraft.resources.ResourceLocation key) {
        return key == null ? "?" : key.getPath();
    }

    /** Every attribute with its name, sorted by name (the registry does not change while the game runs). */
    private static List<Map.Entry<String, Object>> attributes;

    private static Json.Obj attributes(LocalPlayer p) {
        if (attributes == null) {
            List<Map.Entry<String, Object>> all = new ArrayList<>(CompatAttr.all());
            all.sort(Map.Entry.comparingByKey());
            attributes = all;
        }
        Json.Obj out = new Json.Obj();
        for (Map.Entry<String, Object> named : attributes) {
            AttributeInstance instance = CompatAttr.instance(p, named.getValue());
            if (instance == null) {
                continue;
            }
            out.obj(named.getKey(), new Json.Obj()
                .num("base", instance.getBaseValue()).num("value", instance.getValue()).raw("modifiers", Json.array(CompatAttr.modifiers(instance))));
        }
        return out;
    }

    /** The attributes a mount's physics reads, under their bare names, where the release has them. */
    private static Json.Obj mountAttributes(net.minecraft.world.entity.LivingEntity mount) {
        Json.Obj out = new Json.Obj();
        for (Map.Entry<String, Object> named : CompatAttr.all()) {
            String bare = named.getKey().replaceFirst("^(generic|player)\\.", "");
            if (MOUNT_ATTRIBUTES.contains(bare)) {
                AttributeInstance instance = CompatAttr.instance(mount, named.getValue());
                if (instance != null) {
                    out.num(bare, instance.getValue());
                }
            }
        }
        return out;
    }

    private static final java.util.Set<String> MOUNT_ATTRIBUTES = java.util.Set.of("gravity", "step_height", "water_movement_efficiency", "air_drag_modifier", "friction_modifier");

    private static String effects(net.minecraft.world.entity.LivingEntity p) {
        List<MobEffectInstance> effects = new ArrayList<>(p.getActiveEffects());
        effects.sort(Comparator.comparing(CompatAttr::effectId));
        List<String> out = new ArrayList<>();
        for (MobEffectInstance e : effects) {
            out.add(new Json.Obj().str("id", CompatAttr.effectId(e))
                .num("amplifier", e.getAmplifier()).num("duration", e.getDuration())
                .bool("ambient", e.isAmbient()).bool("visible", e.isVisible()).text());
        }
        return Json.array(out);
    }

    private static Json.Obj equipment(LocalPlayer p) {
        Json.Obj out = new Json.Obj();
        CompatLiving.eachEquipped(p, (slot, stack) -> {
            if (CompatLiving.present(stack)) {
                out.obj(slot, new Json.Obj().str("id", id(BuiltInRegistries.ITEM.getKey(stack.getItem())))
                    .num("count", CompatLiving.count(stack)));
            }
        });
        return out;
    }

    private static void withPassengers(net.minecraft.world.entity.Entity entity, List<net.minecraft.world.entity.Entity> out) {
        out.add(entity);
        for (net.minecraft.world.entity.Entity passenger : CompatLiving.passengers(entity)) {
            withPassengers(passenger, out);
        }
    }

    /** The entities the client ticks around the player (in tick order), the rockets on it, the moving pistons. */
    private static String[] scene(Minecraft mc, LocalPlayer p) {
        List<String> nearby = new ArrayList<>();
        List<String> rockets = new ArrayList<>();
        boolean[] beforePlayer = {true};
        int[] order = {-1};
        // a passenger ticks after what it rides, not where the level lists it (Level.tickNonPassenger)
        List<net.minecraft.world.entity.Entity> ticking = new ArrayList<>();
        CompatLevel.tickOrder(mc.level).forEach(e -> {
            if (!e.isPassenger()) {
                withPassengers(e, ticking);
            }
        });
        ticking.forEach(e -> {
            order[0]++;
            if (e == p) {
                beforePlayer[0] = false;
                return;
            }
            if (e instanceof FireworkRocketEntity rocket && CompatLiving.attachedTo(rocket) == p) {
                FireworkRocketEntityAccessor r = (FireworkRocketEntityAccessor) rocket;
                rockets.add(new Json.Obj().num("id", e.getId()).num("life", r.recorder$life()).num("lifetime", r.recorder$lifetime())
                    .bool("tickedBeforePlayer", beforePlayer[0]).num("order", order[0]).text());
                return;
            }
            // (a dragon flies off, and the replay follows it wherever it goes)
            if (e.distanceToSqr(p) > NEARBY * NEARBY && !DragonSnap.isDragon(e)) {
                return;
            }
            // (what the client's tick draws, up to 1.21.4 for an orb in a block, must repeat: the server's are seeded at the start)
            if (isMoving(e)) {
                dev.mcpn.recorder.Fields.seedRandom(e, Entity.class, e.getId() ^ (long) e.tickCount << 20);
            }
            nearby.add(CompatEntity.writeCollider(e, serverEntity(e)).bool("tickedBeforePlayer", beforePlayer[0]).num("order", order[0]).text());
        });

        List<String> pistons = new ArrayList<>();
        List<PistonMovingBlockEntity> moving = new ArrayList<>();
        int cx = CompatEntity.blockX(p) >> 4;
        int cz = CompatEntity.blockZ(p) >> 4;
        for (int x = cx - 1; x <= cx + 1; x++) {
            for (int z = cz - 1; z <= cz + 1; z++) {
                if (!CompatMove.hasChunk(mc, x, z)) {
                    continue;
                }
                List<BlockEntity> list = new ArrayList<>(mc.level.getChunk(x, z).getBlockEntities().values());
                list.sort(Comparator.comparing(BlockEntity::getBlockPos));
                for (BlockEntity be : list) {
                    if (be instanceof PistonMovingBlockEntity piston) {
                        moving.add(piston);
                    }
                }
            }
        }
        // in the order they tick: what meets the player first decides how the others push it (a moved block before its
        // piston's head, 26.3 PistonBaseBlock.java:281-298, Level.java:405-423)
        if (!moving.isEmpty()) {
            Map<Object, Integer> ticks = dev.mcpn.recorder.Fields.tickOrder(mc.level, net.minecraft.world.level.Level.class);
            moving.sort(Comparator.comparingInt(piston -> ticks.getOrDefault(piston, ticks.getOrDefault(piston.getBlockPos(), Integer.MAX_VALUE))));
        }
        for (PistonMovingBlockEntity piston : moving) {
            pistons.add(new Json.Obj().raw("pos", blockPos(piston.getBlockPos()))
                .str("facing", CompatMove.pistonFacing(piston)).bool("extending", piston.isExtending())
                .bool("source", piston.isSourcePiston()).num("progress", piston.getProgress(1.0F))
                .str("moved", CompatMove.blockState(CompatMove.pistonMoved(piston))).text());
        }
        return new String[] {Json.array(nearby), Json.array(rockets), Json.array(pistons)};
    }

    /**
     * The entity the player rides, as the engine's boat and ridden-mob models take it: the entity's own state, then
     * what its kind keeps (a boat's status, paddles and rotation; a mount's input, attributes, jump and boost).
     */
    static Json.Obj vehicle(Entity e) {
        Json.Obj v = entity(e);
        Vec3 old = new Vec3(e.xo, e.yo, e.zo);
        v.vec("oldPos", old.x, old.y, old.z);
        v.bool("horizontalCollision", e.horizontalCollision).bool("verticalCollision", e.verticalCollision)
            .num("fallDistance", e.fallDistance).bool("noGravity", CompatLiving.noGravity(e))
            .bool("isInWater", e.isInWater()).bool("isInLava", e.isInLava())
            .num("fluidHeightWater", CompatEntity.waterHeight(e)).num("fluidHeightLava", CompatEntity.lavaHeight(e))
            .num("maxUpStep", CompatEntity.maxUpStep(e)).num("bbWidth", CompatMove.bbWidth(e)).num("bbHeight", CompatMove.bbHeight(e))
            .bool("controlledByLocalInstance", CompatEntity.local(e));
        Vec3 stuck = CompatMove.stuck(e);
        v.vec("stuckSpeedMultiplier", stuck.x, stuck.y, stuck.z);
        CompatBoat.write(e, v);
        if (e instanceof net.minecraft.world.entity.LivingEntity living) {
            LivingEntityAccessor la = (LivingEntityAccessor) living;
            Json.Obj m = new Json.Obj()
                .num("xxa", living.xxa).num("yya", CompatLiving.yya(living)).num("zza", living.zza).num("speed", living.getSpeed())
                .num("movementSpeed", CompatAttr.instance(living, Attributes.MOVEMENT_SPEED).getValue())
                .bool("jumping", la.recorder$jumping()).num("noJumpDelay", la.recorder$noJumpDelay())
                .num("health", living.getHealth()).raw("effects", effects(living))
                .bool("noAi", living instanceof net.minecraft.world.entity.Mob mob && mob.isNoAi());
            // only the attributes the mob has (a pig has no jump strength: a 0 would read as one)
            if (CompatLiving.flyingSpeed(living) != null) {
                m.num("flyingSpeed", CompatLiving.flyingSpeed(living));
            }
            if (CompatAttr.jumpStrength(living) != null) {
                m.num("jumpStrength", CompatAttr.jumpStrength(living).getValue());
            }
            if (living instanceof net.minecraft.world.entity.animal.horse.AbstractHorse horse) {
                dev.mcpn.recorder.mc.mixin.AbstractHorseAccessor h = (dev.mcpn.recorder.mc.mixin.AbstractHorseAccessor) horse;
                m.bool("saddled", horse.isSaddled()).bool("tamed", horse.isTamed()).bool("standing", horse.isStanding())
                    .num("standCounter", h.recorder$standCounter()).bool("horseJumping", CompatEntity.horseJumping(horse))
                    .num("playerJumpPendingScale", h.recorder$playerJumpPendingScale()).bool("allowStandSliding", h.recorder$allowStandSliding());
            }
            CompatEntity.writeMount(living, m);
            CompatEntity.writeSteering(living, m);
            m.obj("attributes", mountAttributes(living));
            CompatCamel.write(living, m);
            CompatEntity.writeLerp(living, m);
            v.obj("mount", m);
        }
        return v;
    }

    static Json.Obj entity(Entity e) {
        Vec3 pos = CompatMove.position(e);
        Vec3 vel = CompatMove.velocity(e);
        AABB box = e.getBoundingBox();
        Json.Obj o = new Json.Obj().num("id", e.getId()).str("type", CompatMove.entityId(e))
            .vec("pos", pos.x, pos.y, pos.z).vec("vel", vel.x, vel.y, vel.z)
            .num("yRot", CompatEntity.yRot(e)).num("xRot", CompatEntity.xRot(e)).bool("onGround", CompatEntity.onGround(e))
            .raw("box", Json.doubles(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ));
        CompatProjectile.extras(o, e);
        CompatMinecart.write(e, o);
        CompatMinecart.writeItem(e, o);
        CompatMinecart.writeTeam(e, o);
        CompatMinecart.writeBoarding(e, o);
        return isMoving(e) ? o.obj("moving", moving(e)) : o;
    }

    private static boolean isMoving(Entity e) {
        return e instanceof net.minecraft.world.entity.item.PrimedTnt || e instanceof net.minecraft.world.entity.item.FallingBlockEntity
            || e instanceof net.minecraft.world.entity.item.ItemEntity || e instanceof net.minecraft.world.entity.ExperienceOrb;
    }

    /**
     * What the tick of a TNT, falling block, item or orb keeps, as moving_entity.rs takes it. The kinds' own counters are
     * read by name: the releases keep them in different ways.
     */
    private static Json.Obj moving(Entity e) {
        Vec3 stuck = CompatMove.stuck(e);
        Json.Obj m = new Json.Obj().vec("oldPos", e.xo, e.yo, e.zo).num("tickCount", e.tickCount)
            .bool("horizontalCollision", e.horizontalCollision).bool("verticalCollision", e.verticalCollision)
            .num("fallDistance", e.fallDistance).bool("noGravity", CompatLiving.noGravity(e)).bool("noPhysics", e.noPhysics)
            .bool("isInWater", e.isInWater()).bool("isInLava", e.isInLava())
            .vec("stuckSpeedMultiplier", stuck.x, stuck.y, stuck.z);
        if (CompatEntity.COLLISION_BELOW) {
            m.bool("verticalCollisionBelow", CompatEntity.collisionBelow(e));
        }
        if (e instanceof net.minecraft.world.entity.item.PrimedTnt) {
            m.num("fuse", dev.mcpn.recorder.Fields.fuse(e));
        } else if (e instanceof net.minecraft.world.entity.item.FallingBlockEntity) {
            Class<?> type = net.minecraft.world.entity.item.FallingBlockEntity.class;
            m.num("time", dev.mcpn.recorder.Fields.getInt(e, type, "time"))
                .str("block", CompatMove.blockState((net.minecraft.world.level.block.state.BlockState) dev.mcpn.recorder.Fields.get(e, type, "blockState")));
        } else if (e instanceof net.minecraft.world.entity.item.ItemEntity) {
            Class<?> type = net.minecraft.world.entity.item.ItemEntity.class;
            m.num("age", dev.mcpn.recorder.Fields.getInt(e, type, "age")).num("pickupDelay", dev.mcpn.recorder.Fields.getInt(e, type, "pickupDelay"))
                .num("health", dev.mcpn.recorder.Fields.getInt(e, type, "health"));
        } else {
            Class<?> type = net.minecraft.world.entity.ExperienceOrb.class;
            Object following = dev.mcpn.recorder.Fields.get(e, type, "followingPlayer");
            m.num("age", dev.mcpn.recorder.Fields.getInt(e, type, "age")).num("orbTicks", dev.mcpn.recorder.Fields.getInt(e, type, "tickCount"))
                .num("followingTime", dev.mcpn.recorder.Fields.getInt(e, type, "followingTime")).num("throwTime", dev.mcpn.recorder.Fields.getInt(e, type, "throwTime"))
                .num("value", dev.mcpn.recorder.Fields.orbValue(e)).num("health", dev.mcpn.recorder.Fields.getInt(e, type, "health"));
            if (following instanceof Entity player) {
                m.num("following", player.getId());
            }
        }
        return m;
    }

    /** What a mob's travel started from and left, this server tick (MobTravelMixin). */
    private static final Map<Entity, String[]> MOB_TRAVEL = new java.util.WeakHashMap<>();

    /** The mobs the replay travels (moving_entity.rs MobTravelKind), by their names of any release. */
    private static final java.util.Set<String> OWN_TRAVEL = java.util.Set.of("squid", "glow_squid", "cod", "salmon", "tropical_fish", "pufferfish",
        "guardian", "elder_guardian", "ghast", "phantom", "allay", "vex", "tadpole", "blaze", "bat", "bee", "parrot", "dolphin", "turtle", "axolotl", "frog", "drowned",
        "spider", "cave_spider", "polar_bear", "wither", "armor_stand", "strider", "skeleton_horse", "sulfur_cube", "cow",
        "Squid", "Guardian", "Ghast", "Blaze", "Bat", "Spider", "CaveSpider", "WitherBoss", "ArmorStand", "Cow");

    /** Whether the entity's travel is its own (moving_entity.rs MobTravelKind). */
    public static boolean ownTravel(Entity e) {
        return OWN_TRAVEL.contains(CompatMove.entityId(e));
    }

    private static String travelState(net.minecraft.world.entity.LivingEntity e) {
        Vec3 pos = CompatMove.position(e);
        Vec3 vel = CompatMove.velocity(e);
        Vec3 stuck = CompatMove.stuck(e);
        AABB box = e.getBoundingBox();
        Object target = e instanceof net.minecraft.world.entity.Mob ? dev.mcpn.recorder.Fields.get(e, net.minecraft.world.entity.Mob.class, "target") : null;
        boolean moving = e instanceof net.minecraft.world.entity.monster.Guardian guardian && guardian.isMoving();
        return new Json.Obj().vec("pos", pos.x, pos.y, pos.z).vec("vel", vel.x, vel.y, vel.z).num("yRot", CompatEntity.yRot(e))
            .vec("input", e.xxa, CompatLiving.yya(e), e.zza).num("speed", e.getSpeed())
            .bool("onGround", CompatEntity.onGround(e)).bool("horizontalCollision", e.horizontalCollision).bool("verticalCollision", e.verticalCollision)
            .bool("isInWater", e.isInWater()).bool("isInLava", e.isInLava()).bool("noGravity", flag(e, "hasNoGravity", CompatLiving.noGravity(e)))
            .vec("stuckSpeedMultiplier", stuck.x, stuck.y, stuck.z).num("fallDistance", e.fallDistance)
            .num("bbWidth", CompatMove.bbWidth(e)).num("bbHeight", CompatMove.bbHeight(e)).num("maxUpStep", CompatEntity.maxUpStep(e))
            .raw("box", Json.doubles(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ))
            .bool("hasTarget", target != null).bool("guardianMoving", moving)
            .bool("climbing", flag(e, "isClimbing", false)).bool("pushedByFluid", flag(e, "isPushedByFluid", flag(e, "isPushedByWater", true)))
            .num("fluidJumpThreshold", number(e, "getFluidJumpThreshold", 0.4)).bool("underWater", flag(e, "isUnderWater", false))
            .bool("wantsToSwim", flag(e, "wantsToSwim", false)).bool("nearHome", nearHome(e, pos)).bool("marker", flag(e, "isMarker", false))
            .bool("bodyItem", flag(e, "hasBodyItem", false)).bool("floats", Boolean.TRUE.equals(dev.mcpn.recorder.Fields.get(e, e.getClass(), "floatsInLiquids")))
            .num("tickCount", e.tickCount).raw("effects", effects(e)).obj("attributes", mountAttributes(e)).text();
    }

    /** What a getter of the mob's class says; `missing` where this release or mob has none. */
    private static Object ask(Entity e, String name) {
        for (Class<?> at = e.getClass(); at != null; at = at.getSuperclass()) {
            try {
                java.lang.reflect.Method method = at.getDeclaredMethod(name);
                method.setAccessible(true);
                return method.invoke(e);
            } catch (NoSuchMethodException missing) {
                // on up
            } catch (ReflectiveOperationException failed) {
                throw new IllegalStateException(failed);
            }
        }
        return null;
    }

    private static boolean flag(Entity e, String name, boolean missing) {
        return ask(e, name) instanceof Boolean value ? value : missing;
    }

    private static double number(Entity e, String name, double missing) {
        return ask(e, name) instanceof Number value ? value.doubleValue() : missing;
    }

    /** Turtle.goingHome, and within 20 blocks of its home's centre. */
    private static boolean nearHome(Entity e, Vec3 pos) {
        if (!flag(e, "isGoingHome", false)) {
            return false;
        }
        Object home = dev.mcpn.recorder.Fields.get(e, e.getClass(), "homePos");
        if (!(home instanceof net.minecraft.core.BlockPos)) {
            home = ask(e, "getHomePos");
        }
        net.minecraft.core.BlockPos at = (net.minecraft.core.BlockPos) home;
        double x = at.getX() + 0.5 - pos.x;
        double y = at.getY() + 0.5 - pos.y;
        double z = at.getZ() + 0.5 - pos.z;
        return x * x + y * y + z * z < 400;
    }

    /** MobTravelMixin, before the mob's travel. */
    public static void beforeTravel(net.minecraft.world.entity.LivingEntity e) {
        MOB_TRAVEL.put(e, new String[] {travelState(e), null});
    }

    /** MobTravelMixin, after it. */
    public static void afterTravel(net.minecraft.world.entity.LivingEntity e) {
        String[] travel = MOB_TRAVEL.get(e);
        if (travel != null) {
            travel[1] = travelState(e);
        }
    }

    /** An entity with, for those above, the state of its random: its next draws come from it. */
    static Json.Obj serverEntity(Entity e) {
        Json.Obj o = entity(e);
        String[] travel = MOB_TRAVEL.remove(e);
        if (travel != null && travel[1] != null) {
            o.raw("travelFrom", travel[0]).raw("travelTo", travel[1]);
        }
        if (e instanceof net.minecraft.world.entity.boss.enderdragon.EnderDragon dragon) {
            DragonSnap.write(o, dragon);
        }
        return isMoving(e) ? o.str("rng", Long.toString(dev.mcpn.recorder.Fields.randomSeed(e, Entity.class))) : o;
    }
}
