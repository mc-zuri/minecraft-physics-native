package dev.mcpn.recorder.mc.mixin;

import net.minecraft.world.entity.vehicle.Boat;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(Boat.class)
public interface BoatAccessor {
    @Accessor("status")
    Boat.Status recorder$status();

    @Accessor("oldStatus")
    Boat.Status recorder$oldStatus();

    @Accessor("deltaRotation")
    float recorder$deltaRotation();

    @Accessor("waterLevel")
    double recorder$waterLevel();

    @Accessor("landFriction")
    float recorder$landFriction();

    // (Calamus has these two the wrong way round across 1.13: Boat.setInput stores left in "inputDown")
    @Accessor("inputDown")
    boolean recorder$inputLeft();

    @Accessor("inputRight")
    boolean recorder$inputRight();

    @Accessor("inputUp")
    boolean recorder$inputUp();

    @Accessor("inputLeft")
    boolean recorder$inputDown();

    @Accessor("outOfControlTicks")
    float recorder$outOfControlTicks();

    @Accessor("lastYd")
    double recorder$lastYd();

    @Accessor("paddlePositions")
    float[] recorder$paddlePositions();

}
