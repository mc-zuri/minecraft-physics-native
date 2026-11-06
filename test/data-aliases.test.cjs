'use strict';

// B302, B029: six releases take the registry of the release whose data is theirs, on the evidence in data-aliases.json, and
// nothing else stops being refused.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const physics = require('..');
const { ALIASES } = require('../scripts/generate-data-aliases.cjs');
const record = require(path.join(__dirname, '..', 'src', 'mineflayer', 'data-aliases.json'));

const registryOf = require('prismarine-registry');
const minecraftData = require('minecraft-data');
const noBinding = (version) => ({ ...(version ? { version } : {}), get binding() { throw new Error('binding touched'); } });

describe('the data aliases', () => {
    it('are the releases minecraft-data has no table of their own for, each of its protocol', () => {
        assert.deepEqual(Object.keys(record.aliases).sort(), ['1.19.1', '1.21.10', '1.21.2', '1.21.7', '26.1.1', '26.1.2']);
        const protocols = require('minecraft-data/minecraft-data/data/pc/common/protocolVersions.json');
        const protocol = release => protocols.find(entry => entry.minecraftVersion === release).version;
        const manifest = require('../generated/release-manifest.json').releases;
        for (const [requested, alias] of Object.entries(record.aliases)) {
            assert.equal(manifest[requested].protocol, alias.protocol, requested);
            assert.equal(protocol(alias.data), alias.protocol, requested);
            assert.equal(minecraftData(alias.data).version.minecraftVersion, alias.data, requested);
        }
    });

    it('are what the replay and the scenarios use', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'recorder', 'scenarios', 'dsl', 'names.ts'), 'utf8');
        const table = /SAME_DATA[^=]*= (\{[^}]*\})/.exec(source)[1].replaceAll("'", '"');
        assert.deepEqual(JSON.parse(table), Object.fromEntries(Object.entries(record.aliases).map(([requested, { data }]) => [requested, data])));
    });

    it('rest on the vanilla data of both jars and a reviewed reason for every class', () => {
        for (const [requested, alias] of Object.entries(record.aliases)) {
            assert.ok(alias.vanillaDataFiles > 4000, requested);
            assert.match(alias.vanillaData, /^[0-9a-f]{64}$/, requested);
            assert.ok(alias.classes > 6000, requested);
            assert.deepEqual(Object.keys(alias.differing).sort(), Object.keys(ALIASES[requested].reviewed).sort(), requested);
            for (const reason of Object.values(alias.differing)) assert.ok(reason.length > 0, requested);
        }
    });

    it('take 26.1 for 26.1.1 and 26.1.2 only on the same 8594 files, with their different data versions kept', () => {
        const [one, two] = [record.aliases['26.1.1'], record.aliases['26.1.2']];
        assert.equal(one.vanillaData, two.vanillaData);
        assert.equal(one.vanillaDataFiles, 8594);
        assert.ok(!Object.keys(two.differing).some(name => /\.(world|core|tags)\./.test(name)), 'no game class but the listed server handler');
        assert.match(two.differing['net.minecraft.server.network.ServerGamePacketListenerImpl'], /handleAttack/);
        const manifest = require('../generated/release-manifest.json').releases;
        assert.deepEqual(['26.1', '26.1.1', '26.1.2'].map(release => manifest[release].dataVersion), [4786, 4788, 4790]);
        assert.equal(physics.createNativePhysics(registryOf('26.1'), { version: '26.1.2', binding: physics.LoadNativePhysics() }).version, '26.1.2');
    });

    it('serve the requested release, on the registry of its data alone', () => {
        for (const [requested, { data }] of Object.entries(record.aliases)) {
            assert.equal(physics.dataReleaseOf(requested), data);
            const engine = physics.createNativePhysics(registryOf(data), { version: requested, binding: physics.LoadNativePhysics() });
            assert.equal(engine.version, requested);
            engine.dispose();
            // without a selection the registry names its own release
            const own = physics.createNativePhysics(registryOf(data), { binding: physics.LoadNativePhysics() });
            assert.equal(own.version, data);
            own.dispose();
        }
    });

    it('refuse what is not the data', () => {
        // the registry minecraft-data gives by the name, which is another release's
        for (const requested of ['1.19.1', '1.21.2', '1.21.7']) {
            assert.throws(() => new physics.NativePhysics(registryOf(requested), noBinding(requested)), /cannot serve Minecraft|inconsistent/);
            assert.throws(() => new physics.NativePhysics(registryOf(requested), noBinding()), /inconsistent/);
        }
        // a neighbour's
        assert.throws(() => new physics.NativePhysics(registryOf('1.21.4'), noBinding('1.21.2')), /1\.21\.3, whose data it has/);
        assert.throws(() => new physics.NativePhysics(registryOf('1.21.6'), noBinding('1.21.7')), /cannot serve Minecraft 1\.21\.7/);
        // and it does not run backwards, nor to a release with no alias
        assert.throws(() => new physics.NativePhysics(registryOf('1.21.2'), noBinding('1.21.3')), /cannot serve Minecraft/);
        assert.throws(() => new physics.NativePhysics(registryOf('26.1'), noBinding('26.2')), /cannot serve Minecraft 26\.2/);
        assert.equal(physics.dataReleaseOf('26.2'), undefined);
        assert.equal(physics.dataReleaseOf('26.1'), undefined);
        assert.equal(physics.dataReleaseOf('toString'), undefined);
    });

    it('let a bot run its release on the data registry', () => {
        const bot = { version: '1.21.2', registry: registryOf('1.21.3'), on() {}, removeListener() {} };
        const setup = physics.createBotPhysics(bot, { binding: physics.LoadNativePhysics() });
        assert.equal(setup.physics.version, '1.21.2');
        setup.dispose();
        // and a bot of a release without one is still held to it
        assert.throws(() => physics.createBotPhysics({ version: '1.21.4', registry: registryOf('1.21.3'), on() {} }), /the bot runs 1\.21\.4/);
    });
});
