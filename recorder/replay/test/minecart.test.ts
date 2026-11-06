// The cart layer's own checks: that it says so when a cart's side effects differ. Stubs stand in for the engine and a bot's
// tracker: each test gives the layer a wrong answer and wants to hear of it.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import type { ExpandedRow, Recording, ServerView } from '../../schema/recording.ts';
import { replayBotCarts } from '../bot-carts.ts';
import { cartHits, compareBlasts, compareCartTick, minecartRules } from '../minecart.ts';

const cart = (fields: object, minecart: object = {}) => ({
    id: 1, type: 'tnt_minecart', pos: [0, 0, 0], vel: [0, 0, 0], yRot: 0, xRot: 0, onGround: false, box: [0, 0, 0, 1, 1, 1], age: 3,
    ...fields,
    minecart: { flipped: false, inWater: false, horizontalCollision: false, verticalCollision: false, noGravity: false, stuckSpeedMultiplier: [0, 0, 0], fallDistance: 0, hurtTime: 0, hurtDir: 1, damage: 0, fuse: -1, randomSeed: 5, ...minecart },
});
const view = (...entities: object[]) => ({ pos: [9, 0, 9], vel: [0, 0, 0], entities }) as unknown as ServerView;
const row = (srv: ServerView, s2c: object[] = []) => ({ t: 4, srv, s2c }) as unknown as ExpandedRow;
const engine = (state: object, seen?: { carts?: unknown; items?: unknown }) => ({
    simulateVersionedMinecartScene(_version: string, _world: unknown, carts: unknown, _others: unknown, _rules: unknown, items: unknown) {
        if (seen) Object.assign(seen, { carts, items });
        return {
            carts: [{ state: { variant: 'tnt_minecart', position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yRot: 0, xRot: 0, flipped: false, onGround: false, inWater: false, fallDistance: 0, hurtTime: 0, hurtDir: 1, damage: 0, fuse: -1, ...state }, steps: [], primed: false, explosions: [], commandRan: false }],
            others: [], items: [], containers: [],
        };
    },
}) as never;
const compare = (native: never, after: ServerView) => compareCartTick(native, '1.20.4', {} as never, { improvements: false }, view(cart({})), row(after), 99, [], undefined);

describe('the cart layer', () => {
    it('agrees with what agrees', () => {
        assert.deepEqual(compare(engine({}), view(cart({}))).divergences, []);
    });

    it('hears of a cart the server kept and the engine lost, and the other way about', () => {
        assert.equal(compare(engine({ removed: 'exploded' }), view(cart({}))).divergences[0]!.field, 'tnt_minecart#0.removed');
        assert.equal(compare(engine({}), view()).divergences[0]!.field, 'tnt_minecart#0.removed');
        assert.deepEqual(compare(engine({ removed: 'exploded' }), view()).divergences, []);
    });

    for (const [field, minecart, state] of [
        ['fuse', { fuse: 7 }, { fuse: 8 }],
        ['hurtTime', { hurtTime: 10 }, { hurtTime: 9 }],
        ['hurtDir', { hurtDir: -1 }, { hurtDir: 1 }],
        ['damage', { damage: 50 }, { damage: 49 }],
        ['fallDistance', { fallDistance: 1.5 }, { fallDistance: 1 }],
        ['enabled', { enabled: false }, { enabled: true }],
        ['lastActivated', { lastActivated: 4 }, { lastActivated: 3 }],
        ['inventory', { inventory: [{ item: 'a', count: 2, maxStack: 64 }] }, { inventory: [{ item: 'a', count: 1, maxStack: 64 }] }],
    ] as const) {
        it(`hears of a different ${field}`, () => {
            const found = compare(engine(state), view(cart({}, minecart))).divergences;
            assert.deepEqual(found.map(d => d.field), [`tnt_minecart#0.${field}`]);
        });
    }

    it('gives the engine the cart\'s random and an item\'s stack', () => {
        const seen: { carts?: { randomSeed: number; fuse: number }[]; items?: { stack: { count: number } }[] } = {};
        const stack = { item: 'stone', count: 3, maxStack: 64 };
        compareCartTick(engine({}, seen), '1.20.4', {} as never, { improvements: false }, view(cart({}, { fuse: 9 }), { id: 2, type: 'item', pos: [0, 0, 0], vel: [0, 0, 0], box: [0, 0, 0, 1, 1, 1], itemStack: stack }), row(view(cart({}, { fuse: 9 }))), 99, [], undefined);
        assert.equal(seen.carts![0]!.randomSeed, 5);
        assert.equal(seen.carts![0]!.fuse, 9);
        assert.equal(seen.items![0]!.stack.count, 3);
    });

    it('says what a level tells its carts by the release', () => {
        const recording = (commands: string[], features: string[] = []) => ({ header: { features, setup: { commands } } }) as unknown as Recording;
        assert.equal(minecartRules(recording([]), '1.17').minY, 0);
        assert.equal(minecartRules(recording([]), '1.18').minY, -64);
        assert.equal(minecartRules(recording([]), '1.20.4').netherExit, false);
        assert.equal(minecartRules(recording([]), '1.13.2').netherExit, true);
        assert.equal(minecartRules(recording([]), '1.15.2').netherExit, false);
        assert.equal(minecartRules(recording([]), '26.3').netherExit, true);
        assert.equal(minecartRules(recording(['gamerule tntExplodes false']), '1.21.5').tntExplodes, false);
        assert.equal(minecartRules(recording(['gamerule minecartMaxSpeed 40'], ['minecart_improvements']), '1.21.2').maxMinecartSpeed, 40);
    });

    it('gives the engine a boat in the order of the level and from where it pushes', () => {
        const seen: { others?: { position: { x: number }; boat: boolean; hasPassengers: boolean; ticksAfter: number; tickPosition?: { x: number } }[] } = {};
        const native = {
            simulateVersionedMinecartScene(_version: string, _world: unknown, carts: unknown, others: never) {
                seen.others = others;
                return (engine({}) as unknown as { simulateVersionedMinecartScene(...args: unknown[]): unknown }).simulateVersionedMinecartScene('', {}, carts);
            },
        } as never;
        const boat = (id: number, x: number) => ({ id, type: 'oak_boat', pos: [x, 0, 0], vel: [0, 0, 0], box: [x - 1, 0, -1, x + 1, 1, 1], root: id });
        const cartAt = cart({ id: 5 });
        const after = { ...row(view(cartAt, boat(3, 1), boat(7, 11))), pre: { vehicle: { id: 7 } } } as unknown as ExpandedRow;
        compareCartTick(native, '1.20.4', {} as never, { improvements: false }, view(boat(3, 0), cartAt, boat(7, 10)), after, 99, [], undefined);
        const [ahead, ridden] = seen.others!;
        // (ahead of the cart, and it still has its tick's move to make)
        assert.deepEqual([ahead!.boat, ahead!.ticksAfter, ahead!.position.x, ahead!.tickPosition?.x, ahead!.hasPassengers], [true, 0, 0, 1, false]);
        // (behind it, where the client's packets put it before the level's tick)
        assert.deepEqual([ridden!.boat, ridden!.ticksAfter, ridden!.position.x, ridden!.tickPosition, ridden!.hasPassengers], [true, 1, 11, undefined, true]);
    });

    it('holds a player on foot where a teleport left it from 1.21.2, and not before', () => {
        const seen: { others?: { player?: boolean; tickPosition?: { x: number } }[] } = {};
        const native = {
            simulateVersionedMinecartScene(_version: string, _world: unknown, carts: unknown, others: never) {
                seen.others = others;
                return (engine({}) as unknown as { simulateVersionedMinecartScene(...args: unknown[]): unknown }).simulateVersionedMinecartScene('', {}, carts);
            },
        } as never;
        const moving = { ...view(cart({})), vel: [0.5, 0, 0] } as unknown as ServerView;
        const after = row(view(cart({})), [{ name: 'ClientboundPlayerPositionPacket' }]);
        compareCartTick(native, '1.21.1', {} as never, { improvements: false }, moving, after, 99, [], undefined);
        assert.equal(seen.others!.find(o => o.player)!.tickPosition!.x, 9.5);
        compareCartTick(native, '1.21.2', {} as never, { improvements: false }, moving, after, 99, [], undefined);
        assert.equal(seen.others!.find(o => o.player)!.tickPosition, undefined);
        compareCartTick(native, '1.21.2', {} as never, { improvements: false }, moving, row(view(cart({}))), 99, [], undefined);
        assert.equal(seen.others!.find(o => o.player)!.tickPosition!.x, 9.5);
    });

    it('wants an explosion packet for each blast', () => {
        const blasts = [{ tick: 4, power: 4, position: [0, 0, 0] as const }];
        assert.equal(compareBlasts('1.20.4', blasts, row(view(), []))[0]!.field, 'explosion');
        assert.deepEqual(compareBlasts('1.20.4', [], row(view(), [])), []);
    });
});

describe('a bot\'s cart against the client\'s', () => {
    const client = (x: number) => ({ id: 1, type: 'minecart', pos: [x, 0, 0], vel: [0, 0, 0], yRot: 0, xRot: 0, onGround: false, minecart: { hurtTime: 0, hurtDir: 1, damage: 0 } });
    const rows = (...xs: number[]) => xs.map((x, t) => ({ t, s2c: [], playerTicked: true, pre: { vehicle: client(xs[Math.max(0, t - 1)]!) }, post: { vehicle: client(x) } }));
    const recording = (...xs: number[]) => ({ header: { mc: '1.20.4' }, rows: rows(...xs) }) as unknown as Recording;
    const tracker = (moves: number) => () => {
        const carts = new Map<number, { position: { x: number; y: number; z: number }; yRot: number; xRot: number; onGround: boolean; effects: { hurtTime: number; damage: number; fuse: number }; hurtDir: number; lerp: null }>();
        return {
            carts,
            adopt(cart: { id: number; position: { x: number; y: number; z: number } }) {
                const made = { position: { ...cart.position }, yRot: 0, xRot: 0, onGround: false, effects: { hurtTime: 0, damage: 0, fuse: -1 }, hurtDir: 1, lerp: null };
                carts.set(cart.id, made);
                return made;
            },
            tick() {
                for (const cart of carts.values()) cart.position.x += moves;
            },
        } as never;
    };

    it('matches the cart that goes where the client\'s went', () => {
        const result = replayBotCarts(recording(0, 1, 2, 3), tracker(1));
        assert.equal(result.compared, 3);
        assert.deepEqual(result.divergences, []);
    });

    it('hears of one that does not', () => {
        const result = replayBotCarts(recording(0, 1, 2, 3), tracker(2));
        assert.equal(result.divergences[0]!.field, 'pos');
    });

    it('compares nothing of a recording with no cart', () => {
        const none = { header: { mc: '1.20.4' }, rows: [{ t: 0, s2c: [], playerTicked: true, pre: {}, post: {} }, { t: 1, s2c: [], playerTicked: true, pre: {}, post: {} }] } as unknown as Recording;
        assert.equal(replayBotCarts(none, tracker(1)).compared, 0);
    });

    it('feeds it from an emitter of the packets', () => {
        let source: EventEmitter | undefined;
        replayBotCarts(recording(0, 0), (emitter, improvements) => {
            source = emitter;
            assert.equal(improvements, false);
            return tracker(0)() as never;
        });
        assert.ok(source instanceof EventEmitter);
    });
});

describe('a player\'s hit', () => {
    const packet = (name: string, ...bytes: number[]) => ({ seq: 0, phase: 'betweenTicks', name, id: bytes[0]!, b: Buffer.from(bytes).toString('base64') });
    it('is read from the packet of its release, and only an attack is one', () => {
        const pre = { gameMode: 'survival' };
        assert.deepEqual(cartHits({ pre, c2s: [packet('ServerboundAttackPacket', 9, 0x96, 0x01)] } as never), [{ entity: 150, amount: 1, creative: false }]);
        assert.deepEqual(cartHits({ pre, c2s: [packet('ServerboundInteractPacket', 9, 5, 1, 0)] } as never), [{ entity: 5, amount: 1, creative: false }]);
        assert.deepEqual(cartHits({ pre, c2s: [packet('ServerboundInteractPacket', 9, 5, 0, 0)] } as never), []);
    });
});
