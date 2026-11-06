// The rain as the client holds it, followed through the recorded packets: Level.isRaining is rainLevel > 0.2, which the
// server's RAIN_LEVEL_CHANGE events set (26.3 ClientPacketListener.handleGameEvent, Level.java isRaining). The sky above the
// player decides the rest of Entity.isInRain; the biome comes from the world, and a case's fillbiome turns this off.

import { decodeClientbound } from './packets.ts';
import { packetBytes } from './load.ts';
import type { RecordingHeader } from '../schema/recording.ts';

const REASONS: Readonly<Record<string, string>> = { 1: 'start_raining', 2: 'stop_raining', 7: 'rain_level_change' };

export class RainTracker {
    private level = 0;
    private readonly version: string;
    /** The case changes the biome, whose rain the world's data does not tell here. */
    private readonly otherBiome: boolean;

    constructor(header: RecordingHeader) {
        this.version = header.mc;
        this.otherBiome = JSON.stringify(header.body).includes('fillbiome');
    }

    /** The game events of a row. */
    packets(s2c: readonly { readonly name: string; readonly b: string }[]): void {
        for (const packet of s2c) {
            if (!/GameEvent|GameState/.test(packet.name)) continue;
            const { params } = decodeClientbound(this.version, packetBytes(packet.b));
            const reason = REASONS[String(params.reason)] ?? String(params.reason);
            if (reason === 'start_raining') this.level = 1;
            else if (reason === 'stop_raining') this.level = 0;
            else if (reason === 'rain_level_change') this.level = Number(params.gameMode);
        }
    }

    /** Level.isRainingAt, at the block of the player's feet or of the top of its box: `open` says the sky is clear from a height. */
    exposed(open: (height: number) => boolean, feet: number, top: number): boolean {
        return !this.otherBiome && this.level > 0.2 && (open(Math.floor(feet)) || open(Math.floor(top)));
    }
}
