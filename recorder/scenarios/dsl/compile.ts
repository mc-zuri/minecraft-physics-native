// Compiles a version-neutral scenario for one release: resolves every block, property, effect,
// attribute, entity, item and enchantment name with that release's minecraft-data, gates fills
// and commands by release, flattens the steps, and hashes the result. A name the release lacks
// skips the scenario with the reason (an optional fill is left out instead).

import { legacyBlock, legacyEntity, legacyItem } from './legacy-blocks.ts';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type {
    CompiledArea, CompiledAttribute, CompiledEffect, CompiledFill, CompiledItem, CompiledScenario, CompiledSetup, CompiledSummon,
    Condition, Expectation, ServerAction, Step, ClientAction } from '../../schema/scenario.ts';
import { stableStringify } from '../../schema/json.ts';
import type {
    AttributeSpec, BlockRef, EffectSpec, ExpectSpec, ItemSpec, Scenario, ScenarioSpec, ServerActionSpec, StepInput,
    StepSpec, SummonSpec, VersionContext, VersionedCommand,
} from './core.ts';
import { compareVersions, inRange, snake, versionAtLeast } from './names.ts';
import { rawBlock } from './core.ts';

const require = createRequire(import.meta.url);
const mcData = require('minecraft-data') as (version: string) => McData | undefined;

interface McData {
    blocksByName: Record<string, { name: string; states?: { name: string; type: string; values?: string[]; num_values: number }[] }>;
    effectsArray: { name: string }[];
    attributesArray?: { resource: string }[];
    entitiesByName: Record<string, unknown>;
    itemsByName: Record<string, unknown>;
    enchantmentsByName: Record<string, unknown>;
}

/** Renamed registry entries: the modern name -> [older name, the release the modern name starts]. */
const BLOCK_RENAMES: Record<string, readonly [string, string]> = {
    short_grass: ['grass', '1.20.3'],
    dirt_path: ['grass_path', '1.17'],
};
const ITEM_RENAMES: Record<string, readonly [string, string]> = {
    short_grass: ['grass', '1.20.3'],
    dirt_path: ['grass_path', '1.17'],
};
/** Before 1.21.2 every boat is one entity type (with a wood variant): the modern id -> the entity minecraft-data knows. */
/** The boats before 1.13, whose items do not name their wood: 1.8's one boat, from 1.9 BoatEntity.Type (1.8.9 BoatEntity.java has none, 1.9.4 :720-726, 1.12.2 :748). */
const LEGACY_BOATS = (version: string): ReadonlySet<string> => new Set(versionAtLeast(version, '1.9') ? ['oak_boat', 'spruce_boat', 'birch_boat', 'jungle_boat', 'acacia_boat', 'dark_oak_boat'] : ['oak_boat']);
// Entities a release registers only behind an experimental feature flag (EntityType.Builder.requiredFeatures, per release in
// net/minecraft/world/entity/EntityType.java): a default world has none of them, so the recorder could only skip them.
const EXPERIMENTAL_ENTITIES: Readonly<Record<string, string>> = {
    camel: '>=1.19.3 <=1.19.4', // FeatureFlags.UPDATE_1_20
    sniffer: '=1.19.4', // FeatureFlags.UPDATE_1_20
    breeze: '>=1.20.3 <=1.20.6', // FeatureFlags.UPDATE_1_21
    wind_charge: '>=1.20.3 <=1.20.6', // FeatureFlags.UPDATE_1_21
    bogged: '>=1.20.5 <=1.20.6', // FeatureFlags.UPDATE_1_21
    breeze_wind_charge: '>=1.20.5 <=1.20.6', // FeatureFlags.UPDATE_1_21
    ominous_item_spawner: '>=1.20.5 <=1.20.6', // FeatureFlags.UPDATE_1_21
    creaking: '>=1.21.2 <=1.21.3', // FeatureFlags.WINTER_DROP
    creaking_transient: '>=1.21.2 <=1.21.3', // FeatureFlags.WINTER_DROP
};
const BOAT_ENTITIES = /^(?:(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_(chest_)?boat|bamboo_(chest_)?raft)$/;

const GENERIC_FROM_1_20_5 = new Set(['gravity', 'jump_strength', 'step_height', 'scale', 'safe_fall_distance', 'fall_damage_multiplier']);

export class Skip extends Error {}

export interface CompileResult {
    readonly scenario?: CompiledScenario;
    readonly skip?: string;
}

/** The command of the newest release key the release reaches; null when it reaches none. */
export function commandFor(command: VersionedCommand, version: string): string | null {
    if (typeof command === 'string') return command;
    const keys = Object.keys(command).filter(v => versionAtLeast(version, v)).sort(compareVersions);
    return keys.length > 0 ? command[keys.at(-1)!] ?? null : null;
}

export class Resolver {
    readonly version: string;
    readonly data: McData;

    constructor(version: string) {
        const data = mcData(version);
        if (!data) throw new Error(`minecraft-data has no ${version}`);
        this.version = version;
        this.data = data;
    }

    private renamed(name: string, renames: Record<string, readonly [string, string]>): string {
        const rename = renames[name];
        return rename && !versionAtLeast(this.version, rename[1]) ? rename[0] : name;
    }

    /** Before 1.13 blocks go by other names and variants, and minecraft-data has no states to check them with. */
    private legacyState(name: string, props: readonly (readonly [string, string])[]): string {
        const legacy = legacyBlock(name, props, this.version);
        if (!legacy) throw new Skip(`no waterlogged ${name} before 1.13`);
        if (!this.data.blocksByName[legacy.name]) throw new Skip(`no block ${name}`);
        const parts = [...legacy.props].map(([k, v]) => `${k}=${v}`).sort();
        return parts.length === 0 ? legacy.name : `${legacy.name}[${parts.join(',')}]`;
    }

    /** A block ref as the release's state string. */
    block(ref: BlockRef): string {
        if (ref.raw !== undefined) return this.rawState(ref.raw);
        if (!versionAtLeast(this.version, '1.13')) return this.legacyState(ref.name, Object.entries(ref.props).map(([k, v]) => [k, String(v)] as const));
        const name = this.renamed(ref.name, BLOCK_RENAMES);
        const block = this.data.blocksByName[name];
        if (!block) throw new Skip(`no block ${ref.name}`);
        return this.withProps(name, Object.entries(ref.props).map(([k, v]) => [k, String(v)] as const));
    }

    private rawState(state: string): string {
        if (state.startsWith('#')) {
            // #name:data, a block as a world saved before the flattening has it
            const [name, data] = state.slice(1).split(':');
            if (versionAtLeast(this.version, '1.13') || !this.data.blocksByName[name!]) throw new Skip(`no block ${state}`);
            return `${name}[#=${data}]`;
        }
        const open = state.indexOf('[');
        const props = open < 0 ? [] : state.slice(open + 1, -1).split(',').filter(Boolean).map(pair => {
            const [k, v] = pair.split('=');
            return [k!.trim(), v!.trim()] as const;
        });
        if (!versionAtLeast(this.version, '1.13')) return this.legacyState(open < 0 ? state : state.slice(0, open), props);
        const name = this.renamed(open < 0 ? state : state.slice(0, open), BLOCK_RENAMES);
        if (!this.data.blocksByName[name]) throw new Skip(`no block ${name}`);
        return this.withProps(name, props);
    }

    private withProps(name: string, props: readonly (readonly [string, string])[]): string {
        if (props.length === 0) return name;
        const block = this.data.blocksByName[name]!;
        const parts = props.map(([prop, text]) => {
            const state = block.states?.find(s => s.name === prop);
            if (!state) throw new Skip(`block ${name} has no property ${prop}`);
            const values = state.type === 'bool' ? ['true', 'false'] : state.values ?? [];
            if (values.length > 0 && !values.includes(text)) throw new Skip(`block ${name} has no ${prop}=${text}`);
            return `${prop}=${text}`;
        });
        return `${name}[${parts.sort().join(',')}]`;
    }

    /** Slot 40 is the off hand, which came with 1.9. */
    inventorySlot(slot: string): string {
        if (slot === '40' && !versionAtLeast(this.version, '1.9')) throw new Skip('no off hand before 1.9');
        return slot;
    }

    blockName(name: string): string {
        if (!versionAtLeast(this.version, '1.13')) {
            const legacy = legacyBlock(name, [], this.version);
            if (!legacy || !this.data.blocksByName[legacy.name]) throw new Skip(`no block ${name}`);
            return legacy.name;
        }
        const resolved = this.renamed(name, BLOCK_RENAMES);
        if (!this.data.blocksByName[resolved]) throw new Skip(`no block ${name}`);
        return resolved;
    }

    effect(spec: EffectSpec): CompiledEffect {
        return {
            id: this.effectId(spec.id),
            amplifier: spec.amplifier ?? 0,
            duration: spec.duration ?? -1,
            ...(spec.ambient !== undefined ? { ambient: spec.ambient } : {}),
            ...(spec.visible !== undefined ? { visible: spec.visible } : {}),
        };
    }

    effectId(id: string): string {
        if (!this.data.effectsArray.some(e => snake(e.name) === id)) throw new Skip(`no effect ${id}`);
        return id;
    }

    /** The release's attribute registry name: "generic.movement_speed" before 1.20.5. */
    attributeId(id: string): string {
        const bare = id.replace(/^(minecraft:)?(generic|player|zombie|horse)\./, '');
        // (minecraft-data's list for 1.20.5 and 1.20.6 is the one before these moved to generic: EntityAttributes of 1.20.5)
        if (GENERIC_FROM_1_20_5.has(bare) && versionAtLeast(this.version, '1.20.5') && !versionAtLeast(this.version, '1.21')) return `generic.${bare}`;
        // (before 1.16 the same names in camel case: generic.movementSpeed)
        const plain = (name: string) => name.replace(/^(generic|player|zombie|horse)\./, '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
        const found = (this.data.attributesArray ?? [])
            .map(a => a.resource.replace(/^minecraft:/, ''))
            .find(resource => resource === id || plain(resource) === plain(bare));
        if (!found) throw new Skip(`no attribute ${id}`);
        return found;
    }

    /**
     * A summoned mob's attribute. step_height has no attribute before 1.20.5 (each entity type fixes it): it
     * becomes "fixed:step_height", no attribute's name, and the mod skips the case unless the type's own step height is
     * that value.
     */
    mobAttributeId(id: string): string {
        if (id === 'step_height' && !versionAtLeast(this.version, '1.20.5')) return 'fixed:step_height';
        return this.attributeId(id);
    }

    attribute(scenarioId: string, id: string, spec: AttributeSpec): CompiledAttribute {
        const resolved = this.attributeId(id);
        return {
            id: resolved,
            ...(spec.base !== undefined ? { base: spec.base } : {}),
            ...(spec.modifiers ? {
                modifiers: spec.modifiers.map(m => ({
                    uuid: nameUuid(`${scenarioId}/${id}/${m.name}`),
                    key: `recorder:${m.name}`,
                    amount: m.amount,
                    operation: m.operation,
                })),
            } : {}),
        };
    }

    entity(type: string): string {
        // (a second player, which the mod makes itself: FakeTarget)
        if (type === 'player') return type;
        if (!versionAtLeast(this.version, '1.11')) {
            // (a boat's variant the mod makes of the id, as on the later releases)
            if (LEGACY_BOATS(this.version).has(type) && this.data.entitiesByName.Boat) return type;
            const legacy = legacyEntity(type);
            if (this.data.entitiesByName[legacy.split(':')[0]!]) return legacy;
            // (minecraft-data has the rideable cart alone before 1.11; the others are entities all the same, 1.8.9 EntityList)
            if (/^Minecart/.test(legacy)) return legacy;
            throw new Skip(`no entity ${type}`);
        }
        if (EXPERIMENTAL_ENTITIES[type] && inRange(this.version, EXPERIMENTAL_ENTITIES[type])) throw new Skip(`entity ${type} is an experiment in ${this.version}`);
        if (this.data.entitiesByName[type]) return type;
        if (type === 'command_block_minecart' && this.data.entitiesByName.commandblock_minecart) return 'commandblock_minecart';
        // a modern boat id: before 1.21.2 one boat (chest_boat from 1.19) entity with a variant
        const boat = BOAT_ENTITIES.exec(type);
        if (boat && !versionAtLeast(this.version, '1.21.2')) {
            const chest = type.includes('chest');
            // the wood is a variant the release must have too: its boat item says (and the bamboo raft and the cherry boat are
            // experiments in 1.19.3 and 1.19.4)
            const wood = !/^(?:bamboo|cherry)_/.test(type) || versionAtLeast(this.version, '1.20');
            const held = versionAtLeast(this.version, '1.13') ? this.data.itemsByName[type] : LEGACY_BOATS(this.version).has(type);
            if (this.data.entitiesByName[chest ? 'chest_boat' : 'boat'] && held && wood) return type;
        }
        throw new Skip(`no entity ${type}`);
    }

    item(spec: string | ItemSpec): CompiledItem {
        const item: ItemSpec = typeof spec === 'string' ? { item: spec as ItemSpec['item'] } : spec;
        const [legacyId, damage] = versionAtLeast(this.version, '1.13') ? [item.item as string, 0] : legacyItem(item.item);
        const id = versionAtLeast(this.version, '1.13') ? this.renamed(legacyId, ITEM_RENAMES) : legacyId;
        // (air is no item in minecraft-data before 1.11, but the game has it: an empty slot to put)
        if (!this.data.itemsByName[id] && id !== 'air') throw new Skip(`no item ${item.item}`);
        const enchantments: Record<string, number> = {};
        for (const [name, level] of Object.entries(item.enchantments ?? {})) {
            if (!this.data.enchantmentsByName[name]) throw new Skip(`no enchantment ${name}`);
            enchantments[name] = level as number;
        }
        return { id, count: item.count ?? 1, ...(damage ? { damage } : {}), enchantments };
    }

    itemId(id: string): string {
        return this.item(id).id;
    }

    summon(spec: SummonSpec): CompiledSummon {
        return {
            ref: spec.ref, type: this.entity(spec.type), pos: spec.pos,
            ...(spec.vel ? { vel: spec.vel } : {}),
            ...(spec.yRot !== undefined ? { yRot: spec.yRot } : {}),
            ...(spec.xRot !== undefined ? { xRot: spec.xRot } : {}),
            noAi: spec.noAi ?? true,
            ...(spec.noGravity !== undefined ? { noGravity: spec.noGravity } : {}),
            ...(spec.nbt ? { nbt: spec.nbt } : {}),
            ...(spec.ready ? { ready: true } : {}),
            ...(spec.chested ? { chested: true } : {}),
            ...(spec.equipment && Object.keys(spec.equipment).length > 0
                ? { equipment: Object.fromEntries(Object.entries(spec.equipment).map(([slot, id]) => [slot, this.itemId(id)])) } : {}),
            ...(spec.attributes && Object.keys(spec.attributes).length > 0
                ? { attributes: Object.fromEntries(Object.entries(spec.attributes).map(([id, base]) => [this.mobAttributeId(id), base])) } : {}),
        };
    }

    condition(c: Condition): Condition {
        switch (c.op) {
            case 'touching': return { ...c, block: this.blockName(c.block) };
            case 'and': return { op: 'and', all: c.all.map(x => this.condition(x)) };
            case 'or': return { op: 'or', any: c.any.map(x => this.condition(x)) };
            case 'not': return { op: 'not', cond: this.condition(c.cond) };
            default: return c;
        }
    }
}

/** A name-based (version 3) UUID, as Java's UUID.nameUUIDFromBytes makes it. */
export function nameUuid(name: string): string {
    const hash = createHash('md5').update(name, 'utf8').digest();
    hash[6] = (hash[6]! & 0x0f) | 0x30;
    hash[8] = (hash[8]! & 0x3f) | 0x80;
    const hex = hash.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function flatten(steps: readonly StepInput[]): StepSpec[] {
    const out: StepSpec[] = [];
    for (const step of steps) {
        if (Array.isArray(step)) out.push(...flatten(step as readonly StepInput[]));
        else out.push(step as StepSpec);
    }
    return out;
}

/** The action for the release, or null when it has none there (a versioned command no key of which it reaches). */
function serverAction(r: Resolver, scenarioId: string, action: ServerActionSpec): ServerAction | null {
    switch (action.op) {
        case 'setBlock': return { op: 'setBlock', pos: action.pos, block: r.block(action.block), update: action.update };
        case 'fill': return { op: 'fill', from: action.from, to: action.to, block: r.block(action.block), update: action.update };
        case 'effect': return { op: 'effect', effect: r.effect(action.effect) };
        case 'removeEffect': return { op: 'removeEffect', id: r.effectId(action.id) };
        case 'attribute': return { op: 'attribute', attribute: r.attribute(scenarioId, action.id, action.spec) };
        case 'summon': return { op: 'summon', summon: r.summon(action.summon) };
        case 'equip': return { op: 'equip', slot: action.slot, item: r.item(action.item) };
        case 'commands': {
            const command = commandFor(action.command, r.version);
            return command === null ? null : { op: 'command', command };
        }
        default: return action;
    }
}

function step(r: Resolver, scenarioId: string, s: StepSpec): Step | null {
    switch (s.op) {
        case 'until': return { ...s, cond: r.condition(s.cond) };
        case 'server': {
            const action = serverAction(r, scenarioId, s.action);
            return action === null ? null : { op: 'server', action };
        }
        case 'client': {
            const { item, ...client } = s.client;
            return { op: 'client', client: { ...client, ...(item ? { item: r.item({ item: item.id as ItemSpec['item'], count: item.count ?? 1 }) } : {}) } as ClientAction };
        }
        default: return s;
    }
}

function expectation(r: Resolver, e: ExpectSpec): Expectation {
    switch (e.op) {
        case 'touched': return { ...e, block: r.blockName(e.block) };
        case 'final': return { op: 'final', cond: r.condition(e.cond) };
        default: return e;
    }
}

function maxTicks(steps: readonly Step[]): number {
    let total = 0;
    for (const s of steps) {
        switch (s.op) {
            case 'press': case 'turn': case 'ticks': total += s.ticks; break;
            case 'until': case 'stable': case 'stopped': case 'screen': total += s.max; break;
            default: break;
        }
    }
    return total;
}

function validate(id: string, spec: ScenarioSpec, steps: readonly StepSpec[]): void {
    for (const s of steps) {
        if (('ticks' in s && (!Number.isInteger(s.ticks) || s.ticks < 0)) || ('max' in s && (!Number.isInteger(s.max) || s.max <= 0))) {
            throw new Error(`${id}: step ${JSON.stringify(s)} needs whole, non-negative tick counts`);
        }
    }
    // the summons as the case goes: what is alive at each step
    const alive = new Set<string>();
    const summon = (ref: string) => {
        if (alive.has(ref)) throw new Error(`${id}: summon ${ref} twice`);
        alive.add(ref);
    };
    const known = (what: string, ref: string) => {
        if (!alive.has(ref)) throw new Error(`${id}: ${what} of unknown summon ${ref}`);
    };
    for (const x of spec.setup?.summons ?? []) summon(x.ref);
    if (spec.setup?.mount) known('mount', spec.setup.mount);
    for (const s of steps) {
        if (s.op !== 'server') continue;
        const action = s.action;
        if (action.op === 'summon') summon(action.summon.ref);
        else if (action.op === 'mount') known('mount', action.ref);
        else if (action.op === 'remove') {
            known('remove', action.ref);
            alive.delete(action.ref);
        } else if (action.op === 'velocity' && action.target) known('velocity', action.target);
    }
}

function fills(r: Resolver, spec: ScenarioSpec): CompiledFill[] {
    const out: CompiledFill[] = [];
    for (const f of spec.area.fills) {
        if (!inRange(r.version, f.versions)) continue;
        let block: string;
        try {
            block = r.block(f.block);
        } catch (error) {
            if (error instanceof Skip && f.optional) continue;
            throw error;
        }
        out.push({ from: f.from, to: f.to, block, ...(f.update ? { update: true } : {}) });
    }
    return out;
}

export function compileScenario(scenario: Scenario, version: string): CompileResult {
    const ctx: VersionContext = { version, atLeast: v => versionAtLeast(version, v) };
    const spec = typeof scenario.spec === 'function' ? scenario.spec(ctx) : scenario.spec;
    if (!inRange(version, spec.versions)) return { skip: `outside ${spec.versions}` };
    if (spec.unsupported) return { skip: spec.unsupported };
    const r = new Resolver(version);
    // the blocks it is about, each on its own: a fill gated to other releases must not hide that one is missing
    for (const block of spec.requires ?? []) {
        try {
            r.block(rawBlock(block));
        } catch (error) {
            if (error instanceof Skip) return { skip: error.message };
            throw error;
        }
    }
    const steps = flatten(spec.body);
    validate(scenario.id, spec, steps);
    try {
        const area: CompiledArea = {
            name: spec.area.name,
            box: spec.area.box,
            fills: fills(r, spec),
            ...(spec.area.origin ? { origin: spec.area.origin } : {}),
        };
        const s = spec.setup ?? {};
        const setup: CompiledSetup = {
            gameMode: s.gameMode ?? 'survival',
            effects: (s.effects ?? []).map(e => r.effect(e)),
            attributes: Object.entries(s.attributes ?? {}).map(([id, a]) => r.attribute(scenario.id, id, a as AttributeSpec)),
            equipment: Object.fromEntries(Object.entries(s.equipment ?? {}).map(([slot, item]) => [slot, r.item(item as string | ItemSpec)])),
            inventory: Object.fromEntries(Object.entries(s.inventory ?? {}).map(([slot, item]) => [r.inventorySlot(slot), r.item(item as string | ItemSpec)])),
            selectedSlot: s.selectedSlot ?? 0,
            food: s.food ?? 20,
            ...(s.abilities ? { abilities: s.abilities } : {}),
            summons: (s.summons ?? []).map(x => r.summon(x)),
            ...(s.mount ? { mount: s.mount } : {}),
            commands: (s.commands ?? []).map(c => commandFor(c, version)).filter((c): c is string => c !== null),
            autoJump: s.autoJump ?? false,
            allowFlight: s.allowFlight ?? true,
        };
        const body = steps.map(x => step(r, scenario.id, x)).filter((x): x is Step => x !== null);
        const compiled = {
            id: scenario.id,
            tags: [...(spec.tags ?? [])],
            ...(spec.features ? { features: true } : {}),
            ...(spec.mortal ? { mortal: true } : {}),
            ...(spec.difficulty ? { difficulty: spec.difficulty } : {}),
            ...(spec.disconnects ? { disconnects: true } : {}),
            area,
            start: {
                pos: spec.start.pos, yRot: spec.start.yRot, xRot: spec.start.xRot, grounded: spec.start.grounded,
                ...(spec.start.vel ? { vel: spec.start.vel } : {}),
                ...(spec.start.rest ? { rest: spec.start.rest } : {}),
                settle: spec.start.settle ?? true,
            },
            setup,
            body,
            expect: (spec.expect ?? []).map(e => expectation(r, e)),
            ...(spec.checks && spec.checks.length > 0 ? { checks: [...spec.checks] } : {}),
            ...(spec.serverTimed && !(spec.serverTimedUntil && versionAtLeast(r.version, spec.serverTimedUntil)) ? { serverTimed: spec.serverTimed } : {}),
            maxTicks: maxTicks(body),
        };
        const hash = createHash('sha256').update(stableStringify(compiled)).digest('hex').slice(0, 16);
        return { scenario: { ...compiled, hash } };
    } catch (error) {
        if (error instanceof Skip) return { skip: error.message };
        throw error;
    }
}
