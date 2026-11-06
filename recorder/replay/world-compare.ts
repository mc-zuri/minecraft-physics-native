// The world the engine holds against the world the client resolved, cell by cell, before a move is compared and after each
// world edit. The recording says each cell's resolved state (neighbour updates included: a fence's connections are in its
// state); the expected boxes and fluid are read from that state in the release's block data, and what is read back is the
// NativeWorld's, so a block that never arrived, a stale one and a wrong shape all show here and not as a move that went wrong.

import type { Recording } from '../schema/recording.ts';
import { worldSync } from './engine.ts';
import type { AreaWorld } from './world.ts';

export interface WorldDifference {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly state: string;
    readonly field: 'collision' | 'fluid';
    readonly expected: unknown;
    readonly actual: unknown;
}

export interface WorldComparison {
    readonly cells: number;
    /** Cells with a block, and with a fluid, so that a comparison of air says so. */
    readonly solid: number;
    readonly fluid: number;
    readonly differences: readonly WorldDifference[];
}

type Box = readonly [number, number, number, number, number, number];
const FLUIDS = new Set(['water', 'lava', 'flowing_water', 'flowing_lava', 'bubble_column', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant']);
const key = (box: Box) => box.map(v => v.toFixed(7)).join();
const sorted = (boxes: readonly Box[]) => boxes.map(key).sort();

export interface CompareOptions {
    /** The rows whose world edits are applied before comparing, by index; all of them when absent, none at 0. */
    readonly rows?: number;
    /** Changes the world behind the engine, as a test does: a cell the sync is not told of must show. */
    readonly tamper?: (area: AreaWorld) => void;
}

/** Every cell of the recording's area, the world's state after `rows` rows of edits. */
export function compareWorld(recording: Recording, options: CompareOptions = {}): WorldComparison {
    const blocks = recording.header.world.blocks;
    if (!blocks) return { cells: 0, solid: 0, fluid: 0, differences: [] };
    const { sync: syncLike, area } = worldSync(recording);
    const sync = syncLike as unknown as { sync: typeof syncLike.sync; blockChanged: typeof syncLike.blockChanged; collisions(box: object): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }[]; world: { blockAt(x: number, y: number, z: number): { fluid: number } } };
    const [fx, fy, fz] = blocks.from;
    const [tx, ty, tz] = blocks.to;
    const whole = { minX: fx, minY: fy, minZ: fz, maxX: tx + 1, maxY: ty + 1, maxZ: tz + 1 };
    sync.sync(area, whole, 0);
    for (const row of recording.rows.slice(0, options.rows ?? recording.rows.length)) {
        for (const [x, y, z, state] of row.blocks) {
            area.setState(x, y, z, state);
            sync.blockChanged({ x, y, z });
        }
    }
    sync.sync(area, whole, 0);
    options.tamper?.(area);
    const differences: WorldDifference[] = [];
    let [cells, solid, fluid] = [0, 0, 0];
    // (whose a box is, by where it starts: a fence's reaches into the cell above it)
    const held = new Map<string, Box[]>();
    for (const b of sync.collisions({ ...whole, minY: fy - 1, maxY: ty + 2 })) {
        const cell = `${Math.floor(b.min.x + 1e-9)},${Math.floor(b.min.y + 1e-9)},${Math.floor(b.min.z + 1e-9)}`;
        const boxes = held.get(cell) ?? [];
        boxes.push([b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z]);
        held.set(cell, boxes);
    }
    for (let x = fx; x <= tx; x += 1) {
        for (let y = fy; y <= ty; y += 1) {
            for (let z = fz; z <= tz; z += 1) {
                cells += 1;
                const block = area.getBlock({ x, y, z }) as unknown as { name: string; shapes: number[][]; getProperties(): Record<string, unknown> };
                const expected = block.shapes.map(s => [x + s[0]!, y + s[1]!, z + s[2]!, x + s[3]!, y + s[4]!, z + s[5]!] as unknown as Box);
                if (expected.length > 0) solid += 1;
                const actual = held.get(`${x},${y},${z}`) ?? [];
                if (sorted(expected).join('|') !== sorted(actual).join('|')) differences.push({ x, y, z, state: block.name, field: 'collision', expected, actual });
                const wet = FLUIDS.has(block.name) || block.getProperties().waterlogged === true;
                if (wet) fluid += 1;
                const nativeFluid = sync.world.blockAt(x, y, z).fluid !== 0;
                if (wet !== nativeFluid) differences.push({ x, y, z, state: block.name, field: 'fluid', expected: wet, actual: nativeFluid });
            }
        }
    }
    return { cells, solid, fluid, differences };
}
