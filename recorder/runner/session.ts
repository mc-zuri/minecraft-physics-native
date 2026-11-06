// One recording pass of one release: clients started, watched and restarted, what they said held to the selection, the
// run's index written. record.ts holds the command line; everything here takes its inputs, so that tests/ can drive it
// with a fake client.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Launch } from './launch.ts';
import { casesLeft, diedIn, failuresOf, mergedEntries, reconcile, recordingProblem, type IndexEntry, type RecEvent, type ScenarioFailure, type SelectedScenario } from './outcomes.ts';
import { idMatcher } from '../scenarios/build.ts';
import type { ScenarioIndex } from '../schema/scenario.ts';

export interface ShardOutcome { shard: number; results: RecEvent[]; started: string[]; done?: RecEvent; fatal?: string; exitCode: number | null; announcedExit?: number; seconds: number }

export interface RunOptions {
    readonly version: string;
    readonly shards: number;
    readonly watchdogSeconds: number;
    readonly lockstepMs: string;
    readonly shuffle?: boolean;
    readonly filter?: string;
    readonly features?: string;
    readonly render?: boolean;
    /** The compiled scenarios of the release, and its working folder (the clients' game directories). */
    readonly scenariosDir: string;
    readonly runsRoot: string;
    /** The file the clients copy into each header, and the id each recording must then carry. */
    readonly provenance?: { readonly file: string; readonly id: string };
    /** What starts a client from its argument file: java, unless a test says otherwise. */
    readonly command?: (launch: Launch, argFile: string) => readonly [string, readonly string[]];
}

/** How many new clients a shard gets: one that dies each case must not go on through a whole release. */
const MAX_RESTARTS = 5;

/**
 * Windows' fail-fast status (STATUS_STACK_BUFFER_OVERRUN), which Runtime.halt can end in from LWJGL's native teardown
 * (BridgeImpl.quit). It stands for the code the client announced just before halting, and for nothing else.
 */
const HALT_CRASH = 0xC0000409;
export const exitOf = (o: ShardOutcome) => (o.exitCode === HALT_CRASH && o.announcedExit !== undefined ? o.announcedExit : o.exitCode);

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function startShard(options: RunOptions, launch: Launch, shard: number, out: string, tag: string, attempt: number, finished: ReadonlySet<string>): Promise<ShardOutcome> {
    const { version, shards, runsRoot, watchdogSeconds } = options;
    const gameDir = join(runsRoot, `${tag}-shard${shard}${attempt === 0 ? '' : `-restart${attempt}`}`);
    const natives = join(gameDir, 'natives');
    mkdirSync(natives, { recursive: true });
    // (a release before 1.9 needs a server's resource pack folder to be there)
    mkdirSync(join(gameDir, 'server-resource-packs'), { recursive: true });
    // the recorder's options: no sound, small render distance, no tutorial or onboarding
    writeFileSync(join(gameDir, 'options.txt'), [
        'renderDistance:4', 'simulationDistance:5', 'soundCategory_master:0.0', 'pauseOnLostFocus:false', 'onboardAccessibility:false',
        'tutorialStep:none', 'enableVsync:false', 'maxFps:260', 'graphicsMode:0', 'autoJump:false', 'toggleCrouch:false', 'toggleSprint:false',
        'joinedFirstServer:true', 'skipMultiplayerWarning:true',
    ].join('\n'));
    const skipFile = join(gameDir, 'recorder.skip');
    writeFileSync(skipFile, [...finished].join('\n'));
    const props: Record<string, string> = {
        'recorder.skip': skipFile,
        'recorder.scenarios': options.scenariosDir,
        'recorder.out': join(out, version),
        'recorder.shard': String(shard),
        'recorder.shards': String(shards),
        'recorder.lockstep.timeoutMs': options.lockstepMs,
        ...(options.filter ? { 'recorder.filter': options.filter } : {}),
        ...(options.features ? { 'recorder.features': options.features } : {}),
        ...(tag === 'verify' && options.shuffle ? { 'recorder.shuffle': 'true' } : {}),
        ...(options.render ? { 'recorder.render': 'true' } : {}),
        ...(options.provenance ? { 'recorder.provenance': options.provenance.file } : {}),
    };
    const jvmArgs = launch.jvmArgs.filter(a => !a.startsWith('-Drecorder.'))
        .map(a => (a.startsWith('-Dorg.lwjgl.system.SharedLibraryExtractPath=') ? `-Dorg.lwjgl.system.SharedLibraryExtractPath=${natives}` : a))
        .concat(Object.entries(props).map(([k, v]) => `-D${k}=${v}`))
        // (Fields.randomSeed reads java.util.Random's seed, the random of an entity before 1.19)
        .concat('--add-opens=java.base/java.util=ALL-UNNAMED');
    const args = launch.args.slice();
    const at = args.indexOf('--gameDir');
    if (at >= 0) args[at + 1] = gameDir;
    else args.push('--gameDir', gameDir);
    const argFile = join(gameDir, 'recorder.args');
    const classpathSep = process.platform === 'win32' ? ';' : ':';
    writeFileSync(argFile, [...jvmArgs, '-cp', launch.classpath.join(classpathSep), launch.mainClass, ...args].map(quote).join('\n'));
    const log = createWriteStream(join(gameDir, 'client.log'));
    const started = Date.now();
    const outcome: ShardOutcome = { shard, results: [], started: [], exitCode: null, seconds: 0 };
    const [command, commandArgs] = options.command?.(launch, argFile) ?? [launch.java, [`@${argFile}`]];
    return new Promise(done => {
        const child = spawn(command, [...commandArgs], { cwd: gameDir, windowsHide: true });
        let lastEvent = Date.now();
        let lastBeat = '';
        let buffer = '';
        const watchdog = setInterval(() => {
            // (a client says nothing while it starts, which four at once can make slow)
            if (Date.now() - lastEvent > (lastBeat === '' ? 3 : 1) * watchdogSeconds * 1000) {
                outcome.fatal = `no progress for ${watchdogSeconds} s`;
                child.kill();
            }
        }, 1000);
        const onData = (chunk: Buffer) => {
            log.write(chunk);
            buffer += chunk.toString();
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const i = line.indexOf('@rec ');
                if (i < 0) continue;
                let event: RecEvent;
                try {
                    event = JSON.parse(line.slice(i + 5)) as RecEvent;
                } catch {
                    outcome.fatal = `a malformed event: ${line.slice(i, i + 200)}`;
                    continue;
                }
                // a heartbeat proves the client's render thread is alive, not that it gets anywhere (a mixin failing on a
                // netty thread leaves it "loading" for ever): only a change in what it reports counts
                const lockstep = event.lockstep as { rounds?: number; serverTaskSteps?: number } | undefined;
                const state = event.e === 'heartbeat' ? JSON.stringify([event.stage, event.index, lockstep?.rounds, lockstep?.serverTaskSteps]) : '';
                if (event.e !== 'heartbeat' || state !== lastBeat) lastEvent = Date.now();
                if (event.e === 'heartbeat') lastBeat = state;
                if (event.e === 'start') {
                    outcome.started.push(String(event.id));
                } else if (event.e === 'result') {
                    outcome.results.push(event);
                    if (event.status !== 'ok') console.log(`${tag}#${shard} ${String(event.status).padEnd(7)} ${event.id}: ${event.reason ?? ''}`);
                } else if (event.e === 'done') {
                    outcome.done = event;
                } else if (event.e === 'exit') {
                    outcome.announcedExit = Number(event.code);
                } else if (event.e === 'fatal') {
                    outcome.fatal = String(event.reason);
                }
            }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', (chunk: Buffer) => log.write(chunk));
        // (a client that never started has no close to wait for on every platform: this is its end too)
        let ended = false;
        const end = (code: number | null) => {
            if (ended) return;
            ended = true;
            clearInterval(watchdog);
            log.end();
            outcome.exitCode = code;
            outcome.seconds = (Date.now() - started) / 1000;
            done(outcome);
        };
        child.on('error', error => {
            outcome.fatal = `the client did not start: ${error.message}`;
            if (child.pid === undefined) end(null);
        });
        // close, not exit: the output is read to its end first
        child.on('close', end);
    });
}

/**
 * A shard's clients: when one dies, the scenario it was in has failed and a new client takes the ones after it, so that
 * one lockstep timeout does not lose them. What died still fails the run. A client that got through nothing ends this.
 */
async function runShard(options: RunOptions, launch: Launch, shard: number, out: string, tag: string, selected: readonly SelectedScenario[]): Promise<ShardOutcome[]> {
    const outcomes: ShardOutcome[] = [];
    const finished = new Set<string>();
    for (let attempt = 0; ; attempt++) {
        const outcome = await startShard(options, launch, shard, out, tag, attempt, finished);
        outcomes.push(outcome);
        const why = outcome.fatal ?? `the client exited ${outcome.exitCode}`;
        const died = outcome.done ? null : diedIn(selected, outcome, why);
        if (died) {
            console.log(`${tag}#${shard} error   ${died.id}: ${died.reason}`);
            outcome.results.push(died);
            rmSync(join(out, options.version, `${died.id}.jsonl.gz`), { force: true });
        }
        for (const result of outcome.results) finished.add(String(result.id));
        const left = casesLeft(selected, options.shards, shard, finished);
        if (outcome.done || left.length === 0 || outcome.results.length === 0) return outcomes;
        if (attempt === MAX_RESTARTS) {
            console.log(`${tag}#${shard} gives up on ${left.length} scenario(s) after ${MAX_RESTARTS} restarts`);
            return outcomes;
        }
        console.log(`${tag}#${shard} a new client for ${left.length} scenario(s): ${why}`);
    }
}

/** The compiled scenarios of the release, and those this run selects (the filter). */
export function selection(options: Pick<RunOptions, 'version' | 'scenariosDir' | 'filter' | 'features'>): { built: ScenarioIndex; selected: SelectedScenario[] } {
    const { version, scenariosDir, filter, features } = options;
    const built = JSON.parse(readFileSync(join(scenariosDir, 'index.json'), 'utf8')) as ScenarioIndex;
    const ids = built.scenarios.map(s => s.id);
    const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (twice.length > 0) throw new Error(`the compiled index of ${version} holds ${twice[0]} more than once`);
    const matches = idMatcher(filter);
    // (a case that needs an experiment runs in a world made with it, and such a world runs no other)
    const selected = built.scenarios.filter(s => Boolean(s.needsFeature) === Boolean(features) && matches(s.id));
    // (a filter that matches nothing is a mistake, not a run with nothing to do)
    if (selected.length === 0) throw new Error(`no scenario of ${version} matches ${filter ?? 'the selection'}`);
    return { built, selected };
}

export interface RunResult { readonly outcomes: ShardOutcome[]; readonly ok: string[]; readonly failures: ScenarioFailure[]; readonly failed: boolean }

export async function record(options: RunOptions, launch: Launch, outRoot: string, tag: string): Promise<RunResult> {
    const { version, shards, filter } = options;
    // (the clients run in their own game directories: a relative path would resolve against each of those)
    const out = resolve(outRoot);
    console.log(`${tag}: ${shards} client(s) for ${version} -> ${join(out, version)}`);
    const { built, selected } = selection(options);
    // a selected scenario's earlier recording goes first: a run that fails to remake it must not leave the old one
    for (const { id } of selected) rmSync(join(out, version, `${id}.jsonl.gz`), { force: true });
    const started = Date.now();
    const outcomes = (await Promise.all(Array.from({ length: shards }, (_, shard) => runShard(options, launch, shard, out, tag, selected)))).flat();
    const { results: reported, problems } = reconcile(selected, outcomes, shards);
    // a result of ok or invalid speaks of a recording: without that one finished, it is an error
    const results = reported.map((r, i): RecEvent => {
        if (r.status !== 'ok' && r.status !== 'invalid') return r;
        const problem = recordingProblem(join(out, version, `${r.id}.jsonl.gz`), version, selected[i]!, String(r.status), options.provenance?.id);
        if (problem === null) return r;
        problems.push(`${r.id}: ${problem}`);
        return { ...r, status: 'error', reason: problem };
    });
    const count = (status: string) => results.filter(r => r.status === status).length;
    const rounds = outcomes.reduce((n, o) => n + Number((o.done?.lockstep as { rounds?: number } | undefined)?.rounds ?? 0), 0);
    const seconds = (Date.now() - started) / 1000;
    const shardFailed = (o: ShardOutcome) => Boolean(o.fatal) || !o.done || exitOf(o) !== 0;
    for (const o of outcomes) {
        if (shardFailed(o)) console.log(`${tag}#${o.shard} FAILED: ${o.fatal ?? (o.done ? `exited ${exitOf(o)}` : `exited ${o.exitCode} before it finished`)}`);
    }
    mkdirSync(join(out, version), { recursive: true });
    // a filtered run updates its scenarios' entries and keeps the others', of the scenarios as they are compiled now
    const indexFile = join(out, version, 'index.json');
    const previous = filter && existsSync(indexFile) ? readFileSync(indexFile, 'utf8') : undefined;
    const entries: IndexEntry[] = results.map(r => ({ id: String(r.id), hash: String(r.hash), status: String(r.status), ...(r.reason ? { reason: String(r.reason) } : {}), ...(options.provenance ? { build: options.provenance.id } : {}) }));
    const merged = mergedEntries(previous, entries, built);
    problems.push(...merged.problems);
    for (const problem of problems) console.log(`${tag} PROBLEM ${problem}`);
    for (const r of results) if (r.status === 'missing') console.log(`${tag} missing ${r.id}`);
    console.log(`${tag}: ${results.length} scenario(s): ${count('ok')} ok, ${count('invalid')} invalid, ${count('skipped')} skipped, ${count('error')} error, ${count('missing')} missing`
        + ` in ${seconds.toFixed(1)} s (${rounds} ticks, ${(rounds / seconds).toFixed(0)} ticks/s = ${(rounds / seconds / 20).toFixed(1)}x real time over all clients)`);
    writeFileSync(indexFile, `${JSON.stringify({
        version, recordedAt: new Date().toISOString(), shards, ...(options.provenance ? { build: options.provenance.id } : {}),
        scenarios: merged.entries,
    }, null, 2)}\n`);
    if (!filter) {
        // a whole run leaves no recording of a scenario this release no longer compiles
        const compiled = new Set(built.scenarios.map(s => s.id));
        for (const file of readdirSync(join(out, version), { recursive: true }) as string[]) {
            if (!file.endsWith('.jsonl.gz')) continue;
            const id = file.replaceAll('\\', '/').slice(0, -'.jsonl.gz'.length);
            if (!compiled.has(id)) rmSync(join(out, version, file));
        }
    }
    // a scenario that errs, fails its own checks (invalid) or never reports fails the run; a skipped one does not
    const failures = failuresOf(results);
    const failed = problems.length > 0 || outcomes.some(shardFailed) || failures.length > 0;
    return { outcomes, ok: results.filter(r => r.status === 'ok').map(r => String(r.id)), failures, failed };
}

/** Whether one folder is the other or holds it, through links and junctions. */
export function overlapping(a: string, b: string): boolean {
    const [x, y] = [a, b].map(p => {
        mkdirSync(p, { recursive: true });
        return `${realpathSync(p).toLowerCase()}${sep}`;
    });
    return x!.startsWith(y!) || y!.startsWith(x!);
}
