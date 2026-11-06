'use strict';

// B007, B018: every version gate of the shared native code is listed by function with its bounded interval, and is
// either backed by the source audit or marked unverified. A gate cannot move without this list changing.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { document, gatesOf, sharedGates } = require('../scripts/shared-gates.cjs');
const { canonicalReleases } = require('../scripts/release-inventory.cjs');
const { sharedFunctions } = require('../scripts/shared-functions.cjs');

const checkedIn = fs.readFileSync(path.join(__dirname, '..', 'generated', 'shared-gates.json'), 'utf8').replace(/\r\n/g, '\n');

describe('the shared gates', () => {
    const entries = sharedGates();

    it('are the list that is checked in', () => {
        assert.equal(checkedIn, document(entries));
    });

    it('give every gated function a bounded interval and a status', () => {
        assert.ok(entries.length > 100);
        for (const entry of entries) {
            assert.ok(entry.boundaries.length > 0, entry.function);
            assert.ok(['source-compared', 'unverified'].includes(entry.status), entry.function);
        }
    });

    it('cover the subsystems the ticket names', () => {
        const files = new Set(entries.map(entry => entry.file));
        for (const file of ['simulation.rs', 'collision.rs', 'vehicle.rs', 'projectile.rs']) assert.ok(files.has(file), file);
    });

    it('find a gate by its function, and leave out tests', () => {
        const gates = gatesOf([
            'pub(crate) fn outer(release: MinecraftVersion) {',
            '    if release.at_least(1, 21, 5) || release.at_least(1, 20, 0) {}',
            '}',
            '#[cfg(test)]',
            'mod tests {',
            '    fn inner() { release.at_least(1, 9, 0); }',
            '}',
        ].join('\n'));
        assert.deepEqual([...gates.keys()], ['outer']);
        assert.deepEqual([...gates.get('outer')], ['1.21.5', '1.20']);
    });

    it('takes only the test item after a #[cfg(test)], with real code after it', () => {
        const gates = gatesOf([
            '#[cfg(test)]',
            'fn helper(release: MinecraftVersion) {',
            '    release.at_least(1, 9, 0);',
            '}',
            '#[cfg(test)]',
            '#[path = "x_tests.rs"]',
            'mod x_tests;',
            'fn real(release: MinecraftVersion) {',
            '    release.at_least(1, 21, 5);',
            '}',
        ].join('\n'));
        assert.deepEqual([...gates.keys()], ['real']);
        const simulation = fs.readFileSync(path.join(__dirname, '..', 'native', 'src', 'simulation.rs'), 'utf8');
        assert.ok(gatesOf(simulation).has('attribute_landing_damage'));
    });

    it('call a boundary with no source finding unverified, read at its first registered release', () => {
        const registered = canonicalReleases();
        const entriesOf = audited => sharedGates(registered, new Set(audited));
        assert.ok(entriesOf([]).every(entry => entry.status === 'unverified'));
        assert.ok(entriesOf(registered).some(entry => entry.status === 'source-compared'));
    });
});

describe('the shared functions', () => {
    const entries = sharedFunctions();
    const named = name => entries.find(entry => entry.function === name);

    it('list every function outside the tests, the ungated too', () => {
        assert.ok(entries.length > 1000);
        assert.ok(entries.some(entry => entry.interval === 'every release'));
        assert.ok(!entries.some(entry => /tests\.rs$/.test(entry.file)));
    });

    it('give each an interval and a status, with the incomplete marker the default', () => {
        for (const entry of entries) {
            assert.ok(entry.interval === 'every release' || entry.interval.length > 0, entry.function);
            assert.ok(['entry', 'source-compared', 'unverified'].includes(entry.status), entry.function);
        }
        assert.equal(entries.filter(entry => entry.interval === 'every release').every(entry => entry.status !== 'source-compared'), true);
    });

    it('map callers and the families that reach a function from their entry points', () => {
        assert.ok(named('attribute_landing_damage').callers.includes('check_fall_damage'));
        assert.ok(named('attribute_landing_damage').families.includes('player'));
        assert.ok(named('simulate_versioned_boat_tick').families.includes('boat'));
        assert.ok(!named('simulate_versioned_boat_tick').families.includes('projectile'));
    });
});
