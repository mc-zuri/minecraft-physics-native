// The coverage matrix names cases the catalog has: a requirement cannot be answered by a case that does not exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from '../../scenarios/build.ts';
import { MATRIX } from '../matrix.ts';

test('every case the matrix names is in the catalog', async () => {
    const modules = await loadModules();
    const known = new Set(modules.flatMap(m => m.scenarios.map(s => s.id)));
    const missing = MATRIX.flatMap(row => row.cases.filter(id => !known.has(`physrec/${id}`)).map(id => `${row.ticket} ${row.requirement}: ${id}`));
    assert.deepEqual(missing, []);
});

test('every row says what it stands for and names a case', () => {
    for (const row of MATRIX) {
        assert.match(row.ticket, /^B\d+$/);
        assert.ok(row.requirement.length > 0);
        assert.ok(row.cases.length > 0 && row.cases.every(id => id.length > 0), row.requirement);
    }
    assert.ok(new Set(MATRIX.map(row => row.ticket)).size >= 6);
});
