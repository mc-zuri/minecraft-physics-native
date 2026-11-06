// What a recording was made from. The identity is content, not paths or times: the same inputs give the same id wherever
// they are installed. A commit cannot describe a checkout with changes in it, so `commit` and `dirty` describe the
// checkout and stay out of the id, which two builds of the same content share. Those two are the only fields left out of
// the id: jars are written without timestamps (rec-java-conventions), and a client's game directory, natives and
// -Drecorder.* properties are not inputs.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { adapterChain, type Launch } from './launch.ts';
import { mineflayerRequire } from '../replay/packets.ts';

/** A digest with every input named: the fields compare one at a time, so that a mismatch says what moved. */
export interface BuildIdentity {
    readonly id: string;
    readonly release: string;
    /** The JDK's own description (`java -version`). */
    readonly jdk: string;
    /** The game, loader, mappings and libraries on the classpath, each by file name and content. */
    readonly libraries: string;
    /** What this repository built: the classes, resources and common jar on the classpath. */
    readonly mod: string;
    /** The sources those were built from: the release's adapter chain, common, the Gradle build. */
    readonly sources: string;
    /** The main class, arguments and JVM flags, with the install's paths taken out. */
    readonly launch: string;
    readonly schema: string;
    /** The compiled index of the release (every scenario's hash), and the sources it was compiled from. */
    readonly scenarios: string;
    readonly scenarioSources: string;
    /** The packet codec and data the replay decodes with. */
    readonly codec: Readonly<Record<string, string>>;
    /** The commit, and a digest of the changes on top of it, or `clean`: the checkout, not part of the id. */
    readonly commit: string;
    readonly dirty: string;
}

/** The identity and each classpath entry, which goes beside a run's index and not into every recording. */
export interface BuildManifest { readonly identity: BuildIdentity; readonly classpath: readonly { readonly name: string; readonly sha256: string }[] }

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

function files(dir: string, under = dir): string[] {
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
        .flatMap(entry => (entry.isDirectory() ? files(join(dir, entry.name), under) : [relative(under, join(dir, entry.name))]));
}

/** A folder's content: its paths, relative, and their bytes. Nothing of its place or times. */
export function treeDigest(dir: string, keep: (file: string) => boolean = () => true): string {
    const hash = createHash('sha256');
    for (const file of files(dir).filter(keep)) hash.update(file.split(sep).join('/')).update('\0').update(readFileSync(join(dir, file))).update('\0');
    return hash.digest('hex');
}

export const pathDigest = (path: string) => (statSync(path).isDirectory() ? treeDigest(path) : sha256(readFileSync(path)));

/** The digest of many named digests. */
const combined = (entries: readonly (readonly [string, string])[]) => sha256(entries.map(([name, digest]) => `${name}\0${digest}`).join('\n'));

/** A launch argument with the install's roots taken out, so that a relocated install reads the same. */
function relocated(text: string, roots: readonly (readonly [string, string])[]): string {
    return roots.reduce((out, [root, name]) => out.split(root).join(name), text);
}

/** `java -version`, as the JDK says it. */
export function jdkIdentity(java: string): string {
    const result = spawnSync(java, ['-version'], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${java} -version failed: ${result.error?.message ?? result.status}`);
    return result.stderr.trim().split(/\r?\n/).join(' | ');
}

/** The commit of the checkout holding `dir` and a digest of what differs from it there, tracked or not. */
export function checkoutIdentity(dir: string): { commit: string; dirty: string } {
    const git = (...args: string[]) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });
    const head = git('rev-parse', 'HEAD');
    if (head.status !== 0) return { commit: 'unknown', dirty: 'unknown' };
    const changed = git('status', '--porcelain', '--no-renames', '-z', '--', '.').stdout.split('\0').filter(Boolean).sort();
    if (changed.length === 0) return { commit: head.stdout.trim(), dirty: 'clean' };
    const top = git('rev-parse', '--show-toplevel').stdout.trim();
    const entries = changed.map(line => {
        const file = join(top, line.slice(3));
        return [line, existsSync(file) && statSync(file).isFile() ? sha256(readFileSync(file)) : ''] as const;
    });
    return { commit: head.stdout.trim(), dirty: combined(entries).slice(0, 16) };
}

/** A package by version, and by commit where it is a checkout of its own: a corrected local checkout keeps its version. */
function packageIdentity(require: NodeRequire, name: string, nested: readonly string[] = []): string {
    // (a package's entry point is sure to resolve, and its package.json is above it)
    let dir = require.resolve(name);
    while (!existsSync(join(dir, 'package.json'))) dir = resolve(dir, '..');
    const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string };
    const real = realpathSync(dir);
    const top = spawnSync('git', ['-C', real, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();
    if (top === '' || realpathSync(top).toLowerCase() !== real.toLowerCase()) return version;
    const parts = [real, ...nested.map(sub => join(real, sub))].filter(existsSync).map(checkoutIdentity);
    return `${version} ${parts.map(({ commit, dirty }) => `${commit.slice(0, 12)}/${dirty}`).join(' ')}`;
}

/** The packet codec and data: `minecraft-protocol` as the bot loads it (replay/packets.ts). */
export function codecIdentity(from: string): Record<string, string> {
    const require = createRequire(join(from, 'package.json'));
    const fromMineflayer = (() => {
        try {
            require.resolve('minecraft-protocol');
            return require;
        } catch {
            return mineflayerRequire();
        }
    })();
    return { 'minecraft-data': packageIdentity(require, 'minecraft-data', ['minecraft-data']), 'minecraft-protocol': packageIdentity(fromMineflayer, 'minecraft-protocol') };
}

export interface IdentityInputs {
    readonly launch: Launch;
    /** recorder/. */
    readonly recorderRoot: string;
    /** recorder/mod. */
    readonly modRoot: string;
    /** The compiled scenarios of the release. */
    readonly scenariosDir: string;
    /** Set by a test: the JDK's description without asking one. */
    readonly jdk?: string;
}

export function buildManifest({ launch, recorderRoot, modRoot, scenariosDir, jdk }: IdentityInputs): BuildManifest {
    const inside = (path: string) => resolve(path).toLowerCase().startsWith(`${resolve(modRoot).toLowerCase()}${sep}`);
    const classpath = launch.classpath.map(entry => ({ path: entry, name: inside(entry) ? relative(modRoot, entry).split(sep).join('/') : basename(entry), sha256: pathDigest(entry) }));
    const roots: [string, string][] = [[resolve(modRoot), '<mod>'], [process.env.GRADLE_USER_HOME ?? join(homedir(), '.gradle'), '<gradle>']];
    const notRecorder = launch.jvmArgs.filter(a => !a.startsWith('-Drecorder.'));
    const sourceRoots = [join(modRoot, 'common', 'src'), ...adapterChain(modRoot, launch.version).map(dir => join(dir, 'src')), join(modRoot, 'buildSrc', 'src')].filter(existsSync);
    const buildFiles = ['build.gradle', 'settings.gradle', 'gradle.properties', join('buildSrc', 'build.gradle.kts'), join('gradle', 'verification-metadata.xml'), join('gradle', 'wrapper', 'gradle-wrapper.properties')]
        .map(file => join(modRoot, file)).filter(existsSync);
    const source = (dir: string) => treeDigest(dir, file => !file.startsWith(`test${sep}`));
    const content = {
        release: launch.version,
        jdk: jdk ?? jdkIdentity(launch.java),
        libraries: combined(classpath.filter(e => !inside(e.path)).map(e => [e.name, e.sha256])),
        mod: combined(classpath.filter(e => inside(e.path)).map(e => [e.name, e.sha256])),
        sources: combined([...sourceRoots, ...buildFiles].map(path => [relative(modRoot, path).split(sep).join('/'), pathDigest(path)])),
        // (JSON doubles a backslash, so a path is looked for as it reads there)
        launch: sha256(relocated(JSON.stringify([launch.mainClass, notRecorder, launch.args]), roots.map(([root, name]) => [root.replaceAll('\\', '\\\\'), name] as const))),
        schema: source(join(recorderRoot, 'schema')),
        scenarios: sha256(readFileSync(join(scenariosDir, 'index.json'))),
        scenarioSources: combined(['cases', 'dsl'].map(dir => [dir, source(join(recorderRoot, 'scenarios', dir))] as const)),
        codec: codecIdentity(recorderRoot),
    };
    return {
        identity: { id: sha256(JSON.stringify(content)).slice(0, 16), ...content, ...checkoutIdentity(recorderRoot) },
        classpath: classpath.map(({ name, sha256: digest }) => ({ name, sha256: digest })),
    };
}

/** What moved between a stored identity and the inputs as they are now: nothing, or each field by name. */
export function identityChanges(stored: BuildIdentity, current: BuildIdentity): string[] {
    if (stored.id === current.id) return [];
    const keys = (Object.keys(current) as (keyof BuildIdentity)[]).filter(key => key !== 'id' && key !== 'commit' && key !== 'dirty');
    const changed = keys.filter(key => JSON.stringify(stored[key]) !== JSON.stringify(current[key]));
    return changed.length > 0 ? changed : ['id'];
}

/** The replay's own build, which a report gives apart from what its recordings were made with. */
export function replayIdentity(recorderRoot: string): { native: Record<string, string>; codec: Record<string, string>; commit: string; dirty: string } {
    const artifacts = join(recorderRoot, '..', 'native', 'artifacts');
    const native = existsSync(artifacts) ? Object.fromEntries(readdirSync(artifacts).filter(name => name.endsWith('.node')).sort().map(name => [name, sha256(readFileSync(join(artifacts, name)))])) : {};
    return { native, codec: codecIdentity(recorderRoot), ...checkoutIdentity(recorderRoot) };
}
