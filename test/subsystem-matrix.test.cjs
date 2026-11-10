'use strict';

// B016: the subsystem matrix is what its inputs say: the kept replay summary, the corpus, the scenario modules and the
// shared gates make generated/subsystem-matrix.json and docs/subsystem-matrix.md again, and nothing differing goes
// unexplained or unowned.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');

const root = path.resolve(__dirname, '..');
const matrix = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'subsystem-matrix.json'), 'utf8'));

describe('the subsystem matrix (B016)', () => {
    it('is made again from its inputs', () => {
        const run = spawnSync(process.execPath, [path.join(root, 'recorder', 'replay', 'subsystem-matrix.ts'), '--check'], { cwd: root, encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr || run.stdout);
    });

    it('classifies every family over every registered release, every scenario module in one family', () => {
        assert.deepEqual(matrix.families.map(({ id }) => id),
            ['travel', 'collision', 'effects', 'entity', 'vehicle', 'fluid', 'projectiles', 'attributes', 'poses', 'tick-order', 'prediction']);
        for (const family of matrix.families) {
            assert.ok(['verified', 'blocked', 'incomplete'].includes(family.status), family.id);
            assert.equal(Object.keys(family.releases).length, 50, family.id);
        }
        assert.deepEqual(matrix.unassignedModules, ['physrec/random']);
    });

    it('names every subsystem B281 and B289 require, each with a family of its own evidence (B289)', () => {
        const requested = ['entity/player', 'fluid', 'collision', 'vehicles', 'projectiles', 'effects', 'attributes', 'poses', 'tick ordering'];
        const rows = fs.readFileSync(path.join(root, 'docs', 'subsystem-matrix.md'), 'utf8').split(/\r?\n/);
        for (const subsystem of requested) assert.ok(rows.some((row) => row.startsWith(`| ${subsystem} | `) && !row.includes('missing')), subsystem);
        for (const family of matrix.families) {
            // a verified cell had cases of its own to compare
            for (const [release, cell] of Object.entries(family.releases)) assert.ok(cell.status !== 'verified' || cell.cases > 0, `${family.id} ${release}`);
            // a family an open source finding touches is not called verified (B281)
            if (family.findings.length) assert.notEqual(family.status, 'verified', family.id);
        }
    });

    it('lists the fishing hook\'s bite as excluded beside the families it touches, documented in the limitations (B289)', () => {
        for (const id of ['entity', 'projectiles']) assert.match(matrix.families.find((f) => f.id === id).excluded.join(' '), /fishing hook's bite/, id);
        assert.match(fs.readFileSync(path.join(root, 'docs', 'limitations.md'), 'utf8'), /^## Excluded on purpose\r?$[\s\S]*The fishing hook's bite/m);
    });

    it('leaves no difference unexplained, and calls nothing verified that differs or did not replay', () => {
        assert.deepEqual(matrix.unexplained, []);
        for (const family of matrix.families) {
            for (const [release, cell] of Object.entries(family.releases)) {
                if (cell.status !== 'verified') continue;
                assert.deepEqual(cell.failed, {}, `${family.id} ${release}`);
                assert.deepEqual(cell.missing, {}, `${family.id} ${release}`);
                assert.ok(Object.values(cell.compared).some((n) => n > 0), `${family.id} ${release}`);
            }
            if (family.status === 'verified') assert.deepEqual(family.source.uncovered, [], family.id);
        }
    });
});
