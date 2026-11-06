'use strict';

// Attributes against the jars: test/fixtures/attributes.tsv is what scripts/java-oracle/OracleAttributes.java read from
// each release's own registry and DefaultAttributes. docs/attributes.md has the consumers.

const assert = require('node:assert/strict');
const { it } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const adapter = require('..');

const rows = readFileSync(join(__dirname, 'fixtures/attributes.tsv'), 'utf8').trim().split(/\r?\n/).map((line) => {
    const [release, key, fallback, min, max, player, zombie] = line.split('\t');
    return { release, key, fallback: Number(fallback), min: Number(min), max: Number(max), player, zombie };
});
const releases = [...new Set(rows.map(row => row.release))];

/** The attribute names the adapter sends on, with the base a player has where none is synced, and the first release. */
const CONSUMED = {
    movementSpeed: ['movement_speed', 0.1, '1.16'],
    scale: ['scale', 1, '1.20.5'],
    gravity: ['gravity', 0.08, '1.20.5'],
    stepHeight: ['step_height', 0.6, '1.20.5'],
    jumpStrength: ['jump_strength', Math.fround(0.42), '1.20.5'],
    safeFallDistance: ['safe_fall_distance', 3, '1.20.5'],
    fallDamageMultiplier: ['fall_damage_multiplier', 1, '1.20.5'],
    burningTime: ['burning_time', 1, '1.21'],
    movementEfficiency: ['movement_efficiency', 0, '1.21'],
    waterMovementEfficiency: ['water_movement_efficiency', 0, '1.21'],
    sneakingSpeed: ['sneaking_speed', 0.3, '1.21'],
    airDragModifier: ['air_drag_modifier', 1, '26.2'],
    frictionModifier: ['friction_modifier', 1, '26.2'],
    bounciness: ['bounciness', 0, '26.2'],
};

const path = key => key.replace(/^minecraft:/, '').replace(/^(generic|player)\./, '');
const words = name => name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/\./g, '_');
const { aliases } = require('../src/mineflayer/data-aliases.json');
const dataOf = (version) => require('minecraft-data')(aliases[version]?.data ?? version);
const newer = (version, than) => {
    const parts = value => value.split('.').map(Number);
    const [a, b] = [parts(version), parts(than)];
    for (let i = 0; i < 3; i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
    return true;
};

it('holds every release it says, from the jars', () => {
    // (1.14 and 1.15 hold their attributes in SharedMonsterAttributes: their rows are not read from the jar yet)
    assert.equal(releases.length, 44, 'every jar from 1.14 to 26.3 with Mojang names');
    assert.ok(rows.length > 400);
});

it('minecraft-data has each attribute of the jar with its default and range', () => {
    const problems = [];
    for (const release of releases) {
        const data = dataOf(release);
        const known = new Map((data.attributesArray ?? []).map(entry => [path(entry.resource), entry]));
        for (const row of rows.filter(entry => entry.release === release)) {
            const key = path(row.key);
            const entry = known.get(key) ?? known.get(words(key));
            if (!entry) {
                problems.push(`${release} ${row.key}: absent`);
                continue;
            }
            for (const field of ['default', 'min', 'max']) {
                const want = field === 'default' ? row.fallback : row[field];
                if (Number.isFinite(want) && entry[field] !== want) problems.push(`${release} ${row.key} ${field}: data ${entry[field]} jar ${want}`);
            }
        }
    }
    // up to 1.20.6 the jars register 0.7F and 0.4F, widened; minecraft-data has the decimals. Nothing reads these two
    // defaults: a player's base is its own (below), so the difference moves nothing.
    const widened = /(flying_speed|movement_speed|flyingSpeed|movementSpeed) default: data (0\.4|0\.7) jar (0\.4000000059604645|0\.699999988079071)$/;
    assert.deepEqual(problems.filter(problem => !widened.test(problem)), []);
});

it('1.14 and 1.15 read their bases from each entity, as later releases do from a supplier', () => {
    for (const release of releases.filter(name => /^1\.1[45]/.test(name))) {
        const speed = rows.find(row => row.release === release && row.key === 'generic.movementSpeed');
        assert.equal(Number(speed.player), Math.fround(0.1), release);
        assert.equal(Number(speed.zombie), Math.fround(0.23), release);
    }
});

it('a generic default is not a player default: the adapter and engine take the entity base', () => {
    for (const row of rows.filter(entry => path(entry.key) === 'movement_speed')) {
        assert.equal(Math.fround(row.fallback), Math.fround(0.7), `${row.release}: registered`);
        assert.equal(Number(row.player), Math.fround(0.1), `${row.release}: Player`);
        assert.equal(Number(row.zombie), Math.fround(0.23), `${row.release}: Zombie`);
    }
});

it('each attribute the adapter forwards exists from its first release, with the base it falls back to', () => {
    for (const [name, [key, base, first]] of Object.entries(CONSUMED)) {
        for (const release of releases) {
            const row = rows.find(entry => entry.release === release && path(entry.key) === key);
            if (newer(release, first)) {
                assert.ok(row, `${release} has ${key}`);
                assert.ok(Math.abs(Number(row.player) - base) < 1e-6, `${release} ${key}: player ${row.player}, fallback ${base}`);
            } else {
                assert.equal(row, undefined, `${release} has no ${key} yet (${name})`);
            }
        }
    }
});

it('folds modifiers as AttributeInstance.calculateValue does, whatever order they came in', () => {
    const physics = new adapter.NativePhysics(require('prismarine-registry')('26.3'));
    const value = (base, ...modifiers) => physics.attributeValue('movementSpeed', {
        value: base,
        modifiers: modifiers.map(([amount, operation], index) => ({ id: `minecraft:test_${index}`, amount, operation })),
    });
    // 26.3 AttributeInstance.java:151-169: add, then add on the added base, then multiply the total
    assert.equal(value(0.1, [0.1, 0], [0.5, 1], [1, 2]), ((0.1 + 0.1) + (0.1 + 0.1) * 0.5) * 2);
    assert.equal(value(0.1, [1, 2], [0.5, 1], [0.1, 0]), value(0.1, [0.1, 0], [0.5, 1], [1, 2]));
    assert.equal(value(0.1), 0.1, 'no modifier');
    assert.equal(value(0, [0.5, 1]), 0, 'a legal zero is kept');
    assert.equal(value(0.1, [-1, 2]), 0, 'down to the range');
    assert.equal(value(0.1, [5000, 0]), 1024, 'up to the range');
    assert.equal(value(NaN), 0, 'NaN is the minimum');
    // replacing is a new packet: the old modifier is simply not there
    assert.equal(value(0.1, [0.2, 0]), 0.1 + 0.2);
    assert.equal(value(0.1), 0.1, 'and removing it brings the base back');
});

it('a compact state and a complete one stay apart: absent is the engine fallback, a value is taken as it is', () => {
    const physics = new adapter.NativePhysics(require('prismarine-registry')('26.3'));
    const base = { attributes: {}, effects: {}, speed: 0, slowness: 0, jumpBoost: 0, levitation: 0, slowFalling: 0, dolphinsGrace: 0 };
    assert.equal(physics.attributesAndEffects({ ...base }).jumpStrength, undefined);
    assert.equal(physics.attributesAndEffects({ ...base }).gravity, undefined);
    const zero = name => ({ [physics.attributeKey(name)]: { value: 0, modifiers: [] } });
    assert.strictEqual(physics.attributesAndEffects({ ...base, attributes: zero('jumpStrength') }).jumpStrength, 0);
    assert.strictEqual(physics.attributesAndEffects({ ...base, attributes: zero('gravity') }).gravity, 0);
    assert.strictEqual(physics.attributesAndEffects({ ...base, attributes: zero('stepHeight') }).stepHeight, 0);
});

it('the key of an attribute follows the registry of the release, and a release without it has none', () => {
    const key = (version, name) => new adapter.NativePhysics(require('prismarine-registry')(version)).attributeKey(name);
    assert.equal(key('1.15.2', 'movementSpeed'), 'generic.movementSpeed');
    assert.equal(key('1.16.5', 'movementSpeed'), 'minecraft:generic.movement_speed');
    assert.equal(key('1.20.4', 'movementSpeed'), 'minecraft:generic.movement_speed');
    assert.equal(key('1.21.11', 'movementSpeed'), 'minecraft:movement_speed');
    assert.equal(key('1.20.4', 'gravity'), null);
    assert.equal(key('1.21.11', 'airDragModifier'), null);
    assert.equal(key('26.3', 'airDragModifier'), 'minecraft:air_drag_modifier');
});
