package dev.mcpn.recorder.mc;

/** The experimental camel of 1.19.3. */
final class CompatCamel {
    private CompatCamel() {
    }

    static void write(net.minecraft.world.entity.LivingEntity entity, dev.mcpn.recorder.Json.Obj out) {
        if (entity instanceof net.minecraft.world.entity.animal.camel.Camel camel) {
            out.num("dashCooldown", ((dev.mcpn.recorder.mc.mixin.CamelAccessor) camel).recorder$dashCooldown())
                .bool("dashing", camel.isDashing()).bool("sitting", camel.getPose() == net.minecraft.world.entity.Pose.SITTING).num("poseTime", camel.getPoseTime());
        }
    }
}
