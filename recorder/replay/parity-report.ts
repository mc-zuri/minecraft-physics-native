// The player's parity by release: for each registered release and each family of cases, how many recordings replayed and how many
// matched, on the stepwise engine with its phases and through the adapter's own decisions, and which source that release has. It
// says what ran, not what a release is: a family with no recording reads `none`, and only recordings count, never a neighbour.
//
//   node recorder/replay/parity-report.ts --roots a,b --json out.json [--versions 1.20.4,26.3]   # replays, one process a layer
//   node recorder/replay/parity-report.ts --from out.json > docs/player-parity-matrix.md          # the table
//
// A root earlier in --roots wins a case that two of them hold.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { RELEASES } from './capabilities.ts';
import { findRecordings } from './recordings.ts';
import { idMatcher } from '../scenarios/build.ts';

/** A ticket's cases. A family is read by what a ticket's acceptance asks, so one case may stand in two. */
export const FAMILIES: Readonly<Record<string, string>> = {
    'fall damage (B098)': 'physrec/fd_*',
    'jump, ground, air (B103)': 'physrec/j_*,physrec/jd_*,physrec/sj_*',
    'water, lava, climb (B110)': 'physrec/ld_*,physrec/lf_*,physrec/wl_*,physrec/wa_*,physrec/wh_*,physrec/hw_*',
    'swimming, eyes (B111, B120)': 'physrec/pl_swim*,physrec/pl_water*,physrec/pl_surface*,physrec/ie_*',
    'poses (B099, B112)': 'physrec/ps_*,physrec/pl_glide*,physrec/pl_crawl*,physrec/pl_passenger*,physrec/pl_ceiling*',
    'flight (B113)': 'physrec/f_*,physrec/fj_*,physrec/pl_fly*',
    'speed modifiers (B105)': 'physrec/pl_mod*',
    'impulses, hits (B115, B119)': 'physrec/pl_impulse*,physrec/pl_knockback*,physrec/pl_attack*',
    'partial blocks (B161)': 'physrec/pa_*,physrec/pl_nb*,physrec/pl_inside*,physrec/pl_step*',
};

interface Cell { readonly stepwise: number; readonly stepwiseOk: number; readonly adapter: number; readonly adapterOk: number; readonly failures: readonly string[] }
type Report = Record<string, Record<string, Cell>>;

const here = fileURLToPath(new URL('.', import.meta.url));
/** The source of a release, as generated/release-manifest.json records it: its own exact tree, or none. */
const MANIFEST = JSON.parse(readFileSync(join(here, '..', '..', 'generated', 'release-manifest.json'), 'utf8')) as {
    readonly releases: Readonly<Record<string, { readonly source: { readonly status: string } }>>;
};
function sourceOf(version: string): string {
    return MANIFEST.releases[version]?.source.status === 'embedded' ? 'exact' : 'jar only';
}

function layer(version: string, root: string, selection: string, extra: readonly string[]): { readonly lines: readonly string[] } {
    const run = spawnSync(process.execPath, [join(here, 'cli.ts'), '--version', version, '--case', selection, ...extra], {
        encoding: 'utf8', maxBuffer: 1 << 30, env: { ...process.env, REPLAY_RECORDINGS: root },
    });
    return { lines: `${run.stdout}\n${run.stderr}`.split(/\r?\n/) };
}

function replay(versions: readonly string[], roots: readonly string[]): Report {
    const report: Report = {};
    for (const version of versions) {
        report[version] = {};
        const present = new Map<string, string>();
        for (const root of [...roots].reverse()) for (const f of findRecordings(root, [version])) present.set(f.id, root);
        for (const [family, selection] of Object.entries(FAMILIES)) {
            const matches = idMatcher(selection);
            const cases = [...present.keys()].filter(matches);
            let [stepwise, stepwiseOk, adapter, adapterOk] = [0, 0, 0, 0];
            const failures: string[] = [];
            for (const root of roots) {
                const ids = cases.filter(id => present.get(id) === root);
                if (ids.length === 0) continue;
                const list = ids.join(',');
                const a = layer(version, root, list, ['--phases']);
                const b = layer(version, root, list, ['--adapter', '--motion']);
                const count = (lines: readonly string[]) => lines.filter(l => /^(FAIL|BAD)/.test(l));
                stepwise += ids.length;
                adapter += ids.length;
                const badStep = count(a.lines);
                const badAdapter = count(b.lines);
                stepwiseOk += ids.length - badStep.length;
                adapterOk += ids.length - badAdapter.length;
                failures.push(...badStep.map(l => `stepwise ${l}`), ...badAdapter.map(l => `adapter ${l}`));
            }
            report[version][family] = { stepwise, stepwiseOk, adapter, adapterOk, failures };
        }
        console.error(version, 'done');
    }
    return report;
}

function table(report: Report): string {
    const families = Object.keys(FAMILIES);
    const out = [
        '# Player parity by release',
        '',
        'Generated by `node recorder/replay/parity-report.ts`; do not edit. Each cell is matching / replayed for one family of cases: the',
        'stepwise engine with its phases, then the adapter layer with its own decisions and motion (`--adapter --motion`). `none`',
        'means no recording of that family was there for the release, which is a gap and proves nothing either way. `source` is',
        'what the release has: `exact` its own tree in the source collections, `stand-in` another release, `jar only` nothing to',
        'read but its recordings come from its own jar. Separate columns, separate questions: a matching replay of a `jar only`',
        'release is runtime evidence for it, and says nothing about source.',
        '',
        'For landing damage (B098) the three questions read: exact-source, the `exact` rows, whose formula family was read in their own',
        'tree; inferred-policy, the `jar only` and `stand-in` rows, whose family test/landing-policy.test.cjs takes from the trees around',
        'them; runtime-conformant, a row whose fall damage column matches, each landing held to the health the server keeps. A family label alone',
        'closes nothing, and an inferred row with a matching replay is runtime-conformant and still inferred.',
        '',
        `| Release | source | ${families.join(' | ')} |`,
        `| --- | --- | ${families.map(() => '---').join(' | ')} |`,
    ];
    const failures: string[] = [];
    for (const version of RELEASES) {
        const row = report[version];
        if (!row) continue;
        const cells = families.map(family => {
            const c = row[family]!;
            if (c.stepwise === 0) return 'none';
            for (const f of c.failures) failures.push(`- ${version} ${family}: ${f.slice(0, 180)}`);
            return `${c.stepwiseOk}/${c.stepwise}, ${c.adapterOk}/${c.adapter}`;
        });
        out.push(`| ${version} | ${sourceOf(version)} | ${cells.join(' | ')} |`);
    }
    out.push('', `## Differences (${failures.length})`, '', ...(failures.length > 0 ? failures : ['None.']), '');
    return out.join('\n');
}

const { values } = parseArgs({ options: { roots: { type: 'string' }, json: { type: 'string' }, from: { type: 'string' }, versions: { type: 'string' } } });
if (values.from) {
    process.stdout.write(table(JSON.parse(readFileSync(values.from, 'utf8')) as Report));
} else {
    const roots = (values.roots ?? process.env.REPLAY_RECORDINGS ?? '').split(',').filter(Boolean);
    if (roots.length === 0) throw new Error('--roots, or REPLAY_RECORDINGS');
    const report = replay(values.versions ? values.versions.split(',') : RELEASES, roots);
    writeFileSync(values.json ?? join(mkdtempSync(join(tmpdir(), 'parity-')), 'report.json'), JSON.stringify(report, null, 1));
}
