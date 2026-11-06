// Finding recordings on disk and the known failures the replay expects.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RECORDER_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Where recordings are read from: REPLAY_RECORDINGS, else recordings/ (checked in), else out/recordings/ (a local run). */
export function recordingsRoot(): string {
    const env = process.env.REPLAY_RECORDINGS;
    if (env) return env;
    const checkedIn = join(RECORDER_ROOT, 'recordings');
    return existsSync(checkedIn) ? checkedIn : join(RECORDER_ROOT, 'out', 'recordings');
}

export interface RecordingFile { readonly version: string; readonly id: string; readonly file: string }

/** Every `<version>/<id>.jsonl.gz` under the root, sorted. */
export function findRecordings(root = recordingsRoot(), versions?: readonly string[]): RecordingFile[] {
    if (!existsSync(root)) return [];
    const out: RecordingFile[] = [];
    for (const version of readdirSync(root).sort()) {
        if (versions && !versions.includes(version)) continue;
        const dir = join(root, version);
        if (!statSync(dir).isDirectory()) continue;
        // (by the directory entries' own types: a recording being written, *.part, is renamed when it is done, and
        // a stat of it could find it gone)
        const walk = (d: string) => {
            for (const entry of readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
                const path = join(d, entry.name);
                if (entry.isDirectory()) walk(path);
                else if (entry.isFile() && entry.name.endsWith('.jsonl.gz')) out.push({ version, id: relative(dir, path).replace(/\.jsonl\.gz$/, '').split(sep).join('/'), file: path });
            }
        };
        walk(dir);
    }
    return out;
}

/**
 * A divergence the engine is known to have: where it first shows, its whole signature (how many ticks diverge in
 * each field, so a further regression in the same recording is not hidden behind it) and why, with the evidence.
 */
export interface KnownFailure { readonly tick: number; readonly field: string; readonly fields: Readonly<Record<string, number>>; readonly reason: string }

/** How many ticks diverge in each field. */
export function signature(results: readonly { divergences: readonly { field: string }[] }[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of results) for (const field of new Set(r.divergences.map(d => d.field))) out[field] = (out[field] ?? 0) + 1;
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** recorder/known-failures.json: { "<layer>": { "<version>/<id>": { tick, field, fields, reason } } }. */
export function knownFailures(layer: string): Record<string, KnownFailure> {
    const file = join(RECORDER_ROOT, 'known-failures.json');
    if (!existsSync(file)) return {};
    const all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, KnownFailure>>;
    return all[layer] ?? {};
}
