// The determinism comparison on small recordings, in both directions: what one side lacks shows whichever side it is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { compareRuns } from '../compare-runs.ts';

const header = { kind: 'header', schema: 1, mc: '26.3', scenario: { id: 'a/one', hash: 'h' } };
const footer = { kind: 'footer', status: 'ok', rows: 2 };
const row = (t: number, extra: Record<string, unknown> = {}) => ({ t, pre: { pos: [0, 100, 0] }, in: { keys: [], yRot: 0, xRot: 0 }, post: { vel: [0, 0, 0] }, ...extra });

function write(root: string, id: string, lines: readonly unknown[]): void {
    const file = join(root, '26.3', `${id}.jsonl.gz`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, gzipSync(lines.map(line => JSON.stringify(line)).join('\n')));
}

function sides(run: (a: string, b: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'compare '));
    try {
        run(join(dir, 'a'), join(dir, 'b'));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const both = (x: readonly unknown[], y: readonly unknown[]) => {
    const out: ReturnType<typeof compareRuns>[] = [];
    sides((a, b) => {
        write(a, 'a/one', x);
        write(b, 'a/one', y);
        out.push(compareRuns(a, b), compareRuns(b, a));
    });
    return out;
};

const line = [header, row(0), row(1), footer];

test('two equal recordings are the same, whatever differs only by the clock', () => {
    const later = [header, row(0, { wallMs: 5 }), row(1, { wallMs: 6 }), footer];
    for (const r of both(line, later)) assert.deepEqual(r, { same: ['26.3/a/one'], different: [], missing: [] });
});

test('a build is not part of what is compared', () => {
    const built = [{ ...header, provenance: { id: 'b' } }, row(0), row(1), footer];
    for (const r of both(line, built)) assert.deepEqual(r.same, ['26.3/a/one']);
});

test('a recording one side lacks is missing, on either side', () => {
    sides((a, b) => {
        write(a, 'a/one', line);
        mkdirSync(join(b, '26.3'), { recursive: true });
        assert.deepEqual(compareRuns(a, b).missing, ['26.3/a/one (second side)']);
        assert.deepEqual(compareRuns(b, a).missing, ['26.3/a/one (first side)']);
        assert.deepEqual(compareRuns(a, b, ['26.3/a/two']).missing, ['26.3/a/two (first side)']);
    });
});

test('a row one side lacks differs, on either side', () => {
    for (const r of both(line, [header, row(0), footer])) {
        assert.equal(r.different.length, 1);
        assert.equal(r.different[0]!.line, 2);
    }
});

test('a row cut from the end of one side differs, on either side', () => {
    for (const r of both(line, [header, row(0), row(1)])) assert.equal(r.different.length, 1);
});

test('a field one side lacks differs, on either side', () => {
    for (const r of both(line, [header, row(0), row(1, { c2s: [{ seq: 1, phase: 'x', name: 'ServerboundPing', id: 1, b: 'AA==' }] }), footer])) {
        assert.equal(r.different.length, 1);
        assert.equal(r.different[0]!.line, 2);
    }
});

test('-0 and 0 differ, in rows the JSON would print alike', () => {
    const negative = JSON.parse('{"x":-0.0}') as { x: number };
    assert.ok(Object.is(negative.x, -0));
    const write0 = [header, row(0), row(1), footer].map(l => JSON.stringify(l));
    write0[2] = write0[2]!.replace('"vel":[0,0,0]', '"vel":[0,-0.0,0]');
    sides((a, b) => {
        const file = join(a, '26.3', 'a', 'one.jsonl.gz');
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, gzipSync(write0.join('\n')));
        write(b, 'a/one', line);
        for (const r of [compareRuns(a, b), compareRuns(b, a)]) assert.equal(r.different.length, 1);
    });
});

test('with nothing on either side, nothing is the same', () => {
    sides((a, b) => {
        mkdirSync(a);
        mkdirSync(b);
        assert.deepEqual(compareRuns(a, b), { same: [], different: [], missing: [] });
    });
});
