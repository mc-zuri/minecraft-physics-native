// Exact comparison of recorded values with an engine's, field by field, by the registry's rules:
// `exact` compares with Object.is (so -0 and 0 differ), `float32` after Math.fround of both
// sides, `ignore` not at all. The first divergence is the lowest (tick, phase, field).

import { NATIVE_SIM, PLAYER_FIELDS, type Compare, type PlayerFieldKey } from '../schema/fields.ts';
import { writeJson } from '../schema/json.ts';

export interface Divergence {
    readonly tick: number;
    /** A phase name, "post", or a packet ("s2c#<seq>" / "c2s[<index>]"). */
    readonly at: string;
    readonly source: 'native' | 'adapter' | 'bot';
    readonly field: string;
    readonly expected: unknown;
    readonly actual: unknown;
    readonly delta?: number;
}

function same(expected: unknown, actual: unknown, mode: Compare): boolean {
    if (mode === 'ignore') return true;
    // (a recorded null and an absent field are the same: null in a delta removes the field)
    if (expected == null && actual == null) return true;
    if (typeof expected === 'number' && typeof actual === 'number') {
        return mode === 'float32' ? Object.is(Math.fround(expected), Math.fround(actual)) : Object.is(expected, actual);
    }
    if (Array.isArray(expected) && Array.isArray(actual)) {
        return expected.length === actual.length && expected.every((v, i) => same(v, actual[i], mode));
    }
    if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
        const a = expected as Record<string, unknown>;
        const b = actual as Record<string, unknown>;
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const key of keys) if (!same(a[key], b[key], mode)) return false;
        return true;
    }
    return Object.is(expected, actual);
}

function delta(expected: unknown, actual: unknown): number | undefined {
    if (typeof expected === 'number' && typeof actual === 'number') return Math.abs(expected - actual);
    if (Array.isArray(expected) && Array.isArray(actual) && expected.length === actual.length) {
        let max = 0;
        for (let i = 0; i < expected.length; i += 1) {
            const d = delta(expected[i], actual[i]);
            if (d === undefined) return undefined;
            max = Math.max(max, d);
        }
        return max;
    }
    return undefined;
}

/**
 * A list the game keeps as a map, compared as a set by this key: LivingEntity.activeEffects is a HashMap (26.3
 * LivingEntity.java:213), so its order means nothing. Every other list is ordered: Entity.passengers is an ImmutableList whose
 * first entry can be the one that steers (26.3 Entity.java:216, getControllingPassenger).
 */
const UNORDERED: Readonly<Record<string, string>> = { effects: 'id' };

function canonical(field: string, value: unknown): unknown {
    const key = UNORDERED[field];
    if (!key || !Array.isArray(value)) return value;
    return [...(value as Record<string, unknown>[])].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}

/**
 * Compares the given recorded fields of `expected` with `actual`. A field the simulation did not give back while the
 * recording has it is a divergence too: a lost or renamed output must not read as a match.
 */
export function compareFields(
    expected: Record<string, unknown>,
    actual: Record<string, unknown>,
    fields: readonly PlayerFieldKey[],
    where: { tick: number; at: string; source: Divergence['source'] },
): Divergence[] {
    const out: Divergence[] = [];
    for (const field of fields) {
        if (!(field in actual) || actual[field] === undefined) {
            if (expected[field] !== undefined && expected[field] !== null) out.push({ ...where, field, expected: expected[field], actual: '<missing>' });
            continue;
        }
        const mode = PLAYER_FIELDS[field]?.compare ?? 'exact';
        if (!same(canonical(field, expected[field]), canonical(field, actual[field]), mode)) {
            const d = delta(expected[field], actual[field]);
            out.push({ ...where, field, expected: expected[field], actual: actual[field], ...(d !== undefined ? { delta: d } : {}) });
        }
    }
    return out;
}

/** A short line for a divergence: "t=12 afterMove native vel: expected [..] got [..] (Δ 1e-9)". */
/** A landing the engine reported, and a fall of the server's health, in the order they came. */
export interface Landing { readonly t: number; readonly damage: number }

/**
 * The health the server took for each landing, against the damage the engine reported for it (fallDamage is an output
 * of the client's tick, and the client deals nothing: LivingEntity.causeFallDamage's hurt is the server's). Only for
 * a recording where nothing else moves the health: no regeneration, no other damage.
 */
export function compareLandings(landings: readonly Landing[], health: readonly { readonly t: number; readonly health: number }[], protection = 0): Divergence[] {
    const drops: (Landing & { readonly from: number; readonly to: number })[] = [];
    for (let i = 1; i < health.length; i += 1) {
        const lost = health[i - 1]!.health - health[i]!.health;
        if (lost > 0) drops.push({ t: health[i]!.t, damage: lost, from: health[i - 1]!.health, to: health[i]!.health });
    }
    const out: Divergence[] = [];
    for (let i = 0; i < Math.max(landings.length, drops.length); i += 1) {
        const landed = landings[i];
        const dropped = drops[i];
        // (what armour's enchantments leave is a float of the float, and the health a float less it)
        if (protection > 0 && landed && dropped && Math.fround(dropped.from - afterProtection(landed.damage, protection)) === dropped.to) continue;
        if (landed?.damage === dropped?.damage) continue;
        out.push({ tick: (dropped ?? landed)!.t, at: 'srv.health', source: 'native', field: 'fallDamage', expected: dropped?.damage ?? 0, actual: landed ? (protection > 0 ? afterProtection(landed.damage, protection) : landed.damage) : 0 });
    }
    return out;
}

/** CombatRules.getDamageAfterMagicAbsorb, which the server's hurt runs on a landing's damage (1.9.4 CombatRules.java, 26.3 :44-47). */
export function afterProtection(damage: number, protection: number): number {
    const f = Math.fround;
    return f(f(damage) * f(1 - f(f(Math.min(Math.max(protection, 0), 20)) / 25)));
}

/** Feather Falling's share of a landing's protection, 3 a level (1.9.4 EnchantmentProtection.java, 26.3 data/enchantment/feather_falling.json). */
export const featherFallingProtection = (level: number): number => level * 3;

/** How far a block's next hit can be from the last: invulnerableTime lets the same damage in again after 10 of its 20 ticks, a tick more to reach srv. */
const HIT_REACH = 11;

/**
 * The health a block's contact took against the contact the engine reports each tick (contactDamage, the same tick as
 * the server runs it): every fall of the health is a hit of the damage reported on its tick or the one before, and
 * contact never goes on without hits. LivingEntity.hurtServer gives the hits their spacing (1.8.9 LivingEntity.java:693-703,
 * 26.3 LivingEntity.hurtServer), and the server's clock places them a tick either way, so their ticks are not compared.
 */
export function compareContact(contact: readonly Landing[], health: readonly { readonly t: number; readonly health: number }[]): Divergence[] {
    return compareHits(contact, health, 'contactDamage', HIT_REACH);
}

/**
 * The health the cold took against the freezeDamage the engine reports each tick: unlike a block's contact, which goes
 * on through the invulnerability, freezing deals a hit only on the ticks tickCount % 40 == 0 (1.17 LivingEntity.java:2557,
 * 26.3 :3081), so every hit the engine reports is one fall of the health, on its tick or the next.
 */
export function compareFreezing(freezing: readonly Landing[], health: readonly { readonly t: number; readonly health: number }[]): Divergence[] {
    return compareHits(freezing, health, 'freezeDamage', 1);
}

/** Every fall of the health is a hit of the damage reported on its tick or the one before, and no hit stands more than `reach` from a fall. */
function compareHits(hits: readonly Landing[], health: readonly { readonly t: number; readonly health: number }[], field: string, reach: number): Divergence[] {
    const out: Divergence[] = [];
    const drops: Landing[] = [];
    for (let i = 1; i < health.length; i += 1) {
        const lost = health[i - 1]!.health - health[i]!.health;
        if (lost > 0) drops.push({ t: health[i]!.t, damage: lost });
    }
    for (const drop of drops) {
        const hit = hits.find(c => c.t === drop.t - 1) ?? hits.find(c => c.t === drop.t);
        if (hit?.damage !== drop.damage) out.push({ tick: drop.t, at: 'srv.health', source: 'native', field, expected: drop.damage, actual: hit?.damage ?? 0 });
    }
    const unhit = hits.find(c => !drops.some(d => Math.abs(d.t - c.t) <= reach));
    if (unhit) out.push({ tick: unhit.t, at: 'srv.health', source: 'native', field, expected: 0, actual: unhit.damage });
    return out.sort((a, b) => a.tick - b.tick);
}

/**
 * The health a glide into a wall took against the impacts the engine reports (wallDamage, from the client's motion on
 * the same tick as the server runs it): every fall of the health is an impact the tick before it or on it, and an impact
 * the invulnerable ticks of an earlier one do not keep out falls the health. The server's own travel deals the damage
 * (26.3 LivingEntity.java:2499-2510, 2546-2553), so what it took is compared to the float the formula gives.
 */
export function compareWallImpacts(impacts: readonly Landing[], health: readonly { readonly t: number; readonly health: number }[]): Divergence[] {
    const out: Divergence[] = [];
    const drops: { readonly t: number; readonly from: number; readonly to: number }[] = [];
    for (let i = 1; i < health.length; i += 1) {
        if (health[i]!.health < health[i - 1]!.health) drops.push({ t: health[i]!.t, from: health[i - 1]!.health, to: health[i]!.health });
    }
    for (const drop of drops) {
        const hit = impacts.find(c => c.t === drop.t - 1) ?? impacts.find(c => c.t === drop.t);
        // (health is a float, what it lost not quite the damage)
        if (hit === undefined || Math.fround(drop.from - hit.damage) !== drop.to) out.push({ tick: drop.t, at: 'srv.health', source: 'native', field: 'wallDamage', expected: drop.from - drop.to, actual: hit?.damage ?? 0 });
    }
    const first = impacts[0];
    if (first && !drops.some(d => Math.abs(d.t - first.t) <= 1)) out.push({ tick: first.t, at: 'srv.health', source: 'native', field: 'wallDamage', expected: 0, actual: first.damage });
    return out.sort((a, b) => a.tick - b.tick);
}

export function describe(d: Divergence): string {
    // (as the recordings write numbers: -0 kept, NaN and infinities named)
    const fmt = (v: unknown) => writeJson(v);
    return `t=${d.tick} ${d.at} ${d.source} ${d.field}: expected ${fmt(d.expected)} got ${fmt(d.actual)}${d.delta !== undefined ? ` (Δ ${d.delta.toExponential(3)})` : ''}`;
}

/**
 * Every native field the registry seeds from one recorded field (NATIVE_SIM `from`), compared after the tick with
 * vanilla's value converted the same way (`expected` is toNative of vanilla's state there). What the engine leaves
 * out while vanilla has it is a divergence; the field is named as recorded.
 */
export function compareNative(
    expected: Record<string, unknown>,
    actual: Record<string, unknown>,
    where: { tick: number; at: string; source: Divergence['source'] },
    skip: ReadonlySet<string> = new Set(),
    table: Readonly<Record<string, object>> = NATIVE_SIM,
    prefix = '',
    source: Record<string, unknown> = {},
    /** Counts each field compared, by its recorded name, for a coverage report. */
    counts?: Record<string, number>,
): Divergence[] {
    const out: Divergence[] = [];
    for (const [key, map] of Object.entries(table)) {
        if (!('from' in map) || typeof map.from !== 'string' || skip.has(key)) continue;
        // (a vehicle's rider fields and the row's released jump are what the rider gives it, not the vehicle's state;
        // an input field is never given back)
        if (map.from.startsWith('rider.') || map.from.startsWith('row.') || ('input' in map && map.input)) continue;
        // a field the recording does not have for this mob (a camel's boost, a pig's rearing) does not apply to it
        if (prefix && !has(source, map.from)) continue;
        const field = prefix + map.from;
        if (counts) counts[field] = (counts[field] ?? 0) + 1;
        // exact for every field: vanilla's float fields hold exact floats, so the engine must give back exactly that
        // float (float32 rounding of both sides would let a value kept at double precision pass); and nothing the
        // engine computes is ignored
        const mode: Compare = 'exact';
        const e = expected[key];
        const a = actual[key];
        if (a === undefined) {
            if (e !== undefined && e !== null) out.push({ ...where, field, expected: e, actual: '<missing>' });
            continue;
        }
        if (!same(e, a, mode)) {
            const d = delta(flat(e), flat(a));
            out.push({ ...where, field, expected: e, actual: a, ...(d !== undefined ? { delta: d } : {}) });
        }
    }
    return out;
}

/** Whether a recorded object has the field at a path ("mount.boostTime"). */
function has(o: Record<string, unknown>, path: string): boolean {
    let at: unknown = o;
    for (const part of path.split('.')) {
        if (!at || typeof at !== 'object' || !(part in (at as object))) return false;
        at = (at as Record<string, unknown>)[part];
    }
    return at !== undefined;
}

/** {x, y, z} and boxes as arrays, for a delta. */
function flat(v: unknown): unknown {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        if ('min' in o && 'max' in o) return [...(flat(o.min) as number[]), ...(flat(o.max) as number[])];
        if ('x' in o && 'y' in o && 'z' in o) return [o.x, o.y, o.z];
    }
    return v;
}
