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

    @Accessor("inputLeft")
    boolean recorder$inputLeft();

    @Accessor("inputRight")
    boolean recorder$inputRight();

    @Accessor("inputUp")
    boolean recorder$inputUp();

    @Accessor("inputDown")
    boolean recorder$inputDown();

    @Accessor("outOfControlTicks")
    float recorder$outOfControlTicks();

    @Accessor("lastYd")
    double recorder$lastYd();

    @Accessor("isAboveBubbleColumn")
    boolean recorder$isAboveBubbleColumn();

    @Accessor("bubbleColumnDirectionIsDown")
    boolean recorder$bubbleColumnDirectionIsDown();

    @Accessor("bubbleMultiplier")
    float recorder$bubbleMultiplier();

    @Accessor("paddlePositions")
    float[] recorder$paddlePositions();

    @Invoker("getBubbleTime")
    int recorder$bubbleTime();
}
