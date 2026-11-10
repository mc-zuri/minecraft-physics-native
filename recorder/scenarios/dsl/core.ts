// The scenario DSL: version-neutral, typechecked builders. A scenario names blocks, effects,
// attributes, entities and items by their modern registry names (typed by generated/types.ts);
// compile.ts resolves them for one release, and skips the scenario there with a reason when that
// release lacks one of them.

import type { AttributeName, BlockName, BlockProps, EffectName, EnchantmentName, EntityName, ItemName } from '../generated/types.ts';
import type { BlockPos, ClientAction, Condition, Key, Vec3 } from '../../schema/scenario.ts';

export type { BlockPos, Condition, Key, Vec3 };

// ---------------------------------------------------------------------------------------------
// Blocks and areas

export interface BlockRef {
    readonly kind: 'block';
    readonly name: BlockName;
    readonly props: Readonly<Record<string, string | number | boolean>>;
    /** A state string not checked by the types (imported or newer than minecraft-data): resolved per release. */
    readonly raw?: string;
}

export type BlockArg = BlockName | BlockRef;

/** A block with state properties: `b('oak_slab', { type: 'top' })`. */
export function b<N extends BlockName>(name: N, props: BlockProps[N] = {} as BlockProps[N]): BlockRef {
    return { kind: 'block', name, props: props as Record<string, string | number | boolean> };
}

/** A block state as a string, `vine[south=true]`, checked only when compiled for a release. */
export function rawBlock(state: string): BlockRef {
    const open = state.indexOf('[');
    return { kind: 'block', name: (open < 0 ? state : state.slice(0, open)) as BlockName, props: {}, raw: state };
}

export function blockRef(block: BlockArg): BlockRef {
    return typeof block === 'string' ? b(block) : block;
}

export interface AreaFill {
    readonly from: BlockPos;
    readonly to: BlockPos;
    readonly block: BlockRef;
    readonly update: boolean;
    /** The releases that place this fill ("*" when absent). */
    readonly versions?: string;
    /** Left out (not a skip) on a release that lacks the block. */
    readonly optional?: boolean;
}

export interface FillOptions { update?: boolean; versions?: string; optional?: boolean }

export interface Area {
    readonly kind: 'area';
    readonly name: string;
    readonly box: readonly [number, number, number, number, number, number];
    readonly fills: readonly AreaFill[];
    readonly origin?: BlockPos;
}

export class AreaBuilder {
    readonly fills: AreaFill[] = [];
    fill(from: BlockPos, to: BlockPos, block: BlockArg, options: FillOptions = {}): this {
        this.fills.push({
            from, to, block: blockRef(block), update: options.update ?? false,
            ...(options.versions ? { versions: options.versions } : {}),
            ...(options.optional ? { optional: true } : {}),
        });
        return this;
    }
    set(pos: BlockPos, block: BlockArg, options: FillOptions = {}): this {
        return this.fill(pos, pos, block, options);
    }
    /** A square floor at y=-1, `radius` blocks around the origin. */
    floor(block: BlockArg, radius = 8): this {
        return this.fill([-radius, -1, -radius], [radius, -1, radius], block);
    }
    /** Glass walls around a floor of `radius`, `height` blocks high, so a run cannot leave the area. */
    walls(radius = 8, height = 4, block: BlockArg = 'glass'): this {
        const r = radius + 1;
        this.fill([-r, -1, -r], [r, height, -r], block);
        this.fill([-r, -1, r], [r, height, r], block);
        this.fill([-r, -1, -r], [-r, height, r], block);
        this.fill([r, -1, -r], [r, height, r], block);
        return this;
    }
}

export interface AreaOptions {
    /** Half size around the origin: [x, yDown, z]; the box spans y from -yDown to `up`. */
    readonly radius?: number;
    readonly down?: number;
    readonly up?: number;
    /** An explicit box to clear, [minX, minY, minZ, maxX, maxY, maxZ] (else from radius/down/up and the fills). */
    readonly box?: readonly [number, number, number, number, number, number];
    /** The area's own absolute origin (far coordinates); the recorder's fixed origin when absent. */
    readonly origin?: BlockPos;
}

/** An area at the fixed origin; the recorder clears the box and places the fills before each case. */
export function area(name: string, options: AreaOptions, build: (a: AreaBuilder) => void): Area {
    // (the clients run one view distance whatever the area: the header says which. An area cannot ask for another.)
    if ('viewDistance' in options) throw new Error(`area ${name}: an area has no view distance of its own`);
    const builder = new AreaBuilder();
    build(builder);
    const radius = options.radius ?? 12;
    const down = options.down ?? 4;
    const up = options.up ?? 16;
    let box: [number, number, number, number, number, number] = options.box ? [...options.box] : [-radius, -down, -radius, radius, up, radius];
    for (const fill of options.box ? [] : builder.fills) {
        box = [
            Math.min(box[0], fill.from[0], fill.to[0]), Math.min(box[1], fill.from[1], fill.to[1]), Math.min(box[2], fill.from[2], fill.to[2]),
            Math.max(box[3], fill.from[0], fill.to[0]), Math.max(box[4], fill.from[1], fill.to[1]), Math.max(box[5], fill.from[2], fill.to[2]),
        ];
    }
    return { kind: 'area', name, box, fills: builder.fills, ...(options.origin ? { origin: options.origin } : {}) };
}

/** A flat floor of one block, walled in. */
export function floorArea(block: BlockArg, radius = 10): Area {
    const name = typeof block === 'string' ? block : `${block.name}_${Object.values(block.props).join('_')}`;
    return area(`floor_${name}_${radius}`, { radius: radius + 2 }, a => a.floor(block, radius).walls(radius));
}

// ---------------------------------------------------------------------------------------------
// Setup

export interface EffectSpec { readonly id: EffectName; readonly amplifier?: number; readonly duration?: number; readonly ambient?: boolean; readonly visible?: boolean }

export interface ModifierSpec {
    readonly name: string;
    readonly amount: number;
    readonly operation: 'add_value' | 'add_multiplied_base' | 'add_multiplied_total';
}

export interface AttributeSpec { readonly base?: number; readonly modifiers?: readonly ModifierSpec[] }

export interface ItemSpec {
    readonly item: ItemName;
    readonly enchantments?: Partial<Record<EnchantmentName, number>>;
    readonly count?: number;
}

export type EquipmentSlot = 'head' | 'chest' | 'legs' | 'feet' | 'mainhand' | 'offhand';

export interface SummonSpec {
    readonly ref: string;
    readonly type: EntityName;
    readonly pos: Vec3;
    readonly vel?: Vec3;
    readonly yRot?: number;
    readonly xRot?: number;
    readonly noAi?: boolean;
    readonly noGravity?: boolean;
    readonly nbt?: string;
    /** Ready to ride: tamed, saddled where it takes a saddle. */
    readonly ready?: boolean;
    /** Equipment slot (saddle, body, mainhand, ...) -> item id. */
    readonly equipment?: Readonly<Record<string, string>>;
    readonly chested?: boolean;
    /** Attribute (modern name) -> base value. */
    readonly attributes?: Readonly<Record<string, number>>;
}

/** A server command per release: the command of the newest release key the release reaches ("1.13": ..., "1.8": ...). */
export type VersionedCommand = string | Readonly<Record<string, string | null>>;

export interface SetupSpec {
    readonly gameMode?: 'survival' | 'creative' | 'adventure' | 'spectator';
    readonly effects?: readonly EffectSpec[];
    readonly attributes?: Partial<Record<AttributeName, AttributeSpec>>;
    readonly equipment?: Partial<Record<EquipmentSlot, ItemName | ItemSpec>>;
    /** Inventory index (0-8 hotbar, 9-35 main, 36-39 armor, 40 offhand) -> item. */
    readonly inventory?: Readonly<Record<number, ItemName | ItemSpec>>;
    readonly selectedSlot?: number;
    readonly food?: number;
    /** Server commands at the end of the setup. */
    readonly commands?: readonly VersionedCommand[];
    readonly abilities?: { readonly mayfly?: boolean; readonly flying?: boolean; readonly flyingSpeed?: number; readonly walkingSpeed?: number };
    readonly summons?: readonly SummonSpec[];
    readonly mount?: string;
    readonly autoJump?: boolean;
    readonly allowFlight?: boolean;
}

export interface StartSpec {
    readonly pos: Vec3;
    readonly yRot: number;
    readonly xRot: number;
    readonly vel?: Vec3;
    /** Wait on the ground before the body starts (false: the body starts on the arrival tick). */
    readonly grounded: boolean;
    /** Rest here before the teleport to the start (a fall starting mid-air). */
    readonly rest?: Vec3;
    /** Wait until still at the rest point (false: mounts that never stand still). */
    readonly settle?: boolean;
}

/** The start position: block-centred by default (at(0, 0, 0) stands on the floor's middle block). */
export function at(x: number, y: number, z: number, options: { yRot?: number; xRot?: number; vel?: Vec3; grounded?: boolean; centre?: boolean } = {}): StartSpec {
    const centre = options.centre ?? true;
    return {
        pos: centre ? [x + 0.5, y, z + 0.5] : [x, y, z],
        yRot: options.yRot ?? 0,
        xRot: options.xRot ?? 0,
        ...(options.vel ? { vel: options.vel } : {}),
        grounded: options.grounded ?? y === 0,
    };
}

// ---------------------------------------------------------------------------------------------
// Conditions

export const cond = {
    onGround: (): Condition => ({ op: 'onGround' }),
    inWater: (): Condition => ({ op: 'inWater' }),
    inLava: (): Condition => ({ op: 'inLava' }),
    fallFlying: (): Condition => ({ op: 'fallFlying' }),
    stopped: (epsilon = 1e-4): Condition => ({ op: 'stopped', epsilon }),
    collidedHorizontally: (): Condition => ({ op: 'collidedHorizontally' }),
    under: (block: BlockName): Condition => ({ op: 'touching', block, how: 'under' }),
    on: (block: BlockName): Condition => ({ op: 'touching', block, how: 'on' }),
    in: (block: BlockName): Condition => ({ op: 'touching', block, how: 'in' }),
    against: (block: BlockName): Condition => ({ op: 'touching', block, how: 'against' }),
    cmp: (field: Extract<Condition, { op: 'cmp' }>['field'], cmp: '<' | '<=' | '>' | '>=', value: number): Condition => ({ op: 'cmp', field, cmp, value }),
    and: (...all: Condition[]): Condition => ({ op: 'and', all }),
    or: (...any: Condition[]): Condition => ({ op: 'or', any }),
    not: (c: Condition): Condition => ({ op: 'not', cond: c }),
};

// ---------------------------------------------------------------------------------------------
// Server actions (version-neutral; compile.ts resolves names)

export type ServerActionSpec =
    | { readonly op: 'velocity'; readonly target?: string; readonly vel: Vec3 }
    | { readonly op: 'knockback'; readonly strength: number; readonly dx: number; readonly dz: number }
    | { readonly op: 'teleport'; readonly pos: Vec3; readonly yRot?: number; readonly xRot?: number; readonly relative?: readonly ('x' | 'y' | 'z' | 'yRot' | 'xRot')[] }
    | { readonly op: 'explode'; readonly pos: Vec3; readonly power: number }
    | { readonly op: 'setBlock'; readonly pos: BlockPos; readonly block: BlockRef; readonly update: boolean }
    | { readonly op: 'fill'; readonly from: BlockPos; readonly to: BlockPos; readonly block: BlockRef; readonly update: boolean }
    | { readonly op: 'effect'; readonly effect: EffectSpec }
    | { readonly op: 'removeEffect'; readonly id: EffectName }
    | { readonly op: 'clearEffects' }
    | { readonly op: 'food'; readonly food: number }
    | { readonly op: 'commands'; readonly command: VersionedCommand }
    | { readonly op: 'attribute'; readonly id: AttributeName; readonly spec: AttributeSpec }
    | { readonly op: 'abilities'; readonly mayfly?: boolean; readonly flying?: boolean; readonly flyingSpeed?: number; readonly walkingSpeed?: number }
    | { readonly op: 'gameMode'; readonly gameMode: NonNullable<SetupSpec['gameMode']> }
    | { readonly op: 'summon'; readonly summon: SummonSpec }
    | { readonly op: 'mount'; readonly ref: string }
    | { readonly op: 'dismount' }
    | { readonly op: 'remove'; readonly ref: string }
    | { readonly op: 'equip'; readonly slot: EquipmentSlot; readonly item: ItemName | ItemSpec }
    | { readonly op: 'command'; readonly command: string }
    | { readonly op: 'tabList'; readonly header: string; readonly footer: string }
    | { readonly op: 'blockDamage'; readonly pos: BlockPos; readonly stage: number }
    /** The client forgets the chunk column of this block, which the server goes on tracking; the mod sends it again after the case. */
    | { readonly op: 'forgetChunk'; readonly pos: BlockPos }
    | { readonly op: 'kick'; readonly reason: string }
    | { readonly op: 'resourcePack'; readonly url: string; readonly packHash: string; readonly required: boolean; readonly prompt?: string; readonly pop: boolean }
    | { readonly op: 'respawnPoint'; readonly pos: BlockPos }
    /** The player's own Entity.setNoGravity: no vanilla command reaches a player (none before 1.10, where the case skips). */
    | { readonly op: 'noGravity'; readonly noGravity: boolean };

export const srv = {
    tabList: (header: string, footer: string): ServerActionSpec => ({ op: 'tabList', header, footer }),
    blockDamage: (pos: BlockPos, stage: number): ServerActionSpec => ({ op: 'blockDamage', pos, stage }),
    forgetChunk: (pos: BlockPos): ServerActionSpec => ({ op: 'forgetChunk', pos }),
    kick: (reason: string): ServerActionSpec => ({ op: 'kick', reason }),
    resourcePack: (url: string, packHash: string, required: boolean, prompt: string | undefined, pop: boolean): ServerActionSpec =>
        ({ op: 'resourcePack', url, packHash, required, ...(prompt ? { prompt } : {}), pop }),
    respawnPoint: (pos: BlockPos): ServerActionSpec => ({ op: 'respawnPoint', pos }),
    noGravity: (noGravity: boolean): ServerActionSpec => ({ op: 'noGravity', noGravity }),
    velocity: (vel: Vec3, target?: string): ServerActionSpec => ({ op: 'velocity', vel, ...(target ? { target } : {}) }),
    knockback: (strength: number, dx: number, dz: number): ServerActionSpec => ({ op: 'knockback', strength, dx, dz }),
    teleport: (pos: Vec3, options: { yRot?: number; xRot?: number; relative?: ('x' | 'y' | 'z' | 'yRot' | 'xRot')[] } = {}): ServerActionSpec => ({ op: 'teleport', pos, ...options }),
    explode: (pos: Vec3, power: number): ServerActionSpec => ({ op: 'explode', pos, power }),
    setBlock: (pos: BlockPos, block: BlockArg, update = true): ServerActionSpec => ({ op: 'setBlock', pos, block: blockRef(block), update }),
    fill: (from: BlockPos, to: BlockPos, block: BlockArg, update = true): ServerActionSpec => ({ op: 'fill', from, to, block: blockRef(block), update }),
    effect: (id: EffectName, amplifier = 0, duration = -1): ServerActionSpec => ({ op: 'effect', effect: { id, amplifier, duration } }),
    removeEffect: (id: EffectName): ServerActionSpec => ({ op: 'removeEffect', id }),
    clearEffects: (): ServerActionSpec => ({ op: 'clearEffects' }),
    food: (food: number): ServerActionSpec => ({ op: 'food', food }),
    /** A command per release ({ "1.13": "...", "1.8": "..." }): none for a release before every key. */
    commands: (command: VersionedCommand): ServerActionSpec => ({ op: 'commands', command }),
    attribute: (id: AttributeName, spec: AttributeSpec): ServerActionSpec => ({ op: 'attribute', id, spec }),
    abilities: (abilities: { mayfly?: boolean; flying?: boolean; flyingSpeed?: number; walkingSpeed?: number }): ServerActionSpec => ({ op: 'abilities', ...abilities }),
    gameMode: (gameMode: NonNullable<SetupSpec['gameMode']>): ServerActionSpec => ({ op: 'gameMode', gameMode }),
    summon: (summon: SummonSpec): ServerActionSpec => ({ op: 'summon', summon }),
    mount: (ref: string): ServerActionSpec => ({ op: 'mount', ref }),
    dismount: (): ServerActionSpec => ({ op: 'dismount' }),
    remove: (ref: string): ServerActionSpec => ({ op: 'remove', ref }),
    equip: (slot: EquipmentSlot, item: ItemName | ItemSpec): ServerActionSpec => ({ op: 'equip', slot, item }),
    command: (command: string): ServerActionSpec => ({ op: 'command', command }),
};

// ---------------------------------------------------------------------------------------------
// Steps

export type StepSpec =
    | { readonly op: 'hold'; readonly keys: readonly Key[] }
    | { readonly op: 'release'; readonly keys: readonly Key[] }
    | { readonly op: 'releaseAll' }
    | { readonly op: 'press'; readonly keys: readonly Key[]; readonly ticks: number }
    | { readonly op: 'look'; readonly yRot: number; readonly xRot: number }
    | { readonly op: 'turn'; readonly dyRot: number; readonly dxRot: number; readonly ticks: number }
    | { readonly op: 'ticks'; readonly ticks: number }
    | { readonly op: 'until'; readonly cond: Condition; readonly max: number; readonly soft?: boolean }
    | { readonly op: 'stable'; readonly ticks: number; readonly max: number; readonly soft?: boolean }
    | { readonly op: 'stopped'; readonly ticks: number; readonly max: number; readonly soft?: boolean }
    | { readonly op: 'selectSlot'; readonly slot: number }
    | { readonly op: 'server'; readonly action: ServerActionSpec }
    | { readonly op: 'client'; readonly client: ClientActionSpec }
    | { readonly op: 'screen'; readonly screen: string; readonly max: number; readonly soft?: boolean };

/** A client action as a case writes it: its item is a name the release may not have. */
export type ClientActionSpec = Omit<ClientAction, 'item'> & { readonly item?: { readonly id: string; readonly count?: number } };

/** A step, or a list of them (so helpers can return several). */
export type StepInput = StepSpec | readonly StepInput[];

const keyList = (keys: Key | readonly Key[]): readonly Key[] => (typeof keys === 'string' ? [keys] : keys);

export const hold = (...keys: Key[]): StepSpec => ({ op: 'hold', keys });
export const release = (...keys: Key[]): StepSpec => ({ op: 'release', keys });
export const releaseAll = (): StepSpec => ({ op: 'releaseAll' });
/** Hold `keys` for `ticks` ticks, then release them. */
export const press = (keys: Key | readonly Key[], ticks = 1): StepSpec => ({ op: 'press', keys: keyList(keys), ticks });
export const look = (yRot: number, xRot = 0): StepSpec => ({ op: 'look', yRot, xRot });
/** Turn by (dyRot, dxRot) degrees spread evenly over `ticks` ticks. */
export const turn = (dyRot: number, dxRot: number, ticks: number): StepSpec => ({ op: 'turn', dyRot, dxRot, ticks });
export const ticks = (n: number): StepSpec => ({ op: 'ticks', ticks: n });
/** Run ticks until `c` holds after a tick; the case is invalid when it does not within `max` (unless soft). */
export const until = (c: Condition, max: number, options: { soft?: boolean } = {}): StepSpec => ({ op: 'until', cond: c, max, ...(options.soft ? { soft: true } : {}) });
/** Run ticks until the velocity no longer changes (steady motion counts: a flow carrying the player), at least `n` ticks. */
export const stable = (n = 3, max = 400, options: { soft?: boolean } = {}): StepSpec => ({ op: 'stable', ticks: n, max, ...(options.soft ? { soft: true } : {}) });
/** Run ticks until the player has not moved for `n` ticks in a row. */
export const stopped = (n = 3, max = 400, options: { soft?: boolean } = {}): StepSpec => ({ op: 'stopped', ticks: n, max, ...(options.soft ? { soft: true } : {}) });
export const selectSlot = (slot: number): StepSpec => ({ op: 'selectSlot', slot });
/** A server action between this client tick and the server's; its packets arrive before the next tick. */
export const server = (action: ServerActionSpec): StepSpec => ({ op: 'server', action });

// ---------------------------------------------------------------------------------------------
// Scenarios

export type ExpectSpec =
    | { readonly op: 'touched'; readonly block: BlockName; readonly how: 'on' | 'in' | 'against' | 'under' }
    | { readonly op: 'corrections'; readonly allowed: boolean }
    | { readonly op: 'staysInArea' }
    | { readonly op: 'final'; readonly cond: Condition };

export const expect = {
    on: (block: BlockName): ExpectSpec => ({ op: 'touched', block, how: 'on' }),
    in: (block: BlockName): ExpectSpec => ({ op: 'touched', block, how: 'in' }),
    against: (block: BlockName): ExpectSpec => ({ op: 'touched', block, how: 'against' }),
    under: (block: BlockName): ExpectSpec => ({ op: 'touched', block, how: 'under' }),
    noCorrections: (): ExpectSpec => ({ op: 'corrections', allowed: false }),
    correctionsAllowed: (): ExpectSpec => ({ op: 'corrections', allowed: true }),
    staysInArea: (): ExpectSpec => ({ op: 'staysInArea' }),
    final: (c: Condition): ExpectSpec => ({ op: 'final', cond: c }),
};

export interface ScenarioSpec {
    /** The releases it runs on ("*" by default), e.g. ">=1.19.4". */
    readonly versions?: string;
    readonly tags?: readonly string[];
    /** The screens it opens stay open. */
    readonly features?: boolean;
    /** The player can be hurt and die. */
    readonly mortal?: boolean;
    readonly difficulty?: string;
    /** It ends the connection. */
    readonly disconnects?: boolean;
    readonly area: Area;
    readonly start: StartSpec;
    readonly setup?: SetupSpec;
    readonly body: readonly StepInput[];
    readonly expect?: readonly ExpectSpec[];
    /** Path checks in physics-data-generator's syntax, carried along (not enforced yet). */
    readonly checks?: readonly string[];
    /** The release cannot record this scenario yet: compiled as skipped with this reason. */
    readonly unsupported?: string;
    /**
     * The blocks the scenario is about (states allowed: "ladder[waterlogged=true]"): a release without one of them
     * skips it, whatever its fills' version gates leave in the area (else it would record an empty lane).
     */
    readonly requires?: readonly string[];
    /**
     * Why two runs of this scenario need not match (the server's timing decides part of it, as when the server moves
     * an entity the player touches): each recording is still self-consistent, but --verify reports it apart.
     */
    readonly serverTimed?: string;
    /** The release from which it no longer holds, if any. */
    readonly serverTimedUntil?: string;
}

/** What the scenario may depend on of the release it is compiled for. */
export interface VersionContext {
    readonly version: string;
    atLeast(version: string): boolean;
}

export interface Scenario {
    readonly kind: 'scenario';
    readonly id: string;
    readonly spec: ScenarioSpec | ((ctx: VersionContext) => ScenarioSpec);
}

/** A scenario; its spec may depend on the release (`v => v.atLeast('1.21.2') ? ... : ...`). */
export function scenario(id: string, spec: ScenarioSpec | ((ctx: VersionContext) => ScenarioSpec)): Scenario {
    if (!/^[a-z0-9_]+(\/[a-z0-9_.-]+)*$/.test(id)) throw new Error(`scenario id "${id}": use lowercase path segments`);
    return { kind: 'scenario', id, spec };
}

/** Every combination of the axes' values, mapped: `matrix({ a: [1, 2], b: ['x'] }, ({ a, b }) => ...)`. */
export function matrix<const A extends Record<string, readonly unknown[]>, R>(
    axes: A,
    make: (combo: { [K in keyof A]: A[K][number] }) => R,
): R[] {
    let combos: Record<string, unknown>[] = [{}];
    for (const [key, values] of Object.entries(axes)) {
        combos = combos.flatMap(combo => values.map(value => ({ ...combo, [key]: value })));
    }
    return combos.map(combo => make(combo as { [K in keyof A]: A[K][number] }));
}

/** The eight horizontal directions as movement keys, with a short name. */
export const DIRS8 = [
    { name: 'f', keys: ['forward'] },
    { name: 'b', keys: ['back'] },
    { name: 'l', keys: ['left'] },
    { name: 'r', keys: ['right'] },
    { name: 'fl', keys: ['forward', 'left'] },
    { name: 'fr', keys: ['forward', 'right'] },
    { name: 'bl', keys: ['back', 'left'] },
    { name: 'br', keys: ['back', 'right'] },
] as const satisfies readonly { name: string; keys: readonly Key[] }[];
