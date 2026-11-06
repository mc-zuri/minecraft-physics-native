package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.ServerOpsImpl;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.level.Level;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * A server entity made during a case draws from a random seeded by the case and the order it was made in (a
 * firework rocket's lifetime, a dismount spot), instead of an unseeded one, so two runs of a case match.
 */
@Mixin(Entity.class)
public class EntityRandomMixin {
    @Shadow
    @Final
    protected java.util.Random random;

    @Inject(method = "<init>", at = @At("TAIL"))
    private void recorder$seed(EntityType<?> type, Level level, CallbackInfo ci) {
        if (level != null && level.isClientSide()) {
            // a client mob draws for itself too (before 1.19.3 a horse's ambient sound makes it rear, on the client alone)
            Long seed = ServerOpsImpl.nextClientEntitySeed();
            if (seed != null) {
                this.random.setSeed(seed);
            }
        } else if (level != null) {
            Long seed = ServerOpsImpl.nextEntitySeed();
            if (seed != null) {
                this.random.setSeed(seed);
                ((Entity) (Object) this).setUUID(net.minecraft.util.Mth.createInsecureUUID(this.random));
                ((Entity) (Object) this).setId(ServerOpsImpl.lastEntityId());
            }
        }
    }
}
