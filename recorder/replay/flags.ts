// The player's shared flags as the server last sent them. Entity.isOnFire on a client reads flag 0 besides the ticks, and the
// client keeps no count of the server's fire, so only the packets say it.

import type { RecordingHeader } from '../schema/recording.ts';
import { packetBytes } from './load.ts';
import { decodeClientbound } from './packets.ts';

interface Packet { readonly name: string; readonly b: string }
interface Metadata { readonly key: number; readonly value: unknown }

export class SharedFlags {
    private readonly version: string;
    private readonly player: number;
    private flags = 0;

    constructor(header: RecordingHeader) {
        this.version = header.mc;
        this.player = header.player.id;
    }

    packets(packets: readonly Packet[]): void {
        for (const packet of packets) {
            if (packet.name !== 'ClientboundSetEntityDataPacket') continue;
            const { params } = decodeClientbound(this.version, packetBytes(packet.b));
            if (params.entityId !== this.player) continue;
            const flags = (params.metadata as readonly Metadata[]).find(entry => entry.key === 0);
            if (typeof flags?.value === 'number') this.flags = flags.value;
        }
    }

    get onFire(): boolean {
        return (this.flags & 1) !== 0;
    }
}
