// Which release has which movement mechanic, and what stands for it: the first release is read from each release's own data, not
// remembered, and the cases from the catalog. A mechanic with no case is listed as one, so a gap reads as a gap. A mechanic this
// table has no data for says `source` with the file that shows it. It says what can be tested where; what came of it is the gate's.
//
//   node recorder/replay/capabilities.ts > docs/capability-table.md

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadModules } from '../scenarios/build.ts';

const require = createRequire(import.meta.url);

/** The registered releases, oldest first. */
export const RELEASES = ['1.8.8', '1.9.4', '1.10.2', '1.11.2', '1.12.2', '1.13.2', '1.14.4', '1.15', '1.15.1', '1.15.2', '1.16', '1.16.1', '1.16.2', '1.16.3', '1.16.4', '1.16.5',
    '1.17', '1.17.1', '1.18', '1.18.1', '1.18.2', '1.19', '1.19.1', '1.19.2', '1.19.3', '1.19.4', '1.20', '1.20.1', '1.20.2', '1.20.3', '1.20.4', '1.20.5', '1.20.6', '1.21', '1.21.1',
    '1.21.2', '1.21.3', '1.21.4', '1.21.5', '1.21.6', '1.21.7', '1.21.8', '1.21.9', '1.21.10', '1.21.11', '26.1', '26.1.1', '26.1.2', '26.2', '26.3'] as const;

export interface Mechanic {
    readonly kind: 'effect' | 'attribute' | 'enchantment' | 'entity' | 'pose' | 'ability' | 'projectile';
    readonly name: string;
    /** How the catalog's case ids name it. */
    readonly cases: RegExp;
    /** From the source where the data has no list: the release, and the file that shows it. */
    readonly source?: { readonly since: string; readonly file: string };
}

const m = (kind: Mechanic['kind'], name: string, cases: RegExp, source?: Mechanic['source']): Mechanic => ({ kind, name, cases, ...(source ? { source } : {}) });

// (wind_charged, oozing and infested are out: they act when the entity dies, and move no living player)
export const MECHANICS: readonly Mechanic[] = [
    m('effect', 'speed', /^e_speed_/), m('effect', 'slowness', /^e_slowness_/), m('effect', 'jump_boost', /^e_jump_boost|jump_boost/), m('effect', 'levitation', /^e_levitation/),
    m('effect', 'slow_falling', /slow_falling/), m('effect', 'dolphins_grace', /dolphin/), m('effect', 'weaving', /weaving/),
    m('attribute', 'movement_speed', /^e_attr_movement_speed|cf_ride_horse_zero_speed/), m('attribute', 'gravity', /^e_attr_gravity/), m('attribute', 'step_height', /attr_step_height/), m('attribute', 'jump_strength', /^e_attr_jump_strength/),
    m('attribute', 'scale', /^e_attr_scale|cf_scale/), m('attribute', 'safe_fall_distance', /safe/), m('attribute', 'fall_damage_multiplier', /fall_damage_multiplier/),
    m('attribute', 'water_movement_efficiency', /water_movement_efficiency/), m('attribute', 'movement_efficiency', /^e_attr_movement_efficiency|movement_efficiency/), m('attribute', 'sneaking_speed', /sneaking_speed/),
    m('attribute', 'burning_time', /burning_time/), m('attribute', 'bounciness', /bounciness/), m('attribute', 'air_drag_modifier', /air_drag/), m('attribute', 'friction_modifier', /friction_modifier/),
    m('enchantment', 'depth_strider', /depth_strider/), m('enchantment', 'soul_speed', /soul_speed/), m('enchantment', 'swift_sneak', /swift_sneak/), m('enchantment', 'frost_walker', /frost_walker/), m('enchantment', 'riptide', /riptide|^q_rain/), m('enchantment', 'feather_falling', /feather_falling/),
    m('pose', 'crouching', /sneak/, { since: '1.8.8', file: 'Player.updatePlayerPose (1.14), shiftKeyDown before' }), m('pose', 'swimming', /swim/, { since: '1.13.2', file: 'Player.java, Pose.SWIMMING' }),
    m('pose', 'fall_flying', /elytra/, { since: '1.9.4', file: 'LivingEntity.java, isFallFlying' }), m('pose', 'spin_attack', /riptide/, { since: '1.13.2', file: 'LivingEntity.java, isAutoSpinAttack' }), m('pose', 'sleeping', /sleep|bed/, { since: '1.8.8', file: 'Player.java' }),
    m('ability', 'flying', /^f_fly/, { since: '1.8.8', file: 'Abilities.java' }), m('ability', 'mayfly revoked', /ie_fly_revoked/, { since: '1.8.8', file: 'Abilities.java' }), m('ability', 'spectator', /spectator/, { since: '1.8.8', file: 'GameType.java' }), m('ability', 'invulnerable', /^hz_/, { since: '1.8.8', file: 'Abilities.java' }),
    m('entity', 'boat', /^v_boat|boat/), m('entity', 'minecart', /^mc_|minecart/), m('entity', 'horse', /horse/), m('entity', 'donkey', /donkey/), m('entity', 'mule', /mule/), m('entity', 'pig', /pig/), m('entity', 'strider', /strider/),
    m('entity', 'llama', /llama/), m('entity', 'camel', /camel/), m('entity', 'happy_ghast', /happy_ghast/), m('entity', 'nautilus', /nautilus/),
    m('projectile', 'arrow', /_arrow/, { since: '1.8.8', file: 'AbstractArrow.java' }), m('projectile', 'trident', /trident/, { since: '1.13.2', file: 'ThrownTrident.java' }), m('projectile', 'snowball', /snowball/, { since: '1.8.8', file: 'Snowball.java' }),
    m('projectile', 'fireball', /fireball/, { since: '1.8.8', file: 'Fireball.java' }), m('projectile', 'firework', /firework|rocket/, { since: '1.8.8', file: 'FireworkRocketEntity.java' }),
];

interface McData { effectsByName?: Record<string, unknown>; attributesByName?: Record<string, unknown>; enchantmentsByName?: Record<string, unknown>; entitiesByName?: Record<string, unknown> }
const dataOf = (version: string) => require('minecraft-data')(version) as McData | undefined;
const pascal = (name: string) => name.split('_').map(p => p[0]!.toUpperCase() + p.slice(1)).join('');
const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Whether a release's data has the mechanic; undefined when it keeps no such list. */
export function has(mechanic: Mechanic, version: string): boolean | undefined {
    const data = dataOf(version);
    if (!data) return undefined;
    if (mechanic.kind === 'effect') return data.effectsByName ? pascal(mechanic.name) in data.effectsByName || mechanic.name in data.effectsByName : undefined;
    if (mechanic.kind === 'enchantment') return data.enchantmentsByName ? mechanic.name in data.enchantmentsByName : undefined;
    if (mechanic.kind === 'entity') return data.entitiesByName ? mechanic.name in data.entitiesByName || `oak_${mechanic.name}` in data.entitiesByName : undefined;
    if (mechanic.kind === 'attribute') {
        if (!data.attributesByName) return undefined;
        const name = camel(mechanic.name);
        return [name, `generic${name[0]!.toUpperCase()}${name.slice(1)}`, `player${name[0]!.toUpperCase()}${name.slice(1)}`, `horse${name[0]!.toUpperCase()}${name.slice(1)}`].some(key => key in data.attributesByName!);
    }
    return undefined;
}

export interface CapabilityRow { readonly mechanic: Mechanic; readonly since: string; readonly basis: 'data' | 'source' | 'no data'; readonly cases: readonly string[] }

export async function capabilityRows(): Promise<CapabilityRow[]> {
    const ids = (await loadModules()).flatMap(mod => mod.scenarios.map(s => s.id.replace(/^physrec\//, '')));
    return MECHANICS.map(mechanic => {
        const cases = ids.filter(id => mechanic.cases.test(id));
        if (mechanic.source) return { mechanic, since: mechanic.source.since, basis: 'source', cases };
        const first = RELEASES.find(version => has(mechanic, version) === true);
        return { mechanic, since: first ?? 'none', basis: first ? 'data' : 'no data', cases };
    });
}

export function capabilityTable(rows: readonly CapabilityRow[]): string {
    const lines = [
        '# Capability table', '',
        'Generated by `node recorder/replay/capabilities.ts`; do not edit. `since` is the first registered release whose data has the mechanic (`data`), or the file that shows it (`source`). `none` means no release\'s data has it under this name, which needs reading, and `no case` that the catalog has none. A mechanic counts on a release only where a recording of it was compared there: `recorder/replay/matrix.ts` and the gate say that.', '',
        '| Kind | Mechanic | Since | Basis | Cases | First cases |', '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const { mechanic, since, basis, cases } of rows) lines.push(`| ${mechanic.kind} | ${mechanic.name} | ${since} | ${basis === 'source' ? `source: ${mechanic.source!.file}` : basis} | ${cases.length || 'no case'} | ${cases.slice(0, 3).join(', ')} |`);
    return `${lines.join('\n')}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.stdout.write(capabilityTable(await capabilityRows()));
