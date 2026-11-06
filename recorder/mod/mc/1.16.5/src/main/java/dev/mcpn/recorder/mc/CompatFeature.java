package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Json;
import io.netty.buffer.Unpooled;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.chat.TextComponent;
import net.minecraft.network.protocol.game.ClientboundTabListPacket;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;

/** The feature cases' server actions, and what the crosshair hits. */
final class CompatFeature {
    private CompatFeature() {
    }

    /** A pose left by what ran before, which a new start may not put right before its first tick. */
    static void stand(net.minecraft.world.entity.Entity entity) {
        entity.setPose(net.minecraft.world.entity.Pose.STANDING);
    }

    static void tabList(ServerPlayer player, String header, String footer) {
        // the packet takes its header and footer only from the wire
        FriendlyByteBuf buf = new FriendlyByteBuf(Unpooled.buffer());
        ClientboundTabListPacket packet = new ClientboundTabListPacket();
        try {
            buf.writeComponent(new TextComponent(header));
            buf.writeComponent(new TextComponent(footer));
            packet.read(buf);
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
        player.connection.send(packet);
    }

    static void kick(ServerPlayer player, String reason) {
        player.connection.disconnect(new TextComponent(reason));
    }

    static Json.Obj crosshair(Minecraft mc) {
        HitResult hit = mc.hitResult;
        if (hit == null || hit.getType() == HitResult.Type.MISS) {
            return new Json.Obj().bool("miss", true);
        }
        Vec3 at = hit.getLocation();
        if (hit instanceof BlockHitResult block) {
            BlockPos pos = block.getBlockPos();
            return new Json.Obj().raw("block", Json.ints(pos.getX(), pos.getY(), pos.getZ()))
                .str("face", block.getDirection().getName()).raw("at", Json.doubles(at.x, at.y, at.z));
        }
        return new Json.Obj().num("entity", ((EntityHitResult) hit).getEntity().getId()).raw("at", Json.doubles(at.x, at.y, at.z));
    }
}
