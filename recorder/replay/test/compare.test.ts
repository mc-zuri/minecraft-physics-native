// What a determinism check must not call identical (and what it must).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { compareRuns } from '../../runner/compare-runs.ts';

function run(lines: readonly string[]): string {
    const root = mkdtempSync(join(tmpdir(), 'compare-'));
    mkdirSync(join(root, '1.20.4'));
    writeFileSync(join(root, '1.20.4', 'case.jsonl.gz'), gzipSync(`${lines.join('\n')}\n`));
    return root;
}

const header = '{"kind":"header","mc":"1.20.4"}';
const compared = (a: string, b: string) => compareRuns(run([header, a]), run([header, b]));

test('writes to one block in another order are different runs', () => {
    const result = compared('{"t":0,"blocks":[[0,0,0,"stone"],[0,0,0,"air"]]}', '{"t":0,"blocks":[[0,0,0,"air"],[0,0,0,"stone"]]}');
    assert.equal(result.different.length, 1);
});

test('writes to different blocks commute', () => {
    const result = compared('{"t":0,"blocks":[[0,0,0,"stone"],[1,0,0,"air"]]}', '{"t":0,"blocks":[[1,0,0,"air"],[0,0,0,"stone"]]}');
    assert.equal(result.different.length, 0);
});

test('negative zero is not zero', () => {
    const result = compared('{"t":0,"pre":{"vel":[-0.0,0.0,0.0]}}', '{"t":0,"pre":{"vel":[0.0,0.0,0.0]}}');
    assert.equal(result.different.length, 1);
});

test('a change a dropped packet carried is the same change without the packet', () => {
    const light = '{"name":"ClientboundLightUpdatePacket","b":"","after":{"keys":{"jump":false}}}';
    const result = compared(`{"t":0,"s2c":[${light}],"pre":{"pos":[0,0,0]}}`, '{"t":0,"pre":{"keys":{"jump":false},"pos":[0,0,0]}}');
    assert.equal(result.different.length, 0);
});
