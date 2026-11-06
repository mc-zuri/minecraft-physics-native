// What the clients said against what was asked of them. A run's index and exit code come from here, so a client's word
// counts only where it is about a selected scenario, once, with that scenario's hash, on the client that holds it, and
// a success only with the finished recording it speaks of.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export interface RecEvent { e: string; [key: string]: unknown }
export interface ShardReport { readonly shard: number; readonly results: readonly RecEvent[]; readonly done?: RecEvent }
export interface SelectedScenario { readonly id: string; readonly hash: string; readonly file: string }
/** A scenario in a run's index; `build` the identity it was recorded with (provenance.ts). */
export interface IndexEntry { readonly id: string; readonly hash: string; readonly status: string; readonly reason?: string; readonly build?: string }

/** A result's statuses (ScenarioRunner.finish): anything else is no outcome. */
const STATUSES = new Set(['ok', 'invalid', 'skipped', 'error']);
/** An index's statuses: those, and the scenario no client reported. */
const INDEXED = new Set([...STATUSES, 'missing']);

/** The client that runs each scenario (Recorder.load): the compiled files in name order, every shards-th from its shard. */
export function shardsOf(selected: readonly SelectedScenario[], shards: number): Map<string, number> {
    const ordered = selected.map((s, i) => ({ s, i })).sort((a, b) => (a.s.file < b.s.file ? -1 : a.s.file > b.s.file ? 1 : a.i - b.i));
    return new Map(ordered.map(({ s }, i) => [s.id, i % shards]));
}

const failure = (s: SelectedScenario, status: string, reason: string): RecEvent => ({ e: 'result', id: s.id, hash: s.hash, status, reason });

/** The scenarios of a client that have no result yet, for the client that takes over from it. */
export function casesLeft(selected: readonly SelectedScenario[], shards: number, shard: number, finished: ReadonlySet<string>): SelectedScenario[] {
    const owners = shardsOf(selected, shards);
    return selected.filter(s => owners.get(s.id) === shard && !finished.has(s.id));
}

/** The result of the scenario a client died in: the one it started last and said nothing more of. Null if there is none. */
export function diedIn(selected: readonly SelectedScenario[], client: { readonly started: readonly string[]; readonly results: readonly RecEvent[] }, why: string): RecEvent | null {
    const last = client.started.at(-1);
    if (last === undefined || client.results.some(r => r.id === last)) return null;
    const scenario = selected.find(s => s.id === last);
    return scenario ? failure(scenario, 'error', `the client died in it: ${why}`) : null;
}

/**
 * One terminal result for every selected scenario, and what the clients said that cannot stand. A scenario with more than
 * one result, or with a result that does not fit it, is an error whatever those results said; one with none is missing.
 */
export function reconcile(selected: readonly SelectedScenario[], reports: readonly ShardReport[], shards: number): { results: RecEvent[]; problems: string[] } {
    const problems: string[] = [];
    const owners = shardsOf(selected, shards);
    const byId = new Map(selected.map(s => [s.id, s]));
    const reported = new Map<string, { shard: number; event: RecEvent }[]>();
    for (const report of reports) {
        const counted: Record<string, number> = { ok: 0, invalid: 0, skipped: 0, errors: 0 };
        for (const event of report.results) {
            const id = String(event.id);
            const status = String(event.status);
            if (STATUSES.has(status)) counted[status === 'error' ? 'errors' : status]! += 1;
            if (!byId.has(id)) problems.push(`shard ${report.shard}: a result for ${id}, which this run did not select`);
            else reported.set(id, [...(reported.get(id) ?? []), { shard: report.shard, event }]);
        }
        if (report.done) {
            for (const key of Object.keys(counted)) {
                if (Number(report.done[key] ?? 0) !== counted[key]) problems.push(`shard ${report.shard}: done says ${key} ${String(report.done[key] ?? 0)}, its results ${counted[key]}`);
            }
        }
    }
    const results = selected.map((s): RecEvent => {
        const all = reported.get(s.id) ?? [];
        if (all.length === 0) return failure(s, 'missing', 'no client reported it');
        const wrong = (reason: string) => {
            problems.push(`${s.id}: ${reason}`);
            return failure(s, 'error', reason);
        };
        if (all.length > 1) return wrong(`${all.length} results (shards ${all.map(r => r.shard).join(', ')})`);
        const { shard, event } = all[0]!;
        if (!STATUSES.has(String(event.status))) return wrong(`shard ${shard}: an unknown status ${String(event.status)}`);
        if (event.hash !== s.hash) return wrong(`shard ${shard}: its result has the hash ${String(event.hash)}, the selection ${s.hash}`);
        if (owners.get(s.id) !== shard) return wrong(`it belongs to shard ${owners.get(s.id)}, shard ${shard} reported it`);
        return event;
    });
    return { results, problems };
}

/** Why a recording is not the finished one a result of ok or invalid speaks of, or null. */
export function recordingProblem(file: string, version: string, s: SelectedScenario, status: string, build?: string): string | null {
    let lines: string[];
    try {
        lines = gunzipSync(readFileSync(file)).toString('utf8').split('\n').filter(line => line.length > 0);
    } catch (error) {
        return `no readable recording: ${(error as Error).message}`;
    }
    let header: { mc?: unknown; schema?: unknown; scenario?: { id?: unknown; hash?: unknown }; provenance?: { id?: unknown } } | null;
    let footer: { kind?: unknown; status?: unknown } | null;
    try {
        header = JSON.parse(lines[0] ?? 'null') as typeof header;
        footer = JSON.parse(lines.at(-1) ?? 'null') as typeof footer;
    } catch {
        return 'a recording cut short';
    }
    if (header?.mc !== version) return `a recording of ${String(header?.mc)}`;
    if (header.schema !== 1) return `a recording of schema ${String(header.schema)}`;
    if (header.scenario?.id !== s.id || header.scenario?.hash !== s.hash) return `a recording of ${String(header.scenario?.id)} ${String(header.scenario?.hash)}`;
    if (build !== undefined && header.provenance?.id !== build) return `a recording of the build ${String(header.provenance?.id)}, this run ${build}`;
    if (lines.length < 2 || footer?.kind !== 'footer') return 'a recording with no footer';
    if (footer.status !== status) return `a recording that ended ${String(footer.status)}`;
    return null;
}

/**
 * A run's index: this run's entries over those of an earlier filtered run. An earlier entry stands only if it is well
 * formed and speaks of the scenario as compiled now; what does not is left out, so that an index never counts a recording
 * of something else. An index that cannot be read at all is a problem to say, and this run's entries still go in.
 */
export function mergedEntries(previous: string | undefined, entries: readonly IndexEntry[], built: { readonly scenarios: readonly { readonly id: string; readonly hash: string }[]; readonly skipped: readonly { readonly id: string }[] }): { entries: IndexEntry[]; problems: string[] } {
    const problems: string[] = [];
    const hashes = new Map(built.scenarios.map(s => [s.id, s.hash]));
    const skipped = new Set(built.skipped.map(s => s.id));
    const merged = new Map<string, IndexEntry>();
    if (previous !== undefined) {
        let earlier: unknown;
        try {
            earlier = (JSON.parse(previous) as { scenarios?: unknown }).scenarios;
            if (!Array.isArray(earlier)) throw new Error('it has no scenarios');
        } catch (error) {
            problems.push(`the earlier index cannot be read: ${(error as Error).message}`);
            earlier = [];
        }
        for (const e of earlier as IndexEntry[]) {
            if (typeof e?.id !== 'string' || !INDEXED.has(e.status)) problems.push(`the earlier index holds a bad entry: ${JSON.stringify(e)}`);
            else if (merged.has(e.id)) problems.push(`the earlier index holds ${e.id} twice`);
            else if (hashes.get(e.id) === e.hash || (skipped.has(e.id) && e.status === 'skipped')) merged.set(e.id, e);
        }
    }
    for (const e of entries) merged.set(e.id, e);
    return { entries: [...merged.values()].sort((a, b) => a.id.localeCompare(b.id)), problems };
}

/** A selected scenario that left no good recording. */
export interface ScenarioFailure { readonly id: string; readonly status: string; readonly reason: string }

/** What failed the run among its results (a skipped scenario does not). */
export function failuresOf(results: readonly RecEvent[]): ScenarioFailure[] {
    return results.filter(r => r.status === 'error' || r.status === 'invalid' || r.status === 'missing')
        .map(r => ({ id: String(r.id), status: String(r.status), reason: String(r.reason ?? '') }));
}

/**
 * The lines that name each failed scenario once, and in which runs: the comparison of two runs only holds scenarios that
 * were ok in at least one, so one that failed in both is in no verify line.
 */
export function failureLines(version: string, runs: Readonly<Record<string, readonly ScenarioFailure[]>>): string[] {
    const tags = Object.keys(runs);
    const byId = new Map<string, Map<string, ScenarioFailure>>();
    for (const tag of tags) {
        for (const failure of runs[tag]!) {
            if (!byId.has(failure.id)) byId.set(failure.id, new Map());
            byId.get(failure.id)!.set(tag, failure);
        }
    }
    return [...byId].map(([id, failed]) => {
        const where = tags.length > 1 && failed.size === tags.length ? `every run (${tags.join(', ')})` : [...failed.keys()].join(', ');
        const { status, reason } = [...failed.values()][0]!;
        return `FAILED in ${where}: ${version}/${id} ${status}${reason ? ` (${reason})` : ''}`;
    });
}
