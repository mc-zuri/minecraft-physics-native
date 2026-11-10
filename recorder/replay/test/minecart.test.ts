// The cart layer's own checks: that it says so when a cart's side effects differ. Stubs stand in for the engine and a bot's
// tracker: each test gives the layer a wrong answer and wants to hear of it.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import type { ExpandedRow, Recording, ServerView } from '../../schema/recording.ts';
import { replayBotCarts } from '../bot-carts.ts';
import { cartHits, compareBlasts, compareCartTick, minecartRules } from '../minecart.ts';
import { codecsFor } from '../packets.ts';

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

    it('pushes from the player\'s place before its packet up to 1.8, from its box\'s middle before 1.17, and past no negligible velocity', () => {
        const seen: { others?: { player?: boolean; position: { x: number }; tickPosition?: { x: number; z: number } }[] } = {};
        const native = {
            simulateVersionedMinecartScene(_version: string, _world: unknown, carts: unknown, others: never) {
                seen.others = others;
                return (engine({}) as unknown as { simulateVersionedMinecartScene(...args: unknown[]): unknown }).simulateVersionedMinecartScene('', {}, carts);
            },
        } as never;
        const player = () => seen.others!.find(o => o.player)!;
        const x = 3.910011038874918;
        const half = Math.fround(0.6) / 2;
        const at = (pos: number, vel: number) => ({ ...view(cart({})), pos: [pos, 100, 0.5], vel: [vel, -0.0784, 0] }) as unknown as ServerView;
        const tick = (version: string, before: ServerView) => compareCartTick(native, version, {} as never, { improvements: false }, before, row(at(x, 0)), 99, [], undefined);
        // (1.8.8 ticks the player in its move packet, before it goes where the packet says)
        tick('1.8.8', at(2.5, 0));
        assert.equal(player().position.x, 2.5);
        tick('1.9.4', at(2.5, 0));
        assert.equal(player().position.x, x);
        // (a velocity under 0.003 on an axis travels nowhere, and before 1.14 the move takes the box's middle all the same)
        tick('1.12.2', at(2.5, -0.001197));
        assert.equal(player().tickPosition!.x, 3.9100110388749183);
        tick('1.14.4', at(2.5, -0.001197));
        assert.equal(player().tickPosition, undefined);
        tick('1.16', at(2.5, 0.1));
        assert.equal(player().tickPosition!.x, (x - half + 0.1 + (x + half + 0.1)) / 2);
        tick('1.17', at(2.5, 0.1));
        assert.equal(player().tickPosition!.x, x + 0.1);
        // (0.004 on an axis is negligible before 1.9, and from 1.21.5 a player's 0.002 and 0.0025 are not)
        tick('1.8.8', at(2.5, 0.004));
        assert.equal(player().tickPosition!.x, (2.5 - half + (2.5 + half)) / 2);
        const sideways = { ...at(2.5, 0.002), vel: [0.002, 0, 0.0025] } as unknown as ServerView;
        tick('1.21.4', sideways);
        assert.equal(player().tickPosition, undefined);
        tick('1.21.5', sideways);
        assert.deepEqual([player().tickPosition!.x, player().tickPosition!.z], [x + 0.002, 0.5 + 0.0025]);
    });

    it('wants an explosion packet for each blast', () => {
        const blasts = [{ tick: 4, power: 4, position: [0, 0, 0] as const }];
        assert.equal(compareBlasts('1.20.4', blasts, row(view(), []))[0]!.field, 'explosion');
        assert.deepEqual(compareBlasts('1.20.4', [], row(view(), [])), []);
    });

    // (a blast at x 0.5, y 10.2, z 0.5 whose weakest rays break its own block and the strongest one more beside it)
    const at = (x: number, y: number, z: number) => ({ x, y, z });
    const ranged = [{ tick: 4, power: 4, position: [0.5, 10.2, 0.5] as const, certain: [at(0, 10, 0)], possible: [at(0, 10, 0), at(1, 10, 0)] }];
    it('wants the blocks a packet lists between what the weakest and the strongest rays break, before 1.21.2', () => {
        const heard = (...blown: [number, number, number][]) => {
            const params = {
                x: 0.5, y: 10.2, z: 0.5, radius: 4, playerMotionX: 0, playerMotionY: 0, playerMotionZ: 0,
                affectedBlockOffsets: blown.map(([x, y, z]) => ({ x, y: y - 10, z })),
            };
            const b = codecsFor('1.8.8').toClient.createPacketBuffer({ name: 'explosion', params });
            return row(view(), [{ seq: 0, phase: 'betweenTicks', name: 'ClientboundExplodePacket', id: b[0], b: b.toString('base64') }]);
        };
        assert.deepEqual(compareBlasts('1.8.8', ranged, heard([0, 10, 0], [1, 10, 0])), []);
        assert.deepEqual(compareBlasts('1.8.8', ranged, heard([0, 10, 0])), []);
        assert.deepEqual(compareBlasts('1.8.8', ranged, heard([1, 10, 0])).map(d => d.field), ['explosion.blocks.missed']);
        assert.deepEqual(compareBlasts('1.8.8', ranged, heard([0, 10, 0], [2, 10, 0])).map(d => d.field), ['explosion.blocks.beyond']);
    });

    it('wants the blocks the server makes air in its next tick from 1.21.2, and what goes with them', () => {
        const b = codecsFor('1.21.5').toClient.createPacketBuffer({ name: 'explosion', params: { x: 0.5, y: 10.2, z: 0.5, explosionParticle: { type: 'explosion_emitter' }, sound: { soundId: 606 } } });
        const blast = row(view(), [{ seq: 0, phase: 'betweenTicks', name: 'ClientboundExplodePacket', id: b[0], b: b.toString('base64') }]);
        const next = (...made: [number, number, number][]) => ({ t: 5, s2c: [], blocks: made.map(([x, y, z]) => [x, y, z, 'air']) }) as unknown as ExpandedRow;
        const stone = (x: number, y: number, z: number) => (x === 0 && y === 10 && z === 0 ? 'stone' : 'air');
        assert.deepEqual(compareBlasts('1.21.5', ranged, blast, next([0, 10, 0]), stone), []);
        // (a rail that cannot stand pops when the one beside it goes, and the next with it)
        assert.deepEqual(compareBlasts('1.21.5', ranged, blast, next([0, 10, 0], [1, 10, 0], [2, 10, 0], [3, 10, 0]), stone), []);
        assert.deepEqual(compareBlasts('1.21.5', ranged, blast, next([0, 10, 0], [5, 10, 0]), stone).map(d => d.field), ['explosion.blocks.beyond']);
        assert.deepEqual(compareBlasts('1.21.5', ranged, blast, next(), stone).map(d => d.field), ['explosion.blocks.missed']);
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
    it('hears of a spawner delay, but not of one the level\'s random set', () => {
        const spawner = { spawner: { delay: 4, minDelay: 200, maxDelay: 800, range: 16 } };
        const native = (extra: object) => ({
            simulateVersionedMinecartScene(...args: unknown[]) {
                const scene = (engine({ spawnDelay: 5 }) as unknown as { simulateVersionedMinecartScene(...a: unknown[]): { carts: object[] } }).simulateVersionedMinecartScene(...args);
                return { ...scene, carts: scene.carts.map(tick => ({ ...tick, ...extra })) };
            },
        }) as never;
        assert.deepEqual(compare(native({}), view(cart({}, spawner))).divergences.map(d => d.field), ['tnt_minecart#0.spawnDelay']);
        assert.deepEqual(compare(native({ spawner: 'attempt' }), view(cart({}, spawner))).divergences, []);
    });

    it('gives the engine the container over a hopper and the gateways about the carts, and hears of what it left of them', () => {
        const seen: { containers?: { slots: { count: number }[] }[]; gateways?: { position: { x: number }; exit?: { x: number }; cooldown: number }[] } = {};
        const box = { pos: [2, 101, 3], slots: [{ item: 'stone', count: 3, maxStack: 64 }, null] };
        const gate = { pos: [14, 100, 3], exit: [24, 100, 3], cooldown: 0, age: 7 };
        const native = (left: object) => ({
            simulateVersionedMinecartScene(_v: string, _w: unknown, carts: unknown, _o: unknown, _r: unknown, _i: unknown, containers: never, gateways: never) {
                Object.assign(seen, { containers, gateways });
                return { ...(engine({}) as unknown as { simulateVersionedMinecartScene(...a: unknown[]): object }).simulateVersionedMinecartScene('', {}, carts), ...left };
            },
        }) as never;
        const before = view(cart({}, { container: box, gateways: [gate] }));
        const after = view(cart({}, { container: { ...box, slots: [{ item: 'stone', count: 2, maxStack: 64 }, null] }, gateways: [{ ...gate, cooldown: 39 }] }));
        const run = (left: object) => compareCartTick(native(left), '1.21.5', {} as never, { improvements: false }, before, row(after), 99, [], undefined).divergences.map(d => d.field);
        const containers = (count: number) => [{ x: 2, y: 101, z: 3, slots: [{ item: 'stone', count, maxStack: 64 }, { item: '', count: 0, maxStack: 64 }] }];
        const gateways = (cooldown: number, undecided = false) => [{ position: { x: 14, y: 100, z: 3 }, exit: { x: 24, y: 100, z: 3 }, cooldown, age: 8, undecided }];
        assert.deepEqual(run({ containers: containers(2), gateways: gateways(39) }), []);
        assert.deepEqual(seen.containers![0]!.slots.map(s => s.count), [3, 0]);
        assert.deepEqual([seen.gateways![0]!.position.x, seen.gateways![0]!.exit!.x, seen.gateways![0]!.cooldown], [14, 24, 0]);
        assert.deepEqual(run({ containers: containers(3), gateways: gateways(40) }), ['container@2,101,3.slots', 'gateway@14,100,3.cooldown']);
        assert.deepEqual(run({ containers: containers(2), gateways: gateways(39, true) }), ['gateway@14,100,3.undecided']);
    });

    it('gives the engine a container the cart came under in the tick, as it was before the hopper took from it', () => {
        const seen: { containers?: { x: number; slots: { count: number }[] }[] } = {};
        const native = {
            simulateVersionedMinecartScene(_v: string, _w: unknown, carts: unknown, _o: unknown, _r: unknown, _i: unknown, containers: never) {
                Object.assign(seen, { containers });
                return (engine({}) as unknown as { simulateVersionedMinecartScene(...a: unknown[]): object }).simulateVersionedMinecartScene('', {}, carts);
            },
        } as never;
        const stone = (count: number) => ({ item: 'stone', count, maxStack: 64 });
        const run = (slotsAfter: (object | null)[], inventoryBefore: (object | null)[], inventoryAfter: (object | null)[]) => {
            const before = view(cart({ type: 'hopper_minecart' }, { inventory: inventoryBefore }));
            const after = view(cart({ type: 'hopper_minecart' }, { inventory: inventoryAfter, container: { pos: [2, 101, 3], slots: slotsAfter } }));
            compareCartTick(native, '1.21.5', {} as never, { improvements: false }, before, row(after), 99, [], undefined);
            return seen.containers!.map(c => c.slots.map(s => s.count));
        };
        // (one stone went from its first slot into the cart)
        assert.deepEqual(run([stone(63), null], [null], [stone(1)]), [[64, 0]]);
        // (nothing went: as it is)
        assert.deepEqual(run([stone(63), null], [null], [null]), [[63, 0]]);
        // (its first slot is empty after: whether the stone came from there or the next is not told)
        assert.deepEqual(run([null, stone(5)], [null], [stone(1)]), []);
        // (the view before has it among the containers about the cart, as the mod records them: as it was)
        const before = view(cart({ type: 'hopper_minecart' }, { inventory: [null], containers: [{ pos: [3, 101, 3], slots: [stone(9)] }] }));
        compareCartTick(native, '1.21.5', {} as never, { improvements: false }, before, row(view(cart({ type: 'hopper_minecart' }, { inventory: [null] }))), 99, [], undefined);
        assert.deepEqual(seen.containers!.map(c => [c.x, c.slots.map(s => s.count)]), [[3, [9]]]);
    });

    it('gives the engine the teams of the view, as a removal in the tick\'s packets leaves them', () => {
        const seen: { others?: { team?: { name: string } }[]; carts?: { team?: { name: string } }[] } = {};
        const native = {
            simulateVersionedMinecartScene(_v: string, _w: unknown, carts: never, others: never) {
                Object.assign(seen, { carts, others });
                return (engine({}) as unknown as { simulateVersionedMinecartScene(...a: unknown[]): object }).simulateVersionedMinecartScene('', {}, carts);
            },
        } as never;
        const tn = { name: 'tn', collisionRule: 'never' };
        const before = view(cart({ team: tn }), { id: 7, type: 'iron_golem', pos: [1, 0, 0], vel: [0, 0, 0], box: [0, 0, 0, 1, 1, 1], team: tn });
        compareCartTick(native, '1.20.4', {} as never, { improvements: false }, before, row(view(cart({}))), 99, [], undefined);
        assert.deepEqual([seen.carts![0]!.team, seen.others![0]!.team], [tn, tn]);
        const b = codecsFor('1.20.4').toClient.createPacketBuffer({ name: 'teams', params: { team: 'tn', mode: 1 } });
        const removal = { seq: 0, phase: 'betweenTicks', name: 'ClientboundSetPlayerTeamPacket', id: b[0], b: b.toString('base64') };
        compareCartTick(native, '1.20.4', {} as never, { improvements: false }, before, row(view(cart({})), [removal]), 99, [], undefined);
        assert.deepEqual([seen.carts![0]!.team, seen.others![0]!.team], [undefined, undefined]);
    });

    it('reads the spawner game rule', () => {
        const recording = (commands: string[]) => ({ header: { features: [], setup: { commands } } }) as unknown as Recording;
        assert.equal(minecartRules(recording([]), '1.21.9').spawnerBlocksEnabled, true);
        assert.equal(minecartRules(recording(['gamerule spawnerBlocksEnabled false']), '1.21.9').spawnerBlocksEnabled, false);
        assert.equal(minecartRules(recording(['gamerule spawner_blocks_enabled false']), '26.3').spawnerBlocksEnabled, false);
    });
});
