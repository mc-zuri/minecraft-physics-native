package dev.mcpn.recorder.mc.mixin;

import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.chunk.LevelChunk;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/**
 * An entity stands in the client's chunk lists once. Until 1.17 a chunk's arrival adds every entity over it
 * (ClientWorld.addEntitiesToChunk, 1.15 ClientPlayNetworkHandler.java:733) without taking it out of where it is listed, which
 * ClientWorld.checkChunk does on the entity's own tick. So a chunk that arrives before that tick leaves the entity listed
 * twice, one tick's difference in the packets: back in that section, a cow finds the player twice, and pushes it twice
 * in a tick. What arrives here does what checkChunk does.
 */
@Mixin(ClientLevel.class)
public class ClientChunkEntriesMixin {
    @Redirect(method = "reAddEntitiesToChunk", at = @At(value = "INVOKE", target = "Lnet/minecraft/world/level/chunk/LevelChunk;addEntity(Lnet/minecraft/world/entity/Entity;)V"))
    private void recorder$moved(LevelChunk chunk, Entity entity) {
        ClientLevel level = (ClientLevel) (Object) this;
        if (entity.inChunk && level.hasChunk(entity.xChunk, entity.zChunk)) {
            level.getChunk(entity.xChunk, entity.zChunk).removeEntity(entity, entity.yChunk);
        }
        chunk.addEntity(entity);
    }

    /**
     * What a chunk's list says of those no longer in it. ClientChunkCache.getChunk gives the empty chunk for a chunk outside
     * the view, and its unload is ignored there too, so a far teleport whose view centre comes before the player's tick leaves
     * the player listed in a chunk the ring keeps, which comes back as it was when the player does (1.15 ClientChunkManager
     * unload, getChunk, loadChunkFromPacket; ClientWorld.checkChunk). Each tick that entry finds the player again, one tick's
     * difference in the packets, until the player is replaced. What arrives here is what stands in the chunk.
     */
    @org.spongepowered.asm.mixin.injection.Inject(method = "reAddEntitiesToChunk", at = @At("HEAD"))
    private void recorder$stale(LevelChunk chunk, org.spongepowered.asm.mixin.injection.callback.CallbackInfo ci) {
        net.minecraft.util.ClassInstanceMultiMap<Entity>[] sections = chunk.getEntitySections();
        for (int y = 0; y < sections.length; y++) {
            java.util.Set<Entity> seen = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>());
            for (Entity entity : new java.util.ArrayList<>(sections[y])) {
                boolean here = entity.inChunk && entity.xChunk == chunk.getPos().x && entity.yChunk == y && entity.zChunk == chunk.getPos().z;
                if (!here || !seen.add(entity)) sections[y].remove(entity);
            }
        }
    }
}
