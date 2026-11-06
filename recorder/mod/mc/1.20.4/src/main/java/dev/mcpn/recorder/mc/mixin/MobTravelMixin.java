package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.PlayerSnap;
import net.minecraft.world.entity.LivingEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Around the travel call of LivingEntity.aiStep, on the server: what a mob's AI left it to travel with and what the travel
 * left, for the replay of the mobs whose travel is their own. The call takes a Vec3 from 1.14, three floats from 1.12 and two
 * before; a release has one of them, and the others find nothing. From 1.21.2 the blocks' effects follow the travel, in the
 * same step of aiStep, and what they left is what the travel left (its other name is 1.21.2 - 1.21.4's).
 */
@Mixin(LivingEntity.class)
public class MobTravelMixin {
    private static final String VEC = "Lnet/minecraft/world/entity/LivingEntity;travel(Lnet/minecraft/world/phys/Vec3;)V";
    private static final String THREE = "Lnet/minecraft/world/entity/LivingEntity;travel(FFF)V";
    private static final String TWO = "Lnet/minecraft/world/entity/LivingEntity;travel(FF)V";

    private boolean recorder$watched() {
        LivingEntity self = (LivingEntity) (Object) this;
        // (read by name: the releases reach the level in different ways)
        return dev.mcpn.recorder.Fields.get(self, net.minecraft.world.entity.Entity.class, "level") instanceof net.minecraft.server.level.ServerLevel
            && PlayerSnap.ownTravel(self);
    }

    private static final String EFFECTS = "Lnet/minecraft/world/entity/LivingEntity;applyEffectsFromBlocks()V";

    @Inject(method = "aiStep", require = 0, at = @At(value = "INVOKE", target = EFFECTS, shift = At.Shift.AFTER))
    private void recorder$afterEffects(CallbackInfo info) {
        if (recorder$watched()) {
            PlayerSnap.afterTravel((LivingEntity) (Object) this);
        }
    }

    @Inject(method = "aiStep", require = 0, at = {@At(value = "INVOKE", target = VEC), @At(value = "INVOKE", target = THREE), @At(value = "INVOKE", target = TWO)})
    private void recorder$beforeTravel(CallbackInfo info) {
        if (recorder$watched()) {
            PlayerSnap.beforeTravel((LivingEntity) (Object) this);
        }
    }

    @Inject(method = "aiStep", require = 0, at = {
        @At(value = "INVOKE", target = VEC, shift = At.Shift.AFTER),
        @At(value = "INVOKE", target = THREE, shift = At.Shift.AFTER),
        @At(value = "INVOKE", target = TWO, shift = At.Shift.AFTER)})
    private void recorder$afterTravel(CallbackInfo info) {
        if (recorder$watched()) {
            PlayerSnap.afterTravel((LivingEntity) (Object) this);
        }
    }
}
