// Randomized scenarios from a seed: legal cases of a bounded grammar, biased to where the branches are (the motion cuts, block
// changes under the feet, a look at the wrap). The generator's own random is a seeded mulberry32, so a saved seed gives the same
// specs on any machine; what vanilla then does with a case is Minecraft's random, which a repeat run shows as nondeterminism.
// A spec is plain data: shrinking drops steps from it and the smaller case is recorded again, so a shrunk case is still vanilla.

export type RandomStep =
    | { readonly kind: 'press'; readonly keys: readonly string[]; readonly ticks: number }
    | { readonly kind: 'wait'; readonly ticks: number }
    | { readonly kind: 'turn'; readonly dyaw: number; readonly ticks: number }
    | { readonly kind: 'impulse'; readonly vel: readonly [number, number, number] }
    | { readonly kind: 'effect'; readonly id: string; readonly amplifier: number }
    | { readonly kind: 'block'; readonly at: readonly [number, number, number]; readonly state: string };

export interface RandomSpec {
    readonly id: string;
    readonly seed: number;
    readonly area: string;
    readonly yaw: number;
    readonly steps: readonly RandomStep[];
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const AREAS = ['flat', 'cf_course', 'cf_slime'];
const KEYS: readonly (readonly string[])[] = [['forward'], ['forward', 'left'], ['forward', 'right'], ['back'], ['forward', 'sprint'], ['forward', 'jump'], ['forward', 'sprint', 'jump'], ['sneak'], ['forward', 'sneak'], ['jump']];
const BLOCKS = ['stone', 'ice', 'slime_block', 'soul_sand', 'oak_slab', 'air'];
const EFFECTS = ['speed', 'slowness', 'jump_boost'];
/** Around the 0.003 and 0.005 cuts, then what a blast or a knockback gives. */
const IMPULSES = [0.0025, 0.0029, 0.003, 0.0035, 0.0049, 0.0051, 0.1, 0.4, -0.0025, -0.003, -0.1, -0.4];
const YAWS = [0, 90, 179.99, 180, -179.99, 270, 45, 33.3];

export function generate(seed: number, count: number): RandomSpec[] {
    const next = mulberry32(seed);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
    const int = (low: number, high: number) => low + Math.floor(next() * (high - low + 1));
    const step = (): RandomStep => {
        const roll = next();
        if (roll < 0.45) return { kind: 'press', keys: pick(KEYS), ticks: int(1, 20) };
        if (roll < 0.55) return { kind: 'wait', ticks: int(1, 8) };
        if (roll < 0.7) return { kind: 'turn', dyaw: int(-30, 30), ticks: int(1, 6) };
        if (roll < 0.85) return { kind: 'impulse', vel: [pick(IMPULSES), pick([0, 0, 0.1, 0.42]), pick(IMPULSES)] };
        if (roll < 0.93) return { kind: 'block', at: [int(1, 6), int(0, 2), int(-3, 3)], state: pick(BLOCKS) };
        return { kind: 'effect', id: pick(EFFECTS), amplifier: int(0, 2) };
    };
    return Array.from({ length: count }, (_, i) => ({
        id: `rnd_${seed}_${i}`, seed, area: pick(AREAS), yaw: pick(YAWS), steps: Array.from({ length: int(3, 9) }, step),
    }));
}

/** The smaller cases of a spec: each with one step gone, the shortest first to be tried in the order given. */
export function shrinkCandidates(spec: RandomSpec): RandomSpec[] {
    return spec.steps.map((_, drop) => ({ ...spec, id: `${spec.id}_s${drop}`, steps: spec.steps.filter((__, i) => i !== drop) }));
}
