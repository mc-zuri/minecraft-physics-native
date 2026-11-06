// The world border as the client holds it, followed through the recorded packets: nothing of it is a recorded field,
// and Entity.collide reads it. A case moves it with /worldborder, whose packets come in the rows' s2c.

import { versionAtLeast } from '../scenarios/dsl/names.ts';
import { decodeClientbound } from './packets.ts';
import { packetBytes } from './load.ts';

interface Moving {
    readonly from: number;
    readonly to: number;
    readonly duration: number;
    progress: number;
    size: number;
    previousSize: number;
}

export interface BorderState {
    readonly centerX: number;
    readonly centerZ: number;
    readonly size: number;
    readonly previousSize?: number;
    readonly absoluteMaxSize: number;
}

/** WorldBorder.MovingBorderExtent.calculateSize (26.3 WorldBorder.java:370-373). */
function lerpedSize(moving: Moving): number {
    const progress = (moving.duration - moving.progress) / moving.duration;
    return progress < 1 ? moving.from + progress * (moving.to - moving.from) : moving.to;
}

export class BorderTracker {
    /** Whether the next read has something the engine has not been given. */
    changed = false;
    readonly problems: string[] = [];
    private readonly version: string;
    private centerX = 0;
    private centerZ = 0;
    private size = 59999968;
    private absoluteMaxSize = 29999984;
    private moving: Moving | null = null;

    constructor(version: string) {
        this.version = version;
    }

    /** ClientLevel.tick's WorldBorder.tick: MovingBorderExtent.update (26.3 WorldBorder.java:393-398). */
    tick(): void {
        const moving = this.moving;
        if (!moving) return;
        moving.progress -= 1;
        moving.previousSize = moving.size;
        moving.size = lerpedSize(moving);
        this.changed = true;
        if (moving.progress <= 0) {
            this.moving = null;
            this.size = moving.to;
        }
    }

    private lerp(from: number, to: number, duration: number): void {
        if (from === to || duration <= 0) {
            this.moving = null;
            this.size = to;
            return;
        }
        // before 1.21.11 the extent runs on the wall clock (1.21.10 WorldBorder.java:311, 337): no tick count gives its
        // size, and a recording runs 20 times faster than that clock
        if (!versionAtLeast(this.version, '1.21.11')) {
            this.problems.push(`a moving border runs on the wall clock in ${this.version}`);
            this.size = to;
            return;
        }
        this.moving = { from, to, duration, progress: duration, size: 0, previousSize: 0 };
        this.moving.size = lerpedSize(this.moving);
        this.moving.previousSize = this.moving.size;
    }

    /** ClientPacketListener's border packets, as minecraft-protocol reads them. */
    apply(name: string, params: Record<string, unknown>): void {
        const number = (key: string) => Number(params[key]);
        // (a varlong reads as a bigint, or as its high and low words)
        const long = (key: string) => {
            const value = params[key];
            return Array.isArray(value) ? Number(value[0]) * 2 ** 32 + (Number(value[1]) >>> 0) : Number(value);
        };
        // (one packet with an action before 1.17: 0 size, 1 lerp, 2 center, 3 initialize)
        const action = name === 'world_border' ? number('action') : -1;
        if (action === 0) {
            this.moving = null;
            this.size = number('radius');
        } else if (action === 1) {
            this.lerp(number('old_radius'), number('new_radius'), long('speed'));
        } else if (action === 2) {
            this.centerX = number('x');
            this.centerZ = number('z');
        } else if (action === 3) {
            this.centerX = number('x');
            this.centerZ = number('z');
            this.lerp(number('old_radius'), number('new_radius'), long('speed'));
            this.absoluteMaxSize = number('portalBoundary');
        } else if (name === 'world_border_size') {
            this.moving = null;
            this.size = number('diameter');
        } else if (name === 'world_border_lerp_size') {
            this.lerp(number('oldDiameter'), number('newDiameter'), long('speed'));
        } else if (name === 'world_border_center') {
            this.centerX = number('x');
            this.centerZ = number('z');
        } else if (name === 'initialize_world_border') {
            this.centerX = number('x');
            this.centerZ = number('z');
            this.lerp(number('oldDiameter'), number('newDiameter'), long('speed'));
            this.absoluteMaxSize = number('portalTeleportBoundary');
        } else {
            return;
        }
        this.changed = true;
    }

    /** The border packets of a row. */
    packets(s2c: readonly { readonly name: string; readonly b: string }[]): void {
        for (const packet of s2c) {
            if (!/Border/.test(packet.name)) continue;
            const { name, params } = decodeClientbound(this.version, packetBytes(packet.b));
            this.apply(name, params);
        }
    }

    /** What the engine's next tick reads (getMinX(0.0F) is the moving extent's previousSize, 26.3 WorldBorder.java:346-357). */
    state(): BorderState {
        this.changed = false;
        const { centerX, centerZ, absoluteMaxSize } = this;
        const moving = this.moving;
        return moving
            ? { centerX, centerZ, size: moving.size, previousSize: moving.previousSize, absoluteMaxSize }
            : { centerX, centerZ, size: this.size, absoluteMaxSize };
    }
}
