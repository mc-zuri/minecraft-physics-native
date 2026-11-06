// Writes docs/fluid-parity-matrix.md and, beside it, .json (B140): for each fluid equation or predicate, the vanilla source that
// states it, the fixtures that exercise it, and for every registered release whether they match, differ or are unverified; the
// JSON pins each result to the release's source, the recorder builds of its recordings and the native build that replayed them. A release with no finished recording of a family is unverified: a neighbour's result is never
// taken for it.
//
//   node recorder/replay/fluid-matrix.ts --roots <dir>[,<dir>] [--versions 26.3,1.21.11] [--families flow,lava] [--out file]
//
// Each root is a folder of recordings; a case in several is taken from the first that has a release's index.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { idMatcher } from '../scenarios/build.ts';
import { nativeBinding, replayNative } from './engine.ts';
import { loadRecording } from './load.ts';
import { replayMovingEntities } from './moving-entities.ts';
import { RECORDER_ROOT, findRecordings } from './recordings.ts';
import { validateRecording } from './validate.ts';
import { replayIdentity } from '../runner/provenance.ts';
import { writeJson } from '../schema/json.ts';

const require = createRequire(import.meta.url);
const { registeredReleases } = require('../../scripts/registered-releases.cjs') as { registeredReleases(): { version: string }[] };

/** One row of the matrix: what is claimed, where vanilla says it, and the cases that would show it wrong. */
interface Family { readonly id: string; readonly claim: string; readonly source: string; readonly cases: string; readonly since?: string }

const FAMILIES: readonly Family[] = [
    { id: 'levels', claim: 'water height, contact and depth by level, source, falling and same fluid above', source: '26.3 FlowingFluid.getOwnHeight, getHeight, EntityFluidInteraction.update; 1.14.4 same-fluid-above', cases: 'physrec/wa_level_*,physrec/wa_falling_*,physrec/lf_level_*,physrec/lf_falling_*' },
    { id: 'current', claim: 'flow vector, its accumulation over cells and the velocity it leaves', source: '26.3 FlowingFluid.getFlow, EntityFluidInteraction.applyCurrentTo; 1.13.2 Entity height weighting; 1.16 minimum boost', cases: 'physrec/wa_walk_*,physrec/lf_walk_*,physrec/cw_near_*' },
    { id: 'high-y', claim: 'the same near the build limit and far from the origin', source: '26.3 EntityFluidInteraction (double positions, float heights)', cases: 'physrec/wa_high_*,physrec/cw_neg_*,physrec/cw_high_*' },
    { id: 'm13', claim: 'M13: what stops a flow is not the collision shape', source: '1.16.5 FlowableFluid.java:52-75, 1.20.4 AbstractBlock.java:466-488, 26.3 #blocks_fluid_flow', cases: 'physrec/fb_*,physrec/fp_*,physrec/fs_*,physrec/ff_*' },
    { id: 'm14', claim: 'M14: lava contact by the box as vanilla contracts it; mixed fluids', source: '1.13.2 Entity.java isInLava; 1.14 predicate; 26.3 EntityFluidInteraction', cases: 'physrec/mf_*,physrec/lg_*,physrec/lf_*' },
    { id: 'm15', claim: 'M15: eyes by getHeightForCamera under a sturdy face from 26.3, ordinary depth unchanged', source: '26.3 FluidState.java:53-62, EntityFluidInteraction.java:85', cases: 'physrec/ec_*', since: '1.20.5' },
    { id: 'waterlogged', claim: 'blocks that hold water: contact, eyes, swimming, and a change of state', source: '26.3 BlockBehaviour getFluidState; generated/fluid-tables.json', cases: 'physrec/wh_*,physrec/wl_*,physrec/wn_*', since: '1.13' },
    { id: 'jump', claim: 'fluid jump threshold and the escape hop', source: '26.3 LivingEntity.getFluidJumpThreshold, jumpInLiquid; 1.20.5 scale', cases: 'physrec/fj_*,physrec/jo_*' },
    { id: 'water-drag', claim: 'water drag, input speed, efficiency, Depth Strider, Dolphin\'s Grace', source: '1.13.2 LivingEntity.java:1508, 1.21 LivingEntity.java:2108, 26.3 LivingEntity.travelInWater', cases: 'physrec/dg_*,physrec/we_*,physrec/q_depth_strider_*' },
    { id: 'lava-drag', claim: 'lava drag, input, gravity, shallow branch', source: '1.13.2 LivingEntity.java:1639, 1.16.5 shallow branch, 26.3 LivingEntity.java:2459', cases: 'physrec/ld_*,physrec/ls_*' },
    { id: 'bubble', claim: 'bubble columns, player and boat', source: '26.3 BubbleColumnBlock.java:46, AbstractBoat; 1.21.5 top test', cases: 'physrec/bt_*,physrec/bc_*,physrec/v_boat_bubble_*' },
    { id: 'climb', claim: 'climbables, scaffolding and webs in fluids', source: '26.3 LivingEntity.onClimbable, ScaffoldingBlock, WebBlock.java:17', cases: 'physrec/cc_*,physrec/fc_*,physrec/fw_*' },
    { id: 'boat', claim: 'boat water levels, status and passenger box', source: '26.3 AbstractBoat.java:483', cases: 'physrec/v_boat_*,physrec/bf_*' },
    { id: 'strider', claim: 'standing on lava', source: '26.3 LiquidBlock.java:61, Strider.java:170,322', cases: 'physrec/sl_*,physrec/v_strider_*', since: '1.16' },
    { id: 'ultra-warm', claim: 'lava\'s current at 0.007 in an ultra-warm dimension, shallow and deep', source: '1.16.5 Entity.java updateMovementInFluid, 26.3 Entity FAST_LAVA, EntityFluidInteraction', cases: 'physrec/uw_level_*,physrec/uw_source,physrec/uw_walk_*,physrec/uw_deep*,physrec/uw_shallow_jump', since: '1.16' },
    { id: 'loaded-chunk', claim: 'no fluid is touched beside a column not loaded, from 26.1', source: '26.1 EntityFluidInteraction.java:44, 94-110, ClientChunkCache.java:71-80', cases: 'physrec/uw_chunk_edge', since: '1.16' },
    { id: 'aquatic', claim: 'aquatic and fluid mobs', source: '26.3 AbstractFish, Dolphin, Turtle, Axolotl, Tadpole, Frog, Drowned', cases: 'physrec/me_mob_*' },
];

const compare = (a: string, b: string): number => {
    const [x, y] = [a, b].map(v => v.split('.').map(Number));
    for (let i = 0; i < 3; i += 1) if ((x![i] ?? 0) !== (y![i] ?? 0)) return (x![i] ?? 0) - (y![i] ?? 0);
    return 0;
};

interface Cell { matched: number; mismatched: number; firsts: string[]; recorders: Set<string>; builds: Set<string> }

/** The finished recordings of a release under the first root that has its index. */
function filesOf(roots: readonly string[], version: string): ReturnType<typeof findRecordings> {
    const out: ReturnType<typeof findRecordings> = [];
    const seen = new Set<string>();
    for (const root of roots) {
        if (!existsSync(join(root, version, 'index.json'))) continue;
        for (const file of findRecordings(root, [version])) {
            if (seen.has(file.id)) continue;
            seen.add(file.id);
            out.push(file);
        }
    }
    return out;
}

function cellOf(family: Family, files: ReturnType<typeof findRecordings>): Cell {
    const matches = idMatcher(family.cases);
    const cell: Cell = { matched: 0, mismatched: 0, firsts: [], recorders: new Set(), builds: new Set() };
    for (const file of files.filter(f => matches(f.id))) {
        const recording = loadRecording(file.file);
        const invalid = validateRecording(recording, file.version, file.id, true);
        if (invalid.length > 0) continue;
        const result = replayNative(recording);
        if (result.compared === 0) continue;
        const moving = /^physrec\/me_/.test(file.id) ? replayMovingEntities(recording, nativeBinding(), 'server') : undefined;
        const provenance = recording.header.provenance as { id?: string; commit?: string } | undefined;
        if (provenance?.commit) cell.recorders.add(provenance.commit.slice(0, 8));
        if (provenance?.id) cell.builds.add(provenance.id);
        if (result.first || result.problems.length > 0 || moving?.first || (moving?.problems.length ?? 0) > 0) {
            cell.mismatched += 1;
            if (cell.firsts.length < 3) cell.firsts.push(file.id);
        } else {
            cell.matched += 1;
        }
    }
    return cell;
}

function main(): void {
    const { values } = parseArgs({
        options: {
            roots: { type: 'string', default: join(RECORDER_ROOT, 'out', 'recordings') },
            versions: { type: 'string' },
            families: { type: 'string' },
            out: { type: 'string', default: join(RECORDER_ROOT, '..', 'docs', 'fluid-parity-matrix.md') },
        },
    });
    const roots = values.roots!.split(',');
    const wanted = values.versions?.split(',');
    const families = FAMILIES.filter(f => !values.families || values.families.split(',').includes(f.id));
    const releases = registeredReleases().map(r => r.version);
    const cells = new Map<string, Cell>();
    const refused: string[] = [];
    for (const version of releases) {
        if (wanted && !wanted.includes(version)) continue;
        const files = filesOf(roots, version);
        try {
            for (const family of families) cells.set(`${family.id} ${version}`, cellOf(family, files));
        } catch (error) {
            // (a release the engine cannot be given a registry for stays unverified, and says why)
            refused.push(`${version}: ${(error as Error).message}`);
        }
        console.log(`${version}: ${files.length} recording(s)`);
    }
    const mark = (family: Family, version: string): string => {
        if (family.since && compare(version, family.since) < 0) return 'n/a';
        const cell = cells.get(`${family.id} ${version}`);
        if (!cell || cell.matched + cell.mismatched === 0) return 'unverified';
        return cell.mismatched > 0 ? `mismatched ${cell.mismatched}/${cell.matched + cell.mismatched}` : `matched ${cell.matched}`;
    };
    const identity = replayIdentity(RECORDER_ROOT);
    const recorded = [...new Set([...cells.values()].flatMap(c => [...c.recorders]))].sort();
    const mismatches = [...cells.entries()].filter(([, c]) => c.mismatched > 0);
    const lines = [
        '# Fluid parity matrix',
        '',
        'Generated by `recorder/replay/fluid-matrix.ts`; do not edit. A cell is `matched n` when every one of the n compared recordings of the',
        'family replays with no difference on that release, `mismatched k/n` when k differ, `unverified` when no finished recording of it was',
        'there to compare, and `n/a` before the mechanism exists. Exact 1.8.8 has no source (VERSION-REFERENCES.md). A release is never covered by a',
        'neighbour. Adapter-supplied flow is a separate column of evidence: `replay --adapter --motion` compares the adapter\'s, this the engine\'s.',
        '',
        `Native: ${Object.entries(identity.native).map(([k, v]) => `${k} ${v}`).join(', ')}. Checkout: ${identity.commit}${identity.dirty ? ' (dirty)' : ''}.`,
        `Recorded by recorder commits: ${recorded.join(', ') || 'none'}.`,
        '',
        '## Families',
        '',
        '| Family | Claim | Vanilla source | Fixtures |',
        '| --- | --- | --- | --- |',
        ...families.map(f => `| ${f.id} | ${f.claim} | ${f.source} | \`${f.cases}\` |`),
        '',
        '## Results',
        '',
        `| Release | ${families.map(f => f.id).join(' | ')} |`,
        `| --- | ${families.map(() => '---').join(' | ')} |`,
        ...releases.map(version => `| ${version} | ${families.map(f => mark(f, version)).join(' | ')} |`),
        '',
        '## Differences',
        '',
        ...(mismatches.length > 0 ? mismatches.map(([key, c]) => `- ${key}: ${c.firsts.join(', ')}`) : ['None among the compared recordings.']),
        ...(refused.length > 0 ? ['', '## Not replayed', '', ...refused.map(line => `- ${line}`)] : []),
        '',
    ];
    const text = lines.join('\n');
    if (!existsSync(values.out!) || readFileSync(values.out!, 'utf8') !== text) writeFileSync(values.out!, text);
    const tables = (JSON.parse(readFileSync(join(RECORDER_ROOT, '..', 'generated', 'fluid-tables.json'), 'utf8')) as { releases: Record<string, { source: string; sha256: string } | undefined> }).releases;
    const results = families.flatMap(family => releases.map(release => {
        const cell = cells.get(`${family.id} ${release}`);
        return {
            family: family.id, release, result: mark(family, release), cases: family.cases,
            source: tables[release]?.source ?? 'unverified', sourceSha256: tables[release]?.sha256 ?? null,
            recorderBuilds: [...(cell?.builds ?? [])].sort(), recorderCommits: [...(cell?.recorders ?? [])].sort(),
            ...(cell && cell.firsts.length > 0 ? { differing: cell.firsts } : {}),
        };
    }));
    writeFileSync(values.out!.replace(/\.md$/, '.json'), writeJson({ native: identity.native, checkout: identity.commit, dirty: identity.dirty, results }));
    process.exitCode = mismatches.length > 0 ? 1 : 0;
}

main();
