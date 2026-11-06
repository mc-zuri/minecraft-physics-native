// What a client is started from: build/recorder-launch.json, which a --no-build run takes on trust unless it is checked.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Launch { version: string; java: string; workingDir: string; jvmArgs: string[]; classpath: string[]; mainClass: string; args: string[] }

/** Why a client cannot start from this launch for this release, before any capture, or null. */
export function launchProblem(launch: Launch, version: string): string | null {
    if (launch.version !== version) return `the launch is for ${launch.version}, this run for ${version}`;
    if (!existsSync(launch.java)) return `no java at ${launch.java}`;
    if (launch.classpath.length === 0) return 'the launch has no classpath';
    const missing = launch.classpath.filter(entry => !existsSync(entry));
    return missing.length > 0 ? `${missing.length} of the classpath's entries are gone, the first ${missing[0]}` : null;
}

/** The adapters a release is built from, itself first: mc/<v>/base names the next (rec-mc-conventions' overlayChain). */
export function adapterChain(modRoot: string, version: string): string[] {
    const chain: string[] = [];
    for (let dir: string | undefined = join(modRoot, 'mc', version); dir !== undefined;) {
        if (chain.includes(dir)) throw new Error(`the adapters of ${version} go round at ${dir}`);
        chain.push(dir);
        const base: string = join(dir, 'base');
        dir = existsSync(base) ? join(modRoot, 'mc', readFileSync(base, 'utf8').split(/\r?\n/)[0]!.trim()) : undefined;
    }
    return chain;
}

/** The newest file under a directory, as its time and path. */
function newest(dir: string): { time: number; file: string } | null {
    let best: { time: number; file: string } | null = null;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        const found = entry.isDirectory() ? newest(path) : { time: statSync(path).mtimeMs, file: path };
        if (found && (!best || found.time > best.time)) best = found;
    }
    return best;
}

/**
 * A source of the mod changed since the launch was written: a --no-build run would record with the classes of before.
 * The roots that exist are looked through: the sources shared by all, and those of each adapter the release is made from.
 */
export function staleLaunch(launchFile: string, roots: readonly string[]): string | null {
    const written = statSync(launchFile).mtimeMs;
    for (const root of roots) {
        if (!existsSync(root)) continue;
        const found = newest(root);
        if (found && found.time > written) return `${found.file} is newer than the launch: run without --no-build`;
    }
    return null;
}
