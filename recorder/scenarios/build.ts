// Compiles every scenario module (scenarios/cases/**/*.ts, each `export default` a list of
// scenarios) for the requested releases into recorder/out/scenarios/<version>/: one
// <module>.json per module with the scenarios that release runs, and index.json with each
// scenario's hash and size and every skipped scenario with its reason.
//
//   node recorder/scenarios/build.ts --versions 1.20.4[,1.21.4] [--filter "walk/*"] [--out dir]

import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { CompiledScenario, ScenarioIndex } from '../schema/scenario.ts';
import { writeJson } from '../schema/json.ts';
import { compileScenario, type Scenario } from './dsl/index.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

export interface ScenarioModule { readonly name: string; readonly scenarios: readonly Scenario[] }

function files(dir: string): string[] {
    return readdirSync(dir).flatMap(entry => {
        const path = join(dir, entry);
        // (a directory or file whose name starts with _ holds helpers, not scenarios)
        if (entry.startsWith('_')) return [];
        if (statSync(path).isDirectory()) return files(path);
        return entry.endsWith('.ts') && !entry.startsWith('_') ? [path] : [];
    }).sort();
}

/** Every scenario module, in a stable order, with duplicate ids rejected. */
export async function loadModules(dir = join(here, 'cases')): Promise<ScenarioModule[]> {
    const modules: ScenarioModule[] = [];
    const seen = new Map<string, string>();
    for (const file of files(dir)) {
        const name = relative(dir, file).replace(/\.ts$/, '').split(sep).join('/');
        const exported = (await import(pathToFileURL(file).href) as { default?: unknown }).default;
        if (!Array.isArray(exported)) throw new Error(`${name}: export default a list of scenarios`);
        const scenarios = exported.flat(Infinity) as Scenario[];
        for (const s of scenarios) {
            if (s?.kind !== 'scenario') throw new Error(`${name}: exports something that is not a scenario`);
            const other = seen.get(s.id);
            if (other) throw new Error(`scenario ${s.id} is defined in ${other} and ${name}`);
            seen.set(s.id, name);
        }
        modules.push({ name, scenarios });
    }
    return modules;
}

/** A glob over scenario ids: `*` matches within a path segment, `**` across them. */
export function idMatcher(patterns: string | undefined): (id: string) => boolean {
    if (!patterns) return () => true;
    const regexes = patterns.split(',').map(p => p.trim()).filter(Boolean).map(p =>
        new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '.')}$`));
    return id => regexes.some(r => r.test(id));
}

export interface BuildResult { readonly version: string; readonly index: ScenarioIndex; readonly modules: Map<string, CompiledScenario[]> }

export function buildVersion(modules: readonly ScenarioModule[], version: string, filter?: string): BuildResult {
    const matches = idMatcher(filter);
    const compiled = new Map<string, CompiledScenario[]>();
    const entries: ScenarioIndex['scenarios'][number][] = [];
    const skipped: ScenarioIndex['skipped'][number][] = [];
    for (const module of modules) {
        const list: CompiledScenario[] = [];
        for (const s of module.scenarios) {
            if (!matches(s.id)) continue;
            const result = compileScenario(s, version);
            if (result.skip !== undefined) { skipped.push({ id: s.id, reason: result.skip }); continue; }
            const scenario = result.scenario!;
            list.push(scenario);
            entries.push({ id: scenario.id, hash: scenario.hash, file: `${module.name}.json`, maxTicks: scenario.maxTicks,
                ...(scenario.serverTimed ? { serverTimed: scenario.serverTimed } : {}),
                ...((scenario.tags ?? []).some(tag => tag.startsWith('feature:')) ? { needsFeature: true } : {}) });
        }
        if (list.length > 0) compiled.set(module.name, list);
    }
    return { version, modules: compiled, index: { schema: 1, version, scenarios: entries, skipped } };
}

export function writeVersion(result: BuildResult, outRoot: string): string {
    const dir = join(outRoot, result.version);
    rmSync(dir, { recursive: true, force: true });
    for (const [name, list] of result.modules) {
        const file = join(dir, `${name}.json`);
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, `${writeJson(list)}\n`);
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.json'), `${JSON.stringify(result.index, null, 2)}\n`);
    return dir;
}

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            versions: { type: 'string', default: '1.20.4' },
            filter: { type: 'string' },
            out: { type: 'string', default: join(here, '..', 'out', 'scenarios') },
        },
    });
    const modules = await loadModules();
    for (const version of values.versions!.split(',').map(v => v.trim()).filter(Boolean)) {
        const result = buildVersion(modules, version, values.filter);
        const dir = writeVersion(result, values.out!);
        console.log(`${version}: ${result.index.scenarios.length} scenarios, ${result.index.skipped.length} skipped -> ${dir}`);
        for (const s of result.index.skipped) console.log(`  skip ${s.id}: ${s.reason}`);
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
