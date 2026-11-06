package dev.mcpn.recorder.mc;

/** Server operations; a horse armor sits in its body slot from 1.20.5. */
final class CompatServer {
    static final int INFINITE_EFFECT = net.minecraft.world.effect.MobEffectInstance.INFINITE_DURATION;

    private CompatServer() {
    }

    /**
     * The teleport op: an absolute coordinate is area-relative, a relative one an offset from the player (teleportTo
     * takes absolute coordinates and only sends the axes in `relative` as offsets).
     */
    static void teleport(net.minecraft.server.level.ServerPlayer player, net.minecraft.server.level.ServerLevel level, double[] pos, int[] origin,
                         java.util.Set<String> relative, float yRot, float xRot) {
        java.util.Set<net.minecraft.world.entity.Relative> flags = java.util.EnumSet.noneOf(net.minecraft.world.entity.Relative.class);
        for (String r : relative) {
            flags.add(switch (r) {
                case "x" -> net.minecraft.world.entity.Relative.X;
                case "y" -> net.minecraft.world.entity.Relative.Y;
                case "z" -> net.minecraft.world.entity.Relative.Z;
                case "yRot" -> net.minecraft.world.entity.Relative.Y_ROT;
                case "xRot" -> net.minecraft.world.entity.Relative.X_ROT;
                default -> throw new IllegalArgumentException("relative " + r);
            });
        }
        // (what is relative stays an offset: PositionMoveRotation.calculateAbsolute adds the current value)
        double x = (relative.contains("x") ? 0.0 : origin[0]) + pos[0];
        double y = (relative.contains("y") ? 0.0 : origin[1]) + pos[1];
        double z = (relative.contains("z") ? 0.0 : origin[2]) + pos[2];
        player.teleportTo(level, x, y, z, flags, yRot, xRot, true);
    }

    static void stopVines(net.minecraft.world.level.GameRules rules, net.minecraft.server.MinecraftServer server) {
        rules.getRule(net.minecraft.world.level.GameRules.RULE_DO_VINES_SPREAD).set(false, server);
    }

    static net.minecraft.world.level.block.state.BlockState parseBlock(String state) throws com.mojang.brigadier.exceptions.CommandSyntaxException {
        return net.minecraft.commands.arguments.blocks.BlockStateParser.parseForBlock(net.minecraft.core.registries.BuiltInRegistries.BLOCK, state, false).blockState();
    }

    static void explode(net.minecraft.server.level.ServerLevel level, double x, double y, double z, float power) {
        level.explode(null, x, y, z, power, net.minecraft.world.level.Level.ExplosionInteraction.NONE);
    }

    static void equipHorseArmor(net.minecraft.world.entity.animal.horse.AbstractHorse horse, net.minecraft.world.item.ItemStack stack) {
        horse.setBodyArmorItem(stack);
    }

    static void runCommand(net.minecraft.server.MinecraftServer server, net.minecraft.commands.CommandSourceStack source, String command) {
        server.getCommands().performPrefixedCommand(source, command);
    }


    /** Drops the ticks the blocks and fluids of the area scheduled. */
    static void clearTicks(net.minecraft.server.level.ServerLevel level, net.minecraft.world.level.levelgen.structure.BoundingBox bounds) {
        level.getBlockTicks().clearArea(bounds);
        level.getFluidTicks().clearArea(bounds);
    }

    static void knockback(net.minecraft.world.entity.LivingEntity entity, double strength, double dx, double dz) {
        entity.knockback(strength, dx, dz);
    }

    static void stopFreezeDamage(net.minecraft.world.level.GameRules rules, net.minecraft.server.MinecraftServer server) {
        rules.getRule(net.minecraft.world.level.GameRules.RULE_FREEZE_DAMAGE).set(false, server);
    }

    static void stopRandomTicks(net.minecraft.world.level.GameRules rules, net.minecraft.server.MinecraftServer server) {
        rules.getRule(net.minecraft.world.level.GameRules.RULE_RANDOMTICKING).set(0, server);
    }

    static boolean chunkTicking(net.minecraft.server.level.ServerLevel level, long chunk) {
        return level.getChunkSource().isPositionTicking(chunk) && level.areEntitiesLoaded(chunk)
            && level.isPositionEntityTicking(new net.minecraft.core.BlockPos(net.minecraft.core.SectionPos.sectionToBlockCoord(net.minecraft.world.level.ChunkPos.getX(chunk)), 64, net.minecraft.core.SectionPos.sectionToBlockCoord(net.minecraft.world.level.ChunkPos.getZ(chunk))));
    }


    static void teleportAbsolute(net.minecraft.server.level.ServerPlayer player, net.minecraft.server.level.ServerLevel level, double x, double y, double z, float yRot, float xRot) {
        player.teleportTo(level, x, y, z, java.util.Set.of(), yRot, xRot, true);
    }

    static net.minecraft.world.item.Item item(net.minecraft.resources.ResourceLocation id) {
        return net.minecraft.core.registries.BuiltInRegistries.ITEM.getValue(id);
    }

    static net.minecraft.network.protocol.Packet<?> carriedItem(int slot) {
        return new net.minecraft.network.protocol.game.ClientboundSetHeldSlotPacket(slot);
    }

    static net.minecraft.world.entity.Entity create(net.minecraft.world.entity.EntityType<?> type, net.minecraft.server.level.ServerLevel level) {
        return type.create(level, net.minecraft.world.entity.EntitySpawnReason.COMMAND);
    }

    /** The saddle, when the entity takes one. */
    static void saddle(net.minecraft.world.entity.Entity entity) {
        // (a llama's canUseSlot takes every slot; the saddle's equippable component is what leaves it out)
        var saddle = new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.SADDLE);
        if (entity instanceof net.minecraft.world.entity.Mob mob && mob.isEquippableInSlot(saddle, net.minecraft.world.entity.EquipmentSlot.SADDLE)) {
            mob.setItemSlot(net.minecraft.world.entity.EquipmentSlot.SADDLE, saddle);
        }
    }

    static void clear(net.minecraft.world.level.block.entity.BlockEntity entity) {
        if (entity instanceof net.minecraft.world.Clearable clearable) {
            clearable.clearContent();
        }
    }

    static net.minecraft.nbt.CompoundTag parseNbt(String text) throws com.mojang.brigadier.exceptions.CommandSyntaxException {
        return net.minecraft.nbt.TagParser.parseCompoundFully(text);
    }

    /** What the entity saves, as text: a projectile's state that no accessor reaches on every release. */
    static String nbtText(net.minecraft.world.entity.Entity entity) {
        net.minecraft.nbt.CompoundTag tag = entity.saveWithoutId(new net.minecraft.nbt.CompoundTag());
        return tag.toString();
    }

    /** Merges into what the entity saves, as /summon does. */
    static void mergeNbt(net.minecraft.world.entity.Entity entity, String text) throws com.mojang.brigadier.exceptions.CommandSyntaxException {
        net.minecraft.nbt.CompoundTag tag = entity.saveWithoutId(new net.minecraft.nbt.CompoundTag());
        tag.merge(parseNbt(text));
        entity.load(tag);
    }

    /** The body slot of what is not a horse. */
    static boolean equipBody(net.minecraft.world.entity.LivingEntity entity, net.minecraft.world.item.ItemStack stack) {
        return false;
    }

    /** ServerGamePacketListenerImpl kicks a player floating too long unless the server allows flight. */
    static void setFlightAllowed(net.minecraft.server.MinecraftServer server, boolean allowed) {
        server.setFlightAllowed(allowed);
    }

    static void stopWorldRules(net.minecraft.world.level.GameRules rules, net.minecraft.server.MinecraftServer server) {
        rules.getRule(net.minecraft.world.level.GameRules.RULE_DAYLIGHT).set(false, server);
        rules.getRule(net.minecraft.world.level.GameRules.RULE_WEATHER_CYCLE).set(false, server);
        rules.getRule(net.minecraft.world.level.GameRules.RULE_DOMOBSPAWNING).set(false, server);
    }

    /** The damage a mortal case keeps count of: fall, fire and freeze (stopDamageRules and stopFreezeDamage turn them off). */
    static void mortalDamage(net.minecraft.world.level.GameRules rules, net.minecraft.server.MinecraftServer server, boolean on) {
        rules.getRule(net.minecraft.world.level.GameRules.RULE_FALL_DAMAGE).set(on, server);
        rules.getRule(net.minecraft.world.level.GameRules.RULE_FIRE_DAMAGE).set(on, server);
        rules.getRule(net.minecraft.world.level.GameRules.RULE_FREEZE_DAMAGE).set(on, server);
    }

    static void stopDamageRules(net.minecraft.world.level.GameRules rules, net.minecraft.server.MinecraftServer server) {
        rules.getRule(net.minecraft.world.level.GameRules.RULE_FALL_DAMAGE).set(false, server);
        rules.getRule(net.minecraft.world.level.GameRules.RULE_FIRE_DAMAGE).set(false, server);
        rules.getRule(net.minecraft.world.level.GameRules.RULE_DROWNING_DAMAGE).set(false, server);
    }

    static void stopDropRules(net.minecraft.world.level.GameRules rules, net.minecraft.server.MinecraftServer server) {
        rules.getRule(net.minecraft.world.level.GameRules.RULE_DOENTITYDROPS).set(false, server);
        rules.getRule(net.minecraft.world.level.GameRules.RULE_DOBLOCKDROPS).set(false, server);
    }

    static net.minecraft.commands.CommandSourceStack fullPermission(net.minecraft.commands.CommandSourceStack source) {
        return source.withPermission(4);
    }

    /** What only takes a saddle tamed, besides a horse. */
    static void tame(net.minecraft.world.entity.Entity entity) {
        // (nothing)
    }

    static void setDayTime(net.minecraft.server.level.ServerLevel level, long time) {
        level.setDayTime(time);
    }

    static void clearWeather(net.minecraft.server.level.ServerLevel level) {
        level.setWeatherParameters(1_000_000, 0, false, false);
    }

    static java.util.Optional<net.minecraft.world.entity.EntityType<?>> entityType(String id) {
        return net.minecraft.world.entity.EntityType.byString(id);
    }
}
