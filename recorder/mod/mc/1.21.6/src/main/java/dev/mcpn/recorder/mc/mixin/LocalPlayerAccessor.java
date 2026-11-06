package dev.mcpn.recorder.mc.mixin;

import net.minecraft.client.player.LocalPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** What LocalPlayer keeps about its input and what it last sent (sendPosition's bookkeeping). */
@Mixin(LocalPlayer.class)
public interface LocalPlayerAccessor {
    @Accessor("xLast")
    double recorder$xLast();

    @Accessor("yLast")
    double recorder$yLast();

    @Accessor("zLast")
    double recorder$zLast();

    @Accessor("xLast")
    void recorder$setXLast(double value);

    @Accessor("yLast")
    void recorder$setYLast(double value);

    @Accessor("zLast")
    void recorder$setZLast(double value);

    @Accessor("yRotLast")
    float recorder$yRotLast();

    @Accessor("xRotLast")
    float recorder$xRotLast();

    @Accessor("lastOnGround")
    boolean recorder$lastOnGround();

    @Accessor("wasSprinting")
    boolean recorder$wasSprinting();

    @Accessor("positionReminder")
    int recorder$positionReminder();

    @Accessor("positionReminder")
    void recorder$setPositionReminder(int value);

    @Accessor("crouching")
    boolean recorder$crouching();

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
