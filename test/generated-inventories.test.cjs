'use strict';

// B043: which vanilla declarations each collision primitive ports. B046: every decimal the engine and the adapter move
// things by, looked up in each release's sources. Both are reviewed tables held to the source: a new primitive or a
// constant nobody can place fails here.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { PRIMITIVES, nativePrimitives, declaredMethods } = require('../scripts/generate-primitive-map.cjs');
const { keysOf, trivial, moved, cited, usesOf } = require('../scripts/generate-movement-constants.cjs');
const { registeredReleases, compareReleases } = require('../scripts/registered-releases.cjs');

const root = path.resolve(__dirname, '..');
const generated = name => JSON.parse(fs.readFileSync(path.join(root, 'generated', name), 'utf8'));
const map = generated('primitive-map.json');
const inventory = generated('movement-constants.json');
const constants = Object.values(inventory.constants);

describe('the primitive map (B043)', () => {
    it('has an entry for every public function of the collision modules', () => {
        assert.deepEqual(nativePrimitives().filter(name => !PRIMITIVES[name]), []);
        assert.ok(nativePrimitives().length >= 29);
    });

    it('has no entry for a function that is gone', () => {
        assert.deepEqual(Object.keys(PRIMITIVES).filter(name => !nativePrimitives().includes(name)), []);
    });

    it('says why a function ports nothing, when it does not', () => {
        for (const [name, entry] of Object.entries(PRIMITIVES)) {
            if (!Array.isArray(entry)) assert.ok(entry.own.length > 10, name);
        }
    });

    it('finds each declaration it names in the source of some release', () => {
        assert.deepEqual(Object.entries(map.declarations).filter(([, row]) => row.eras.every(era => era.sha256 === null)).map(([name]) => name), []);
        for (const entry of Object.values(PRIMITIVES)) {
            if (Array.isArray(entry)) for (const reference of entry) assert.ok(map.declarations[reference], reference);
        }
    });

    it('covers the releases of Mojang\'s names and names the others', () => {
        assert.equal(map.mapped.length, 44);
        assert.deepEqual(map.yarnReleases, ['1.8.8', '1.9.4', '1.10.2', '1.11.2', '1.12.2', '1.13.2']);
        assert.deepEqual(map.unavailable, []);
    });

    it('shows where a declaration came and changed: BlockCollisions is 1.18\'s', () => {
        const blocks = map.declarations['BlockCollisions#computeNext'].eras;
        assert.equal(blocks[0].sha256, null);
        assert.equal(blocks[0].from, '1.14.4');
        assert.equal(blocks.find(era => era.sha256).from, '1.18');
        const merged = map.declarations['Entity#collideWithShapes'].eras;
        assert.equal(merged.find(era => era.sha256).from, '1.18');
    });

    it('follows helpers through the shape classes, and not into Entity', () => {
        const { helpers } = map.declarations['VoxelShape#optimize'];
        assert.ok(helpers.includes('Shapes#joinUnoptimized'), helpers.join());
        assert.ok(helpers.includes('VoxelShape#forAllBoxes'), helpers.join());
        for (const row of Object.values(map.declarations)) assert.ok(!row.helpers.some(helper => helper.startsWith('Entity#')));
    });

    it('reads a class\'s declared methods, not its calls', () => {
        const source = 'class A {\n   public double f(int a) {\n      return this.g(a);\n   }\n\n   private static void h() {\n   }\n}';
        assert.deepEqual([...declaredMethods(source)].sort(), ['f', 'h']);
    });
});

describe('the movement constants (B046)', () => {
    it('reads every release, and every module but the bindings and the tests', () => {
        assert.equal(inventory.releases, 50);
        assert.deepEqual(inventory.unavailable, []);
        assert.equal(moved('simulation.rs'), true);
        assert.equal(moved('trig.rs'), true);
        assert.equal(moved('napi_api.rs'), false);
        assert.equal(moved('oracle_tests.rs'), false);
        assert.equal(moved('lib.rs'), false);
    });

    it('accounts for each one, and none is left unplaced', () => {
        assert.equal(inventory.totals.unresolved ?? 0, 0);
        for (const row of constants) {
            assert.ok(['source', 'jdk', 'cited'].includes(row.status), String(row.value));
            assert.ok(row.files.length > 0, String(row.value));
        }
        assert.ok(constants.length >= 130);
    });

    it('says the release range and the Java type of a source constant', () => {
        for (const row of constants.filter(({ status }) => status === 'source')) {
            assert.ok(row.first && row.last && row.releases > 0, String(row.value));
            assert.ok(row.types.every(type => type === 'float' || type === 'double'), String(row.value));
            assert.ok(compareReleases(row.first, row.last) <= 0, String(row.value));
        }
    });

    it('holds each number to its release: a constant that came late or went is not called universal', () => {
        const held = value => constants.find(row => row.value === value);
        assert.equal(held(0.0325).first, '1.21.11');
        assert.equal(held(0.0325).last, '26.3');
        assert.equal(compareReleases(held(0.06153846016296973).last, '1.20.4'), 0);
    });

    it('keeps StrictMath apart: the JDK\'s numbers are no source of Minecraft\'s', () => {
        const jdk = constants.filter(({ status }) => status === 'jdk');
        assert.ok(jdk.length >= 3);
        for (const row of jdk) assert.deepEqual(row.files, ['native/trig.rs']);
    });

    it('holds legal zeros and thresholds of the movement tick', () => {
        for (const value of [0.91, 0.98, 0.08, 0.02, 0.003, 1.0E-7, 0.21600002, 0.6]) {
            const row = constants.find(entry => keysOf(entry.value).includes(String(value)) || keysOf(value).includes(String(entry.value)));
            assert.ok(row, String(value));
            assert.equal(row.status, 'source', String(value));
        }
    });

    it('leaves out what is no constant of anything, and reads a literal as it is written', () => {
        assert.equal(trivial(0.5), true);
        assert.equal(trivial(2), true);
        assert.equal(trivial(0.25), true);
        assert.equal(trivial(0.3), false);
        assert.deepEqual(keysOf(0.1), ['0.1', String(Math.fround(0.1))]);
    });

    it('does not read a version, a test or a string as a number', () => {
        const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mc-constants-'));
        fs.writeFileSync(path.join(directory, 'a.rs'), [
            '// 1.11.2 FireworkRocketEntity.java:113',
            'fn f() { let a = 0.98_f32; let v = "1.21.5"; g(1.0e-7); h(2.0); }',
            '#[cfg(test)]',
            'fn helper() {}',
            'fn g() { let b = 0.31; }',
            '#[cfg(test)]',
            'mod tests { fn t() { assert_eq!(0.77, 0.77); } }',
        ].join('\n'));
        const uses = usesOf(directory, ['a.rs'], true);
        assert.deepEqual([...uses.keys()].sort(), ['0.31', '0.98', '1e-7']);
        assert.equal(uses.get('0.98').cited, true);
    });

    it('calls a line cited by the source named above it', () => {
        assert.equal(cited(['// 26.3 Entity.java:12', 'let a = 0.3;'], 1), true);
        assert.equal(cited(['let b = 1;', 'let a = 0.3;'], 1), false);
    });
});

describe('releases', () => {
    it('are the registered ones', () => {
        assert.equal(registeredReleases().length, 50);
    });
});
