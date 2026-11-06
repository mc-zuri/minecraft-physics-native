// Reads a recording (schema/recording.ts) and expands its delta-encoded states into full snapshots.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { readNumber } from '../schema/json.ts';
import { PLAYER_FIELDS, type FieldSpec, type PlayerFieldKey } from '../schema/fields.ts';
import { versionAtLeast } from '../scenarios/dsl/names.ts';
import type { ExpandedRow, Recording, RecordingFooter, RecordingHeader, RecordingRow, Snapshot } from '../schema/recording.ts';

const NON_FINITE = new Set(['NaN', '+Inf', '-Inf']);

/** A float field the release keeps as a double. */
const isDouble = (spec: FieldSpec, version: string) => spec.doubleFrom !== undefined && versionAtLeast(version, spec.doubleFrom);

/** Restores the recorded number rules: non-finite strings to numbers in numeric fields, f32 fields to floats. */
function normalize(snapshot: Snapshot, version: string): Snapshot {
    const out: Snapshot = {};
    for (const [key, value] of Object.entries(snapshot)) {
        const spec = PLAYER_FIELDS[key as PlayerFieldKey];
        if (spec && typeof value === 'string' && NON_FINITE.has(value)) out[key] = readNumber(value);
        else if (spec?.type === 'f32' && typeof value === 'number' && !isDouble(spec, version)) out[key] = Math.fround(value);
        else if (spec?.type === 'vec3' && Array.isArray(value)) out[key] = value.map(readNumber);
        else out[key] = value;
    }
    return out;
}

function apply(running: Snapshot, delta: Snapshot | undefined, version: string): Snapshot {
    if (!delta) return running;
    const next: Snapshot = { ...running };
    for (const [key, value] of Object.entries(normalize(delta, version))) {
        if (value === null) delete next[key];
        else next[key] = value;
    }
    return next;
}

export function parseRecording(text: string): Recording {
    const lines = text.split('\n').filter(line => line.length > 0);
    const header = JSON.parse(lines[0]!) as RecordingHeader;
    if ((header as { kind: string }).kind !== 'header') throw new Error('the first line is not a header');
    if (header.schema !== 1) throw new Error(`unknown recording schema ${header.schema}`);
    const version = header.mc;
    const footer = JSON.parse(lines.at(-1)!) as RecordingFooter;
    if ((footer as { kind: string }).kind !== 'footer') throw new Error('the recording has no footer (unfinished?)');
    let running: Snapshot = {};
    const rows: ExpandedRow[] = [];
    for (const line of lines.slice(1, -1)) {
        const row = JSON.parse(line) as RecordingRow;
        const s2c = (row.s2c ?? []).map(packet => {
            running = apply(running, packet.after, version);
            return { ...packet, state: running };
        });
        running = row.kf ? normalize(row.pre, version) : apply(running, row.pre, version);
        const pre = running;
        const phases = Object.entries(row.ph ?? {}).map(([name, delta]) => {
            running = apply(running, delta, version);
            return { name, state: running };
        });
        running = apply(running, row.post, version);
        rows.push({
            t: row.t,
            s2c,
            pre,
            input: row.in,
            phases,
            vehiclePhases: Object.entries(row.vph ?? {}).map(([name, state]) => ({ name, state })),
            c2s: row.c2s ?? [],
            post: running,
            playerTicked: row.playerTicked !== false,
            ...(row.srv ? { srv: row.srv } : {}),
            corrections: row.corrections ?? [],
            blocks: row.blocks ?? [],
            ...(row.ridingJump !== undefined ? { ridingJump: row.ridingJump } : {}),
        });
    }
    if (rows.length !== footer.rows) throw new Error(`the footer counts ${footer.rows} rows, the file has ${rows.length}`);
    return { header, rows, footer };
}

export function loadRecording(file: string): Recording {
    const raw = readFileSync(file);
    const text = (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8');
    return parseRecording(text);
}

/** The bytes of a recorded packet (packet id varint first). */
export function packetBytes(b64: string): Buffer {
    return Buffer.from(b64, 'base64');
}
