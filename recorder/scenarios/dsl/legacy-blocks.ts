// The scenarios name blocks as they are from 1.13 on. Before that flattening a block's name often meant something else
// and its variants were properties of one shared block: this says the same block in a release's own terms. minecraft-data
// has no states for those releases, so the mod checks what comes out against the real block.

import { versionAtLeast } from './names.ts';

/** Names that changed at the flattening (name before 1.13 on the right). */
const RENAMED: Readonly<Record<string, string>> = {
    grass_block: 'grass', slime_block: 'slime', cobweb: 'web', oak_fence: 'fence', magma_block: 'magma', oak_door: 'wooden_door',
    oak_trapdoor: 'trapdoor', lily_pad: 'waterlily', dirt_path: 'grass_path', snow: 'snow_layer', snow_block: 'snow',
    powered_rail: 'golden_rail', oak_planks: 'planks', oak_leaves: 'leaves', white_wool: 'wool', white_carpet: 'carpet',
    white_bed: 'bed', oak_fence_gate: 'fence_gate', nether_bricks: 'nether_brick', note_block: 'noteblock', oak_log: 'log',
    repeater: 'unpowered_repeater', comparator: 'unpowered_comparator', oak_stairs: 'oak_stairs', stone_stairs: 'stone_stairs',
    oak_sign: 'standing_sign', oak_wall_sign: 'wall_sign', oak_pressure_plate: 'wooden_pressure_plate',
    // (the plain box of 1.13 was the purple one)
    shulker_box: 'purple_shulker_box',
    bricks: 'brick_block', cobblestone_stairs: 'stone_stairs', nether_portal: 'portal',
};

export type LegacyProps = Map<string, string>;
export interface LegacyBlock { readonly name: string; readonly props: LegacyProps }

/** Waterlogging came with 1.13: a waterlogged block has no such block before. */
export function legacyBlock(name: string, given: Iterable<readonly [string, string]>, version: string): LegacyBlock | null {
    const props: LegacyProps = new Map(given);
    const waterlogged = props.get('waterlogged');
    props.delete('waterlogged');
    if (waterlogged === 'true') return null;
    const put = (prop: string, value: string) => props.set(prop, value);
    const drop = (...names: string[]) => names.forEach(n => props.delete(n));
    switch (name) {
        case 'stone_slab': {
            // (before 1.14 "stone_slab" is the smooth one, a variant of the block all stone slabs share)
            const type = props.get('type');
            drop('type');
            put('variant', 'stone');
            if (type === 'double') return { name: 'double_stone_slab', props };
            put('half', type === 'top' ? 'top' : 'bottom');
            return { name, props };
        }
        case 'oak_log': put('variant', 'oak'); break;
        case 'oak_planks': put('variant', 'oak'); break;
        case 'oak_leaves': {
            const persistent = props.get('persistent');
            drop('persistent', 'distance');
            put('decayable', persistent === 'true' ? 'false' : 'true');
            put('variant', 'oak');
            break;
        }
        case 'white_wool': case 'white_carpet': put('color', 'white'); break;
        case 'sand': put('variant', 'sand'); break;
        case 'stone': put('variant', 'stone'); break;
        case 'dirt': put('variant', 'dirt'); break;
        case 'cobblestone_wall': put('variant', 'cobblestone'); break;
        case 'white_bed': drop('occupied'); break;
        case 'oak_door': case 'oak_trapdoor': drop('powered'); break;
        // (a note block keeps these in its block entity)
        case 'note_block': drop('instrument', 'note', 'powered'); break;
        // (a command block has no direction or conditional mode before 1.9)
        case 'command_block': if (!versionAtLeast(version, '1.9')) drop('facing', 'conditional'); break;
        // (a chest's type came with 1.13: two chests side by side join by themselves)
        case 'chest': case 'trapped_chest': drop('type'); break;
        // (a lever's face came with 1.13: on a floor or a ceiling it went by the axis it lies along, 1.13.2 class_4500.java:3222, 3247-3258)
        case 'lever': {
            const face = props.get('face');
            drop('face');
            if (face === 'floor' || face === 'ceiling') put('facing', `${face === 'floor' ? 'up' : 'down'}_${/east|west/.test(props.get('facing') ?? '') ? 'x' : 'z'}`);
            break;
        }
        default: break;
    }
    return { name: RENAMED[name] ?? name, props };
}

/** Modern items a pre-flattening release calls something else: its item and damage. */
const ITEMS: Readonly<Record<string, readonly [string, number]>> = {
    oak_planks: ['planks', 0], oak_log: ['log', 0], oak_sign: ['sign', 0], lapis_lazuli: ['dye', 4], poppy: ['red_flower', 0],
    music_disc_13: ['record_13', 0], firework_rocket: ['fireworks', 0], grass_block: ['grass', 0], white_wool: ['wool', 0],
    oak_door: ['wooden_door', 0], oak_boat: ['boat', 0], snow_block: ['snow', 0], cobweb: ['web', 0], slime_block: ['slime', 0],
    bone_meal: ['dye', 15], ink_sac: ['dye', 0], cod: ['fish', 0], cooked_cod: ['cooked_fish', 0], cooked_porkchop: ['cooked_porkchop', 0],
    oak_fence: ['fence', 0], oak_trapdoor: ['trapdoor', 0], white_bed: ['bed', 0], white_carpet: ['carpet', 0],
};

export function legacyItem(name: string): readonly [string, number] {
    return ITEMS[name] ?? [name, 0];
}

/** The names of entities before 1.11, which were their classes': the horses are one, with a type after the colon. */
const ENTITIES: Readonly<Record<string, string>> = {
    horse: 'EntityHorse:horse', donkey: 'EntityHorse:donkey', mule: 'EntityHorse:mule', zombie_horse: 'EntityHorse:zombie',
    skeleton_horse: 'EntityHorse:skeleton', minecart: 'MinecartRideable', chest_minecart: 'MinecartChest',
    furnace_minecart: 'MinecartFurnace', tnt_minecart: 'MinecartTNT', hopper_minecart: 'MinecartHopper',
    spawner_minecart: 'MinecartSpawner', command_block_minecart: 'MinecartCommandBlock', firework_rocket: 'FireworksRocketEntity',
    egg: 'ThrownEgg', potion: 'ThrownPotion', experience_bottle: 'ThrownExpBottle', item: 'Item',
    tnt: 'PrimedTnt', falling_block: 'FallingSand', ender_pearl: 'ThrownEnderpearl', experience_orb: 'XPOrb', iron_golem: 'VillagerGolem',
    snow_golem: 'SnowMan', mooshroom: 'MushroomCow', ocelot: 'Ozelot', magma_cube: 'LavaSlime', zombie_pigman: 'PigZombie',
};

export function legacyEntity(name: string): string {
    return ENTITIES[name] ?? name.split('_').map(part => part[0]!.toUpperCase() + part.slice(1)).join('');
}
