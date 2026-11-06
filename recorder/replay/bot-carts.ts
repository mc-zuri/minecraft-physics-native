// The bot's side of a ridden cart: the recording's own packets, decoded with the codec the bot uses, through MinecartTracker
// and a tick a row, against the client's cart. A cart is the one thing a recording has of the client's own idea of an entity
// that follows the server: where the rider's vehicle is, what its interpolation is doing, what it has been told of its hurt.

import { EventEmitter } from 'node:events';

import type { MinecartTracker as Tracker, ClientMinecart } from '../../dist/mineflayer/minecarts.js';
import type { ExpandedRow, Recording, Snapshot } from '../schema/recording.ts';
import type { Divergence } from './compare.ts';
import { packetBytes } from './load.ts';
import { readClientbound } from './packets.ts';

type Vec = readonly [number, number, number];

interface RecordedVehicle {
    readonly id: number;
    readonly type: string;
    readonly pos: Vec;
    readonly vel: Vec;
    readonly yRot: number;
    readonly xRot: number;
    readonly onGround: boolean;
    readonly minecart?: {
        readonly hurtTime?: number;
        readonly hurtDir?: number;
        readonly damage?: number;
        readonly lerp?: { readonly steps: number; readonly target: Vec; readonly yRot: number; readonly xRot: number };
        readonly steps?: unknown;
    };
}

export interface BotCartResult {
    readonly compared: number;
    readonly divergences: readonly Divergence[];
}

const vehicleOf = (s: Snapshot | undefined) => s?.vehicle as RecordedVehicle | null | undefined;
const vec = (v: Vec) => ({ x: v[0], y: v[1], z: v[2] });
const same = (a: number, b: number) => a === b || (a === 0 && b === 0);

/**
 * `tracker` is made by `make` on an emitter this feeds. It starts from the first row that has the client on a cart, as a
 * bot that has been riding it would be, and stops comparing a cart when the client leaves it.
 */
export function replayBotCarts(recording: Recording, make: (source: EventEmitter, improvements: boolean) => Tracker): BotCartResult {
    const version = recording.header.mc;
    const features = (recording.header as unknown as { features?: readonly string[] }).features ?? [];
    const client = new EventEmitter();
    const tracker = make(client, features.includes('minecart_improvements'));
    const divergences: Divergence[] = [];
    let compared = 0;
    let riding: number | null = null;
    // (a row's pre is its packets' work already: where the tracker starts from it, it starts with the row's tick)
    const feed = (row: ExpandedRow) => {
        for (const packet of row.s2c) {
            let data;
            try {
                data = readClientbound(version, packetBytes(packet.b));
            } catch {
                continue; // (a packet the codec cannot read says nothing of carts: what can move one has the same shape in all)
            }
            client.emit(data.name, data.params);
        }
    };
    for (const row of recording.rows) {
        const before = vehicleOf(row.pre);
        if (riding === null && before?.minecart && row.t > 0) {
            riding = before.id;
            const lerp = before.minecart.lerp;
            const cart = tracker.adopt({ id: before.id, variant: before.type, position: vec(before.pos), yRot: before.yRot, xRot: before.xRot, velocity: vec(before.vel), targetVelocity: vec(before.vel), onGround: before.onGround, tracked: vec(lerp && lerp.steps > 0 ? lerp.target : before.pos), lerp: lerp && lerp.steps > 0 ? { position: vec(before.pos), yRot: before.yRot, xRot: before.xRot, steps: lerp.steps, target: vec(lerp.target), targetYRot: lerp.yRot, targetXRot: lerp.xRot } : null });
            cart.effects = { hurtTime: before.minecart.hurtTime ?? 0, damage: before.minecart.damage ?? 0, fuse: -1 };
            cart.hurtDir = before.minecart.hurtDir ?? 1;
        } else if (riding === null) {
            continue;
        } else {
            feed(row);
        }
        if (!row.playerTicked) continue;
        tracker.tick();
        const want = vehicleOf(row.post);
        if (!want || want.id !== riding) {
            riding = null;
            continue;
        }
        const got: ClientMinecart | undefined = tracker.carts.get(riding);
        const where = { tick: row.t, at: 'bot.minecart', source: 'native' as const };
        if (!got) {
            divergences.push({ ...where, field: 'tracked', expected: riding, actual: null });
            continue;
        }
        compared += 1;
        const wrong = (field: string, expected: unknown, actual: unknown) => divergences.push({ ...where, field, expected, actual });
        if (!same(want.pos[0], got.position.x) || !same(want.pos[1], got.position.y) || !same(want.pos[2], got.position.z)) wrong('pos', want.pos, [got.position.x, got.position.y, got.position.z]);
        if (!same(Math.fround(want.yRot), Math.fround(got.yRot))) wrong('yRot', want.yRot, got.yRot);
        if (!same(Math.fround(want.xRot), Math.fround(got.xRot))) wrong('xRot', want.xRot, got.xRot);
        if (want.onGround !== got.onGround) wrong('onGround', want.onGround, got.onGround);
        const m = want.minecart;
        if (m?.hurtTime !== undefined && m.hurtTime !== got.effects.hurtTime) wrong('hurtTime', m.hurtTime, got.effects.hurtTime);
        if (m?.hurtDir !== undefined && m.hurtDir !== got.hurtDir) wrong('hurtDir', m.hurtDir, got.hurtDir);
        if (m?.damage !== undefined && !same(m.damage, got.effects.damage)) wrong('damage', m.damage, got.effects.damage);
        if (m?.lerp && got.lerp && m.lerp.steps !== got.lerp.steps) wrong('lerp.steps', m.lerp.steps, got.lerp.steps);
    }
    return { compared, divergences };
}
