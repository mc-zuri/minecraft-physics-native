// The subsystem matrix (B016): for each family of the engine (travel, collision, effects, entity, vehicle, prediction) and
// each registered release, what says the engine does what vanilla does there. Three kinds of evidence, never one alone:
//   source    the version gates of the family's native files, each compared in vanilla's code on both sides of its
//             boundary (generated/shared-gates.json, generated/gate-sources.json, B007)
//   corpus    the recordings of the family's scenario modules pinned for the release (recorder/corpus/<release>.json)
//   replays   how they replayed: the stepwise engine with its phases and the continuous one for the family's own cases, and
//             the modes that compare the family's part of every recording (projectiles and the server's moving entities for
//             `entity`; the adapter, its motion, the client's moving entities, the bot's carts and the bot for `prediction`)
// A cell is `verified` when every case of the family the release has replayed in each of the family's own modes, and nothing
// compared in its modes differed; `blocked` when what differs needs an input no recording holds (GAPS); `incomplete` when
// anything else differs or did not replay; `n/a` when the corpus has no case of the family for the release. A family is
// `verified` when every release with cases is, every gated function of its files is source-compared, and each gate's
// boundary has a verified release on both sides: a shared path's equivalence there, a divergent path's regression.
//
// The replays are the record of runs of recorder/replay/cli.ts over REPLAY_RECORDINGS, which take hours: `--replays` reads
// runs' logs, `<dir>/<mode>/<release>.log` as `cli.ts --version <release> <mode flags> --json <release>.json > <release>.log`
// writes them (a later dir's verdicts replacing an earlier one's, case by case, as do `<mode>-delta/` re-runs of some
// cases), and `--recheck` a re-run on a later commit of every case the runs left failing. Their summary is
// kept in generated/subsystem-matrix.json with each run's commit and addon. Without --replays the summary already there is
// kept, and the source, the corpus and the verdicts are made again.
//
//   node recorder/replay/subsystem-matrix.ts --replays <dir>[,<dir>...] [--recheck <dir>]   # new replay evidence
//   node recorder/replay/subsystem-matrix.ts                                                # the rest again, and the doc
//   node recorder/replay/subsystem-matrix.ts --check                                        # fails on a difference

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { RELEASES } from './capabilities.ts';
import { loadModules } from '../scenarios/build.ts';

const require = createRequire(import.meta.url);
const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', '..');
const outputPath = join(root, 'generated', 'subsystem-matrix.json');
const docPath = join(root, 'docs', 'subsystem-matrix.md');

type Mode = 'phases' | 'continuous' | 'projectiles' | 'moving' | 'adapter' | 'adapter-motion' | 'moving-client' | 'bot-carts' | 'bot';
const MODES: readonly Mode[] = ['phases', 'continuous', 'projectiles', 'moving', 'adapter', 'adapter-motion', 'moving-client', 'bot-carts', 'bot'];
/** Modes whose logs print a line for a match too; the others print only what differs. */
const LINE_PER_RECORDING: readonly Mode[] = ['phases', 'continuous', 'projectiles', 'moving', 'moving-client'];

interface Family {
    readonly id: string;
    readonly title: string;
    /** The scenario modules (recorder/scenarios/cases) whose cases are the family's. */
    readonly modules: readonly string[];
    /** Instead of modules: the cases of any module whose id this matches (a subsystem the modules cut across). */
    readonly cases?: RegExp;
    /** What the family's scope leaves out on purpose, each with where it is documented. */
    readonly excluded?: readonly string[];
    /** The native sources whose gates the family's code takes. */
    readonly native: readonly string[];
    /** Modes that replay the family's own cases. */
    readonly own: readonly Mode[];
    /** Modes that compare the family's part of every recording. */
    readonly every: readonly Mode[];
}

/** The fishing hook's exclusion: what its replay stops at, and why (docs/limitations.md, Excluded on purpose). */
const HOOK_EXCLUSION = "the fishing hook's bite and its rod's retrieve: the bite's timing and pulls are the server's random (catchingFish's timers, syncronizedRandom's pulls), which no recording holds, and the retrieve is the rod's use; a hook is compared up to either (docs/limitations.md, Excluded on purpose)";

/** The subsystems B281 and B289 require, and the families that evidence each. */
export const REQUESTED: readonly (readonly [string, readonly string[]])[] = [
    ['entity/player', ['travel', 'entity']], ['fluid', ['fluid']], ['collision', ['collision']], ['vehicles', ['vehicle']],
    ['projectiles', ['projectiles']], ['effects', ['effects']], ['attributes', ['attributes']], ['poses', ['poses']], ['tick ordering', ['tick-order']],
];

export const FAMILIES: readonly Family[] = [
    {
        id: 'travel', title: 'the player\'s travel: ground, air, fluids, climbing, flight, falls and its own move',
        modules: ['physrec/java-ground', 'physrec/java-flight', 'physrec/java-fluid-drag', 'physrec/java-fluid-edges', 'physrec/java-falls',
            'physrec/java-input-edges', 'physrec/java-player-edges', 'physrec/java-conformance', 'physrec/java-moves', 'physrec/java-interactions',
            'physrec/prismarine-physics', 'physrec/manual-r_free_play', 'walk', 'physrec/coverage/movement'],
        native: ['simulation.rs', 'legacy_fluid.rs', 'math.rs'],
        own: ['phases', 'continuous'], every: [],
    },
    {
        id: 'collision', title: 'collision: block shapes, steps, partial blocks, the world border, pistons and shulker lids',
        modules: ['physrec/java-geometry', 'physrec/java-partial-states', 'physrec/java-edge', 'physrec/java-gate-edges', 'physrec/java-suffocate-border',
            'physrec/coverage/shulker-box'],
        native: ['collision.rs', 'block_traversal.rs', 'voxel_shape.rs', 'world.rs', 'piston.rs', 'shulker_box.rs'],
        own: ['phases', 'continuous'], every: [],
    },
    {
        id: 'effects', title: 'effects: status effects, attributes, enchantments and the blocks a player stands in or on',
        modules: ['physrec/java-effects', 'physrec/java-equipment', 'physrec/java-blocks', 'physrec/java-surfaces', 'surfaces'],
        native: ['simulation.rs'],
        own: ['phases', 'continuous'], every: [],
    },
    {
        id: 'entity', title: 'entities: what pushes or carries the player, projectiles, the server\'s moving entities, portals and impulses',
        modules: ['physrec/java-entities', 'physrec/java-moving-entities', 'physrec/java-projectiles', 'physrec/java-portals', 'server'],
        native: ['entity.rs', 'moving_entity.rs', 'projectile.rs', 'projectile_hits.rs', 'dragon.rs', 'napi_moving_entity.rs', 'napi_projectile.rs'],
        own: ['phases', 'continuous'], every: ['projectiles', 'moving'],
        excluded: [HOOK_EXCLUSION],
    },
    {
        id: 'vehicle', title: 'vehicles: boats, ridden mobs and minecarts, ridden and not',
        modules: ['physrec/java-vehicles', 'physrec/java-minecarts', 'physrec/coverage/mounts', 'physrec/coverage/mount-click'],
        native: ['vehicle.rs', 'ridden.rs', 'minecart.rs', 'napi_minecart.rs'],
        own: ['phases', 'continuous'], every: [],
    },
    // the subsystems B281 and B289 name that the families above cut across: each its own cases, by pattern
    {
        id: 'fluid', title: 'fluids: water and lava contact, currents, drag, eyes, waterlogging, flow blockers and fluid jumps',
        modules: [], cases: /^physrec\/((wa|lf|fj|jo|mf|cw|fb|fp|fs|ff|lg|ec|wn|ul|sl|dg|ld|hw|wh|wl|ie|uw)_|b_(water|lava))/,
        native: ['legacy_fluid.rs', 'simulation.rs'],
        own: ['phases', 'continuous'], every: [],
    },
    {
        id: 'projectiles', title: 'projectiles: arrows, tridents, thrown items, fireballs, wind charges, rockets, bullets and the fishing hook',
        modules: [], cases: /^physrec\/(pj_|m_fishing$|m_flow_fish$|cf_arrow)/,
        native: ['projectile.rs', 'projectile_hits.rs', 'napi_projectile.rs'],
        own: ['phases', 'continuous'], every: ['projectiles'],
        excluded: [HOOK_EXCLUSION],
    },
    {
        id: 'attributes', title: 'attributes: gravity, scale, step height, speeds, movement efficiencies, jump strength, fall damage and burning',
        modules: [], cases: /^physrec\/(e_attr_|cf_attr_|gr_|g_step_attr_|dg_(efficiency|gravity)|ld_gravity|ls_gravity|we_gravity|v_scaled_|cf_scale_|ps_\w*scale|hw_scale)/,
        native: ['simulation.rs'],
        own: ['phases', 'continuous'], every: [],
    },
    {
        id: 'poses', title: "poses: sneaking and crouching, crawling, swimming, gliding, sleeping, dying, a passenger's, under a ceiling and a shulker lid",
        modules: [], cases: /^physrec\/(ps_|pl_(glide|crawl|passenger|ceiling|swim)|sb_)|sneak|crouch/,
        native: ['simulation.rs', 'napi_api.rs'],
        own: ['phases', 'continuous'], every: [],
    },
    {
        id: 'tick-order', title: "tick ordering: every phase of the client's tick and of its vehicle's, in vanilla's order, each compared where it ends",
        modules: [], cases: /^/,
        native: ['napi_api.rs'],
        own: ['phases'], every: [],
    },
    {
        id: 'prediction', title: 'prediction: the adapter\'s client decisions and motion, the client\'s moving entities, the bot',
        modules: ['physrec/mineflayer-features', 'physrec/mouse-clicks', 'physrec/mouse-clicks-extra', 'physrec/coverage/containers-entity',
            'physrec/coverage/dig', 'physrec/coverage/place', 'physrec/coverage/use-block', 'physrec/coverage/use-entity', 'physrec/coverage/use-item'],
        native: ['napi_api.rs', 'napi_bulk.rs', 'version.rs'],
        own: ['phases', 'continuous'], every: ['adapter', 'adapter-motion', 'moving-client', 'bot-carts', 'bot'],
    },
];

/**
 * What differs that was read, and who owns it: a recording of these cases in these modes differs for the reason given.
 * `blocked` is a difference no engine change can close: the recording lacks the input. Anything not listed is unexplained.
 */
export const GAPS: readonly { readonly cases: RegExp; readonly modes: readonly Mode[]; readonly kind: 'blocked' | 'incomplete'; readonly owner: string; readonly why: string }[] = [
    { cases: /.*/, modes: ['bot', 'bot-carts'], kind: 'incomplete', owner: 'B026',
        why: 'the bot, in the mineflayer fork lane: its decisions and packets, not the engine; its runs are that lane\'s' },
];

const gapOf = (id: string, mode: string) => GAPS.find(({ cases, modes }) => modes.includes(mode as Mode) && cases.test(id));

interface Run { readonly commit: string; readonly native: string }
/** One mode on one release of a run: each recording's verdict, or for the modes printing only differences, a count. */
interface RawCell { readonly lines: ReadonlyMap<string, string>; readonly compared: number }

const verdictLine = /^(ok|none|FAIL|BAD|unsupported|known|untested)\s+[0-9.]+\/(\S+?):?(?:\s|$)/;

function verdicts(file: string): Map<string, string> {
    const out = new Map<string, string>();
    if (!existsSync(file)) return out;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = verdictLine.exec(line);
        if (m) out.set(m[2]!, m[1] === 'BAD' ? 'FAIL' : m[1]!);
    }
    return out;
}

const readJson = (file: string): Record<string, unknown> => {
    if (!existsSync(file)) return {};
    try {
        return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
        return {};
    }
};

function runOf(file: string): Run | null {
    const replay = readJson(file)['replay'] as { commit?: string; native?: Record<string, string> } | undefined;
    return replay?.commit ? { commit: replay.commit, native: Object.values(replay.native ?? {})[0] ?? '' } : null;
}

/** Runs' logs, deltas and a recheck, per mode and release. */
function importReplays(dirs: readonly string[], recheck: string | undefined, ids: ReadonlyMap<string, readonly string[]>) {
    const cells = new Map<string, RawCell>();
    const runs: Record<string, Run[]> = {};
    for (const mode of MODES) {
        const seen = new Map<string, Run>();
        for (const release of RELEASES) {
            // each dir's verdicts over the earlier ones': a later run of some cases, or of a release an earlier one stopped in
            const held = dirs.filter((candidate) => existsSync(join(candidate, mode, `${release}.log`)));
            if (held.length === 0) continue;
            // (a mode that prints only differences says nothing of a case it matched, so its latest run of the release, which
            // replays every recording, stands alone, counts and all)
            const dir = held[held.length - 1]!;
            const lines = new Map<string, string>();
            for (const each of LINE_PER_RECORDING.includes(mode) ? held : [dir]) {
                const run = runOf(join(each, mode, `${release}.json`));
                if (run) seen.set(`${run.commit}|${run.native}`, run);
                for (const [id, verdict] of verdicts(join(each, mode, `${release}.log`))) lines.set(id, verdict);
                for (const [id, verdict] of verdicts(join(each, `${mode}-delta`, `${release}.log`))) lines.set(id, verdict);
            }
            // a recheck re-ran every case left failing: what it does not say differs matched (some modes print only differences)
            const again = recheck ? join(recheck, mode, `${release}.log`) : null;
            if (again && existsSync(again)) {
                const now = verdicts(again);
                for (const [id, verdict] of [...lines]) if (verdict === 'FAIL') lines.set(id, now.get(id) === 'FAIL' ? 'FAIL' : 'ok');
            }
            const summary = readJson(join(dir, mode, `${release}.json`)) as { recordings?: number; notCompared?: readonly unknown[]; matching?: number };
            const failed = [...lines.values()].filter((v) => v === 'FAIL').length;
            const compared = LINE_PER_RECORDING.includes(mode)
                ? [...lines.values()].filter((v) => v === 'ok' || v === 'FAIL').length
                : mode === 'bot-carts' ? (summary.matching ?? 0) + failed
                    : (summary.recordings ?? ids.get(release)?.length ?? 0) - (summary.notCompared?.length ?? 0);
            cells.set(`${mode}|${release}`, { lines, compared });
        }
        runs[mode] = [...seen.values()];
    }
    if (recheck) {
        const run = runOf(join(recheck, 'run.json'));
        if (run) runs['recheck'] = [run];
    }
    return { runs, cells };
}

/** The corpus: each release's pinned recording ids. */
function corpus(): Map<string, readonly string[]> {
    const out = new Map<string, readonly string[]>();
    for (const release of RELEASES) {
        const file = join(root, 'recorder', 'corpus', `${release}.json`);
        if (existsSync(file)) out.set(release, (JSON.parse(readFileSync(file, 'utf8')) as { entries: { id: string }[] }).entries.map(({ id }) => id));
    }
    return out;
}

/** What one mode says of one family on one release: compared, differing (each id, or a count where ids would be thousands), not replayed. */
interface ModeEvidence { compared: number; failing: string[]; failed: number; missing: string[] }
/** Evidence per family, release and mode. */
type Evidence = Record<string, Record<string, Record<string, ModeEvidence>>>;

/** Whether a case is the family's: by its module, or by the family's pattern. */
const inFamily = (family: Family, id: string, moduleOf: ReadonlyMap<string, string>) =>
    family.cases ? family.cases.test(id) : family.modules.includes(moduleOf.get(id) ?? '');

function evidenceOf(cells: ReadonlyMap<string, RawCell>, moduleOf: ReadonlyMap<string, string>, ids: ReadonlyMap<string, readonly string[]>): Evidence {
    const out: Evidence = {};
    for (const family of FAMILIES) {
        for (const release of RELEASES) {
            const own = (ids.get(release) ?? []).filter((id) => inFamily(family, id, moduleOf));
            const cell: Record<string, ModeEvidence> = {};
            for (const mode of family.own) {
                const raw = cells.get(`${mode}|${release}`);
                if (!raw) continue;
                const failing = own.filter((id) => raw.lines.get(id) === 'FAIL');
                const compared = own.filter((id) => raw.lines.get(id) === 'ok').length + failing.length;
                // a case with no verdict at all did not replay: the run stopped, or it is newer than the run
                const missing = own.filter((id) => !raw.lines.has(id));
                cell[mode] = { compared, failing, failed: failing.length, missing };
            }
            for (const mode of family.every) {
                const raw = cells.get(`${mode}|${release}`);
                if (!raw) continue;
                // (a recording in the folder that the release's corpus does not pin is no evidence either way)
                const pinned = new Set(ids.get(release) ?? []);
                const failing = [...raw.lines].filter(([id, v]) => v === 'FAIL' && pinned.has(id)).map(([id]) => id).sort();
                cell[mode] = { compared: raw.compared, failing: mode === 'bot' ? [] : failing, failed: failing.length, missing: [] };
            }
            (out[family.id] ??= {})[release] = cell;
        }
    }
    return out;
}

async function familyMap() {
    const modules = await loadModules();
    const moduleOf = new Map<string, string>();
    for (const { name, scenarios } of modules) for (const { id } of scenarios) moduleOf.set(id, name);
    const unassigned = modules.filter(({ name }) => !FAMILIES.some(({ modules: names }) => names.includes(name))).map(({ name }) => name);
    return { moduleOf, unassigned };
}

type Status = 'verified' | 'blocked' | 'incomplete' | 'n/a';

/** Which families a source finding's scope touches, by its words; one the words place nowhere is the player's travel. */
const FINDING_FAMILIES: readonly (readonly [RegExp, readonly string[]])[] = [
    [/boat|camel|horse|ridden|vehicle/, ['vehicle']],
    [/projectile|arrow|trident|fireball|throwable|thrown|llama spit|shulker bullet|fishing hook|rocket/, ['projectiles', 'entity']],
    [/fluid|water|lava|liquid|bubble/, ['fluid']],
    [/attribute|movement speed|safe_fall|fall_damage/, ['attributes']],
    [/eye_height|eye height|sneak|pose|glide|elytra|fall_flying|fallflying/, ['poses']],
    [/collision|collider|clip|shape|border|suffocat|piston|inside-block|auto-jump|autojump|backofffromedge|closestspace/, ['collision']],
    [/block effects|stepon|riptide|slime/, ['effects']],
    [/entity push|entities|remote entity|colliders|passengers|piston push/, ['entity']],
    [/tick order|removal tick/, ['tick-order']],
    [/client.player|client.localplayer/, ['travel']],
];

/**
 * The source findings still open (docs/parity-dispositions.json: active, or fixed without a trace), each with the families
 * its scope touches. B281: a known finding keeps the scope it touches incomplete until it is resolved, whatever the replays show.
 */
function openFindings(): { id: string; title: string; releases: string; tickets: readonly string[]; families: readonly string[] }[] {
    const all = JSON.parse(readFileSync(join(root, 'docs', 'parity-dispositions.json'), 'utf8')) as {
        id: string; title: string; releases: string; scope: string; disposition: string; overlaps: string[];
    }[];
    return all.filter(({ disposition }) => disposition === 'active' || disposition === 'fixed-unvalidated').map((finding) => {
        const words = `${finding.scope} ${finding.title}`.toLowerCase();
        const families = [...new Set(FINDING_FAMILIES.filter(([words_]) => words_.test(words)).flatMap(([, ids]) => ids))];
        return { id: finding.id, title: finding.title, releases: finding.releases, tickets: finding.overlaps, families: families.length ? families : ['travel'] };
    });
}
interface Cell {
    readonly status: Status;
    readonly cases: number;
    readonly compared: Readonly<Record<string, number>>;
    /** mode -> the differing cases, each with its gap's owner, or `unexplained`. */
    readonly failing: Readonly<Record<string, readonly string[]>>;
    readonly failed: Readonly<Record<string, number>>;
    readonly missing: Readonly<Record<string, number>>;
}

export async function matrix(runs: Readonly<Record<string, readonly Run[]>>, evidence: Evidence) {
    const { moduleOf, unassigned } = await familyMap();
    const ids = corpus();
    const gates = (JSON.parse(readFileSync(join(root, 'generated', 'shared-gates.json'), 'utf8')) as {
        entries: { file: string; function: string; boundaries: string[]; status: string }[];
    }).entries;
    const { pairOf } = require('../../scripts/compare-gate-sources.cjs') as { pairOf: (boundary: string, registered: readonly string[]) => [string, string] | null };
    const unexplained = new Set<string>();
    const open = openFindings();
    const families = FAMILIES.map((family) => {
        const findings = open.filter(({ families: ids }) => ids.includes(family.id));
        const cells: Record<string, Cell> = {};
        for (const release of RELEASES) {
            const cases = (ids.get(release) ?? []).filter((id) => inFamily(family, id, moduleOf)).length;
            const compared: Record<string, number> = {};
            const failing: Record<string, readonly string[]> = {};
            const failed: Record<string, number> = {};
            const missing: Record<string, number> = {};
            const kinds = new Set<string>();
            for (const [mode, e] of Object.entries(evidence[family.id]?.[release] ?? {})) {
                compared[mode] = e.compared;
                if (e.failed) {
                    failed[mode] = e.failed;
                    failing[mode] = e.failing;
                    const listed = e.failing.length ? e.failing : ['*'];
                    for (const id of listed) {
                        const gap = gapOf(id, mode);
                        if (!gap) unexplained.add(`${mode} ${release}/${id}`);
                        kinds.add(gap?.kind ?? 'incomplete');
                    }
                }
                if (e.missing.length) {
                    missing[mode] = e.missing.length;
                    kinds.add('incomplete');
                }
            }
            if (cases > 0 && !family.own.some((mode) => (compared[mode] ?? 0) > 0)) kinds.add('incomplete');
            const status: Status = cases === 0 ? 'n/a' : kinds.has('incomplete') ? 'incomplete' : kinds.has('blocked') ? 'blocked' : 'verified';
            cells[release] = { status, cases, compared, failing, failed, missing };
        }
        const functions = gates.filter(({ file }) => family.native.includes(file));
        const boundaries = [...new Set(functions.flatMap(({ boundaries: list }) => list))].sort((a, b) => RELEASES.indexOf(pairOf(a, RELEASES)?.[1] as never) - RELEASES.indexOf(pairOf(b, RELEASES)?.[1] as never));
        const uncovered = boundaries.filter((boundary) => {
            const pair = pairOf(boundary, RELEASES);
            return !pair || pair.some((release) => cells[release]?.status !== 'verified');
        });
        const statuses = new Set(Object.values(cells).map(({ status: s }) => s));
        const sourced = functions.every(({ status: s }) => s === 'source-compared');
        const status: Status = statuses.has('incomplete') || !sourced || findings.length ? 'incomplete' : statuses.has('blocked') ? 'blocked' : uncovered.length ? 'incomplete' : 'verified';
        return {
            id: family.id, title: family.title, status, modules: family.modules, ...(family.cases ? { cases: family.cases.source } : {}), excluded: family.excluded ?? [],
            findings: findings.map(({ id, title, releases, tickets }) => ({ id, title, releases, tickets })),
            source: { files: family.native, functions: functions.length, compared: functions.filter(({ status: s }) => s === 'source-compared').length, boundaries, uncovered },
            modes: { own: family.own, every: family.every },
            releases: cells,
        };
    });
    return { schema: 1, generatedBy: 'recorder/replay/subsystem-matrix.ts', runs, unassignedModules: unassigned, unexplained: [...unexplained].sort(), families, evidence };
}

type Matrix = Awaited<ReturnType<typeof matrix>>;
const bare = (id: string) => id.replace(/^physrec\//, '');

/** The verdict of a family on a release, short, for the table. */
function short(cell: Cell): string {
    if (cell.status === 'n/a') return 'n/a';
    const failed = Object.values(cell.failed).reduce((sum, n) => sum + n, 0);
    const missing = Object.values(cell.missing).reduce((sum, n) => Math.max(sum, n), 0);
    const parts = [`${cell.status}`];
    if (failed) parts.push(`${failed} differ`);
    if (missing) parts.push(`${missing} not replayed`);
    return cell.status === 'verified' ? 'verified' : `**${parts.join(', ')}**`;
}

function doc(m: Matrix): string {
    const lines: string[] = [];
    const push = (...items: string[]) => lines.push(...items);
    push('# Subsystem matrix', '');
    push('Generated by `node recorder/replay/subsystem-matrix.ts`; do not edit (B016). A family is the engine\'s code for one part of vanilla');
    push('and the recorded cases that exercise it. A release is `verified` for a family when every case of the family it has replayed');
    push('in each of the family\'s own modes and nothing compared in its modes differed; `blocked` when what differs needs an input no');
    push('recording holds; `incomplete` when anything else differs or did not replay; `n/a` with no case. Source evidence is B007\'s:');
    push('every version gate of the family\'s native files compared in vanilla\'s code on both sides of its boundary. A boundary is');
    push('covered when the releases either side of it are verified: for a shared path that is its equivalence there, for a divergent');
    push('one its regression. No status here comes from a registered profile or a unit test alone.', '');
    push('A behaviour left out of a family\'s scope on purpose is listed with it and documented in docs/limitations.md; it is not counted');
    push('as verified, and nothing that differs is left out without such a line. A source finding still open in');
    push('docs/parity-dispositions.json (active, or fixed without a trace) keeps every family its scope touches incomplete, however its');
    push('replays went: the replays say no recorded case differs, the finding that the code differs where none was recorded.', '');
    push('## Requested subsystems', '');
    push('The subsystems B281 and B289 name, each with the family whose cases and gates are its evidence:', '');
    push('| subsystem | family |');
    push('| --- | --- |');
    for (const [subsystem, ids] of REQUESTED) push(`| ${subsystem} | ${ids.map((id) => `${id} (${m.families.find((f) => f.id === id)?.status ?? 'missing'})`).join(', ')} |`);
    push('', 'Replay runs (mode: commit, addon); a recheck re-ran on its commit every case the runs left differing:');
    for (const [mode, runs] of Object.entries(m.runs)) push(`- ${mode}: ${runs.map(({ commit, native }) => `\`${commit.slice(0, 8)}\` addon \`${native.slice(0, 8)}\``).join(', ') || 'none'}`);
    push('', '## Families', '');
    push('| family | status | gated functions source-compared | boundaries covered | releases verified | excluded on purpose | what is left |');
    push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const f of m.families) {
        const cells = Object.values(f.releases).filter(({ status }) => status !== 'n/a');
        const left: string[] = [];
        const byGap = new Map<string, { releases: Set<string>; cases: Set<string>; count: number }>();
        for (const [release, cell] of Object.entries(f.releases)) {
            for (const [mode, n] of Object.entries(cell.failed)) {
                const list = cell.failing[mode]?.length ? cell.failing[mode]! : ['*'];
                for (const id of list) {
                    const gap = gapOf(id, mode);
                    const key = gap ? `${mode}: ${gap.why} (${gap.kind}, ${gap.owner})` : `${mode}: unexplained`;
                    const entry = byGap.get(key) ?? { releases: new Set(), cases: new Set(), count: 0 };
                    entry.releases.add(release);
                    if (id !== '*') entry.cases.add(bare(id));
                    entry.count += id === '*' ? n : 1;
                    byGap.set(key, entry);
                }
            }
            for (const [mode, n] of Object.entries(cell.missing)) {
                const key = `${mode}: cases the run did not replay`;
                const entry = byGap.get(key) ?? { releases: new Set(), cases: new Set(), count: 0 };
                entry.releases.add(release);
                entry.count += n;
                byGap.set(key, entry);
            }
        }
        for (const [key, { releases, cases, count }] of byGap) {
            const named = cases.size ? `: ${[...cases].slice(0, 8).join(', ')}${cases.size > 8 ? ` and ${cases.size - 8} more` : ''}` : '';
            left.push(`${key}, ${count} on ${releases.size} release${releases.size === 1 ? '' : 's'}${named}`);
        }
        if (f.findings.length) left.push(`open source findings (docs/limitations.md), each keeping the family incomplete until resolved: ${f.findings.map(({ id, tickets }) => `${id} (${tickets.join(', ') || 'no ticket'})`).join(', ')}`);
        if (f.source.uncovered.length) left.push(`boundaries without a verified release either side: ${f.source.uncovered.join(', ')}`);
        push(`| ${f.id} | **${f.status}** | ${f.source.compared} of ${f.source.functions} | ${f.source.boundaries.length - f.source.uncovered.length} of ${f.source.boundaries.length} | ${cells.filter(({ status }) => status === 'verified').length} of ${cells.length} | ${f.excluded.join('<br>') || 'nothing'} | ${left.join('<br>') || 'nothing'} |`);
    }
    if (m.unexplained.length) push('', `Unexplained differences: ${m.unexplained.join(', ')}.`);
    push('');
    for (const f of m.families) {
        push(`## ${f.id}`, '');
        push(`${f.title[0]!.toUpperCase()}${f.title.slice(1)}. ${f.cases ? `Cases: the ids \`${f.cases}\` matches` : `Scenario modules: ${f.modules.map((name) => `\`${name}\``).join(', ')}`}. Native files: ${f.source.files.map((file) => `\`${file}\``).join(', ')}. Modes: ${[...f.modes.own, ...f.modes.every].join(', ')}.`, '');
        push('| release | cases | verdict | compared by mode | differing |');
        push('| --- | ---: | --- | --- | --- |');
        for (const [release, cell] of Object.entries(f.releases)) {
            const compared = Object.entries(cell.compared).map(([mode, n]) => `${mode} ${n}`).join(', ');
            const failing = Object.entries(cell.failed).map(([mode, n]) => {
                const list = cell.failing[mode] ?? [];
                return `${mode}: ${list.length ? `${list.slice(0, 5).map(bare).join(', ')}${list.length > 5 ? ` and ${list.length - 5} more` : ''}` : n}`;
            }).join('; ');
            push(`| ${release} | ${cell.cases} | ${short(cell)} | ${compared} | ${failing} |`);
        }
        push('');
    }
    if (m.unassignedModules.length) push(`Scenario modules in no family: ${m.unassignedModules.join(', ')}.`, '');
    return `${lines.join('\n')}\n`;
}

async function main() {
    const { values } = parseArgs({ options: { replays: { type: 'string' }, recheck: { type: 'string' }, check: { type: 'boolean', default: false } } });
    const kept = existsSync(outputPath) ? (JSON.parse(readFileSync(outputPath, 'utf8')) as { runs: Record<string, Run[]>; evidence: Evidence }) : null;
    let runs = kept?.runs;
    let evidence = kept?.evidence;
    if (values.replays) {
        const ids = corpus();
        const replays = importReplays(values.replays.split(','), values.recheck, ids);
        runs = replays.runs;
        evidence = evidenceOf(replays.cells, (await familyMap()).moduleOf, ids);
    }
    if (!runs || !evidence) throw new Error('no replay evidence: run with --replays <dir> once');
    const m = await matrix(runs, evidence);
    const json = `${JSON.stringify(m, null, 1)}\n`;
    const text = doc(m);
    if (values.check) {
        const differs = ([[outputPath, json], [docPath, text]] as const).filter(([file, body]) => !existsSync(file) || readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== body);
        if (differs.length) {
            console.error(`differs: ${differs.map(([file]) => file).join(', ')}`);
            process.exit(1);
        }
        return;
    }
    writeFileSync(outputPath, json);
    writeFileSync(docPath, text);
    for (const f of m.families) console.log(`${f.id}: ${f.status}`);
    if (m.unexplained.length) console.log(`unexplained: ${m.unexplained.length}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
