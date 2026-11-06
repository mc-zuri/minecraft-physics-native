// The adapter's MovingBlockTracker against the moving blocks the client recorded: from the block events alone it must give
// NativeWorldSync what the recording gives it, tick by tick.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { packetBytes, loadRecording } from '../load.ts';
import { movingBlocks } from '../moving.ts';
import { readClientbound } from '../packets.ts';
import { findRecordings } from '../recordings.ts';
import { AreaWorld } from '../world.ts';
import type { Recording } from '../../schema/recording.ts';

const require = createRequire(import.meta.url);
const { MovingBlockTracker } = require('../../../dist/index.js') as {
    MovingBlockTracker: new (registry: unknown, release: string, world: unknown) => {
        trigger(name: string, base: number[], event: number, param: number): void;
        blockChanged(cell: number[], name: string | undefined): void;
        tick(): void;
        blocks(): { x: number; y: number; z: number; facing: number; extending: boolean; source: boolean; progress: number; block: { stateId?: number; type: number; metadata: number }; base?: { stateId?: number; type: number; metadata: number } }[];
    };
};

type Listed = ReturnType<InstanceType<typeof MovingBlockTracker>['blocks']>[number];
const stateOf = (b: Listed['block'] | undefined) => (b ? b.stateId ?? (b.type << 4 | b.metadata) : undefined);
const brief = (b: Listed) => ({ at: [b.x, b.y, b.z], facing: b.facing, extending: b.extending, source: b.source, progress: b.progress, block: stateOf(b.block), base: stateOf(b.base) });
const sorted = (list: Listed[]) => list.map(brief).sort((p, q) => String(p.at).localeCompare(String(q.at)));

/** The first tick the tracker's blocks and the recorded ones differ, if one does. */
function firstDifference(recording: Recording): string | undefined {
    const version = recording.header.mc;
    const registry = require('prismarine-registry')(version) as { blocks: Record<number, { name: string } | undefined>; blocksByName: unknown };
    const area = new AreaWorld(recording.header);
    const world = {
        getBlock: (pos: { x: number; y: number; z: number }) => area.getBlock(pos),
        getBlockStateId: (pos: { x: number; y: number; z: number }) => area.getBlockStateId(pos),
        setBlockStateId: (pos: { x: number; y: number; z: number }, id: number) => area.set(pos.x, pos.y, pos.z, id),
    };
    const tracker = new MovingBlockTracker(registry, version, world);
    for (const row of recording.rows) {
        for (const packet of row.s2c) {
            if (!/Block(Event|Action)|BlockEvent/i.test(packet.name)) continue;
            const { name, params } = readClientbound(version, packetBytes(packet.b));
            if (name !== 'block_action') continue;
            const { location, blockId, byte1, byte2 } = params as { location: { x: number; y: number; z: number }; blockId: number; byte1: number; byte2: number };
            tracker.trigger(registry.blocks[blockId]?.name ?? '', [location.x, location.y, location.z], byte1, byte2);
        }
        // what the client's level became, the packets' blocks among it: what a packet set in a cell ends its block entity
        // (a cell can change twice in a row, emptied and then moved into: its last state is what stays)
        const settled = new Map(row.blocks.map(([x, y, z, state]) => [`${x},${y},${z}`, [x, y, z, state] as const]));
        for (const [x, y, z, state] of settled.values()) {
            area.setState(x, y, z, state);
            tracker.blockChanged([x, y, z], /moving_piston|^#36:/.test(state) ? 'moving_piston' : state);
        }
        const start = row.phases.find(p => p.name === 'tickStart')?.state ?? row.pre;
        const problems: string[] = [];
        const want = sorted(movingBlocks(version, start, area, problems) as unknown as Listed[]);
        const got = sorted(tracker.blocks());
        if (JSON.stringify(want) !== JSON.stringify(got)) return `t=${row.t}: expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`;
        tracker.tick();
    }
    return undefined;
}

// (single pistons, with what they push in one line; a case of slime or honey moves what the tracker does not follow)
const pistonCases = /^physrec\/(pm_|n_piston_)(?!.*(slime|honey))/;
for (const version of ['1.8.8', '1.12.2', '1.13.2', '26.3']) {
    const files = findRecordings(undefined, [version]).filter(f => pistonCases.test(f.id));
    test(`the moving blocks of ${version} come from the block events alone`, { skip: files.length === 0 ? 'no recordings (set REPLAY_RECORDINGS)' : false }, () => {
        const differing = files.flatMap(f => {
            const difference = firstDifference(loadRecording(f.file));
            return difference ? [`${f.id} ${difference}`] : [];
        });
        assert.deepEqual(differing, []);
    });
}
