// The recorded packets as minecraft-protocol (mineflayer's codec) reads them: every packet's bytes
// are its varint id and payload in the PLAY protocol of the recording's release, so a mineflayer
// replay can hand the S2C bytes to a client and compare what it writes with the C2S bytes.
//
// minecraft-protocol is resolved through mineflayer (REPLAY_MINEFLAYER_DIR, else the fork beside the
// checkout that owns node_modules, else the mineflayer this repository depends on), so the codec is
// the one the bot uses.

import { createRequire } from 'node:module';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Parsed { data: { name: string; params: Record<string, unknown> } }
interface Codecs {
    fromServer: { parsePacketBuffer(b: Buffer): Parsed };
    toServer: { createPacketBuffer(p: { name: string; params: unknown }): Buffer; parsePacketBuffer(b: Buffer): Parsed };
    toClient: { createPacketBuffer(p: { name: string; params: unknown }): Buffer };
}

const here = createRequire(import.meta.url);
let mc: { createSerializer: (o: object) => never; createDeserializer: (o: object) => never } | undefined;

/** A require from mineflayer: what it resolves is what the bot loads. */
export function mineflayerRequire(): NodeRequire {
    // (the fork beside this repository when there is one: the published protocol has no vecDelta and
    // misreads lpVec3. Found from where node_modules really is: a worktree's is a junction to the main
    // checkout's, and the fork sits beside that checkout, not beside the worktree)
    const modules = fileURLToPath(new URL('../../node_modules', import.meta.url));
    const sibling = join(existsSync(modules) ? realpathSync(modules) : modules, '..', '..', 'mineflayer');
    const dir = process.env.REPLAY_MINEFLAYER_DIR ?? (existsSync(join(sibling, 'package.json')) ? sibling : undefined);
    return createRequire(dir ? join(dir, 'package.json') : here.resolve('mineflayer/package.json'));
}

/** minecraft-protocol as mineflayer loads it. */
export function minecraftProtocol(): NonNullable<typeof mc> {
    mc ??= mineflayerRequire()('minecraft-protocol') as NonNullable<typeof mc>;
    return mc;
}

const codecs = new Map<string, Codecs>();
export function codecsFor(version: string): Codecs {
    let c = codecs.get(version);
    if (!c) {
        const p = minecraftProtocol();
        c = {
            fromServer: p.createDeserializer({ state: 'play', isServer: false, version }),
            toServer: Object.assign(p.createSerializer({ state: 'play', isServer: false, version }),
                { parsePacketBuffer: (p.createDeserializer({ state: 'play', isServer: true, version }) as Codecs['toServer']).parsePacketBuffer }),
            toClient: p.createSerializer({ state: 'play', isServer: true, version }),
        } as Codecs;
        codecs.set(version, c);
    }
    return c;
}

export interface DecodedPacket { readonly name: string; readonly params: Record<string, unknown>; readonly roundTrip: boolean }

/** A server packet: its minecraft-protocol name and fields, and whether encoding them gives the recorded bytes back. */
export function decodeServerbound(version: string, bytes: Buffer): DecodedPacket {
    const c = codecsFor(version);
    const { data } = c.toServer.parsePacketBuffer(bytes);
    const again = c.toServer.createPacketBuffer({ name: data.name, params: data.params });
    return { name: data.name, params: data.params, roundTrip: again.equals(bytes) };
}

/** Whether a respawn packet takes the client out of the overworld, the only world a recording has the blocks of. */
export function leavesOverworld(version: string, bytes: Buffer): boolean {
    const { params } = decodeClientbound(version, bytes);
    const text = JSON.stringify(params, (_, x: unknown) => (typeof x === 'bigint' ? String(x) : x));
    // (the dimension's number before 1.16; afterwards its name)
    return /the_nether|the_end/.test(text) || params.dimension === -1 || params.dimension === 1;
}

/** A client packet's name and fields, not encoded again (a chunk's data is long, and what reads it wants its column). */
export function readClientbound(version: string, bytes: Buffer): Parsed['data'] {
    return codecsFor(version).fromServer.parsePacketBuffer(bytes).data;
}

export function decodeClientbound(version: string, bytes: Buffer): DecodedPacket {
    const c = codecsFor(version);
    const data = readClientbound(version, bytes);
    const again = c.toClient.createPacketBuffer({ name: data.name, params: data.params });
    return { name: data.name, params: data.params, roundTrip: again.equals(bytes) };
}
