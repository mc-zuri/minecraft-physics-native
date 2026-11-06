package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Json;
import io.netty.buffer.Unpooled;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.chat.TextComponent;
import net.minecraft.network.protocol.game.ClientboundTabListPacket;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;

/** The feature cases' server actions, and what the crosshair hits. */
final class CompatFeature {
    private CompatFeature() {
    }

    /** (no poses before 1.14) */
    static void stand(net.minecraft.world.entity.Entity entity) {
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
        player.connection.disconnect(reason);
    }

    static Json.Obj crosshair(Minecraft mc) {
        // (one class for every kind of hit before 1.14)
        HitResult hit = mc.hitResult;
        if (hit == null || hit.type == HitResult.Type.MISS) {
            return new Json.Obj().bool("miss", true);
        }
        Vec3 at = hit.location;
        if (hit.type == HitResult.Type.BLOCK) {
            BlockPos pos = hit.getBlockPos();
            return new Json.Obj().raw("block", Json.ints(pos.getX(), pos.getY(), pos.getZ()))
                .str("face", hit.direction.getName()).raw("at", Json.doubles(at.x, at.y, at.z));
        }
        return new Json.Obj().num("entity", hit.entity.getId()).raw("at", Json.doubles(at.x, at.y, at.z));
    }
}
