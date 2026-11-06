// Compares two recordings of the same scenarios, row by row, after dropping what legitimately
// differs between runs (wall time, the global packet sequence numbers, the server's tick counter).
// A scenario whose canonical rows differ is not deterministic; the first difference is printed.
//
//   node recorder/runner/compare-runs.ts <dirA> <dirB>

import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { packetBytes } from '../replay/load.ts';
import { decodeClientbound, decodeServerbound, leavesOverworld } from '../replay/packets.ts';
import { findRecordings } from '../replay/recordings.ts';
import { compareVersions } from '../scenarios/dsl/names.ts';

const VOLATILE = new Set(['seq', 're', 'wallMs']);
/**
 * Packets that cannot move the player and whose contents do not repeat run to run: sound seeds, particles, light
 * (computed on worker threads), advancements (they carry wall-clock dates), the tab list's latency and the command
 * tree (its game rules come in a hash map's order), and statistics (likewise). So too the chunk centre and the chunks a far teleport forgets, which
 * land on the tick after it in some runs; the chunks themselves are compared. They stay in
 * the recordings; the comparison leaves them out.
 */
export const COSMETIC = new Set([
    'ClientboundSoundPacket', 'ClientboundSoundEntityPacket', 'ClientboundLevelParticlesPacket', 'ClientboundLightUpdatePacket',
    'ClientboundCommandsPacket', 'ClientboundCustomSoundPacket', 'ClientboundAwardStatsPacket', 'ClientboundSetChunkCacheCenterPacket', 'ClientboundForgetLevelChunkPacket', 'ClientboundUpdateAdvancementsPacket', 'ClientboundRecipePacket', 'ClientboundRecipeBookAddPacket', 'ClientboundRecipeBookRemovePacket', 'ClientboundRecipeBookSettingsPacket', 'ClientboundPlayerInfoUpdatePacket', 'ClientboundLevelEventPacket',
]);

/**
 * Before 1.20.2 nothing paces the chunks a move brings into view: when a chunk is ready decides the tick its packets
 * land on, around a case's start. They change no player state, and the player's fields are compared in every row, so a
 * chunk that matters to the physics still shows. From 1.20.2 the server batches them by ticks and they are compared.
 */
const UNPACED_CHUNKS = new Set(['ChunkMapS2CPacket', 'ClientboundSetChunkCacheCenterPacket', 'ClientboundLevelChunkWithLightPacket', 'ClientboundLevelChunkPacket', 'ClientboundForgetLevelChunkPacket']);

function canonical(value: unknown): unknown {
    // (JSON.stringify writes -0 as 0, and a recording tells them apart)
    if (Object.is(value, -0)) return '-0';
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) if (!VOLATILE.has(k)) out[k] = canonical(v);
        return out;
    }
    return value;
}

const EFFECT_PACKETS = new Set(['ClientboundRemoveMobEffectPacket', 'ClientboundUpdateMobEffectPacket']);
const BLOCK_PACKETS = new Set(['ClientboundBlockUpdatePacket', 'ClientboundSectionBlocksUpdatePacket', 'ClientboundChunkBlocksUpdatePacket']);
/** Advancements a tick earns are announced in a hash set's order. */
const SYSTEM_CHAT = new Set(['ClientboundChatPacket', 'ClientboundSystemChatPacket']);
const groupOf = (name: string) => (EFFECT_PACKETS.has(name) ? 'effects' : BLOCK_PACKETS.has(name) ? 'blocks' : SYSTEM_CHAT.has(name) ? 'chat' : undefined);

/**
 * The server sends a player's effects in the order of a map keyed by identity hash (LivingEntity.activeEffects), so
 * effects that change together arrive in either order, to the same end. A run of them is compared as a set: sorted,
 * with the run's net state change (its deltas merged in arrival order) on its last packet. A tick's block updates come
 * chunk by chunk in the order of a list the server shuffled (ServerChunkCache.tickChunks before 1.20.3), and a chunk's
 * order depends on what the client played before: a run of them is compared by block, each block's writes in the order
 * they came, as only writes to different blocks commute.
 */
function orderFreeRunsSorted<P extends { name: string; b: string; after?: unknown }>(packets: P[], version: string): P[] {
    const out: P[] = [];
    for (let i = 0; i < packets.length;) {
        let j = i;
        const group = groupOf(packets[i]!.name);
        while (j < packets.length && group !== undefined && groupOf(packets[j]!.name) === group) j++;
        if (j - i < 2) { out.push(packets[i]!); i++; continue; }
        const run = packets.slice(i, j);
        // each after is a delta on the one before: the run's net change is their merge in arrival order
        const deltas = run.map(p => p.after).filter((d): d is Record<string, unknown> => !!d && typeof d === 'object');
        const after = deltas.length === 0 ? undefined : Object.assign({}, ...deltas) as unknown;
        if (group === 'blocks') {
            const writes = run.flatMap(p => blockWrites(version, p));
            out.push({ name: 'blocks', b: JSON.stringify(sortedByPosition(writes)), ...(after === undefined ? {} : { after }) } as unknown as P);
            i = j;
            continue;
        }
        const sorted = run.map(({ after: _, ...p }) => p as P).sort((x, y) => (x.name + x.b).localeCompare(y.name + y.b));
        sorted[sorted.length - 1] = { ...sorted[sorted.length - 1]!, ...(after === undefined ? {} : { after }) };
        out.push(...sorted);
        i = j;
    }
    return out;
}

type BlockWrite = readonly [number, number, number, number | string];

/** Sorted by block; a stable sort keeps the writes to one block in their order. */
function sortedByPosition<T extends readonly unknown[]>(writes: readonly T[]): T[] {
    const at = (w: T) => [Number(w[0]), Number(w[1]), Number(w[2])];
    return [...writes].sort((x, y) => {
        const [a, b] = [at(x), at(y)];
        return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
    });
}

/** The blocks a block packet writes, in the packet's order. */
function blockWrites(version: string, packet: { name: string; b: string }): BlockWrite[] {
    const params = decodeClientbound(version, packetBytes(packet.b)).params as {
        location?: { x: number; y: number; z: number }; type?: number;
        chunkCoordinates?: { x: number; y: number; z: number };
        chunkX?: number; chunkZ?: number; records?: unknown[];
    };
    if (params.location) return [[params.location.x, params.location.y, params.location.z, params.type!]];
    const section = params.chunkCoordinates;
    if (section && params.records) {
        // (a section's records from 1.16.2: the state, then x, z and y of 4 bits each)
        return params.records.map(record => {
            const n = BigInt(record as number | bigint);
            const at = (shift: bigint) => Number((n >> shift) & 15n);
            return [section.x * 16 + at(8n), section.y * 16 + at(0n), section.z * 16 + at(4n), Number(n >> 12n)] as const;
        });
    }
    if (params.chunkX !== undefined && params.records) {
        return (params.records as { horizontalPos: number; y: number; blockId: number }[]).map(r =>
            [params.chunkX! * 16 + (r.horizontalPos >> 4), r.y, params.chunkZ! * 16 + (r.horizontalPos & 15), r.blockId] as const);
    }
    throw new Error(`${version}: no block writes read from ${packet.name}`);
}

/** Entity data with the one list that comes in no fixed order (a player's effect particles, from 1.20.5) sorted. */
function entityDataCompared(version: string, packet: { b: string }): string {
    const { params } = decodeClientbound(version, packetBytes(packet.b));
    const json = (v: unknown) => JSON.stringify(v, (_, x: unknown) => (typeof x === 'bigint' ? `${x}n` : x));
    const metadata = (params.metadata as { type: unknown; value: unknown }[]).map(m =>
        (m.type === 'particles' ? { ...m, value: (m.value as unknown[]).map(json).sort() } : m));
    return json({ ...params, metadata });
}

/**
 * Another dimension's terrain and clock are the world's, not the case's: when its chunks generate and when its lava
 * flows follows worker threads and what ran before. There the blocks are not compared; the player, in every row, is.
 */
const TERRAIN = new Set([...UNPACED_CHUNKS, ...BLOCK_PACKETS, 'ClientboundBlockEntityDataPacket', 'ClientboundChunkBatchStartPacket', 'ClientboundChunkBatchFinishedPacket', 'ClientboundChunksBiomesPacket', 'ClientboundBlockChangedAckPacket', 'ClientboundBlockDestructionPacket', 'ClientboundBlockEventPacket', 'ClientboundSetTimePacket']);
const TERRAIN_REPLIES = new Set(['ServerboundChunkBatchReceivedPacket']);

/**
 * What the client stamps a chat message with when it sends it: the clock's time and a random salt, which the server
 * echoes and (signed) chains. The rest of the packet is compared.
 */
const CHAT = new Set(['ServerboundChatPacket', 'ServerboundChatCommandPacket', 'ServerboundChatCommandSignedPacket', 'ClientboundPlayerChatPacket', 'ClientboundDisguisedChatPacket']);
const STAMPS = new Set(['timestamp', 'salt', 'signature', 'argumentSignatures', 'globalIndex']);

function chatCompared(version: string, packet: Packet): string {
    const decode = packet.name.startsWith('Server') ? decodeServerbound : decodeClientbound;
    return JSON.stringify(decode(version, packetBytes(packet.b)).params, (key, x: unknown) =>
        (STAMPS.has(key) ? undefined : typeof x === 'bigint' ? `${x}n` : x));
}

/**
 * From 1.20.5 an item's components, and the enchantments in one, are written in a hash map's order: packets that carry
 * items are compared with them sorted.
 */
const ITEM_PACKETS = new Set(['ClientboundContainerSetSlotPacket', 'ClientboundContainerSetContentPacket', 'ClientboundSetPlayerInventoryPacket', 'ClientboundSetEquipmentPacket', 'ClientboundSetCursorItemPacket', 'ServerboundContainerClickPacket']);

function itemsCompared(version: string, packet: Packet): string {
    const decode = packet.name.startsWith('Server') ? decodeServerbound : decodeClientbound;
    return JSON.stringify(decode(version, packetBytes(packet.b)).params, function replace(key, x: unknown): unknown {
        if (typeof x === 'bigint') return `${x}n`;
        return (key === 'enchantments' || key === 'components') && Array.isArray(x) ? x.map(e => JSON.stringify(e, replace)).sort() : x;
    });
}

interface Packet { name: string; b: string; after?: Record<string, unknown> }

/**
 * The packets without those `drop` names. A dropped packet's state delta moves to the next one kept (or the last); with
 * none kept, it is what `left` is given: the row's state goes on from it.
 */
function withoutCosmetic(packets: readonly Packet[], drop: (name: string) => boolean, left: (delta: Record<string, unknown>) => void): Packet[] {
    const kept: Packet[] = [];
    let pending: Record<string, unknown> | undefined;
    for (const p of packets) {
        if (drop(p.name)) {
            if (p.after) pending = { ...pending, ...p.after };
            continue;
        }
        kept.push(pending ? { ...p, after: { ...pending, ...p.after } } : p);
        pending = undefined;
    }
    if (pending && kept.length > 0) {
        const last = kept[kept.length - 1]!;
        kept[kept.length - 1] = { ...last, after: { ...last.after, ...pending } };
    } else if (pending) left(pending);
    return kept;
}

function rows(file: string): string[] {
    const lines = gunzipSync(readFileSync(file)).toString('utf8').split('\n').filter(Boolean);
    const version = (JSON.parse(lines[0]!) as { mc: string }).mc;
    const unpaced = compareVersions(version, '1.20.2') < 0;
    const particles = compareVersions(version, '1.20.5') >= 0;
    let elsewhere = false;
    let wentAway = false;
    let respawned = false;
    return lines.map(line => {
        const row = JSON.parse(line) as Record<string, unknown>;
        // (what was recorded is compared, not what it was built with: two builds may be set against each other)
        if (row.kind === 'header') delete row.provenance;
        const respawn = (row.s2c as Packet[] | undefined)?.findLast(p => p.name === 'ClientboundRespawnPacket');
        const leaving = elsewhere;
        if (respawn) elsewhere = leavesOverworld(version, packetBytes(respawn.b));
        respawned ||= respawn !== undefined;
        const offWorld = leaving || elsewhere;
        wentAway ||= offWorld;
        if (Array.isArray(row.c2s)) {
            // (a resource pack's fate comes from its download's thread, in whichever tick it ends)
            row.c2s = (row.c2s as Packet[]).filter(p => p.name !== 'ServerboundResourcePackPacket');
            if ((row.c2s as Packet[]).length === 0) delete row.c2s;
        }
        if (Array.isArray(row.c2s)) {
            row.c2s = (row.c2s as Packet[]).map(p => (CHAT.has(p.name) ? { ...p, b: chatCompared(version, p) }
                : particles && ITEM_PACKETS.has(p.name) ? { ...p, b: itemsCompared(version, p) } : p));
        }
        if (offWorld) {
            delete row.blocks;
            if (Array.isArray(row.c2s)) {
                row.c2s = (row.c2s as Packet[]).filter(p => !TERRAIN_REPLIES.has(p.name));
                if ((row.c2s as Packet[]).length === 0) delete row.c2s;
            }
        }
        if (row.srv && typeof row.srv === 'object') delete (row.srv as Record<string, unknown>).tick;
        // (what is hit is compared; exactly where follows the partial tick of whichever frame looked last)
        if (row.crosshair && typeof row.crosshair === 'object') delete (row.crosshair as Record<string, unknown>).at;
        // (the changes a tick's block packets made, which come in those packets' order: see orderFreeRunsSorted)
        if (Array.isArray(row.blocks)) row.blocks = sortedByPosition(row.blocks as unknown[][]);
        if (Array.isArray(row.s2c)) {
            // (the chunks a respawn sends again hold the light as far as the server has got: their blocks are in the header)
            // (what a chunk being sent brings along: which chunks hold what is the areas' business, and they are in the header)
            const chunked = (row.s2c as Packet[]).some(p => p.name === 'ClientboundLevelChunkPacket' || p.name === 'ChunkMapS2CPacket');
            const cosmetic = (name: string) => COSMETIC.has(name) || (chunked && name === 'ClientboundBlockEntityDataPacket') || (unpaced && UNPACED_CHUNKS.has(name)) || (respawned && TERRAIN.has(name)) || (offWorld && TERRAIN.has(name)) || (wentAway && name === 'ClientboundSetTimePacket');
            row.s2c = withoutCosmetic(row.s2c as Packet[], cosmetic, delta => { row.pre = { ...delta, ...(row.pre as object) }; }).map(p => {
                // the server writes a player's dirty attributes in hash-set order, which varies run to run: compare them by name
                // (and from 1.20.5 a player's effect particles, a list in the same order, in its entity data)
                // (the blocks are the header's; a chunk's bytes also hold palettes in the order of all it ever held)
                if (UNPACED_CHUNKS.has(p.name)) return { ...p, b: '' };
                if (CHAT.has(p.name)) return { ...p, b: chatCompared(version, p) };
                if (particles && ITEM_PACKETS.has(p.name)) return { ...p, b: itemsCompared(version, p) };
                if (p.name === 'ClientboundSetEntityDataPacket' && !particles) return p;
                if (p.name === 'ClientboundSetEntityDataPacket') return { ...p, b: entityDataCompared(version, p) };
                if (p.name !== 'ClientboundUpdateAttributesPacket') return p;
                const { params } = decodeClientbound(version, packetBytes(p.b));
                // (the attribute's name is `key` in the older protocols, its registry id from 1.21)
                const nameOf = (x: { name?: string; key?: string | number }) => String(x.name ?? x.key ?? '');
                const properties = [...(params.properties as { name?: string; key?: string | number }[])].sort((x, y) => nameOf(x).localeCompare(nameOf(y)));
                return { ...p, b: JSON.stringify({ ...params, properties }) };
            });
            row.s2c = orderFreeRunsSorted(row.s2c as { name: string; b: string; after?: unknown }[], version);
            if ((row.s2c as unknown[]).length === 0) delete row.s2c;
        }
        return JSON.stringify(canonical(row));
    });
}

/**
 * Compares the recordings of `ids` ("<version>/<id>") in two directories; without ids, every recording either side
 * has. A recording one side lacks is missing (and the comparison fails).
 */
export function compareRuns(a: string, b: string, ids?: readonly string[]): { same: string[]; different: { id: string; line: number; a: string; b: string }[]; missing: string[] } {
    const left = new Map(findRecordings(a).map(f => [`${f.version}/${f.id}`, f.file]));
    const right = new Map(findRecordings(b).map(f => [`${f.version}/${f.id}`, f.file]));
    const same: string[] = [];
    const different: { id: string; line: number; a: string; b: string }[] = [];
    const missing: string[] = [];
    const wanted = ids ?? [...new Set([...left.keys(), ...right.keys()])].sort();
    for (const id of wanted) {
        const file = left.get(id);
        const other = right.get(id);
        if (!file || !other) { missing.push(`${id} (${!file ? 'first' : 'second'} side)`); continue; }
        const ra = rows(file);
        const rb = rows(other);
        const line = ra.findIndex((r, i) => r !== rb[i]);
        if (line < 0 && ra.length === rb.length) same.push(id);
        else {
            const at = line < 0 ? Math.min(ra.length, rb.length) : line;
            const x = ra[at] ?? '<end>';
            const y = rb[at] ?? '<end>';
            // a window around the first character that differs
            let c = 0;
            while (c < x.length && c < y.length && x[c] === y[c]) c++;
            const from = Math.max(0, c - 250);
            different.push({ id, line: at, a: x.slice(from, c + 150), b: y.slice(from, c + 150) });
        }
    }
    return { same, different, missing };
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('compare-runs.ts')) {
    const [a, b] = process.argv.slice(2);
    if (!a || !b) {
        console.error('usage: node recorder/runner/compare-runs.ts <dirA> <dirB>');
        process.exit(2);
    }
    const result = compareRuns(a, b);
    for (const d of result.different) console.log(`DIFF ${d.id} line ${d.line}\n  a: ${d.a}\n  b: ${d.b}`);
    for (const m of result.missing) console.log(`MISSING ${m}`);
    console.log(`${result.same.length} identical, ${result.different.length} different, ${result.missing.length} missing`);
    process.exitCode = result.different.length > 0 || result.missing.length > 0 ? 1 : 0;
}
