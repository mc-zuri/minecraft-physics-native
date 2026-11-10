// The strict gate over a pinned corpus: what the recordings of a release are (its manifest), what running them showed, and
// whether that lets anyone call the release complete. A release is complete only on the whole of its manifest, with every
// required field compared, nothing unexpected and nothing left out that the manifest does not declare with a reason. What
// is not vanilla evidence (Rust and adapter suites) is reported in its own category and never stands in for it.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { idMatcher } from '../scenarios/build.ts';
import { inRange, versionAtLeast } from '../scenarios/dsl/names.ts';
import { NATIVE_SIM, PLAYER_FIELDS } from '../schema/fields.ts';
import type { Recording } from '../schema/recording.ts';
import type { ReplayResult } from './engine.ts';
import { loadRecording } from './load.ts';
import { findRecordings, RECORDER_ROOT, signature, type KnownFailure, type RecordingFile } from './recordings.ts';
import { validateRecording } from './validate.ts';

export interface CorpusEntry {
    readonly id: string;
    /** The compiled scenario it was recorded from. */
    readonly scenario: string;
    /** The file's bytes. */
    readonly sha256: string;
    readonly rows: number;
    /** The build it was made with, as its header says, or `unrecorded`. */
    readonly build: string;
}

/** A case the release cannot compare: never a match, and listed here with why. */
export interface DeclaredExclusion { readonly id: string; readonly reason: string }

export interface CorpusManifest {
    readonly schema: 1;
    readonly version: string;
    readonly protocol: number;
    readonly entries: readonly CorpusEntry[];
    readonly exclusions: readonly DeclaredExclusion[];
}

/** The scenarios compiled for a release, none when it was not compiled here. */
export function compiledScenarios(version: string): string[] {
    const file = join(RECORDER_ROOT, 'out', 'scenarios', version, 'index.json');
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { scenarios: { id: string }[] }).scenarios.map(s => s.id) : [];
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

function entryOf(file: RecordingFile, recording: Recording, bytes: Buffer): CorpusEntry {
    return { id: file.id, scenario: recording.header.scenario.hash, sha256: sha256(bytes), rows: recording.rows.length, build: recording.header.provenance?.id ?? 'unrecorded' };
}

/** The manifest of a release's recordings as they are: a recording that is not fit to pin is an error, not an entry. */
export function pinCorpus(root: string, version: string, exclusions: readonly DeclaredExclusion[] = []): { manifest?: CorpusManifest; problems: string[] } {
    const files = findRecordings(root, [version]);
    const problems: string[] = [];
    const entries: CorpusEntry[] = [];
    let protocol: number | undefined;
    if (files.length === 0) problems.push(`no recordings of ${version} in ${root}`);
    for (const file of files) {
        try {
            const recording = loadRecording(file.file);
            problems.push(...validateRecording(recording, version, file.id, true).map(p => `${file.id}: ${p}`));
            protocol ??= recording.header.protocol;
            entries.push(entryOf(file, recording, readFileSync(file.file)));
        } catch (e) {
            problems.push(`${file.id}: ${(e as Error).message}`);
        }
    }
    if (problems.length > 0 || protocol === undefined) return { problems };
    return { manifest: { schema: 1, version, protocol, entries, exclusions }, problems };
}

export function readManifest(file: string): CorpusManifest | undefined {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as CorpusManifest : undefined;
}

/**
 * What is wrong with a manifest by itself: its schema, its release, a recording pinned twice or with no digest, an exclusion
 * of nothing or with no reason, and, given the scenarios compiled for the release (id to hash), an entry recorded from a
 * scenario that has changed since or that the release no longer has. A compiled scenario the manifest does not pin is the
 * gate's to block (decide), not a fault of the manifest.
 */
export function manifestProblems(manifest: CorpusManifest, version: string, compiled?: ReadonlyMap<string, string>): string[] {
    const problems: string[] = [];
    if (manifest.schema !== 1) problems.push(`unknown manifest schema ${String(manifest.schema)}`);
    if (manifest.version !== version) problems.push(`the manifest is of ${manifest.version}, not ${version}`);
    if (!Number.isInteger(manifest.protocol)) problems.push('no protocol');
    if (manifest.entries.length === 0) problems.push('the manifest pins nothing');
    const seen = new Set<string>();
    for (const entry of manifest.entries) {
        if (seen.has(entry.id)) problems.push(`${entry.id} is pinned twice`);
        seen.add(entry.id);
        if (!/^[0-9a-f]{64}$/.test(entry.sha256)) problems.push(`${entry.id}: no sha256`);
        if (!Number.isInteger(entry.rows) || entry.rows <= 0) problems.push(`${entry.id}: ${entry.rows} rows`);
        if (!compiled) continue;
        const hash = compiled.get(entry.id);
        if (hash === undefined) problems.push(`${entry.id}: no compiled scenario of ${version} has this id`);
        else if (hash !== entry.scenario) problems.push(`${entry.id}: recorded from another version of its scenario`);
    }
    for (const { id, reason } of manifest.exclusions) {
        if (!seen.has(id)) problems.push(`${id} is excluded, and not in the manifest`);
        if (reason.trim() === '') problems.push(`${id} is excluded with no reason`);
    }
    return problems;
}

/** The entries of a selection, from the manifest and not from what lies on disk: a selected case that is gone stays selected. */
export const selectEntries = (manifest: CorpusManifest, glob?: string) => {
    const matches = idMatcher(glob);
    return manifest.entries.filter(entry => matches(entry.id));
};

/** What is wrong with the selected recordings against the manifest. */
export function checkCorpus(manifest: CorpusManifest, root: string, version: string, selected: readonly CorpusEntry[] = manifest.entries): string[] {
    const problems: string[] = [];
    if (manifest.schema !== 1) problems.push(`unknown manifest schema ${String(manifest.schema)}`);
    if (manifest.version !== version) problems.push(`the manifest is of ${manifest.version}, not ${version}`);
    if (manifest.entries.length === 0) problems.push('the manifest pins nothing');
    const seen = new Set<string>();
    for (const { id } of manifest.entries) {
        if (seen.has(id)) problems.push(`${id} is pinned twice`);
        seen.add(id);
    }
    for (const { id } of manifest.exclusions) if (!seen.has(id)) problems.push(`${id} is excluded, and not in the manifest`);
    for (const { id, reason } of manifest.exclusions) if (reason.trim() === '') problems.push(`${id} is excluded with no reason`);
    for (const entry of selected) {
        const file = join(root, version, `${entry.id}.jsonl.gz`);
        if (!existsSync(file)) {
            problems.push(`${entry.id}: no recording`);
            continue;
        }
        const bytes = readFileSync(file);
        if (sha256(bytes) !== entry.sha256) {
            problems.push(`${entry.id}: its bytes changed`);
            continue;
        }
        try {
            const recording = loadRecording(file);
            if (recording.header.mc !== version) problems.push(`${entry.id}: recorded on ${recording.header.mc}`);
            if (recording.header.protocol !== manifest.protocol) problems.push(`${entry.id}: protocol ${recording.header.protocol}, the manifest has ${manifest.protocol}`);
            if (recording.header.scenario.hash !== entry.scenario) problems.push(`${entry.id}: recorded from another scenario`);
            if (recording.rows.length !== entry.rows) problems.push(`${entry.id}: ${recording.rows.length} rows, the manifest has ${entry.rows}`);
        } catch (e) {
            problems.push(`${entry.id}: ${(e as Error).message}`);
        }
    }
    return problems;
}

/** A known failure names a recording of the whole corpus; a filtered run reconciles only what it selected. */
export function reconcileKnown(known: Readonly<Record<string, KnownFailure>>, manifest: CorpusManifest, results: ReadonlyMap<string, Pick<ReplayResult, 'first' | 'results'>>): string[] {
    const problems: string[] = [];
    const pinned = new Set(manifest.entries.map(e => `${manifest.version}/${e.id}`));
    for (const [key, entry] of Object.entries(known)) {
        if (!key.startsWith(`${manifest.version}/`)) continue;
        if (!pinned.has(key)) {
            problems.push(`${key} is a known failure of no pinned recording`);
            continue;
        }
        const result = results.get(key);
        if (!result) continue;
        if (!result.first) problems.push(`${key} is a known failure that passes now: remove it`);
        else if (result.first.field !== entry.field || result.first.tick !== entry.tick || JSON.stringify(signature(result.results)) !== JSON.stringify(entry.fields)) problems.push(`${key} no longer fails as listed`);
    }
    return problems;
}

/** Why a field the registry maps is not compared on every tick: a field absent here with no count blocks completion. */
export const OMITTED_FIELDS: Readonly<Record<string, string>> = {
    look: 'the engine takes the look as it is given: before 1.12 it follows the head, which a mount turns during the tick (engine.ts)',
};

/**
 * Fields an output of the tick only from a release: before it the release's tick has no such output to compare, which no
 * selection of cases changes. movingSlowly: LocalPlayer.isMovingSlowly is new in 1.14 (1.13.2 LocalPlayer.java:213 reads
 * isSneaking), and in 1.14 and 1.15 the tick moves it after the input read it (1.15.2 LocalPlayer.java:598, 631), so the
 * replay gives it back as the input it started from (engine.ts); from 1.16 it is compared on every tick.
 */
export const OUTPUT_FROM: Readonly<Record<string, string>> = {
    movingSlowly: '1.16',
};

/** The recorded fields the native layer must have compared on `version`: every one the registry maps that the release has. */
export function requiredFields(version: string): string[] {
    const specs = PLAYER_FIELDS as Record<string, { versions?: string }>;
    return Object.values(NATIVE_SIM).flatMap(map => {
        if (!('from' in map) || typeof map.from !== 'string' || ('input' in map && map.input)) return [];
        const field = map.from;
        if (field in OMITTED_FIELDS || (specs[field] && !inRange(version, specs[field].versions))) return [];
        if (OUTPUT_FROM[field] && !versionAtLeast(version, OUTPUT_FROM[field]!)) return [];
        return [field];
    });
}

/** The strength of what a result shows: the report never adds one to another. */
export type Evidence = 'primitive' | 'adapter' | 'stepwise' | 'continuous' | 'vanilla-golden';

export interface EvidenceRow {
    readonly category: Evidence;
    /** What ran, or `not run`. */
    readonly source: string;
    readonly passed: number;
    readonly failed: number;
    /** Recorded and not compared: skipped, unsupported, interpolated. Never counted as passed. */
    readonly unavailable: number;
}

/**
 * Which replay a result is evidence of. A continuous replay's tick that seeded again is a stepwise tick, so a result with
 * nothing carried, however it was started, is stepwise.
 */
export function replayEvidence(result: Pick<ReplayResult, 'mode' | 'compared' | 'continuous'>): 'stepwise' | 'continuous' {
    if (result.mode !== 'continuous' || !result.continuous) return 'stepwise';
    return result.compared - result.continuous.reseeds.length - result.continuous.vehicle.reseeds.length >= 1 ? 'continuous' : 'stepwise';
}

export interface Outcomes {
    recorded: number;
    valid: number;
    compared: number;
    /** Recordings with nothing compared but ticks the server drives or a vehicle with no model. */
    unsupported: number;
    known: number;
    unexpected: number;
    /** Ticks. */
    comparedTicks: number;
    interpolatedTicks: number;
    unmodelledTicks: number;
    elsewhereTicks: number;
}

export const emptyOutcomes = (): Outcomes => ({ recorded: 0, valid: 0, compared: 0, unsupported: 0, known: 0, unexpected: 0, comparedTicks: 0, interpolatedTicks: 0, unmodelledTicks: 0, elsewhereTicks: 0 });

export interface GateInput {
    readonly version: string;
    readonly manifest?: CorpusManifest;
    readonly selection: 'whole' | 'subset';
    readonly corpusProblems: readonly string[];
    readonly knownProblems: readonly string[];
    readonly outcomes: Outcomes;
    /** Compared ticks by recorded field. */
    readonly fields: Readonly<Record<string, number>>;
    /** The ids that compared nothing, for the exclusions to answer for. */
    readonly uncompared: readonly string[];
    /** The ids compiled for this release: what a manifest must cover before its success means the release's. */
    readonly scenarios: readonly string[];
    /** The replay layers the gate asks of this release, and those that ran clean. */
    readonly requiredLayers: readonly string[];
    readonly cleanLayers: readonly string[];
}

export interface GateDecision {
    /** complete: the whole release. clean-subset: nothing wrong with what ran, which certifies nothing. */
    readonly status: 'complete' | 'clean-subset' | 'incomplete';
    readonly blockers: readonly string[];
    readonly omittedFields: Readonly<Record<string, string>>;
}

export function decide(input: GateInput): GateDecision {
    const blockers: string[] = [];
    const { manifest, outcomes } = input;
    if (!manifest) blockers.push('no corpus manifest: nothing says what this release must show');
    blockers.push(...input.corpusProblems, ...input.knownProblems);
    if (outcomes.recorded === 0) blockers.push('no recording ran');
    if (outcomes.comparedTicks === 0) blockers.push('no tick was compared');
    if (outcomes.unexpected > 0) blockers.push(`${outcomes.unexpected} recording(s) with an unexpected outcome`);
    if (outcomes.known > 0) blockers.push(`${outcomes.known} recording(s) differ as known: a known difference is still one`);
    for (const layer of input.requiredLayers) if (!input.cleanLayers.includes(layer)) blockers.push(`the ${layer} layer did not run clean`);
    const declared = new Set(manifest?.exclusions.map(e => e.id));
    for (const id of input.uncompared) if (!declared.has(id)) blockers.push(`${id} compared nothing and no exclusion answers for it`);
    if (input.selection === 'whole') {
        // (a manifest pinned from a few recordings would otherwise certify a release by leaving the rest out)
        if (input.scenarios.length === 0) blockers.push(`no scenarios compiled for ${input.version}: nothing says what the release must cover`);
        const pinned = new Set(manifest?.entries.map(e => e.id));
        const unpinned = input.scenarios.filter(id => !pinned.has(id));
        if (manifest && unpinned.length > 0) blockers.push(`${unpinned.length} compiled scenario(s) are not pinned, the first ${unpinned[0]}`);
        for (const field of requiredFields(input.version)) if (!input.fields[field]) blockers.push(`the required field ${field} was never compared`);
    }
    const status = blockers.length > 0 ? 'incomplete' : input.selection === 'whole' ? 'complete' : 'clean-subset';
    return { status, blockers, omittedFields: OMITTED_FIELDS };
}
