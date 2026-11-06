package dev.mcpn.recorder.mc;

/** Before the tick containers of 1.18. */
final class CompatServer {
    static final int INFINITE_EFFECT = Integer.MAX_VALUE;

    private CompatServer() {
    }

    /**
     * The teleport op: an absolute coordinate is area-relative, a relative one an offset from the player (teleportTo
     * takes absolute coordinates and only sends the axes in `relative` as offsets).
     */
    static void teleport(net.minecraft.server.level.ServerPlayer player, net.minecraft.server.level.ServerLevel level, double[] pos, int[] origin,
                         java.util.Set<String> relative, float yRot, float xRot) {
        java.util.Set<net.minecraft.network.protocol.game.ClientboundPlayerPositionPacket.RelativeArgument> flags = java.util.EnumSet.noneOf(net.minecraft.network.protocol.game.ClientboundPlayerPositionPacket.RelativeArgument.class);
        for (String r : relative) {
            flags.add(switch (r) {
                case "x" -> net.minecraft.network.protocol.game.ClientboundPlayerPositionPacket.RelativeArgument.X;
                case "y" -> net.minecraft.network.protocol.game.ClientboundPlayerPositionPacket.RelativeArgument.Y;
                case "z" -> net.minecraft.network.protocol.game.ClientboundPlayerPositionPacket.RelativeArgument.Z;
                case "yRot" -> net.minecraft.network.protocol.game.ClientboundPlayerPositionPacket.RelativeArgument.Y_ROT;
                case "xRot" -> net.minecraft.network.protocol.game.ClientboundPlayerPositionPacket.RelativeArgument.X_ROT;
                default -> throw new IllegalArgumentException("relative " + r);
            });
        }
        double x = (relative.contains("x") ? player.x : origin[0]) + pos[0];
        double y = (relative.contains("y") ? player.y : origin[1]) + pos[1];
        double z = (relative.contains("z") ? player.z : origin[2]) + pos[2];
        // the angles too: these flags only say how the packet writes the target (ServerGamePacketListenerImpl.teleport)
        float yaw = (relative.contains("yRot") ? CompatEntity.yRot(player) : 0.0F) + yRot;
        float pitch = (relative.contains("xRot") ? CompatEntity.xRot(player) : 0.0F) + xRot;
        player.connection.teleport(x, y, z, yaw, pitch, flags);
    }

    static void stopVines(net.minecraft.world.level.GameRules rules, net.minecraft.server.MinecraftServer server) {
        // (no such rule yet)
    }

    static String boatVariant(net.minecraft.world.entity.vehicle.Boat boat) {
        return boat.getBoatType().getName();
    }

    static void setBoatVariant(net.minecraft.world.entity.vehicle.Boat boat, net.minecraft.world.entity.vehicle.Boat.Type variant) {
        boat.setType(variant);
    }

    /** "name[prop=value,...]": the scenario compiler says it in this release's terms, and a property it has wrong is an error. */
    @SuppressWarnings({"unchecked", "rawtypes"})
    static net.minecraft.world.level.block.state.BlockState parseBlock(String state) {
        int open = state.indexOf('[');
        String name = open < 0 ? state : state.substring(0, open);
        net.minecraft.world.level.block.Block block = net.minecraft.world.level.block.Block.REGISTRY.get(new net.minecraft.resources.ResourceLocation(name));
        if (state.startsWith("[#=", open)) {
            // (a block by its data value, as a world saved before the flattening has it)
            return block.stateFromData(Integer.parseInt(state.substring(open + 3, state.length() - 1)));
        }
        net.minecraft.world.level.block.state.BlockState out = block.defaultBlockState();
        if (open >= 0) {
            for (String pair : state.substring(open + 1, state.length() - 1).split(",")) {
                String[] kv = pair.split("=", 2);
                net.minecraft.world.level.block.state.properties.Property property = null;
                for (net.minecraft.world.level.block.state.properties.Property<?> p : out.getProperties()) {
                    if (p.getName().equals(kv[0])) {
                        property = p;
                    }
                }
                if (property == null) {
                    throw new IllegalArgumentException(name + " has no property " + kv[0]);
                }
                Object value = property.getValue(kv[1]).orNull();
                if (value == null) {
                    throw new IllegalArgumentException(name + " has no " + kv[0] + "=" + kv[1]);
                }
                out = out.with(property, (Comparable) value);
            }
        }
        return out;
    }

    static void explode(net.minecraft.server.level.ServerLevel level, double x, double y, double z, float power) {
        level.explode(null, x, y, z, power, false);
    }

    static void equipHorseArmor(net.minecraft.world.entity.animal.horse.AbstractHorse horse, net.minecraft.world.item.ItemStack stack) {
        horse.setItemSlot(net.minecraft.world.entity.EquipmentSlot.CHEST, stack);
    }




    /** Drops the ticks the blocks and fluids of the area scheduled. */
    static void clearTicks(net.minecraft.server.level.ServerLevel level, net.minecraft.world.level.levelgen.structure.BoundingBox bounds) {
        level.getScheduledTicks(bounds, true);
    }

    static void knockback(net.minecraft.world.entity.LivingEntity entity, double strength, double dx, double dz) {
        entity.knockback(entity, (float) strength, dx, dz);
    }

    static void stopFreezeDamage(net.minecraft.world.level.GameRules rules, net.minecraft.server.MinecraftServer server) {
        // (no such rule)
    }

    static void stopRandomTicks(net.minecraft.world.level.GameRules rules, net.minecraft.server.MinecraftServer server) {
        rules.register("randomTickSpeed", "0");
    }

    static boolean chunkTicking(net.minecraft.server.level.ServerLevel level, long chunk) {
        // (a loaded chunk ticks)
        return true;
    }


    static void teleportAbsolute(net.minecraft.server.level.ServerPlayer player, net.minecraft.server.level.ServerLevel level, double x, double y, double z, float yRot, float xRot) {
        player.connection.teleport(x, y, z, yRot, xRot);
    }

    static net.minecraft.world.item.Item item(net.minecraft.resources.ResourceLocation id) {
        return net.minecraft.core.registries.BuiltInRegistries.ITEM.get(id);
    }

    static net.minecraft.network.protocol.Packet<?> carriedItem(int slot) {
        return new net.minecraft.network.protocol.game.ClientboundSetCarriedItemPacket(slot);
    }

    static net.minecraft.world.entity.Entity create(net.minecraft.resources.ResourceLocation id, net.minecraft.server.level.ServerLevel level) {
        return net.minecraft.world.entity.EntityType.createInstanceFromId(id, level);
    }

    /** The saddle, when the entity takes one. */
    static void saddle(net.minecraft.world.entity.Entity entity) {
        if (entity instanceof net.minecraft.world.entity.animal.Pig pig) {
            pig.setSaddle(true);
        } else if (entity instanceof net.minecraft.world.entity.animal.horse.AbstractHorse horse
            && !(entity instanceof net.minecraft.world.entity.animal.horse.Llama) && horse.isTamed() && !horse.isBaby()) {
            horse.setSaddled(true);
        }
    }

    static void clear(net.minecraft.world.level.block.entity.BlockEntity entity) {
        if (entity instanceof net.minecraft.world.Container container) {
            container.clearContent();
        }
    }

    static net.minecraft.nbt.CompoundTag parseNbt(String text) throws Exception {
        return net.minecraft.nbt.TagParser.parseTag(text);
    }

    /** What the entity saves, as text: a projectile's state that no accessor reaches on every release. */
    static String nbtText(net.minecraft.world.entity.Entity entity) {
        net.minecraft.nbt.CompoundTag tag = entity.saveWithoutId(new net.minecraft.nbt.CompoundTag());
        return tag.toString();
    }

    /** Merges into what the entity saves, as /summon does. */
    static void mergeNbt(net.minecraft.world.entity.Entity entity, String text) throws Exception {
        // (a falling block made without its block cannot be saved from 1.11: Block.getData no longer takes null)
        if (entity instanceof net.minecraft.world.entity.item.FallingBlockEntity falling && falling.getBlockState() == null) {
            ((dev.mcpn.recorder.mc.mixin.FallingBlockAccessor) falling).recorder$setBlockState(net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
        }
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

    /** Game rules are strings before 1.14. */
    private static void rule(net.minecraft.server.MinecraftServer server, String name) {
        CompatMove.overworld(server).getGameRules().register(name, "false");
    }

    static void stopWorldRules(net.minecraft.world.level.GameRules rules, net.minecraft.server.MinecraftServer server) {
        rule(server, "doDaylightCycle");
        rule(server, "doWeatherCycle");
        rule(server, "doMobSpawning");
    }

    /** The damage a mortal case keeps count of: fall, fire and freeze (stopDamageRules and stopFreezeDamage turn them off). */
    static void mortalDamage(net.minecraft.world.level.GameRules rules, net.minecraft.server.MinecraftServer server, boolean on) {
        // (no such rules before 1.15: the setup alone makes the player mortal)
    }

    static void stopDamageRules(net.minecraft.world.level.GameRules rules, net.minecraft.server.MinecraftServer server) {
        // (no such rules before 1.15: the setup makes the player invulnerable)
    }

    static void stopDropRules(net.minecraft.world.level.GameRules rules, net.minecraft.server.MinecraftServer server) {
        rule(server, "doEntityDrops");
        rule(server, "doTileDrops");
    }


    /** What only takes a saddle tamed, besides a horse. */
    static void tame(net.minecraft.world.entity.Entity entity) {
        // (nothing)
    }

    static void setDayTime(net.minecraft.server.level.ServerLevel level, long time) {
        level.setDayTime(time);
    }

    static void clearWeather(net.minecraft.server.level.ServerLevel level) {
        var data = level.getLevelData();
        data.setClearWeatherTime(1_000_000);
        data.setRainTime(0);
        data.setThunderTime(0);
        data.setRaining(false);
        data.setThundering(false);
    }

    static java.util.Optional<net.minecraft.resources.ResourceLocation> entityType(String id) {
        net.minecraft.resources.ResourceLocation name = new net.minecraft.resources.ResourceLocation(id);
        return net.minecraft.world.entity.EntityType.IDENTIFIERS.contains(name) ? java.util.Optional.of(name) : java.util.Optional.empty();
    }
}
