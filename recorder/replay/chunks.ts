// The chunk columns the client holds, followed through the recorded packets: nothing of them is a recorded field, and
// before 1.14 LivingEntity.travel asks for the one under the player (1.8.9 LivingEntity.java:1187-1197), which after a far
// teleport has not come yet. The columns of a recording are the area's, whose packets came before the first row, and
// those its rows bring: the rows say which those are, so no server's view distance has to be assumed.

import { versionAtLeast } from '../scenarios/dsl/names.ts';
import { packetBytes } from './load.ts';
import { readClientbound } from './packets.ts';

type Packet = { readonly name: string; readonly b: string };
export type ColumnChange = readonly [chunkX: number, chunkZ: number, loaded: boolean];

const COLUMN = (x: number, z: number) => `${x},${z}`;

/**
 * What ClientPacketListener does to its columns for a packet as minecraft-protocol reads it. A map_chunk with no full
 * column updates sections of one the client has; on 1.8 a full one of no sections forgets it, and from 1.9 unload_chunk
 * does, a full one being a column however empty (1.8.9 ClientPlayNetworkHandler.java:566-574, 993-999, 1.12.2 :624-627, 649-652).
 */
export function columnChanges(version: string, name: string, params: Record<string, unknown>): ColumnChange[] {
    if (name === 'map_chunk_bulk') return (params.meta as { x: number; z: number }[]).map(({ x, z }) => [x, z, true]);
    if (name === 'unload_chunk') return [[params.chunkX as number, params.chunkZ as number, false]];
    if (name !== 'map_chunk' || params.groundUp === false) return [];
    return [[params.x as number, params.z as number, versionAtLeast(version, '1.9') || params.bitMap !== 0]];
}

export class ChunkTracker {
    private readonly version: string;
    private readonly absent = new Set<string>();
    private readonly arrived = new Set<string>();
    private emptied = false;

    /** A column whose first packet brings it was not there before; one forgotten first, or never named, was. */
    constructor(version: string, rows: readonly { readonly s2c: readonly Packet[] }[]) {
        this.version = version;
        const named = new Set<string>();
        for (const row of rows) {
            // (a respawn sends again the columns the client has, so what comes after it says nothing of the first ones)
            for (const packet of row.s2c) {
                if (/Respawn/.test(packet.name)) return;
                for (const [x, z, loaded] of this.changes(packet)) {
                    const column = COLUMN(x, z);
                    if (named.has(column)) continue;
                    named.add(column);
                    if (loaded) this.absent.add(column);
                }
            }
        }
    }

    private changes(packet: Packet): ColumnChange[] {
        if (!/chunk/i.test(packet.name)) return [];
        const { name, params } = readClientbound(this.version, packetBytes(packet.b));
        return columnChanges(this.version, name, params);
    }

    holds(chunkX: number, chunkZ: number): boolean {
        return this.emptied ? this.arrived.has(COLUMN(chunkX, chunkZ)) : !this.absent.has(COLUMN(chunkX, chunkZ));
    }

    /** A respawn empties the client's columns (ClientLevel is made anew): from here each holds only what has come since. */
    respawned(): void {
        this.emptied = true;
        this.arrived.clear();
    }

    /** The columns a row's packets loaded or forgot, those that changed. */
    packets(s2c: readonly Packet[]): ColumnChange[] {
        const out: ColumnChange[] = [];
        for (const packet of s2c) {
            for (const change of this.changes(packet)) {
                const [x, z, loaded] = change;
                if (loaded === this.holds(x, z)) continue;
                if (this.emptied) {
                    if (loaded) this.arrived.add(COLUMN(x, z));
                    else this.arrived.delete(COLUMN(x, z));
                } else if (loaded) this.absent.delete(COLUMN(x, z));
                else this.absent.add(COLUMN(x, z));
                out.push(change);
            }
        }
        return out;
    }
}
