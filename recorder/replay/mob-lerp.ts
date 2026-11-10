// A mob the server drives, as its rider's client keeps it: the client never travels it, so where it is after a tick is the
// step of the interpolation the server's packets started (LivingEntity.aiStep's lerp, InterpolationHandler), and then the
// pistons, which push every entity on the client too. A llama, a pig without a carrot on a stick, a NoAI mount.
//
// Its packets are read as the client reads them: the deltas of a move are added to the position the client keeps of the
// server's (in 32nds before 1.9, then in 4096ths: lfloor to 1.16.5, Math.round from 1.17's TrackedPosition, VecDeltaCodec),
// a teleport sets it, and each starts an interpolation of 3 steps (1.8.8 EntityLivingBase.setPositionAndRotation2 and
// onLivingUpdate; 1.20.4 LivingEntity.lerpTo and aiStep; 1.21.5 and 26.3 InterpolationHandler). The step is
// src/mineflayer/vehicles.ts's lerpStep, on a mob nothing else moves.

import { packetBytes } from './load.ts';
import { decodeClientbound } from './packets.ts';
import { versionAtLeast } from '../scenarios/dsl/names.ts';

type V = { x: number; y: number; z: number };
interface Delta { readonly dX: number; readonly dY: number; readonly dZ: number }

const v = (a: readonly number[]): V => ({ x: a[0]!, y: a[1]!, z: a[2]! });

interface Mob {
    /** The position the client keeps of the server's: what the next move's deltas are added to. */
    tracked: V;
    target: V | null;
    steps: number;
    /** Where the last step left it (1.21.5+: the mob's own move since then is carried into the target). */
    previous: V | null;
    /** 26.3: where the step started from and the ticks into it. */
    start: V | null;
    ticks: number;
}

export class ServerDrivenMobs {
    private readonly mobs = new Map<number, Mob>();
    private readonly version: string;

    constructor(version: string) {
        this.version = version;
    }

    private lt(release: string): boolean {
        return !versionAtLeast(this.version, release);
    }

    /** The position the client keeps of the server's, as a fixed-point encoding leaves a double the server sent. */
    private encoded(p: V): V {
        if (this.lt('1.9')) return { x: Math.floor(p.x * 32) / 32, y: Math.floor(p.y * 32) / 32, z: Math.floor(p.z * 32) / 32 };
        if (this.lt('1.17')) return { x: Math.floor(p.x * 4096) / 4096, y: Math.floor(p.y * 4096) / 4096, z: Math.floor(p.z * 4096) / 4096 };
        return { ...p };
    }

    /** The mob, first seen where the server had it (its spawn, for a mob that has not moved since). */
    private mob(id: number, server: V): Mob {
        let mob = this.mobs.get(id);
        if (!mob) {
            mob = { tracked: this.encoded(server), target: null, steps: 0, previous: null, start: null, ticks: 0 };
            this.mobs.set(id, mob);
        }
        return mob;
    }

    private addDeltas(mob: Mob, { dX, dY, dZ }: Delta): void {
        if (this.lt('1.9')) {
            mob.tracked = { x: (Math.round(mob.tracked.x * 32) + dX) / 32, y: (Math.round(mob.tracked.y * 32) + dY) / 32, z: (Math.round(mob.tracked.z * 32) + dZ) / 32 };
            return;
        }
        const encode = this.lt('1.17') ? Math.floor : Math.round;
        const axis = (base: number, delta: number) => (delta === 0 ? base : (encode(base * 4096) + delta) / 4096);
        mob.tracked = { x: axis(mob.tracked.x, dX), y: axis(mob.tracked.y, dY), z: axis(mob.tracked.z, dZ) };
    }

    private lerpTo(mob: Mob, at: V, target: V, steps = 3): void {
        mob.target = { ...target };
        mob.steps = steps;
        mob.previous = { ...at };
        if (!this.lt('26.3')) {
            mob.start = { ...at };
            mob.ticks = 1 + (3 - steps);
        }
    }

    /**
     * The packets of a tick to the mob `id`, which the client handles before its entities tick; `at` is where the client
     * has it then. Returns whether any of them was the mob's.
     */
    packets(row: { s2c: readonly { name: string; b: string }[] }, id: number, at: V, server: V): boolean {
        const mob = this.mob(id, server);
        let any = false;
        for (const packet of row.s2c) {
            if (!/Pos|Rot|Teleport|PositionSync|MoveEntity|Look/.test(packet.name)) continue;
            let decoded: { name: string; params: Record<string, unknown> };
            try {
                decoded = decodeClientbound(this.version, packetBytes(packet.b)) as typeof decoded;
            } catch {
                continue;
            }
            const params = decoded.params as { entityId?: number } & Record<string, any>;
            if (params.entityId !== id) continue;
            any = true;
            const lerping = mob.steps > 0 && mob.target;
            if (decoded.name === 'rel_entity_move' || decoded.name === 'entity_move_look') {
                const deltas: Delta[] = params.delta ? (params.delta.steps ?? [params.delta]) : [{ dX: params.dX ?? 0, dY: params.dY ?? 0, dZ: params.dZ ?? 0 }];
                for (const delta of deltas) this.addDeltas(mob, delta);
                this.lerpTo(mob, at, mob.tracked);
            } else if (decoded.name === 'entity_look') {
                // a turn alone: before 1.15 to the tracked place like any move; to where it is, or from 1.20.2 where it is going
                this.lerpTo(mob, at, this.lt('1.15') ? mob.tracked : (!this.lt('1.20.2') && lerping ? mob.target! : at));
            } else if (decoded.name === 'entity_teleport') {
                const scale = this.lt('1.9') ? 32 : 1;
                const flags = typeof params.flags === 'object' ? params.flags as Record<string, boolean> : null;
                const base = lerping ? mob.target! : at;
                const target = {
                    x: flags?.x ? base.x + params.x : params.x / scale,
                    y: flags?.y ? base.y + params.y : params.y / scale,
                    z: flags?.z ? base.z + params.z : params.z / scale,
                };
                mob.tracked = { ...target };
                this.lerpTo(mob, at, target);
            } else if (decoded.name === 'sync_entity_position') {
                const p = params.path ? (params.path.steps?.at(-1) ?? params.path) : params;
                const target = { x: p.x, y: p.y, z: p.z };
                mob.tracked = { ...target };
                const dx = at.x - target.x;
                const dy = at.y - target.y;
                const dz = at.z - target.z;
                if (dx * dx + dy * dy + dz * dz > 4096) {
                    mob.target = null;
                    mob.steps = 0;
                } else this.lerpTo(mob, at, target);
            }
        }
        return any;
    }

    /** The mob's step of its interpolation in its client tick, from `p`; `undefined` when none runs. */
    step(id: number, p: V): V | undefined {
        const mob = this.mobs.get(id);
        const t = mob?.target;
        if (!mob || !(mob.steps > 0) || !t) return undefined;
        const n = mob.steps;
        // (1.21.5+: what moved the mob since the last step, a piston, is carried into the target and the start)
        if (!this.lt('1.21.5') && mob.previous) {
            const dx = p.x - mob.previous.x;
            const dy = p.y - mob.previous.y;
            const dz = p.z - mob.previous.z;
            mob.target = { x: t.x + dx, y: t.y + dy, z: t.z + dz };
            if (mob.start) mob.start = { x: mob.start.x + dx, y: mob.start.y + dy, z: mob.start.z + dz };
        }
        const to = mob.target!;
        let stepped: V;
        if (!this.lt('26.3') && mob.start) {
            const s = mob.start;
            const a = Math.fround(mob.ticks / 3);
            stepped = mob.ticks < 3 ? { x: s.x + (to.x - s.x) * a, y: s.y + (to.y - s.y) * a, z: s.z + (to.z - s.z) * a } : { ...to };
            mob.ticks += 1;
        } else if (this.lt('1.20.2')) {
            stepped = { x: p.x + (to.x - p.x) / n, y: p.y + (to.y - p.y) / n, z: p.z + (to.z - p.z) / n };
        } else {
            stepped = { x: p.x + (1 / n) * (to.x - p.x), y: p.y + (1 / n) * (to.y - p.y), z: p.z + (1 / n) * (to.z - p.z) };
        }
        mob.steps -= 1;
        mob.previous = { ...stepped };
        return stepped;
    }
}

export const vec3 = v;
