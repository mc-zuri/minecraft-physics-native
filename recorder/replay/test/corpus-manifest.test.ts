// The pinned corpus (recorder/corpus/<release>.json, conformance-cli.ts pin): each manifest is well formed, of its own
// release, and pins no recording of a scenario that has changed since (where the scenarios are compiled here). Whether the
// recordings themselves still have the pinned bytes is conformance-cli.ts check's, which needs the corpus.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RECORDER_ROOT } from '../recordings.ts';
import { manifestProblems, readManifest } from '../conformance.ts';

const dir = join(RECORDER_ROOT, 'corpus');
const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')) : [];

test('a corpus is pinned', { skip: files.length === 0 && process.env.CONFORMANCE !== 'strict' ? 'no recorder/corpus' : false }, () => {
    assert.ok(files.length > 0);
});

for (const file of files) {
    const version = file.replace(/\.json$/, '');
    test(`the pinned corpus of ${version}`, () => {
        const manifest = readManifest(join(dir, file))!;
        const index = join(RECORDER_ROOT, 'out', 'scenarios', version, 'index.json');
        const compiled = existsSync(index)
            ? new Map((JSON.parse(readFileSync(index, 'utf8')) as { scenarios: { id: string; hash: string }[] }).scenarios.map(s => [s.id, s.hash]))
            : undefined;
        assert.deepEqual(manifestProblems(manifest, version, compiled).slice(0, 10), []);
    });
}
