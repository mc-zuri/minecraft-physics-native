package dev.mcpn.recorder.mc.mixin;

import dev.mcpn.recorder.mc.SharedRandom;
import java.util.Random;
import net.minecraft.world.entity.animal.Animal;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** What an animal is worth is a draw from the level's random in 1.8, which draws a varying number of times a tick. */
@Mixin(Animal.class)
public class AnimalExperienceMixin {
    @Redirect(method = "getExperienceReward", at = @At(value = "INVOKE", target = "Ljava/util/Random;nextInt(I)I"))
    private int recorder$seeded(Random random, int bound) {
        return (int) (SharedRandom.next() * bound);
    }
}
