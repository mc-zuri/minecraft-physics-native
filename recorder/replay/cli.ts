// Replays recordings through the native engine and reports the first divergence of each.
//
//   node recorder/replay/cli.ts [--version 1.20.4] [--case "walk/*"] [--json report.json] [--all-ticks]
//   node recorder/replay/cli.ts --projectiles [--version 26.3] [--case "physrec/pj_*"]: each projectile's path and hits
//   node recorder/replay/cli.ts [--version 1.20.4] [--case "walk/*"] [--json report.json] [--all-ticks] [--moving] [--moving-client]
//
// --moving replays the moving entities (TNT, falling blocks, items, orbs) of the server's view too, which the physrec/me_*
// cases always do; --moving-client the client's view of them; --moving-only those and not the player.
//
// --adapter asks the adapter for the decisions the native layer seeds from vanilla (adapter.ts) instead; --clones forks the state
// through cloneState after every tick and goes on from the fork; with --motion
// what its whole tick left as well (the position, the motion, the ground, the fall, the jump counters); with --effects-only
// from the effects alone, no movement speed attribute synced.
//
// --bot runs a whole mineflayer bot on the recorded packets and holds what it writes to the client's, by name, order and bytes
// (bot.ts).
//
// --pinned replays only the recordings recorder/corpus/<release>.json pins.
//
// --continuous seeds each recording once and carries the engine's output forward (continuous.ts); its report says so, and a
// stepwise match is no continuous one. --phases compares the engine's trace with vanilla's phases as well (phases.ts).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { replayAdapter } from './adapter.ts';
import { idMatcher } from '../scenarios/build.ts';
import { describe } from './compare.ts';
import { describeProjectile, replayProjectiles } from './projectile.ts';
import { createRequire } from 'node:module';
import { replayBot } from './bot.ts';
import { replayBotCarts } from './bot-carts.ts';
import { nativeBinding, replayNative, type ReplayResult } from './engine.ts';
import { replayMovingEntities } from './moving-entities.ts';
import { loadRecording } from './load.ts';
import { validateRecording } from './validate.ts';
import { writeJson } from '../schema/json.ts';
import { findRecordings, knownFailures, recordingsRoot, RECORDER_ROOT } from './recordings.ts';
import { describeTally, emptyTally, tallyFails, verdict } from './verdict.ts';
import { replayIdentity } from '../runner/provenance.ts';

const require = createRequire(import.meta.url);
const { MinecartTracker, NativeMinecartPhysics } = require('../../dist/index.js') as typeof import('../../dist/index.js');
const registryFor = (version: string) => (require('prismarine-registry') as (v: string) => ConstructorParameters<typeof NativeMinecartPhysics>[0])(version);

const { values } = parseArgs({
    options: {
        version: { type: 'string' },
        case: { type: 'string' },
        json: { type: 'string' },
        'all-ticks': { type: 'boolean', default: false },
        projectiles: { type: 'boolean', default: false },
        moving: { type: 'boolean', default: false },
        'moving-client': { type: 'boolean', default: false },
        'moving-only': { type: 'boolean', default: false },
        adapter: { type: 'boolean', default: false },
        motion: { type: 'boolean', default: false },
        clones: { type: 'boolean', default: false },
        'effects-only': { type: 'boolean', default: false },
        'bot-carts': { type: 'boolean', default: false },
        bot: { type: 'boolean', default: false },
        'bot-keep-last-sent': { type: 'boolean', default: false },
        'bot-forget-rider-collision': { type: 'boolean', default: false },
        continuous: { type: 'boolean', default: false },
        phases: { type: 'boolean', default: false },
        pinned: { type: 'boolean', default: false },
    },
});

const matches = idMatcher(values.case);
// (--pinned: only the recordings recorder/corpus/<release>.json pins, as the release matrix replays them; a release with no
// manifest has none)
const pinnedIds = (version: string): Set<string> => {
    const manifest = join(RECORDER_ROOT, 'corpus', `${version}.json`);
    return new Set(existsSync(manifest) ? (JSON.parse(readFileSync(manifest, 'utf8')) as { entries: { id: string }[] }).entries.map(e => e.id) : []);
};
const pins = new Map<string, Set<string>>();
const pinned = (version: string, id: string) => {
    if (!pins.has(version)) pins.set(version, pinnedIds(version));
    return pins.get(version)!.has(id);
};
const files = findRecordings(recordingsRoot(), values.version ? values.version.split(',') : undefined)
    .filter(f => matches(f.id) && (!values.pinned || pinned(f.version, f.id)));
if (files.length === 0) {
    console.error(`no recordings match ${values.case ?? '*'}${values.version ? ` for ${values.version}` : ''} in ${recordingsRoot()}`);
    process.exit(1);
}
if (values.projectiles) {
    let bad = 0;
    let matching = 0;
    for (const f of files) {
        const recording = loadRecording(f.file);
        const key = `${f.version}/${f.id}`;
        const invalid = validateRecording(recording, f.version, f.id, true);
        if (invalid.length > 0) {
            bad += 1;
            console.log(`BAD   ${key}: ${invalid.slice(0, 3).join('; ')}`);
            continue;
        }
        const result = replayProjectiles(recording);
        if (result.compared === 0) {
            bad += 1;
            console.log(`none  ${key}: no projectile tick to compare`);
            continue;
        }
        const hits = result.hits.map(h => `t${h.t} #${h.target} ${h.reaction}`).join(', ');
        const blocks = result.blockHits.map(h => `t${h[0]} [${h[2]},${h[3]},${h[4]}] ${h[5]}`).join(', ')
            + result.playerHealth.map(h => ` t${h.t} health ${h.before}->${h.after}${h.reaction ? ` ${h.reaction}` : ''}${h.damage !== undefined ? ` (${h.damage})` : ''}`).join('');
        if (!result.first) {
            matching += 1;
            const stops = result.stopped.map(x => `#${x.projectile} stopped at its ${x.why}, t=${x.t}`).join(', ');
            console.log(`ok    ${key} (${result.projectiles} projectile(s), ${result.compared} ticks${hits ? `; ${hits}` : ''}${blocks ? `; ${blocks}` : ''}${stops ? `; ${stops}` : ''})`);
            continue;
        }
        bad += 1;
        console.log(`FAIL  ${key} ${result.divergences.length} divergence(s) in ${result.compared} ticks; first: ${describeProjectile(result.first)}`);
        if (values['all-ticks']) for (const d of result.divergences) console.log(`        ${describeProjectile(d)}`);
    }
    console.log(`${files.length} recording(s), ${matching} matching, ${bad} unexpected`);
    if (values.json) writeFileSync(values.json, writeJson({ replay: replayIdentity(RECORDER_ROOT), matching, unexpected: bad, recordings: files.length }));
    process.exit(bad > 0 ? 1 : 0);
}

if (values.adapter) {
    let unexpected = 0;
    let matching = 0;
    const notCompared: string[] = [];
    for (const f of files) {
        // (a WeakRef's target lives until the job ends: without a turn of the loop every recording's world stays)
        await new Promise(resolve => setImmediate(resolve));
        const recording = loadRecording(f.file);
        // (a recording that cannot be asked is not one that agrees)
        const invalid = validateRecording(recording, f.version, f.id, true);
        if (invalid.length > 0) {
            unexpected += 1;
            console.log(`BAD   ${f.version}/${f.id}: ${invalid.slice(0, 3).join('; ')}`);
            continue;
        }
        const result = replayAdapter(recording, undefined, values.motion, values['effects-only'], values.clones);
        if (!result.first) {
            if (result.compared > 0) matching += 1;
            else notCompared.push(f.id);
            continue;
        }
        unexpected += 1;
        console.log(`FAIL  ${f.version}/${f.id} ${result.divergences.length}/${result.compared} decisions diverge; first: ${describe(result.first)}`);
    }
    console.log(`${files.length} recording(s), ${matching} matching, ${notCompared.length} with no decision to compare, ${unexpected} unexpected`);
    if (values.json) writeFileSync(values.json, writeJson({ replay: replayIdentity(RECORDER_ROOT), matching, notCompared, unexpected, recordings: files.length }));
    process.exit(unexpected === 0 ? 0 : 1);
}

if (values['bot-carts']) {
    let bad = 0;
    let matching = 0;
    let none = 0;
    const failures: { key: string; divergences: number; compared: number; first: unknown }[] = [];
    for (const f of files) {
        const recording = loadRecording(f.file);
        const key = `${f.version}/${f.id}`;
        const physics = new NativeMinecartPhysics(registryFor(f.version));
        const result = replayBotCarts(recording, (source, improvements) => new MinecartTracker(physics, source, { improvements }));
        if (result.compared === 0) {
            none += 1;
            continue;
        }
        if (result.divergences.length === 0) {
            matching += 1;
            continue;
        }
        bad += 1;
        const first = result.divergences[0]!;
        failures.push({ key, divergences: result.divergences.length, compared: result.compared, first });
        console.log(`FAIL  ${key} ${result.divergences.length} divergence(s) in ${result.compared} ticks; first: t=${first.tick} ${first.field}: expected ${JSON.stringify(first.expected)} got ${JSON.stringify(first.actual)}`);
        if (values['all-ticks']) for (const d of result.divergences) console.log(`        t=${d.tick} ${d.field}: expected ${JSON.stringify(d.expected)} got ${JSON.stringify(d.actual)}`);
    }
    console.log(`${files.length} recording(s), ${matching} matching, ${none} with no ridden cart, ${bad} unexpected`);
    if (values.json) writeFileSync(values.json, writeJson({ replay: replayIdentity(RECORDER_ROOT), matching, none, unexpected: bad, recordings: files.length, failures }));
    process.exit(bad > 0 ? 1 : 0);
}
if (values.bot) {
    const tally = { matching: 0, unsupported: 0, hands: 0, different: 0, codec: 0 };
    const packets: Record<string, number> = {};
    const left: Record<string, number> = {};
    const outcomes: { key: string; outcome: string; detail: unknown }[] = [];
    for (const f of files) {
        await new Promise(resolve => setImmediate(resolve));
        const recording = loadRecording(f.file);
        const key = `${f.version}/${f.id}`;
        const invalid = validateRecording(recording, f.version, f.id, true);
        if (invalid.length > 0) {
            tally.different += 1;
            outcomes.push({ key, outcome: 'bad', detail: invalid[0] });
            console.log(`BAD   ${key}: ${invalid[0]}`);
            continue;
        }
        const result = await replayBot(recording, { keepLastSentOnTeleport: values['bot-keep-last-sent'], forgetRiderCollision: values['bot-forget-rider-collision'] });
        for (const [name, n] of Object.entries(result.packets)) packets[name] = (packets[name] ?? 0) + n;
        for (const [name, n] of Object.entries(result.notCompared)) left[name] = (left[name] ?? 0) + n;
        if (result.unsupported) {
            tally.unsupported += 1;
            outcomes.push({ key, outcome: 'unsupported', detail: result.unsupported });
            console.log(`none  ${key}: ${result.unsupported}`);
        } else if (result.first) {
            tally.different += 1;
            outcomes.push({ key, outcome: 'different', detail: { divergences: result.divergences.length, compared: result.compared, first: result.first } });
            console.log(`FAIL  ${key} ${result.divergences.length} of ${result.compared} ticks; first: ${JSON.stringify(result.first).slice(0, 260)}`);
        } else if (result.afterHands.length > 0) {
            tally.hands += 1;
            outcomes.push({ key, outcome: 'hands', detail: { at: result.handsAt, ticks: result.afterHands.length } });
            console.log(`hands ${key}: the client acted at t=${result.handsAt}, and ${result.afterHands.length} ticks differ from there; this layer does not drive what it did`);
        } else if (result.codec.length > 0) {
            tally.codec += 1;
            outcomes.push({ key, outcome: 'codec', detail: result.codec[0] });
            console.log(`codec ${key}: ${result.codec[0]}`);
        } else {
            tally.matching += 1;
        }
    }
    console.log(`packets compared ${JSON.stringify(packets)}; not compared ${JSON.stringify(left)}`);
    console.log(`${files.length} recording(s), bot: ${tally.matching} matching, ${tally.unsupported} unsupported, ${tally.hands} past the hands, ${tally.codec} codec, ${tally.different} different`);
    if (values.json) writeFileSync(values.json, writeJson({ replay: replayIdentity(RECORDER_ROOT), ...tally, recordings: files.length, packets, notCompared: left, outcomes }));
    process.exit(tally.different > 0 ? 1 : 0);
}

const known = knownFailures('native');
const report: (ReplayResult & { version: string; known?: string; recording: unknown })[] = [];
const tally = emptyTally();
for (const f of files) {
    // (a moving replay's worlds go by a WeakRef as well, which only a turn of the loop lets go)
    await new Promise(resolve => setImmediate(resolve));
    const recording = loadRecording(f.file);
    const key = `${f.version}/${f.id}`;
    // (a recording that is not what it says it is proves nothing, whatever it matches)
    const invalid = validateRecording(recording, f.version, f.id, true);
    if (invalid.length > 0) {
        tally.fail += 1;
        console.log(`BAD   ${key}: ${invalid.slice(0, 3).join('; ')}${invalid.length > 3 ? ` (+${invalid.length - 3})` : ''}`);
        continue;
    }
    for (const side of [...(values.moving || /^physrec\/me_/.test(f.id) ? ['server' as const] : []), ...(values['moving-client'] ? ['client' as const] : [])]) {
        const moved = replayMovingEntities(recording, nativeBinding(), side);
        const kinds = Object.entries(moved.kinds).map(([kind, n]) => `${kind} ${n}`).join(', ');
        const tag = moved.problems.length > 0 || moved.first ? 'FAIL ' : moved.compared === 0 ? 'none ' : 'ok   ';
        if (tag === 'FAIL ') tally.fail += 1;
        console.log(`${tag} ${key} [moving ${side}] ${moved.compared} entity ticks (${kinds}), ${moved.ended} ended, ${moved.gone} left to the server${moved.first ? `; ${moved.diverged} diverge; first: t=${moved.first.tick} ${moved.first.at} ${moved.first.field}: ${JSON.stringify(moved.first.expected)} != ${JSON.stringify(moved.first.actual)}` : ''}${moved.problems.length ? `; ${moved.problems[0]}` : ''}`);
    }
    // (--moving-only: the moving entities alone, the player's replay being another mode's)
    if (values['moving-only']) continue;
    // (a packet the codec cannot read fails this recording, not the run: the rest of the release still replays)
    let result: ReturnType<typeof replayNative>;
    try {
        result = replayNative(recording, { mode: values.continuous ? 'continuous' : 'stepwise', phases: values.phases });
    } catch (error) {
        tally.fail += 1;
        console.log(`BAD   ${key}: the replay stopped: ${String((error as Error).message).split(/\r?\n/)[0]}`);
        continue;
    }
    const expected = values.continuous ? undefined : known[key];
    // (what the recording was made with stands as it was: the report's own build is apart from it, below)
    report.push({ ...result, version: f.version, ...(expected ? { known: expected.reason } : {}), recording: recording.header.provenance ?? 'unrecorded' });
    const outcome = verdict(result, expected);
    tally[outcome] += 1;
    if (result.problems.length > 0) {
        console.log(`BAD   ${key}: ${result.problems.slice(0, 3).join('; ')}${result.problems.length > 3 ? ` (+${result.problems.length - 3})` : ''}`);
        continue;
    }
    if (result.compared === 0) {
        // nothing the native layer models: not a match, so not "ok"
        const why = result.unmodelled > 0 ? `${result.unmodelled} ridden ticks of a vehicle the engine does not model`
            : result.interpolated > 0 ? `${result.interpolated} ridden ticks of a vehicle the server drives` : result.elsewhere > 0 ? `${result.elsewhere} ticks in another dimension` : 'no player tick';
        console.log(`none  ${key}: not compared (${why})${expected ? '  <- listed as a known failure' : ''}`);
        continue;
    }
    if (!result.first) {
        console.log(`ok    ${key} (${result.compared} ticks${result.unmodelled ? `, ${result.unmodelled} ridden ticks of an unmodelled vehicle` : ''}${result.interpolated ? `, ${result.interpolated} ridden ticks the server drives` : ''})${expected ? '  <- known failure passes now: remove it' : ''}`);
        continue;
    }
    console.log(`${outcome === 'known' ? 'known' : 'FAIL '} ${key} ${result.diverged}/${result.compared} ticks diverge; first: ${describe(result.first)}`);
    if (result.continuous) {
        const { drift, corrections, reseeds } = result.continuous;
        console.log(`        drift: at the first ${drift.firstPosition.toExponential(3)}, at most ${drift.maxPosition.toExponential(3)} (motion ${drift.maxVelocity.toExponential(3)}), at the end ${drift.finalPosition.toExponential(3)}; ${corrections.length} correction(s), ${reseeds.length} seed(s)`);
    }
    if (values['all-ticks']) {
        for (const r of result.results) for (const d of r.divergences) console.log(`        ${describe(d)}`);
    }
}
console.log(`${files.length} recording(s), ${values.continuous ? 'continuous' : 'stepwise'}${values.phases ? ' with phases' : ''}, ${describeTally(tally)}`);
if (values.json) writeFileSync(values.json, writeJson({ replay: replayIdentity(RECORDER_ROOT), results: report }));
process.exitCode = tallyFails(tally) ? 1 : 0;
