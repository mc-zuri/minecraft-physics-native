// The capability table is read from the releases' own data and is the file checked in; a mechanic with no case stays visible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capabilityRows, capabilityTable, has, MECHANICS, RELEASES } from '../capabilities.ts';
import { overBudget } from '../profile-budget.ts';
import { RECORDER_ROOT } from '../recordings.ts';

const mechanic = (name: string) => MECHANICS.find(m => m.name === name)!;

test('fifty releases, in order', () => {
    assert.equal(RELEASES.length, 50);
    assert.equal(new Set(RELEASES).size, 50);
});

test('a mechanic is on a release by that release\'s data, not by a neighbour', () => {
    assert.equal(has(mechanic('slow_falling'), '1.12.2'), false);
    assert.equal(has(mechanic('slow_falling'), '1.13.2'), true);
    assert.equal(has(mechanic('swift_sneak'), '1.18.2'), false);
    assert.equal(has(mechanic('swift_sneak'), '1.19'), true);
    assert.equal(has(mechanic('camel'), '1.19.4') !== undefined, true);
    assert.equal(has(mechanic('camel'), '1.18.2'), false);
    assert.equal(has(mechanic('camel'), '1.20'), true);
});

test('the table is the one checked in, and a row with no case says so', async () => {
    const rows = await capabilityRows();
    assert.equal(readFileSync(join(RECORDER_ROOT, '..', 'docs', 'capability-table.md'), 'utf8').replace(/\r\n/g, '\n'), capabilityTable(rows));
    assert.equal(rows.length, MECHANICS.length);
    for (const row of rows) if (row.cases.length === 0) assert.match(capabilityTable([row]), /no case/);
});

test('every row says how it knows its release', async () => {
    for (const row of await capabilityRows()) {
        assert.ok(['data', 'source', 'no data'].includes(row.basis), row.mechanic.name);
        if (row.basis === 'source') assert.ok(RELEASES.includes(row.since as (typeof RELEASES)[number]), row.mechanic.name);
    }
});

test('a run within its budget passes, and over it each measure is named', () => {
    const budget = { allowance: { perRow: 0.5, peakRssMb: 0.25 }, sets: { small: { version: '26.3', case: 'x', measured: 'y', perRow: 2, peakRssMb: 400 } } };
    assert.deepEqual(overBudget(budget, 'small', { perRow: 3, peakRssMb: 500 }), []);
    assert.match(overBudget(budget, 'small', { perRow: 3.1, peakRssMb: 400 }).join(), /ms a row/);
    assert.match(overBudget(budget, 'small', { perRow: 1, peakRssMb: 501 }).join(), /MB/);
    assert.match(overBudget(budget, 'large', { perRow: 1, peakRssMb: 1 }).join(), /no set large/);
});
