// The shulker box lids of a recording. The recording holds no lid: it holds the block events the server sent
// (ClientboundBlockEventPacket), and every client animates a lid from those alone, so the replay runs the same
// ShulkerBoxTracker a bot does, and the boxes and pushes come from the engine.

import { ShulkerBoxTracker } from '../../dist/mineflayer/shulkers.js';
import type { OpenShulkerBox } from '../../dist/mineflayer/shulkers.js';
import type { NativePhysicsBinding } from '../../dist/native.js';
import { packetBytes } from './load.ts';
import { readClientbound } from './packets.ts';
import type { AreaWorld } from './world.ts';

interface Packet { readonly name: string; readonly b: string }

const FACINGS = ['down', 'up', 'north', 'south', 'west', 'east'];

export class ReplayLids {
    private readonly tracker: ShulkerBoxTracker;
    private readonly version: string;
    private readonly area: AreaWorld;
    private ticked = -1;

    constructor(binding: NativePhysicsBinding, version: string, area: AreaWorld) {
        this.tracker = new ShulkerBoxTracker(binding, version);
        this.version = version;
        this.area = area;
    }

    /** The block events of a row: a client handles them before its level ticks. */
    packets(row: { readonly t: number; readonly s2c: readonly Packet[] }): void {
        for (const packet of row.s2c) {
            if (!/Block(Event|Action)/i.test(packet.name)) continue;
            const { name, params } = readClientbound(this.version, packetBytes(packet.b));
            if (name !== 'block_action') continue;
            const { location, byte1, byte2 } = params as { location: { x: number; y: number; z: number }; byte1: number; byte2: number };
            const block = this.area.getBlock(location) as { name?: string; metadata?: number; getProperties?(): { facing?: string } } | null;
            if (byte1 !== 1 || !block?.name?.endsWith('shulker_box')) continue;
            // (before the flattening the facing is the block's data, a Direction's ordinal)
            const named = block.getProperties?.().facing;
            const facing = named ? FACINGS.indexOf(named) : block.metadata ?? 1;
            this.tracker.event(location.x, location.y, location.z, facing, byte2);
        }
    }

    /** The lids as the move meets them: as the last tick left them. */
    boxes(): OpenShulkerBox[] {
        return this.tracker.boxes();
    }

    /** The block entities' tick, after the entities': once a row, whatever the row did. The lids that push. */
    tick(t: number): OpenShulkerBox[] {
        if (this.ticked === t) return [];
        this.ticked = t;
        this.tracker.tick();
        return this.tracker.boxes().filter(box => box.pushes);
    }
}
