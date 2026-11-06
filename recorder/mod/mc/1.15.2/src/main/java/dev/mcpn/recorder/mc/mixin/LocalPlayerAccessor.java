package dev.mcpn.recorder.mc.mixin;

import net.minecraft.client.player.LocalPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** What LocalPlayer keeps about its input and what it last sent (sendPosition's bookkeeping). */
@Mixin(LocalPlayer.class)
public interface LocalPlayerAccessor {
    @Accessor("xLast")
    double recorder$xLast();

    @Accessor("yLast1")
    double recorder$yLast();

    @Accessor("zLast")
    double recorder$zLast();

    @Accessor("xLast")
    void recorder$setXLast(double value);

    @Accessor("yLast1")
    void recorder$setYLast(double value);

    @Accessor("zLast")
    void recorder$setZLast(double value);

    @Accessor("yRotLast")
    float recorder$yRotLast();

    @Accessor("xRotLast")
    float recorder$xRotLast();

    @Accessor("lastOnGround")
    boolean recorder$lastOnGround();

    @Accessor("wasShiftKeyDown")
    boolean recorder$wasShiftKeyDown();

    @Accessor("wasSprinting")
    boolean recorder$wasSprinting();

    @Accessor("positionReminder")
    int recorder$positionReminder();

    @Accessor("positionReminder")
    void recorder$setPositionReminder(int value);

    @Accessor("autoJumpTime")
    int recorder$autoJumpTime();

    @Accessor("autoJumpEnabled")
    boolean recorder$autoJumpEnabled();

    @Accessor("sprintTriggerTime")
    int recorder$sprintTriggerTime();

    @Accessor("jumpRidingScale")
    float recorder$jumpRidingScale();

    @Accessor("jumpRidingTicks")
    int recorder$jumpRidingTicks();
}
