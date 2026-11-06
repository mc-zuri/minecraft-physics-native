// The minecart engine through its N-API face and the mineflayer adapter: which path a level's features select, the state
// it gives back, the diagnostics of what it cannot run, and the client's interpolation, which reads no world.
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const adapter = require('../dist/index.js');

function worldOf(version, place) {
    const registry = require('prismarine-registry')(version);
    const Block = require('prismarine-block')(registry);
    const blocks = new Map();
    place({ registry, Block, set: (x, y, z, id) => blocks.set(`${x},${y},${z}`, id) });
    const air = registry.blocksByName.air.defaultState ?? 0;
    const stateAt = pos => blocks.get(`${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`) ?? air;
    const world = Object.assign(new EventEmitter(), {
        getBlock: pos => Block.fromStateId(stateAt(pos), 0),
        getBlockStateId: stateAt,
    });
    return { registry, world };
}

/** A straight east-west rail over stone, in the release's own terms. */
function track(version) {
    return worldOf(version, ({ registry, Block, set }) => {
        const flat = registry.version['>=']('1.13');
        const rail = flat ? Block.fromProperties('rail', { shape: 'east_west', waterlogged: false }, 0).stateId : (registry.blocksByName.rail.id << 4) | 1;
        const stone = registry.blocksByName.stone.defaultState ?? (registry.blocksByName.stone.id << 4);
        for (let x = -2; x < 30; x += 1) {
            set(x, 0, 0, rail);
            set(x, -1, 0, stone);
        }
    });
}

const cart = fields => ({
    variant: 'minecart', position: { x: 2.5, y: 0.0625, z: 0.5 }, velocity: { x: 0.1, y: 0, z: 0 }, yRot: 0, flipped: false,
    onGround: false, inWater: false, ...fields,
});

describe('NativeMinecartPhysics', () => {
    it('goes along a rail on the old path in every kind of release', () => {
        for (const version of ['1.8.8', '1.13.2', '1.20.4', '26.3']) {
            const { registry, world } = track(version);
            const physics = new adapter.NativeMinecartPhysics(registry);
            const { state } = physics.simulate(cart(), world, { improvements: false });
            assert.ok(Math.abs(state.position.x - 2.6) < 1e-9, version);
            assert.equal(state.onRails, true, version);
            assert.ok(state.velocity.x > 0.09 && state.velocity.x < 0.1, version);
        }
    });

    it('takes the improved path by the flag and not by the release', () => {
        const { registry, world } = track('1.21.4');
        const physics = new adapter.NativeMinecartPhysics(registry);
        const old = physics.simulate(cart(), world, { improvements: false });
        const improved = physics.simulate(cart({ position: { x: 2.5, y: 0.1, z: 0.5 }, onRails: true }), world, { improvements: true, maxMinecartSpeed: 8 });
        assert.equal(old.state.velocity.x, 0.1 * 0.96);
        assert.equal(old.steps.length, 0);
        assert.equal(improved.state.velocity.x, 0.1 * 0.975);
        assert.equal(improved.steps.length, 1);
    });

    it('says what it cannot run', () => {
        const { registry, world } = track('1.21.4');
        const physics = new adapter.NativeMinecartPhysics(registry);
        assert.throws(() => physics.simulate(cart(), world, { improvements: true }), /maxMinecartSpeed/);
        assert.throws(() => physics.simulate(cart({ variant: 'boat' }), world, { improvements: false }), /boat is no minecart/);
        assert.throws(() => physics.simulate(cart({ variant: 'furnace_minecart' }), world, { improvements: false }), /fuel and push/);
        assert.throws(() => physics.simulate(cart({ variant: 'chest_minecart' }), world, { improvements: false }), /comparatorSignal/);
        const older = track('1.20.4');
        const before = new adapter.NativeMinecartPhysics(older.registry);
        assert.throws(() => before.simulate(cart(), older.world, { improvements: true, maxMinecartSpeed: 8 }), /does not exist in 1\.20\.4/);
    });

    it('gives its state back to carry on from', () => {
        const { registry, world } = track('1.20.4');
        const physics = new adapter.NativeMinecartPhysics(registry);
        let state = cart({ variant: 'furnace_minecart', fuel: 5, push: { x: 1, y: 0, z: 0 } });
        for (let tick = 0; tick < 3; tick += 1) ({ state } = physics.simulate(state, world, { improvements: false }));
        assert.equal(state.variant, 'furnace_minecart');
        assert.equal(state.fuel, 2);
        assert.ok(state.position.x > 2.5);
    });

    it('interpolates a client cart with no world, by its release', () => {
        const registry = require('prismarine-registry')('1.20.4');
        const physics = new adapter.NativeMinecartPhysics(registry);
        let lerp = physics.lerpTo({ position: { x: 0, y: 0, z: 0 }, yRot: 0, xRot: 0 }, { x: 5, y: 0, z: 0 }, 0, 0);
        assert.equal(lerp.steps, 5);
        lerp = physics.interpolate(lerp);
        assert.equal(lerp.position.x, 1);
        assert.equal(new adapter.NativeMinecartPhysics(require('prismarine-registry')('26.3')).lerpTo(lerp, lerp.target, 0, 0).steps, 3);
    });

    it('takes the push of a boat at its turn in the level, from 1.9', () => {
        const boat = fields => ({
            position: { x: 1.15, y: 0.0625, z: 0.5 },
            boundingBox: { min: { x: 0.4625, y: 0.0625, z: -0.1875 }, max: { x: 1.8375, y: 0.625, z: 1.1875 } },
            pushable: true, solid: true, boat: true, hasPassengers: true, ...fields,
        });
        const still = cart({ velocity: { x: 0, y: 0, z: 0 } });
        const pushed = (version, fields) => {
            const { registry, world } = track(version);
            return new adapter.NativeMinecartPhysics(registry).simulateScene([still], [boat(fields)], world, { improvements: false }).carts[0].state;
        };
        for (const version of ['1.9.4', '1.20.4', '26.3']) {
            const after = pushed(version, {});
            assert.equal(after.position.x, 2.5, version);
            assert.ok(Math.abs(after.velocity.x - 0.05) < 1e-6, version);
            assert.ok(pushed(version, { ticksAfter: 0 }).position.x > 2.5, version);
        }
        assert.equal(pushed('1.8.8', {}).velocity.x, 0);
        assert.throws(() => pushed('1.20.4', { tickPosition: { x: 1, y: 0, z: 0 } }), /go together/);
    });

    it('walks a client cart through the steps the server sent', () => {
        const physics = new adapter.NativeMinecartPhysics(require('prismarine-registry')('26.3'));
        const origin = { x: 0, y: 0, z: 0 };
        const step = { position: { x: 3, y: 0, z: 0 }, movement: origin, yRot: 0, xRot: 0, weight: 3 };
        let client = { position: origin, velocity: origin, yRot: 0, xRot: 0, delay: 0, pending: [step], current: [], totalWeight: 0, old: { ...step, position: origin, weight: 0 } };
        client = physics.interpolateSteps(client);
        assert.ok(Math.abs(client.position.x - 1) < 1e-6);
        assert.equal(client.delay, 3);
        assert.equal(client.pending.length, 0);
    });
});
