package dev.mcpn.recorder.mc;

/** The fields of a camel. */
final class CompatCamel {
    private CompatCamel() {
    }

    static void write(net.minecraft.world.entity.LivingEntity entity, dev.mcpn.recorder.Json.Obj out) {
        if (entity instanceof net.minecraft.world.entity.animal.camel.Camel camel) {
            out.num("dashCooldown", ((dev.mcpn.recorder.mc.mixin.CamelAccessor) camel).recorder$dashCooldown())
                .bool("dashing", camel.isDashing()).bool("sitting", camel.isCamelSitting()).num("poseTime", camel.getPoseTime());
        }
    }
}
