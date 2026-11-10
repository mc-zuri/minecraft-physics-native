// physics-data-generator's case vocabulary (D:\minecraft\java\physics-data-generator, catalog/src/dsl.mjs),
// typed, on this recorder's scenarios. The generator's cases (scenarios/cases/physrec/) were ported
// from its catalog sources line by line and are maintained here now:
//
//   kase('j_jump_walk_f', { area: 'flat', at: [0.5, 0, 0.5], expect: 'on:stone' },
//     hold(F), press(JUMP, 1), until('onGround', 40), release(F), stopped(3), ticks(3))
//
// kase() turns each case into a scenario (id physrec/<name>) whose spec is made per release, keeping
// the generator's semantics:
//
//  - an area (by name, from the registry: registerAreas) is its extent plus the margin, cleared up to
//    clearAbove over its highest block, with the ground layers (grass on dirt on stone on bedrock)
//    under it everywhere; area-local y=0 is the floor block, which here is y=-1 (a start at y=0
//    stands on it in both);
//  - a fill gated by since/until is placed only in those releases; when a case lists the blocks it
//    is about (requires), any other block the release lacks is left out, else it skips the case;
//  - versioned commands (commandBy) run the command of the newest release key the release reaches;

import type { BlockPos, Condition, Key, Vec3 } from '../../schema/scenario.ts';
import { ACTION_KEYS, MOVEMENT_KEYS } from '../../schema/scenario.ts';
import * as core from './core.ts';
import {
    area, expect as expects, rawBlock, scenario, srv,
    type Area, type ExpectSpec, type ItemSpec, type Scenario, type ScenarioSpec, type ServerActionSpec, type SetupSpec, type StepSpec,
    type SummonSpec, type VersionContext,
} from './core.ts';
import { inRange } from './names.ts';

// ---------------------------------------------------------------------------------------------
// The generator's formats

/** A position as the cases write it: [x, y, z] (a plain array literal types as number[]). */
export type Pos = readonly number[];

export interface PhysrecFill {
    readonly from: Pos;
    readonly to: Pos;
    readonly block: string;
    readonly since?: string;
    readonly until?: string;
    readonly update?: boolean;
}

export interface PhysrecArea {
    readonly name: string;
    /** [minX, maxX, minZ, maxZ], local. */
    readonly extent: readonly number[];
    readonly blocks: readonly PhysrecFill[];
    /** A fixed world origin (far coordinates); else the area is packed at the recorder's origin. */
    readonly origin?: Pos;
}

export interface PhysrecAreas {
    readonly margin: number;
    readonly clearAbove: number;
    readonly ground: readonly { readonly block: string; readonly from: number; readonly to: number }[];
    readonly areas: readonly PhysrecArea[];
}

export interface PhysrecItem { readonly id: string; readonly count?: number; readonly enchantments?: Readonly<Record<string, number>> }

export interface PhysrecSummon {
    readonly entity: string;
    readonly at: Pos;
    readonly vel?: Pos;
    readonly noGravity?: boolean;
    readonly yaw?: number;
    readonly noAi?: boolean;
    readonly nbt?: string;
    readonly ready?: boolean;
    readonly equipment?: Readonly<Record<string, string>>;
    readonly chested?: boolean;
}

export interface PhysrecMount {
    readonly entity: string;
    readonly noAi?: boolean;
    readonly at?: Pos;
    readonly yaw?: number;
    readonly attributes?: Readonly<Record<string, number>>;
    readonly equipment?: Readonly<Record<string, string>>;
    readonly chested?: boolean;
}

export interface PhysrecSetup {
    readonly effects?: readonly { readonly id: string; readonly amplifier?: number }[];
    readonly equipment?: Readonly<Record<string, PhysrecItem>>;
    readonly attributes?: Readonly<Record<string, number>>;
    /** Modifiers of an attribute of the player, on top of `attributes`: the mod adds them through the release's own container. */
    readonly modifiers?: Readonly<Record<string, readonly core.ModifierSpec[]>>;
    readonly food?: number;
    readonly flying?: boolean;
    readonly autoJump?: boolean;
    readonly mount?: PhysrecMount;
    readonly summon?: readonly PhysrecSummon[];
    readonly inventory?: Readonly<Record<string, PhysrecItem>>;
    readonly selected?: number;
    readonly commands?: readonly Readonly<Record<string, string | null>>[];
}

export interface PhysrecAction {
    readonly effect?: { readonly id: string; readonly amplifier?: number };
    readonly clearEffects?: boolean;
    readonly impulse?: Pos;
    readonly velocityOf?: { readonly ref: string; readonly vel: Pos };
    readonly attribute?: { readonly id: string; readonly base: number };
    readonly block?: { readonly at: Pos; readonly state: string };
    readonly food?: number;
    readonly summon?: PhysrecSummon;
    readonly explode?: { readonly at: Pos; readonly power: number };
    readonly command?: string;
    readonly commands?: Readonly<Record<string, string | null>>;
    readonly tabList?: { readonly header: string; readonly footer: string };
    readonly resourcePack?: { readonly url: string; readonly hash?: string; readonly required?: boolean; readonly prompt?: string; readonly pop?: boolean };
    readonly blockDamage?: { readonly at: Pos; readonly stage: number };
    readonly forgetChunk?: Pos;
    readonly kick?: string;
    readonly respawnPoint?: Pos;
    readonly noGravity?: boolean;
    readonly teleport?: Pos;
}

export interface PhysrecStep {
    readonly op: 'ticks' | 'press' | 'hold' | 'release' | 'look' | 'turn' | 'until' | 'stable' | 'stopped' | 'server' | 'client' | 'screen';
    readonly keys?: readonly string[];
    readonly ticks?: number;
    readonly n?: number;
    readonly max?: number;
    readonly yaw?: number;
    readonly pitch?: number;
    readonly dyaw?: number;
    readonly dpitch?: number;
    readonly cond?: string;
    readonly soft?: boolean;
    readonly actions?: readonly PhysrecAction[];
    readonly client?: unknown;
    readonly screen?: string;
}

export interface PhysrecCase {
    readonly name: string;
    readonly tier?: number;
    readonly tags?: readonly string[];
    readonly since?: string;
    readonly until?: string;
    readonly area: string;
    readonly at: Pos;
    readonly rest?: Pos;
    readonly yaw?: number;
    readonly pitch?: number;
    /** survival, creative, adventure or spectator (checked when the case compiles). */
    readonly gamemode?: string;
    readonly settle?: boolean;
    readonly serverMoves?: boolean;
    readonly serverMovesIn?: readonly string[];
    readonly verify?: number;
    readonly features?: boolean;
    readonly serverTimed?: string;
    readonly serverTimedUntil?: string;
    readonly mortal?: boolean;
    readonly difficulty?: string;
    readonly disconnects?: boolean;
    readonly setup?: PhysrecSetup;
    readonly expect?: readonly string[];
    readonly checks?: readonly string[];
    readonly requires?: readonly string[];
    readonly steps: readonly PhysrecStep[];
    readonly startMotion?: { readonly vel: Pos };
}

// ---------------------------------------------------------------------------------------------
// Conditions: "onGround || isInWater || y<-1.9", "on:stone && !in:water"

const COMPARE = /^(x|y|z|vx|vy|vz|fallDistance|health|highest|lowest|distance)\s*(<=|>=|==|<|>)\s*(-?[0-9.eE+-]+)$/;

/** Parses a condition in physics-data-generator's syntax; throws on what this recorder cannot evaluate. */
export function parseCondition(text: string): Condition {
    const tokens = text.match(/\(|\)|&&|\|\||!(?!=)|[^\s()&|!]+(?:\s*(?:<=|>=|==|<|>)\s*-?[0-9.eE+-]+)?/g) ?? [];
    let at = 0;
    const peek = () => tokens[at];
    const or = (): Condition => {
        const any = [and()];
        while (peek() === '||') { at += 1; any.push(and()); }
        return any.length === 1 ? any[0]! : { op: 'or', any };
    };
    const and = (): Condition => {
        const all = [unary()];
        while (peek() === '&&') { at += 1; all.push(unary()); }
        return all.length === 1 ? all[0]! : { op: 'and', all };
    };
    const unary = (): Condition => {
        const token = tokens[at++];
        if (token === undefined) throw new Error(`condition "${text}" ends early`);
        if (token === '!') return { op: 'not', cond: unary() };
        if (token === '(') {
            const inner = or();
            if (tokens[at++] !== ')') throw new Error(`condition "${text}": missing )`);
            return inner;
        }
        return atom(token.replace(/\s+/g, ''));
    };
    const atom = (token: string): Condition => {
        switch (token) {
            case 'onGround': return { op: 'onGround' };
            case 'fishBiting': return { op: 'fishBiting' };
            case 'isInWater': return { op: 'inWater' };
            case 'isInLava': return { op: 'inLava' };
            case 'isCollidedHorizontally': return { op: 'collidedHorizontally' };
            case 'elytraFlying': case 'fallFlying': return { op: 'fallFlying' };
            case 'true': return { op: 'const', holds: true };
            case 'false': return { op: 'const', holds: false };
            default: break;
        }
        const contact = /^(on|in|against|under):([a-z0-9_]+)$/.exec(token);
        if (contact) return { op: 'touching', how: contact[1] as 'on', block: contact[2]! };
        const cmp = COMPARE.exec(token);
        if (cmp) {
            const field = cmp[1] as Extract<Condition, { op: 'cmp' }>['field'];
            const value = Number(cmp[3]);
            if (cmp[2] === '==') return { op: 'and', all: [{ op: 'cmp', field, cmp: '>=', value }, { op: 'cmp', field, cmp: '<=', value }] };
            return { op: 'cmp', field, cmp: cmp[2] as '<', value };
        }
        throw new Error(`condition "${text}": "${token}" is not supported`);
    };
    const result = or();
    if (at !== tokens.length) throw new Error(`condition "${text}": unexpected "${tokens[at]}"`);
    return result;
}

// ---------------------------------------------------------------------------------------------
// Areas

/** A position as a tuple. */
const tuple = (p: Pos): Vec3 => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
/** An area-local block position one lower: the generator's floor is y=0, this recorder's y=-1. */
const shift = (p: Pos): BlockPos => [p[0] ?? 0, (p[1] ?? 0) - 1, p[2] ?? 0];

/** A manual recording's snapshot, which said where its world's blocks changed form: the flattening's release here. */
const inRelease = (version: string) => version === '17w50a' ? '1.13' : version;

function range(since?: string, until?: string): string | undefined {
    const parts = [since ? `>=${inRelease(since)}` : '', until ? `<${inRelease(until)}` : ''].filter(Boolean);
    return parts.length ? parts.join(' ') : undefined;
}

/** The generator's area as this recorder's: its box, the ground under it, its fills one block lower. */
export function convertArea(file: PhysrecAreas, physrecArea: PhysrecArea, requires: readonly string[]): Area {
    const [x0 = 0, x1 = 0, z0 = 0, z1 = 0] = physrecArea.extent;
    let low = 0;
    let high = 0;
    for (const layer of file.ground) low = Math.min(low, layer.from);
    for (const fill of physrecArea.blocks) {
        low = Math.min(low, fill.from[1] ?? 0, fill.to[1] ?? 0);
        high = Math.max(high, fill.from[1] ?? 0, fill.to[1] ?? 0);
    }
    const box = [x0 - file.margin, low - 1, z0 - file.margin, x1 + file.margin, high + file.clearAbove - 1, z1 + file.margin] as const;
    const about = new Set(requires);
    const optional = (state: string) => requires.length > 0 && !about.has(state.replace(/\[.*$/, ''));
    return area(`physrec_${physrecArea.name}`, {
        box,
        ...(physrecArea.origin ? { origin: shift([physrecArea.origin[0] ?? 0, (physrecArea.origin[1] ?? 0) + 1, physrecArea.origin[2] ?? 0]) } : {}),
    }, a => {
        for (const layer of file.ground) {
            a.fill([box[0], layer.from - 1, box[2]], [box[3], layer.to - 1, box[5]], rawBlock(layer.block), { optional: optional(layer.block) });
        }
        for (const fill of physrecArea.blocks) {
            const versions = range(fill.since, fill.until);
            a.fill(shift(fill.from), shift(fill.to), rawBlock(fill.block), {
                ...(fill.update ? { update: true } : {}),
                ...(versions ? { versions } : {}),
                ...(optional(fill.block) ? { optional: true } : {}),
            });
        }
    });
}

// ---------------------------------------------------------------------------------------------
// Cases

const KEYS = new Set<string>([...MOVEMENT_KEYS, ...ACTION_KEYS]);

class Unsupported extends Error {}

function keys(list: readonly string[] | undefined): Key[] {
    return (list ?? []).map(k => {
        if (!KEYS.has(k)) throw new Unsupported(`key ${k}`);
        return k as Key;
    });
}

function toItem(i: PhysrecItem): ItemSpec {
    return { item: i.id as ItemSpec['item'], count: i.count ?? 1, enchantments: (i.enchantments ?? {}) as ItemSpec['enchantments'] };
}

function toSummon(ref: string, s: PhysrecSummon): SummonSpec {
    return {
        ref, type: s.entity as SummonSpec['type'], pos: tuple(s.at),
        ...(s.yaw !== undefined ? { yRot: s.yaw } : {}),
        ...(s.vel ? { vel: tuple(s.vel) } : {}),
        ...(s.noGravity !== undefined ? { noGravity: s.noGravity } : {}),
        noAi: s.noAi ?? true,
        ...(s.nbt ? { nbt: s.nbt } : {}),
        ...(s.ready ? { ready: true } : {}),
        ...(s.equipment ? { equipment: s.equipment } : {}),
        ...(s.chested ? { chested: true } : {}),
    };
}

function action(a: PhysrecAction, refs: { next: number }): ServerActionSpec {
    if (a.effect) return srv.effect(a.effect.id as never, a.effect.amplifier ?? 0);
    if (a.clearEffects) return srv.clearEffects();
    if (a.impulse) return srv.velocity(tuple(a.impulse));
    if (a.velocityOf) return srv.velocity(tuple(a.velocityOf.vel), a.velocityOf.ref);
    if (a.attribute) return srv.attribute(a.attribute.id as never, { base: a.attribute.base });
    if (a.block) return srv.setBlock(shift(a.block.at), rawBlock(a.block.state), true);
    if (a.food !== undefined) return srv.food(a.food);
    if (a.summon) return srv.summon(toSummon(`summon${refs.next++}`, a.summon));
    if (a.explode) return srv.explode(tuple(a.explode.at), a.explode.power);
    if (a.command !== undefined) return srv.command(a.command);
    if (a.commands) return srv.commands(a.commands);
    if (a.tabList) return srv.tabList(a.tabList.header, a.tabList.footer);
    if (a.blockDamage) return srv.blockDamage(shift(a.blockDamage.at), a.blockDamage.stage);
    if (a.forgetChunk) return srv.forgetChunk(shift(a.forgetChunk));
    if (a.kick !== undefined) return srv.kick(a.kick);
    if (a.resourcePack) return srv.resourcePack(a.resourcePack.url, a.resourcePack.hash ?? '', a.resourcePack.required ?? false, a.resourcePack.prompt, a.resourcePack.pop ?? false);
    if (a.respawnPoint) return srv.respawnPoint(shift(a.respawnPoint));
    if (a.noGravity !== undefined) return srv.noGravity(a.noGravity);
    if (a.teleport) return srv.teleport(tuple(a.teleport));
    const kind = Object.keys(a)[0] ?? 'empty';
    throw new Unsupported(`server action ${kind}`);
}

const GAME_MODES = ['survival', 'creative', 'adventure', 'spectator'] as const;
function gameMode(c: PhysrecCase): (typeof GAME_MODES)[number] {
    const mode = c.gamemode ?? 'survival';
    if (!(GAME_MODES as readonly string[]).includes(mode)) throw new Error(`${c.name}: unknown game mode ${mode}`);
    return mode as (typeof GAME_MODES)[number];
}

/** The case for one release (since/until, versioned commands and serverMovesIn depend on it). */
function convertCase(c: PhysrecCase, file: PhysrecAreas, areas: ReadonlyMap<string, PhysrecArea>, v: VersionContext): ScenarioSpec {
    const physrecArea = areas.get(c.area);
    if (!physrecArea) throw new Error(`${c.name}: unknown area ${c.area}`);
    const builtArea = convertArea(file, physrecArea, c.requires ?? []);
    const s = c.setup ?? {};
    const tags = [...(c.tags ?? []), 'physrec', ...(c.tier !== undefined ? [`tier${c.tier}`] : [])];
    const base = {
        versions: range(c.since, c.until),
        tags,
        ...(c.features ? { features: true } : {}),
        ...(c.mortal ? { mortal: true } : {}),
        ...(c.serverTimed ? { serverTimed: c.serverTimed } : {}),
        ...(c.serverTimedUntil ? { serverTimedUntil: c.serverTimedUntil } : {}),
        ...(c.difficulty ? { difficulty: c.difficulty } : {}),
        ...(c.disconnects ? { disconnects: true } : {}),
        area: builtArea,
        start: {
            pos: tuple(c.at), yRot: c.yaw ?? 0, xRot: c.pitch ?? 0,
            grounded: c.rest === undefined && !s.flying && c.settle !== false,
            ...(c.rest ? { rest: tuple(c.rest) } : {}),
            ...(c.settle === false ? { settle: false } : {}),
            ...(c.startMotion ? { vel: tuple(c.startMotion.vel) } : {}),
        },
        ...(c.checks && c.checks.length > 0 ? { checks: c.checks } : {}),
        ...(c.requires && c.requires.length > 0 ? { requires: c.requires } : {}),
        // (the generator's verify: 1 marked cases its two runs did not agree on; here they all record identically, the
        // difference was the mouse turning a rider between ticks, so no case is let off the comparison)
    };
    try {
        const refs = { next: 0 };
        const summons: SummonSpec[] = (s.summon ?? []).map(x => toSummon(`summon${refs.next++}`, x));
        if (s.mount) {
            summons.push({
                ref: 'mount', type: s.mount.entity as SummonSpec['type'],
                pos: tuple(s.mount.at ?? c.rest ?? c.at),
                yRot: s.mount.yaw ?? 0, noAi: s.mount.noAi ?? false, ready: true,
                ...(s.mount.equipment ? { equipment: s.mount.equipment } : {}),
                ...(s.mount.chested ? { chested: true } : {}),
                ...(s.mount.attributes ? { attributes: s.mount.attributes } : {}),
            });
        }
        const setup: SetupSpec = {
            gameMode: gameMode(c),
            effects: (s.effects ?? []).map(e => ({ id: e.id as never, amplifier: e.amplifier ?? 0 })),
            attributes: Object.fromEntries([...new Set([...Object.keys(s.attributes ?? {}), ...Object.keys(s.modifiers ?? {})])].map(id => [id, {
                ...(s.attributes?.[id] !== undefined ? { base: s.attributes[id] } : {}),
                ...(s.modifiers?.[id] ? { modifiers: s.modifiers[id] } : {}),
            }])),
            equipment: Object.fromEntries(Object.entries(s.equipment ?? {}).map(([slot, i]) => [slot, toItem(i)])),
            inventory: Object.fromEntries(Object.entries(s.inventory ?? {}).map(([slot, i]) => [Number(slot), toItem(i)])),
            ...(s.selected !== undefined ? { selectedSlot: s.selected } : {}),
            ...(s.food !== undefined ? { food: s.food } : {}),
            ...(s.flying ? { abilities: { mayfly: true, flying: true } } : {}),
            summons,
            ...(s.mount ? { mount: 'mount' } : {}),
            commands: s.commands ?? [],
            autoJump: s.autoJump ?? false,
        };
        // look keeps the angle the step leaves out
        let yaw = c.yaw ?? 0;
        let pitch = c.pitch ?? 0;
        const body: StepSpec[] = [];
        for (const st of c.steps) {
            switch (st.op) {
                case 'ticks': body.push(core.ticks(st.ticks ?? 0)); break;
                case 'press': body.push(core.press(keys(st.keys), st.ticks ?? 1)); break;
                case 'hold': body.push(core.hold(...keys(st.keys))); break;
                // (a release of no keys releases them all)
                case 'release': body.push(st.keys && st.keys.length > 0 ? core.release(...keys(st.keys)) : core.releaseAll()); break;
                case 'look':
                    yaw = st.yaw ?? yaw;
                    pitch = st.pitch ?? pitch;
                    body.push(core.look(yaw, pitch));
                    break;
                case 'turn': {
                    // the generator's turn is degrees on each tick; core.turn takes the whole turn over its ticks
                    const n = st.ticks ?? 1;
                    const dyaw = (st.dyaw ?? 0) * n;
                    const dpitch = (st.dpitch ?? 0) * n;
                    yaw += dyaw;
                    pitch += dpitch;
                    body.push(core.turn(dyaw, dpitch, n));
                    break;
                }
                case 'until': {
                    let cond: Condition;
                    try {
                        cond = parseCondition(st.cond ?? 'true');
                    } catch (error) {
                        throw new Unsupported((error as Error).message);
                    }
                    body.push(core.until(cond, st.max ?? 400, st.soft ? { soft: true } : {}));
                    break;
                }
                case 'stable':
                    body.push(core.stable(st.n ?? 1, st.max ?? 400, st.soft ? { soft: true } : {}));
                    break;
                case 'stopped':
                    body.push(core.stopped(st.n ?? 1, st.max ?? 400, st.soft ? { soft: true } : {}));
                    break;
                case 'server': for (const a of st.actions ?? []) body.push(core.server(action(a, refs))); break;
                case 'client': body.push({ op: 'client', client: st.client as core.ClientActionSpec }); break;
                case 'screen': body.push({ op: 'screen', screen: st.screen!, max: st.max ?? 400, ...(st.soft ? { soft: true } : {}) }); break;
                default: throw new Unsupported(`step ${(st as { op: string }).op}`);
            }
        }
        const moves = c.serverMoves || (c.serverMovesIn ?? []).some(release => inRange(v.version, release));
        const expect: ExpectSpec[] = [];
        for (const e of c.expect ?? []) {
            // (`on:ice@>=1.20`: an expectation for a range of releases)
            const [text, only] = e.split('@') as [string, string | undefined];
            if (!inRange(v.version, only)) continue;
            const m = /^(on|in|against|under):(.+)$/.exec(text);
            if (m) expect.push({ op: 'touched', how: m[1] as 'on', block: m[2] as never });
        }
        expect.push(moves ? expects.correctionsAllowed() : expects.noCorrections());
        // the path checks must hold at the end, or the case did not do what it is about
        for (const check of c.checks ?? []) {
            // (`y < 0@>=1.21.3`: a check for a range of releases)
            const [text, only] = check.split('@') as [string, string | undefined];
            if (!inRange(v.version, only)) continue;
            let cond: Condition;
            try {
                cond = parseCondition(text);
            } catch (error) {
                throw new Unsupported(`check ${(error as Error).message}`);
            }
            expect.push(expects.final(cond));
        }
        return { ...base, setup, body, expect };
    } catch (error) {
        if (!(error instanceof Unsupported)) throw error;
        return { ...base, body: [], unsupported: `not supported yet: ${error.message}` };
    }
}

// ---------------------------------------------------------------------------------------------
// The area registry and the world constants of the generator's catalog/build.mjs

/** The ground layers under every area (bedrock-observer's), area-local y. */
export const GROUND: PhysrecAreas['ground'] = [
    { block: 'bedrock', from: -11, to: -11 },
    { block: 'stone', from: -10, to: -4 },
    { block: 'dirt', from: -3, to: -1 },
    { block: 'grass_block', from: 0, to: 0 },
];

const registry: { margin: number; clearAbove: number; ground: PhysrecAreas['ground']; areas: PhysrecArea[] } = {
    margin: 8, clearAbove: 24, ground: GROUND, areas: [],
};
const byName = new Map<string, PhysrecArea>();

/** Makes areas known to kase() by name (an area module calls it as it loads). */
export function registerAreas(...areas: readonly (PhysrecArea | readonly PhysrecArea[])[]): void {
    for (const a of areas.flat() as PhysrecArea[]) {
        const known = byName.get(a.name);
        if (known && known !== a) throw new Error(`area ${a.name} is defined twice`);
        if (!known) registry.areas.push(a);
        byName.set(a.name, a);
    }
}

// ---------------------------------------------------------------------------------------------
// The vocabulary (catalog/src/dsl.mjs)

export const F = 'forward';
export const B = 'back';
export const L = 'left';
export const R = 'right';
export const JUMP = 'jump';
export const SNEAK = 'sneak';
export const SPRINT = 'sprint';
export const USE = 'use';
// feature keys
export const ATTACK = 'attack';
export const DROP = 'drop';
export const SWAP = 'swapHands';
export const INVENTORY = 'inventory';
export const HOTBAR = (n: number): string => `hotbar${n}`;

/** The 8 movement directions as key sets, with names for case ids. */
export const DIRECTIONS: Readonly<Record<string, readonly string[]>> = {
    f: ['forward'], b: ['back'], l: ['left'], r: ['right'],
    fl: ['forward', 'left'], fr: ['forward', 'right'], bl: ['back', 'left'], br: ['back', 'right'],
};

type Keys = string | readonly string[];
/** A step, or the steps a helper returns. */
export type PhysrecSteps = PhysrecStep | readonly PhysrecSteps[];

const keyList = (k: Keys): string[] => [k].flat() as string[];

export const ticks = (n: number): PhysrecStep => ({ op: 'ticks', ticks: n });
export const press = (k: Keys, n: number): PhysrecStep => ({ op: 'press', keys: keyList(k), ticks: n });
export const hold = (...k: Keys[]): PhysrecStep => ({ op: 'hold', keys: k.flatMap(keyList) });
export const release = (...k: Keys[]): PhysrecStep => ({ op: 'release', keys: k.flatMap(keyList) });
export const releaseAll = (): PhysrecStep => ({ op: 'release', keys: [] });
export const look = (yaw?: number, pitch?: number): PhysrecStep => ({ op: 'look', ...(yaw !== undefined ? { yaw } : {}), ...(pitch !== undefined ? { pitch } : {}) });
/** Turn by dyaw/dpitch degrees on each of n ticks. */
export const turn = (dyaw: number, dpitch: number, n: number): PhysrecStep => ({ op: 'turn', dyaw, dpitch, ticks: n });
export const stable = (n: number, max?: number): PhysrecStep => ({ op: 'stable', n, ...(max ? { max } : {}) });
export const stopped = (n: number, max?: number): PhysrecStep => ({ op: 'stopped', n, ...(max ? { max } : {}) });
/** Ticks until the condition holds (physics-data-generator's syntax: "onGround || y<-1.9", "on:stone && !in:water"). */
export const until = (cond: string, max?: number): PhysrecStep => ({ op: 'until', cond, ...(max ? { max } : {}) });
/** Waits that may run out: after max ticks the case just goes on (bobbing never settles, a climber never lands). */
export const settleFor = (n: number, max: number): PhysrecStep => ({ op: 'stable', n, max, soft: true });
export const untilOr = (cond: string, max: number): PhysrecStep => ({ op: 'until', cond, max, soft: true });
export const repeat = (n: number, body: (i: number) => PhysrecSteps): PhysrecSteps[] => Array.from({ length: n }, (_, i) => body(i));

export const effect = (id: string, amplifier = 0): { id: string; amplifier: number } => ({ id, amplifier });
export const item = (id: string, enchantments: Readonly<Record<string, number>> = {}): PhysrecItem => ({ id, enchantments });

/** What kase() takes besides the name and the steps. */
export interface KaseSpec extends Omit<PhysrecCase, 'name' | 'steps' | 'expect' | 'checks'> {
    /** Contacts the path must make: "on:ice in:water" or a list. */
    readonly expect?: string | readonly string[];
    readonly checks?: string | readonly string[];
}

const list = (v: string | readonly string[] | undefined): string[] => (v == null ? [] : typeof v === 'string' ? v.split(' ').filter(Boolean) : [...v]);

/** A case: kase(name, { area, at, rest?, yaw?, pitch?, tier, tags, expect?, checks?, setup?, since?, until? }, ...steps). */
export function kase(name: string, spec: KaseSpec, ...steps: PhysrecSteps[]): Scenario {
    const { checks, expect: contacts, ...rest } = spec;
    const c: PhysrecCase = {
        ...rest,
        name,
        tier: spec.tier ?? 0,
        tags: spec.tags ?? [],
        expect: list(contacts),
        ...(checks ? { checks: [checks].flat() as string[] } : {}),
        steps: (steps as unknown[]).flat(Infinity) as PhysrecStep[],
    };
    return scenario(`physrec/${name.toLowerCase().replace(/[^a-z0-9_.-]/g, '_')}`, v => convertCase(c, registry, byName, v));
}

// server-side changes mid-case (the recording shows the tick the client learns of them)
export const server = (...actions: (PhysrecAction | readonly PhysrecAction[])[]): PhysrecStep => ({ op: 'server', actions: actions.flat() as PhysrecAction[] });
export const giveEffect = (id: string, amplifier = 0): PhysrecAction => ({ effect: { id, amplifier } });
export const clearEffects = (): PhysrecAction => ({ clearEffects: true });
export const impulse = (x: number, y: number, z: number): PhysrecAction => ({ impulse: [x, y, z] });
/** Sets a summon's velocity (`summon0` and on; `mount`), as a cart is set going. */
export const cartVelocity = (ref: string, vel: Pos): PhysrecAction => ({ velocityOf: { ref, vel } });
export const setAttribute = (id: string, base: number): PhysrecAction => ({ attribute: { id, base } });
export const setBlock = (at: Pos, state: string): PhysrecAction => ({ block: { at, state } });
export const setFood = (food: number): PhysrecAction => ({ food });
export const summon = (entity: string, at: Pos, extra: Partial<PhysrecSummon> = {}): PhysrecAction => ({ summon: { entity, at, noAi: true, ...extra } });
export const explode = (at: Pos, power = 2): PhysrecAction => ({ explode: { at, power } });
/** A command run by the server console, e.g. command('title @a title "Hi"'). */
export const command = (text: string): PhysrecAction => ({ command: text });
/** A command whose syntax differs by release: { since: text }, the newest key the release reaches; null: none there. */
export const commandBy = (variants: Readonly<Record<string, string | null>>): PhysrecAction => ({ commands: variants });
export const tabList = (header: string, footer: string): PhysrecAction => ({ tabList: { header, footer } });
export const resourcePack = (url: string, { hash = '', required = false, prompt }: { hash?: string; required?: boolean; prompt?: string } = {}): PhysrecAction =>
    ({ resourcePack: { url, hash, required, prompt } });
export const popResourcePack = (url: string): PhysrecAction => ({ resourcePack: { url, pop: true } });
export const kick = (reason: string): PhysrecAction => ({ kick: reason });
export const respawnPoint = (at: Pos): PhysrecAction => ({ respawnPoint: at });
/** The player's NoGravity flag (Entity.setNoGravity, synced to its client): cases using it start at 1.10. */
export const setNoGravity = (on: boolean): PhysrecAction => ({ noGravity: on });
/** The server moves the player to this area-local position, as a position packet. */
export const teleport = (x: number, y: number, z: number): PhysrecAction => ({ teleport: [x, y, z] });
/** Another player's digging progress on a block (area-local), as the server shows it: 0-9, -1 ends it. */
export const blockDamage = (at: Pos, stage: number): PhysrecAction => ({ blockDamage: { at, stage } });
/** The client forgets the chunk column of this block (area-local); the server still has it, and sends it again after the case. */
export const forgetChunk = (at: Pos): PhysrecAction => ({ forgetChunk: at });

// feature cases: client actions through the vanilla code paths, and waits for screens
const client = (type: string, fields: Record<string, unknown> = {}): PhysrecStep => ({ op: 'client', client: { type, ...fields } });
export const chat = (text: string): PhysrecStep => client('chat', { text });
/** A command the client types, without the slash. */
export const clientCommand = (text: string): PhysrecStep => client('command', { text });
/** A click in the open container: mode PICKUP (button 0 left, 1 right), QUICK_MOVE, SWAP, CLONE, THROW, QUICK_CRAFT, PICKUP_ALL. */
export const click = (slot: number, button = 0, mode = 'PICKUP'): PhysrecStep => client('click', { slot, button, mode });
export const button = (id: number): PhysrecStep => client('button', { id });
export const closeScreen = (): PhysrecStep => client('close');
export const respawn = (): PhysrecStep => client('respawn');
export const selectTrade = (id: number): PhysrecStep => client('selectTrade', { id });
export const rename = (text: string): PhysrecStep => client('rename', { text });
export const writeSign = (...lines: string[]): PhysrecStep => client('sign', { lines });
export const writeBook = (pages: readonly string[], title?: string): PhysrecStep => client('book', { pages, ...(title ? { title } : {}) });
export const suggest = (text: string, id = 1): PhysrecStep => client('suggest', { text, id });
export const setCommandBlock = (at: Pos, text: string, mode = 'REDSTONE'): PhysrecStep => client('commandBlock', { at, text, mode });
export const creativeSlot = (slot: number, id: string, count = 1): PhysrecStep => client('creative', { slot, item: { id, count } });
export const confirm = (yes = true): PhysrecStep => client('confirm', { id: yes ? 1 : 0 });
export const wake = (): PhysrecStep => client('wake');
/** Selects a hotbar slot (0-8) as the hotbar keys do, also with a screen open. */
export const selectSlot = (id: number): PhysrecStep => client('select', { id });
/** Records what the client's crosshair hits now. */
export const crosshair = (): PhysrecStep => client('crosshair');
/** Waits until the open screen's name starts with this: none, death, sign, book, merchant, anvil, inventory... */
export const screen = (name: string, max?: number): PhysrecStep => ({ op: 'screen', screen: name, ...(max ? { max } : {}) });
