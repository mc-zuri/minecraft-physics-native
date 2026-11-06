// The field registry accounts for every field of the native engine's state, in both of its
// declarations (the generated native.d.ts and the hand-written src/native.ts mirror), and every
// recorded field is either read by the native mapping or listed as recorded-only with a reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NATIVE_SIM, PLAYER_FIELDS, RECORDED_ONLY, nativeSources, type PlayerFieldKey } from '../fields.ts';
import { NATIVE_PHASES, PHASES, PLAYER_PHASES } from '../phases.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** The member names of `interface <name> { ... }` in a declaration file. */
export function interfaceMembers(source: string, name: string): Set<string> {
    const start = source.search(new RegExp(`export interface ${name}\\b`));
    assert.notEqual(start, -1, `interface ${name} not found`);
    const open = source.indexOf('{', start);
    let depth = 1;
    let end = open + 1;
    for (; end < source.length && depth > 0; end += 1) {
        if (source[end] === '{') depth += 1;
        else if (source[end] === '}') depth -= 1;
    }
    const body = source.slice(open + 1, end - 1).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    return new Set([...body.matchAll(/^\s*(\w+)\??\s*:/gm)].map(match => match[1]!));
}

const declarations = {
    'native/artifacts/native.d.ts': readFileSync(`${root}native/artifacts/native.d.ts`, 'utf8'),
    'src/native.ts': readFileSync(`${root}src/native.ts`, 'utf8'),
};

test('every NativeSimulationState field is mapped, derived, scene-fed or excluded', () => {
    const mapped = new Set(Object.keys(NATIVE_SIM));
    for (const [file, source] of Object.entries(declarations)) {
        const members = interfaceMembers(source, 'NativeSimulationState');
        const unmapped = [...members].filter(name => !mapped.has(name));
        assert.deepEqual(unmapped, [], `${file}: fields without an entry in NATIVE_SIM`);
        const stale = [...mapped].filter(name => !members.has(name));
        assert.deepEqual(stale, [], `${file}: NATIVE_SIM entries for fields it does not declare`);
    }
});

test('the generated and hand-written declarations agree', () => {
    const generated = interfaceMembers(declarations['native/artifacts/native.d.ts'], 'NativeSimulationState');
    const mirror = interfaceMembers(declarations['src/native.ts'], 'NativeSimulationState');
    assert.deepEqual([...mirror].sort(), [...generated].sort());
});

test('every recorded player field is read natively or recorded-only with a reason', () => {
    const read = nativeSources();
    const neither = (Object.keys(PLAYER_FIELDS) as PlayerFieldKey[]).filter(key => !read.has(key) && !RECORDED_ONLY[key]);
    assert.deepEqual(neither, []);
    const both = (Object.keys(RECORDED_ONLY) as PlayerFieldKey[]).filter(key => read.has(key));
    assert.deepEqual(both, [], 'listed as recorded-only but read by NATIVE_SIM');
    for (const key of read) assert.ok(key in PLAYER_FIELDS, `NATIVE_SIM reads an unknown field ${key}`);
});

test('phase specs are complete and the native subset keeps the order', () => {
    assert.deepEqual(Object.keys(PHASES).sort(), [...PLAYER_PHASES].sort());
    for (const name of PLAYER_PHASES) assert.equal(PHASES[name].name, name);
    let last = -1;
    for (const name of NATIVE_PHASES) {
        const index = PLAYER_PHASES.indexOf(name);
        assert.ok(index > last, `${name} out of order`);
        last = index;
        assert.ok(PHASES[name].native, `${name} is native-owned but names no Rust point`);
    }
});

test('every NativeBoatState and NativeHorseState field is mapped from the recorded vehicle or excluded', async () => {
    const { BOAT_SIM, HORSE_SIM } = await import('../fields.ts');
    for (const [name, map] of [['NativeBoatState', BOAT_SIM], ['NativeHorseState', HORSE_SIM]] as const) {
        for (const [file, source] of Object.entries(declarations)) {
            const members = interfaceMembers(source, name);
            assert.deepEqual([...members].filter(m => !(m in map)), [], `${file}: ${name} fields without an entry`);
            assert.deepEqual(Object.keys(map).filter(k => !members.has(k)), [], `${file}: entries for fields ${name} does not declare`);
        }
    }
});
