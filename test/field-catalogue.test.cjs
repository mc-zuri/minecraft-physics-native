'use strict';

// B271: every exported field has an entry, and a new one fails until it does.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { FLAGS, OUTPUTS, OUTPUT_FLAGS, PACKED } = require('../scripts/state-bridge.cjs');
const { MAPPED, current, parse, render } = require('../scripts/field-catalogue.cjs');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const made = current();
const doc = read('docs/field-catalogue.md');

describe('the field catalogue', () => {
    it('is what the declarations and layouts say', () => {
        assert.equal(doc, render(made), 'docs/field-catalogue.md differs: node scripts/field-catalogue.cjs');
    });

    it('fails when a field is exported with no entry', () => {
        const added = parse(read('native/artifacts/native.d.ts').replace('export interface NativeSimulationConfig {', 'export interface NativeSimulationConfig {\n  brandNewField?: number'));
        assert.notEqual(render({ ...made, declarations: added }), doc);
    });

    it('gives every interface a contract', () => {
        for (const { name, members } of made.declarations.interfaces) {
            if (MAPPED[name]) {
                const page = read(`docs/${MAPPED[name]}`);
                for (const { name: field } of members) assert.ok(page.includes(`| \`${field}\``), `${name}.${field} in ${MAPPED[name]}`);
            } else {
                assert.ok(doc.includes(`### ${name}\n`), name);
                const section = doc.slice(doc.indexOf(`### ${name}\n`));
                const end = section.indexOf('\n### ', 5);
                const table = end === -1 ? section : section.slice(0, end);
                for (const { name: field } of members) assert.ok(table.includes(`| \`${field}\` |`), `${name}.${field}`);
            }
        }
    });

    it('keeps the hand-written interfaces of src/native.ts to the generated ones', () => {
        const hand = new Map(parse(read('src/native.ts')).interfaces.map(item => [item.name, item.members.map(member => member.name).sort()]));
        for (const { name, members } of made.declarations.interfaces) {
            assert.deepEqual(hand.get(name), members.map(member => member.name).sort(), name);
        }
    });

    it('holds every packed mapping to a name of the layout', () => {
        const { NativePlayerInput, NativePlayerInputFlag, NativePlayerOutput, NativePlayerOutputFlag } = made.layouts;
        for (const [table, layout] of [[PACKED, NativePlayerInput], [FLAGS, NativePlayerInputFlag], [OUTPUTS, NativePlayerOutput], [OUTPUT_FLAGS, NativePlayerOutputFlag]]) {
            for (const [field, name] of Object.entries(table)) assert.ok(name in layout, `${field}: ${name}`);
        }
    });
});
