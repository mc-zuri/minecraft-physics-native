// Stands in for a client in session.test.ts: it reads the same argument file and writes what the mod writes. What goes
// wrong is said by FAKE_CLIENT, one of the behaviours below, and the scenarios it applies to by FAKE_CLIENT_ON (all, if
// unset).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const argFile = process.argv[2]!;
const lines = readFileSync(argFile, 'utf8').split('\n').map(line => line.slice(1, -1).replaceAll('\\"', '"').replaceAll('\\\\', '\\'));
const prop = (name: string) => lines.find(line => line.startsWith(`-D${name}=`))?.slice(name.length + 3);

const behaviour = process.env.FAKE_CLIENT ?? 'normal';
const on = (id: string) => (process.env.FAKE_CLIENT_ON ?? id).split(',').includes(id);
const say = (event: Record<string, unknown>) => process.stdout.write(`@rec ${JSON.stringify(event)}\n`);

const shard = Number(prop('recorder.shard'));
const shards = Number(prop('recorder.shards'));
const out = prop('recorder.out')!;
const skip = new Set(readFileSync(prop('recorder.skip')!, 'utf8').split('\n').filter(Boolean));
const provenance = prop('recorder.provenance');
const index = JSON.parse(readFileSync(join(prop('recorder.scenarios')!, 'index.json'), 'utf8')) as { version: string; scenarios: { id: string; hash: string; file: string }[] };
const version = process.env.FAKE_CLIENT_RELEASE ?? index.version;

function write(id: string, hash: string, status: string): void {
    const header = { kind: 'header', schema: 1, mc: version, scenario: { id, hash }, ...(provenance ? { provenance: behaviour === 'other_build' ? { id: 'another' } : JSON.parse(readFileSync(provenance, 'utf8')) as unknown } : {}) };
    const footer = { kind: 'footer', status, rows: 0 };
    const body = behaviour === 'no_footer' && on(id) ? [header] : [header, footer];
    const file = join(out, `${id}.jsonl.gz`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, gzipSync(body.map(line => JSON.stringify(line)).join('\n')));
}

const hang = () => new Promise(() => setInterval(() => {}, 1000));

const counts = { ok: 0, invalid: 0, skipped: 0, errors: 0 };
const filter = prop('recorder.filter');
const mine = index.scenarios.filter(s => !filter || filter === s.id).filter((_, i) => i % shards === shard).filter(s => !skip.has(s.id));
for (const s of mine) {
    say({ e: 'start', id: s.id });
    if (on(s.id)) {
        if (behaviour === 'exit_mid_case') process.exit(3);
        if (behaviour === 'hang_mid_case') await hang();
        if (behaviour === 'malformed') process.stdout.write('@rec {not json\n');
        if (behaviour === 'silent') continue;
    }
    const hash = behaviour === 'wrong_hash' && on(s.id) ? 'another-hash' : s.hash;
    const status = behaviour === 'unknown_status' && on(s.id) ? 'great' : behaviour === 'invalid' && on(s.id) ? 'invalid' : 'ok';
    if (!(behaviour === 'no_recording' && on(s.id))) write(s.id, hash, status === 'great' ? 'ok' : status);
    say({ e: 'result', id: s.id, hash, status });
    if (status === 'ok') counts.ok += 1;
    else if (status === 'invalid') counts.invalid += 1;
    if (behaviour === 'twice' && on(s.id)) say({ e: 'result', id: s.id, hash, status });
}
if (behaviour === 'beat_forever') {
    setInterval(() => say({ e: 'heartbeat', stage: 'loading', index: 0 }), 100);
    await hang();
}
if (behaviour === 'exit_before_done') process.exit(4);
say({ e: 'done', ...counts, ...(behaviour === 'wrong_counts' ? { ok: counts.ok + 1 } : {}) });
process.exit(behaviour === 'exit_after_done' ? 5 : 0);
