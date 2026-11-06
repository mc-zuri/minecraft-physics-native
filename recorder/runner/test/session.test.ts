// A whole run against fake clients (fake-client.ts), real processes and files: every way a client or its output can fail
// must come out as a failed run with its own diagnostic, and only a client that did it all as a success.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { overlapping, record, selection, type RunOptions, type RunResult } from '../session.ts';
import type { Launch } from '../launch.ts';

const fake = fileURLToPath(new URL('./fake-client.ts', import.meta.url));
const launch: Launch = { version: '26.3', java: 'unused', workingDir: '.', jvmArgs: [], classpath: [], mainClass: 'Fake', args: [] };
const scenarios = [{ id: 'a/one', hash: 'h1', file: 'a.json', maxTicks: 10 }, { id: 'a/two', hash: 'h2', file: 'a.json', maxTicks: 10 }, { id: 'a/three', hash: 'h3', file: 'a.json', maxTicks: 10 }];

interface Run { result: RunResult; lines: string[]; index: { build?: string; scenarios: { id: string; hash: string; status: string; reason?: string; build?: string }[] } }

/** A run with the behaviour given; `before` prepares the output folder. */
async function run(behaviour: string, extra: Partial<RunOptions> & { on?: string; before?: (out: string) => void; after?: (out: string) => void; release?: string } = {}): Promise<Run> {
    const dir = mkdtempSync(join(tmpdir(), 'recorder run '));
    const { on, before, after, release, ...overrides } = extra;
    try {
        const scenariosDir = join(dir, 'scenarios');
        mkdirSync(scenariosDir);
        writeFileSync(join(scenariosDir, 'index.json'), JSON.stringify({ schema: 1, version: '26.3', scenarios, skipped: [{ id: 'a/gone', reason: 'outside' }] }));
        const out = join(dir, 'out');
        mkdirSync(join(out, '26.3'), { recursive: true });
        before?.(out);
        process.env.FAKE_CLIENT = behaviour;
        if (on) process.env.FAKE_CLIENT_ON = on;
        if (release) process.env.FAKE_CLIENT_RELEASE = release;
        const options: RunOptions = {
            version: '26.3', shards: 1, watchdogSeconds: 1, lockstepMs: '1000', scenariosDir, runsRoot: join(dir, 'runs'),
            command: (_, argFile) => [process.execPath, [fake, argFile]], ...overrides,
        };
        const lines: string[] = [];
        const log = console.log;
        console.log = (line: string) => void lines.push(line);
        try {
            const result = await record(options, launch, out, 'run');
            const index = JSON.parse(readFileSync(join(out, '26.3', 'index.json'), 'utf8')) as Run['index'];
            after?.(out);
            return { result, lines, index };
        } finally {
            console.log = log;
        }
    } finally {
        delete process.env.FAKE_CLIENT;
        delete process.env.FAKE_CLIENT_ON;
        delete process.env.FAKE_CLIENT_RELEASE;
        rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
}

const statuses = (r: Run) => Object.fromEntries(r.index.scenarios.map(s => [s.id, s.status]));
const said = (r: Run, pattern: RegExp) => assert.ok(r.lines.some(line => pattern.test(line)), `${pattern} in:\n${r.lines.join('\n')}`);

test('a client that does everything is a success', async () => {
    const r = await run('normal');
    assert.equal(r.result.failed, false);
    assert.deepEqual(statuses(r), { 'a/one': 'ok', 'a/three': 'ok', 'a/two': 'ok' });
});

test('a client that cannot start fails with why', async () => {
    const r = await run('normal', { command: () => [join(tmpdir(), 'no such client.exe'), []] });
    assert.equal(r.result.failed, true);
    said(r, /FAILED: the client did not start/);
    assert.deepEqual(statuses(r), { 'a/one': 'missing', 'a/three': 'missing', 'a/two': 'missing' });
});

test('a client that exits non-zero after its done fails the run', async () => {
    const r = await run('exit_after_done');
    assert.equal(r.result.failed, true);
    said(r, /FAILED: exited 5/);
});

test('a client that exits before its done fails the run, whatever it reported', async () => {
    const r = await run('exit_before_done');
    assert.equal(r.result.failed, true);
    said(r, /exited 4 before it finished/);
});

test('a client that dies in a case fails that case, and a new one takes the rest', async () => {
    const r = await run('exit_mid_case', { on: 'a/two' });
    assert.equal(r.result.failed, true);
    assert.deepEqual(statuses(r), { 'a/one': 'ok', 'a/three': 'ok', 'a/two': 'error' });
    assert.match(r.index.scenarios.find(s => s.id === 'a/two')!.reason!, /the client died in it: the client exited 3/);
});

test('a client that hangs is killed by the watchdog, which says so', async () => {
    const r = await run('hang_mid_case', { on: 'a/one' });
    assert.equal(r.result.failed, true);
    assert.equal(statuses(r)['a/one'], 'error');
    assert.match(r.index.scenarios.find(s => s.id === 'a/one')!.reason!, /no progress for 1 s/);
});

test('heartbeats that say the same thing are no progress', async () => {
    const r = await run('beat_forever');
    assert.equal(r.result.failed, true);
    said(r, /FAILED: no progress for 1 s/);
});

test('a line that cannot be read is fatal to the client', async () => {
    const r = await run('malformed', { on: 'a/one' });
    assert.equal(r.result.failed, true);
    said(r, /a malformed event/);
});

test('a scenario no client reports is missing, though the client says it is done', async () => {
    const r = await run('silent', { on: 'a/two' });
    assert.equal(r.result.failed, true);
    assert.equal(statuses(r)['a/two'], 'missing');
    said(r, /missing a\/two/);
});

test('a scenario that fails its own checks fails the run', async () => {
    const r = await run('invalid', { on: 'a/two' });
    assert.equal(r.result.failed, true);
    assert.equal(statuses(r)['a/two'], 'invalid');
});

test('two results, a wrong hash, an unknown status or a done with wrong counts fail though the totals look right', async () => {
    assert.match((await run('twice', { on: 'a/one' })).lines.join('\n'), /PROBLEM a\/one: 2 results/);
    assert.match((await run('wrong_hash', { on: 'a/one' })).lines.join('\n'), /PROBLEM a\/one: shard 0: its result has the hash another-hash/);
    assert.match((await run('unknown_status', { on: 'a/one' })).lines.join('\n'), /PROBLEM a\/one: shard 0: an unknown status great/);
    const counts = await run('wrong_counts');
    assert.equal(counts.result.failed, true);
    said(counts, /PROBLEM shard 0: done says ok 4, its results 3/);
});

test('a success without its recording, or with a cut or foreign one, is an error', async () => {
    const none = await run('no_recording', { on: 'a/one' });
    assert.equal(statuses(none)['a/one'], 'error');
    said(none, /no readable recording/);
    const cut = await run('no_footer', { on: 'a/one' });
    assert.equal(statuses(cut)['a/one'], 'error');
    said(cut, /no footer/);
    const other = await run('normal', { release: '1.20.4' });
    assert.equal(other.result.failed, true);
    said(other, /a recording of 1\.20\.4/);
});

test('a recording of another build is an error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'provenance '));
    try {
        const file = join(dir, 'provenance.json');
        writeFileSync(file, JSON.stringify({ id: 'this-build' }));
        const good = await run('normal', { provenance: { file, id: 'this-build' } });
        assert.equal(good.result.failed, false);
        assert.equal(good.index.build, 'this-build');
        assert.ok(good.index.scenarios.every(s => s.build === 'this-build'));
        const bad = await run('other_build', { provenance: { file, id: 'this-build' } });
        assert.equal(bad.result.failed, true);
        said(bad, /a recording of the build another, this run this-build/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a run removes the old recording of what it selects: failing to remake it leaves none', async () => {
    const stale = (out: string) => join(out, '26.3', 'a', 'one.jsonl.gz');
    const r = await run('exit_mid_case', {
        on: 'a/one',
        before: out => {
            mkdirSync(join(out, '26.3', 'a'), { recursive: true });
            writeFileSync(stale(out), gzipSync('{"kind":"header","schema":1,"mc":"26.3","scenario":{"id":"a/one","hash":"h1"}}\n{"kind":"footer","status":"ok"}'));
        },
        after: out => assert.equal(existsSync(stale(out)), false),
    });
    assert.equal(statuses(r)['a/one'], 'error');
});

test('a filtered run keeps the entries of the scenarios as compiled now, and no others', async () => {
    const earlier = JSON.stringify({
        scenarios: [
            { id: 'a/one', hash: 'h1', status: 'ok' }, { id: 'a/two', hash: 'an older hash', status: 'ok' },
            { id: 'a/removed', hash: 'hx', status: 'ok' }, { id: 'a/gone', hash: 'hg', status: 'skipped' },
        ],
    });
    const r = await run('normal', { filter: 'a/three', before: out => writeFileSync(join(out, '26.3', 'index.json'), earlier) });
    assert.equal(r.result.failed, false);
    assert.deepEqual(r.index.scenarios.map(s => s.id), ['a/gone', 'a/one', 'a/three']);
});

test('an earlier index that cannot be read fails the run, which still writes its own', async () => {
    const r = await run('normal', { filter: 'a/three', before: out => writeFileSync(join(out, '26.3', 'index.json'), '{ cut') });
    assert.equal(r.result.failed, true);
    said(r, /the earlier index cannot be read/);
    assert.deepEqual(r.index.scenarios.map(s => s.id), ['a/three']);
});

test('a relative output folder reaches the clients as an absolute one', async () => {
    // (the client's game directory is not the folder the run started in: a relative path would land there)
    const here = process.cwd();
    const scratch = mkdtempSync(join(tmpdir(), 'relative run '));
    try {
        process.chdir(scratch);
        const scenariosDir = join(scratch, 'scenarios');
        mkdirSync(scenariosDir);
        writeFileSync(join(scenariosDir, 'index.json'), JSON.stringify({ schema: 1, version: '26.3', scenarios, skipped: [] }));
        const log = console.log;
        console.log = () => {};
        try {
            const options: RunOptions = { version: '26.3', shards: 1, watchdogSeconds: 2, lockstepMs: '1000', scenariosDir, runsRoot: join(scratch, 'runs'), command: (_, argFile) => [process.execPath, [fake, argFile]] };
            const result = await record(options, launch, 'somewhere', 'run');
            assert.equal(result.failed, false);
        } finally {
            console.log = log;
        }
        assert.ok(existsSync(join(scratch, 'somewhere', '26.3', 'a', 'one.jsonl.gz')));
    } finally {
        process.chdir(here);
        rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
    }
});

test('a selection holds each scenario once and is not empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'selection '));
    try {
        const write = (list: unknown[]) => writeFileSync(join(dir, 'index.json'), JSON.stringify({ scenarios: list, skipped: [] }));
        write([...scenarios, scenarios[0]]);
        assert.throws(() => selection({ version: '26.3', scenariosDir: dir }), /holds a\/one more than once/);
        write(scenarios);
        assert.throws(() => selection({ version: '26.3', scenariosDir: dir, filter: 'b/*' }), /no scenario of 26\.3 matches b\/\*/);
        assert.equal(selection({ version: '26.3', scenariosDir: dir, filter: 'a/*' }).selected.length, 3);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the output may not be the working folder or hold it, or be held by it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlap '));
    try {
        assert.equal(overlapping(join(dir, 'runs', 'out'), join(dir, 'runs')), true);
        assert.equal(overlapping(join(dir, 'runs'), join(dir, 'runs', 'out')), true);
        assert.equal(overlapping(join(dir, 'out'), join(dir, 'runs')), false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
