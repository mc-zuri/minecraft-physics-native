// A NativeWorld kept in step with a prismarine world (mineflayer's bot.world, or any world with getBlock): before each
// tick the blocks around the simulated entity are read again, and every block whose own state or a neighbour's changed
// is written anew (its shape before 1.13, its fluid flow and the trapdoor over a ladder depend on the blocks around).
import type { NativeAabb, NativePhysicsBinding, NativeWorld } from '../native';
import { BlockMapper, describeBlock, type DescribedBlock, type PrismarineBlock } from './blocks';
import type { Box } from './legacy';

export interface Vec3Like {
    x: number;
    y: number;
    z: number;
}

/** A prismarine world: mineflayer's bot.world, or anything that gives the prismarine block at a position. */
export interface PrismarineWorld {
    getBlock(pos: Vec3Like): PrismarineBlock | null | undefined;
    /** The state id at a position, read without building a block (prismarine-world's). */
    getBlockStateId?(pos: Vec3Like): number | null | undefined;
}

export interface SyncRegistry {
    version: ConstructorParameters<typeof BlockMapper>[0];
    blocksArray: { id: number; name: string }[];
    blocksByName: Record<string, { id: number } | undefined>;
}

export interface BoxLike {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

const UNKNOWN = -1;
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

class Cursor implements Vec3Like {
    constructor(public x = 0, public y = 0, public z = 0) {}

    set(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }

    floored() {
        return new Cursor(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    }

    clone() {
        return new Cursor(this.x, this.y, this.z);
    }

    offset(dx: number, dy: number, dz: number) {
        return new Cursor(this.x + dx, this.y + dy, this.z + dz);
    }
}

export class NativeWorldSync {
    readonly world: NativeWorld;
    private readonly mapper: BlockMapper;
    /** The state id read at each cell (UNKNOWN where the world had no block), and the block of each state id. */
    private readonly ids = new Map<string, number>();
    private readonly described = new Map<number, DescribedBlock>();
    /** The cells written with the blocks around them as they were read. */
    private readonly written = new Set<string>();
    private readonly loadedChunks = new Set<string>();
    private readonly cursor = new Cursor();
    private source: PrismarineWorld | null = null;

    constructor(binding: NativePhysicsBinding, registry: SyncRegistry) {
        this.world = new binding.NativeWorld();
        this.mapper = new BlockMapper(registry.version, registry);
    }

    /**
     * Brings the blocks within `margin` of `box` up to date with `source` (a new source forgets the blocks of the old
     * one). The blocks within one more block are read too, as the ones nearest the box are made from them.
     */
    sync(source: PrismarineWorld, box: BoxLike, margin: number): void {
        if (source !== this.source) this.reset(source);
        const lo = [Math.floor(box.minX - margin), Math.floor(box.minY - margin), Math.floor(box.minZ - margin)];
        const hi = [Math.floor(box.maxX + margin), Math.floor(box.maxY + margin), Math.floor(box.maxZ + margin)];
        const dirty = new Set<string>();
        for (let x = lo[0] - 1; x <= hi[0] + 1; x += 1) {
            for (let z = lo[2] - 1; z <= hi[2] + 1; z += 1) {
                for (let y = lo[1] - 1; y <= hi[1] + 1; y += 1) {
                    const cell = key(x, y, z);
                    const id = this.read(source, x, y, z);
                    if (this.ids.get(cell) === id) continue;
                    this.ids.set(cell, id);
                    for (let dx = -1; dx <= 1; dx += 1) {
                        for (let dy = -1; dy <= 1; dy += 1) {
                            for (let dz = -1; dz <= 1; dz += 1) dirty.add(key(x + dx, y + dy, z + dz));
                        }
                    }
                }
            }
        }
        const updates = [];
        const rewritten: [number, number, number][] = [];
        for (let x = lo[0]; x <= hi[0]; x += 1) {
            for (let z = lo[2]; z <= hi[2]; z += 1) {
                for (let y = lo[1]; y <= hi[1]; y += 1) {
                    const cell = key(x, y, z);
                    if (this.written.has(cell) && !dirty.has(cell)) continue;
                    this.written.add(cell);
                    rewritten.push([x, y, z]);
                    updates.push({ x, y, z, remove: true }, ...this.mapper.updatesAt(this.blockAt, x, y, z));
                }
            }
        }
        if (updates.length === 0) return;
        try {
            this.world.applyBlockUpdates(updates);
        } catch {
            // a block NativeWorld refuses stays out; the others go in one by one
            for (const [x, y, z] of rewritten) {
                try {
                    this.world.applyBlockUpdates([{ x, y, z, remove: true }, ...this.mapper.updatesAt(this.blockAt, x, y, z)]);
                } catch {
                    this.world.applyBlockUpdates([{ x, y, z, remove: true }]);
                }
            }
        }
    }

    /** The collision boxes the engine sees within the box, those that meet it. */
    collisions(box: BoxLike): NativeAabb[] {
        const shapes = this.world.collisionShapes({ x: box.minX, y: box.minY, z: box.minZ }, { x: box.maxX, y: box.maxY, z: box.maxZ });
        return shapes.filter(({ min, max }) => min.x < box.maxX && max.x > box.minX && min.y < box.maxY && max.y > box.minY && min.z < box.maxZ && max.z > box.minZ);
    }

    /** The collision boxes of the block the sync read at a cell, in the cell. */
    boxesAt(x: number, y: number, z: number): Box[] {
        const block = this.blockAt(x, y, z);
        return block ? this.mapper.boxesAt(this.blockAt, x, y, z, block) : [];
    }

    /** The block the sync read at a cell (null where the world had none or it was not read). */
    readonly blockAt = (x: number, y: number, z: number): DescribedBlock | null => {
        const id = this.ids.get(key(x, y, z));
        return id === undefined || id === UNKNOWN ? null : this.described.get(id) ?? null;
    };

    private reset(source: PrismarineWorld) {
        this.source = source;
        this.ids.clear();
        this.written.clear();
        for (const chunk of this.loadedChunks) {
            const [chunkX, chunkZ] = chunk.split(',').map(Number);
            this.world.setChunkLoaded(chunkX, chunkZ, false);
        }
        this.loadedChunks.clear();
    }

    private read(source: PrismarineWorld, x: number, y: number, z: number): number {
        const pos = this.cursor.set(x, y, z);
        let id = source.getBlockStateId?.(pos);
        let block: PrismarineBlock | null | undefined;
        if (id == null) {
            block = source.getBlock(pos);
            if (!block) return UNKNOWN;
            id = block.stateId ?? ((block.type << 4) | block.metadata);
        }
        if (!this.described.has(id)) {
            block ??= source.getBlock(pos);
            if (!block) return UNKNOWN;
            this.described.set(id, describeBlock(block));
        }
        const chunk = `${x >> 4},${z >> 4}`;
        if (!this.loadedChunks.has(chunk)) {
            this.loadedChunks.add(chunk);
            this.world.setChunkLoaded(x >> 4, z >> 4, true);
        }
        return id;
    }
}
