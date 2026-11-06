// The moving piston blocks of a snapshot as the engine's world takes them. A moving_piston block has the shape of its
// block entity (MovingPistonBlock.getCollisionShape), which the world's blocks do not say: the field movingPistons does.

import { versionAtLeast } from '../scenarios/dsl/names.ts';
import type { Snapshot } from '../schema/recording.ts';
import type { AreaWorld } from './world.ts';

interface RecordedPiston {
    readonly pos: readonly [number, number, number];
    readonly facing: string;
    readonly extending: boolean;
    readonly source: boolean;
    readonly progress: number;
    /** The block it moves, as the release names it (#id:data before the flattening). */
    readonly moved?: string;
}

/** Direction.from3DDataValue. */
const DIRECTIONS = ['down', 'up', 'north', 'south', 'west', 'east'];
const LEGACY = /^#(\d+):(\d+)$/;
const PISTON_BASE_IDS = new Set([29, 33]);
const PISTON_HEAD_ID = 34;

const bare = (state: string) => state.replace(/^minecraft:/, '');
const isPistonBase = (state: string) => {
    const legacy = LEGACY.exec(state);
    return legacy ? PISTON_BASE_IDS.has(Number(legacy[1])) : /^(sticky_)?piston\[/.test(state);
};

/**
 * The block whose shape a block entity moves. From 1.11 a source piston shows its head, short while its arm slides into
 * the base (1.12.2 PistonBlockEntity.java:331-338, 26.3 PistonMovingBlockEntity.java:340-344); before, the block it holds.
 * The numbers before the flattening say no `short`: BlockPistonExtension's arm is its own property there.
 */
function shown(version: string, piston: RecordedPiston, moved: string): string {
    if (!piston.source || !versionAtLeast(version, '1.11')) return moved;
    const facing = DIRECTIONS.indexOf(piston.facing);
    if (LEGACY.test(moved)) return `#${PISTON_HEAD_ID}:${facing}`;
    const short = piston.extending !== (Math.fround(1 - piston.progress) < 0.25);
    return `piston_head[facing=${piston.facing},short=${short}]`;
}

/** The extended base a source piston leaves as it retracts, from 1.11 (1.12.2 PistonBlockEntity.java:323-325, 26.3 :329-330). */
function base(version: string, piston: RecordedPiston, moved: string): string | undefined {
    if (piston.extending || !piston.source || !versionAtLeast(version, '1.11') || !isPistonBase(moved)) return undefined;
    const legacy = LEGACY.exec(moved);
    return legacy ? `#${legacy[1]}:${Number(legacy[2]) | 8}` : moved.replace('extended=false', 'extended=true');
}

/** The moving blocks at a snapshot; those with no block recorded are named in `problems`. */
export function movingBlocks(version: string, snapshot: Snapshot, area: AreaWorld, problems: string[]) {
    return ((snapshot.movingPistons ?? []) as RecordedPiston[]).flatMap(piston => {
        if (!piston.moved) {
            problems.push(`the moving piston at [${piston.pos.join(',')}] does not say the block it moves`);
            return [];
        }
        const moved = bare(piston.moved);
        const [x, y, z] = piston.pos;
        const extended = base(version, piston, moved);
        return [{
            x, y, z,
            facing: DIRECTIONS.indexOf(piston.facing),
            extending: piston.extending,
            source: piston.source,
            progress: piston.progress,
            block: area.block(shown(version, piston, moved)),
            next: area.block(shown(version, { ...piston, progress: Math.min(Math.fround(piston.progress + 0.5), 1) }, moved)),
            ...(extended ? { base: area.block(extended) } : {}),
        }];
    });
}
