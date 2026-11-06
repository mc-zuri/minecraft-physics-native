// Records the scenarios of one release with several clients at once (each a JVM with its own
// integrated server in lockstep, its own game directory and natives), then optionally records them
// again (--verify) and compares the two runs.
//
//   node recorder/runner/record.ts --version 1.20.4 [--shards 4] [--filter "walk/*"] [--out dir]
//                                  [--verify] [--no-build] [--render]
//
// Each client prints `@rec {...}` lines (common/Log.java): heartbeats, one result per scenario, a
// final done or fatal. A client that makes no progress for --watchdog seconds (its heartbeats say the same thing) is killed. A
// client that dies fails the scenario it was in, and a new one takes its remaining scenarios. The recordings land in <out>/<version>/<id>.jsonl.gz, and <out>/<version>/index.json
// lists every scenario's status and the build it was recorded with; <out>/<version>/builds/<id>.json holds that build.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { compareRuns } from './compare-runs.ts';
import { adapterChain, launchProblem, staleLaunch, type Launch } from './launch.ts';
import { failureLines } from './outcomes.ts';
import { buildManifest, identityChanges, type BuildManifest } from './provenance.ts';
import { overlapping, record, type RunOptions, type RunResult } from './session.ts';
import type { ScenarioIndex } from '../schema/scenario.ts';

const recorderRoot = fileURLToPath(new URL('../', import.meta.url));
const modRoot = join(recorderRoot, 'mod');

const { values } = parseArgs({
    options: {
        version: { type: 'string', default: '1.20.4' },
        shards: { type: 'string', default: '4' },
        // how long a client waits on the other side of the lockstep: a slow machine's light backlog can take minutes
        'lockstep-ms': { type: 'string', default: '60000' },
        // the repeat run in another order: what a case leaves behind for the next one shows as a difference
        shuffle: { type: 'boolean', default: false },
        filter: { type: 'string' },
        /** The experiments of the world (minecart_improvements): its cases, tagged feature:<name>, run in no other. */
        features: { type: 'string' },
        out: { type: 'string', default: join(recorderRoot, 'out', 'recordings') },
        verify: { type: 'boolean', default: false },
        'no-build': { type: 'boolean', default: false },
        render: { type: 'boolean', default: false },
        watchdog: { type: 'string', default: '120' },
    },
});

const version = values.version!;
const positive = (name: string, text: string | undefined): number => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive whole number, not ${text}`);
    return n;
};
const outRoot = resolve(values.out!);
// one working directory per release, remade by each run: the latest run's client logs and its verify copy, nothing older
const runsRoot = join(recorderRoot, 'runs', version);
const scenariosDir = join(recorderRoot, 'out', 'scenarios', version);
const launchFile = join(modRoot, 'mc', version, 'build', 'recorder-launch.json');
const manifestFile = join(modRoot, 'mc', version, 'build', 'recorder-identity.json');

const options: RunOptions = {
    version,
    shards: positive('shards', values.shards),
    watchdogSeconds: positive('watchdog', values.watchdog),
    lockstepMs: values['lockstep-ms']!,
    shuffle: values.shuffle!,
    render: values.render!,
    scenariosDir,
    runsRoot,
    ...(values.filter ? { filter: values.filter } : {}),
    ...(values.features ? { features: values.features } : {}),
};

function run(command: string, args: string[], cwd: string): void {
    // (only a .bat needs the shell on Windows; through it, a path with spaces such as node's would split)
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: command.endsWith('.bat') });
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
}

/**
 * The launch and the build it stands for. A build states its identity; --no-build asks that nothing has moved since, by
 * content, and that it was built here for this release, so that intended reuse and stale output cannot be mistaken.
 */
function prepare(): { launch: Launch; manifest: BuildManifest } {
    const build = !values['no-build'];
    if (build) {
        run(process.execPath, [join(recorderRoot, 'scenarios', 'build.ts'), '--versions', version], recorderRoot);
        run(join(modRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), [`:mc:${version}:recorderLaunch`, '--console=plain', '-q'], modRoot);
    }
    if (!existsSync(launchFile)) throw new Error(`${launchFile} is missing: run without --no-build`);
    const launch = JSON.parse(readFileSync(launchFile, 'utf8')) as Launch;
    const problem = launchProblem(launch, version)
        ?? (build ? null : staleLaunch(launchFile, [join(modRoot, 'common', 'src'), ...adapterChain(modRoot, version).map(dir => join(dir, 'src'))]));
    if (problem) throw new Error(`${launchFile}: ${problem}`);
    const manifest = buildManifest({ launch, recorderRoot, modRoot, scenariosDir });
    if (build) {
        writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
        return { launch, manifest };
    }
    if (!existsSync(manifestFile)) throw new Error(`${manifestFile} is missing: run without --no-build`);
    const changes = identityChanges((JSON.parse(readFileSync(manifestFile, 'utf8')) as BuildManifest).identity, manifest.identity);
    if (changes.length > 0) throw new Error(`${manifestFile}: ${changes.join(', ')} changed since the build: run without --no-build`);
    return { launch, manifest };
}

/** The identity for the clients to copy into each header, one line, and the whole manifest beside the run's index. */
function stateBuild(manifest: BuildManifest, out: string): RunOptions['provenance'] {
    const { id } = manifest.identity;
    const builds = join(out, version, 'builds');
    mkdirSync(builds, { recursive: true });
    writeFileSync(join(builds, `${id}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
    const file = join(runsRoot, 'provenance.json');
    writeFileSync(file, JSON.stringify(manifest.identity));
    return { file, id };
}

async function main(): Promise<void> {
    // the runs folder is emptied below and the second run writes into it: the recordings must not live there
    if (overlapping(outRoot, runsRoot)) throw new Error(`the output ${outRoot} overlaps the working folder ${runsRoot}`);
    const { launch, manifest } = prepare();
    // (its contents: a shell may be standing in the folder itself, and Windows would refuse to remove it)
    mkdirSync(runsRoot, { recursive: true });
    for (const entry of readdirSync(runsRoot)) rmSync(join(runsRoot, entry), { recursive: true, force: true });
    mkdirSync(runsRoot, { recursive: true });
    const out = outRoot;
    console.log(`build ${manifest.identity.id} (${manifest.identity.commit.slice(0, 10)}, ${manifest.identity.dirty}; ${manifest.identity.jdk.split(' | ')[0]})`);
    const first = await record({ ...options, provenance: stateBuild(manifest, out) }, launch, out, 'run');
    let failed = first.failed;
    const failures: Record<string, RunResult['failures']> = { run: first.failures };
    if (values.verify) {
        const second = join(runsRoot, 'verify');
        rmSync(second, { recursive: true, force: true });
        const again = await record({ ...options, provenance: stateBuild(manifest, second) }, launch, second, 'verify');
        failed ||= again.failed;
        failures.verify = again.failures;
        // what either run recorded, looked for on both sides: a case one run skipped is missing, whichever run it was
        const cmp = compareRuns(out, second, [...new Set([...first.ok, ...again.ok])].map(id => `${version}/${id}`));
        // scenarios whose server timing decides part of them: reported, not failed
        const index = JSON.parse(readFileSync(join(scenariosDir, 'index.json'), 'utf8')) as ScenarioIndex;
        const timed = new Map(index.scenarios.filter(s => s.serverTimed).map(s => [`${version}/${s.id}`, s.serverTimed!]));
        const different = cmp.different.filter(d => !timed.has(d.id));
        for (const d of cmp.different) {
            console.log(`${timed.has(d.id) ? 'server-timed' : 'NOT DETERMINISTIC'} ${d.id} (first difference at line ${d.line})`);
        }
        for (const m of cmp.missing) console.log(`verify missing ${m}`);
        console.log(`verify: ${cmp.same.length} identical, ${different.length} different, ${cmp.different.length - different.length} server-timed, ${cmp.missing.length} missing`);
        failed ||= different.length > 0 || cmp.missing.length > 0;
    }
    // (last, and by name: a scenario that failed in both runs is in neither the comparison nor its summary)
    for (const line of failureLines(version, failures)) console.log(line);
    process.exitCode = failed ? 1 : 0;
}

await main();
