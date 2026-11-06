package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.entity.animal.horse.AbstractHorse;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(AbstractHorse.class)
public interface AbstractHorseAccessor {
    @Accessor("standCounter")
    int recorder$standCounter();

    @Accessor("isJumping")
    boolean recorder$isJumpingField();

    @Accessor("playerJumpPendingScale")
    float recorder$playerJumpPendingScale();

    @Accessor("allowStandSliding")
    boolean recorder$allowStandSliding();

    @Invoker("createInventory")
    void recorder$createInventory();

}
