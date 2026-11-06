// The coverage the conformance tickets ask for, requirement by requirement: which recorded cases stand for it, and what each
// release shows of them. A row names its cases, so a test can hold it to the catalog, and a run reports each release's row as
// recorded and compared, not recorded, not compiled (the release does not have it) or unavailable. Nothing here counts as
// matching: it says where to look, and the gate (conformance.ts) says what came of it.
//
//   node recorder/replay/matrix.ts [--version 26.3,1.21.4] [--ticket B240] [--json report.json]

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { compiledScenarios } from './conformance.ts';
import { replayNative } from './engine.ts';
import { loadRecording } from './load.ts';
import { recordingsRoot } from './recordings.ts';

export interface MatrixRow {
    readonly ticket: string;
    readonly requirement: string;
    /** The cases, without the physrec/ prefix: entry, steady state and exit where the row is a mode. */
    readonly cases: readonly string[];
    /** The first release that has the mechanic, by source; the row is `absent` before it. */
    readonly since?: string;
}

const row = (ticket: string, requirement: string, cases: string, since?: string): MatrixRow => ({ ticket, requirement, cases: cases.split(' '), ...(since ? { since } : {}) });

export const MATRIX: readonly MatrixRow[] = [
    // B240: every movement mode, with its way in and out
    row('B240', 'walking', 'j_walk_f j_walk_fl j_tap_forward_1'),
    row('B240', 'sprinting', 'j_sprint_f j_sprint_turn_fast j_sprint_then_release_sprint'),
    row('B240', 'sneaking', 'j_sprint_to_sneak s_sneak_ice g_step_sneak_stone_slab_type_bottom'),
    row('B240', 'jumping and falling', 'j_hop_held j_jump_released_in_air x_impulse_downward'),
    row('B240', 'climbing', 'pb_climb_ladder_up pb_climb_ladder_jump_off b_climb_walk_up_ladder_water'),
    row('B240', 'swimming', 'b_water_swim_fl b_water_sprint_swim', '1.13'),
    row('B240', 'lava travel', 'b_lava_walk_in b_lava_swim_forward b_lava_jump_out'),
    row('B240', 'creative flight', 'f_fly_toggle_on f_fly_forward f_fly_toggle_off_in_air f_fly_down_to_ground'),
    row('B240', 'spectator flight', 'f_spectator_through_wall f_spectator_up_down', '1.8'),
    row('B240', 'fall flying', 'f_elytra_pitch_0 f_elytra_wall_hit f_elytra_rocket_straight_down', '1.9.4'),
    row('B240', 'Riptide in water', 'q_riptide_1_surface q_riptide_3_underwater_level q_riptide_short_charge', '1.13'),
    row('B240', 'Riptide on rain alone', 'q_rain_open q_rain_roofed q_rain_clear_sky q_rain_desert', '1.13'),
    row('B240', 'Slow Falling with a boost across vertical zero', 'gr_slow_falling_impulse_turns_up', '1.13'),
    row('B240', 'ridden movement', 'v_horse_jump_short_charge c_ride_donkey_step_up cf_ride_horse_through_web'),
    row('B240', 'boats', 'v_boat_forward v_boat_onto_land v_dismount_boat_pocket'),
    // B241: geometry and fluids
    row('B241', 'empty and full blocks', 'fb_idle_air fb_walk_air g_wall_chunk_border_x'),
    row('B241', 'stairs at a corner and across it', 'g_wall_stairs_inner_corner g_wall_stairs_outer_corner g_step_walk_stone_stairs_facing_east'),
    row('B241', 'slabs and steps', 'g_step_walk_stone_slab_type_bottom g_step_jump_stone_slab_type_bottom'),
    row('B241', 'the top of a fence', 'bt_oak_fence_up_top bt_oak_fence_down_top wh_oak_fence_walk'),
    row('B241', 'waterlogged partial blocks', 'wl_walk_slab wl_walk_stairs wl_walk_fence wl_soak_slab', '1.13'),
    row('B241', 'a sign that blocks flow with no collision, and a full block', 'fb_idle_oak_sign fb_walk_oak_sign fb_idle_air'),
    row('B241', 'the world border from both sides', 'x_world_border_walk x_world_border_jump bo_outside_still bo_outside_walk_along'),
    // B243: angles and input
    row('B243', 'diagonals against cardinals at one magnitude', 'j_walk_f j_walk_fl j_walk_fr j_sprint_fl'),
    row('B243', 'both sides of the wrap', 'cf_yaw_walk_179_99 cf_yaw_walk_180 cf_yaw_walk_180_01 cf_yaw_walk_neg_179_99 cf_yaw_walk_neg_180 cf_yaw_walk_neg_180_01 cf_look_turn_through_wrap cf_look_pitch_edges'),
    row('B243', 'a motion the radial cutoff keeps and the component one does not', 'cf_cut_two_small_components cf_cut_one_small_component'),
    // B244: effects, attributes, poses, abilities
    row('B244', 'speed and slowness', 'e_speed_1_walk e_speed_2_sprint e_slowness_1_walk e_slowness_4_sprint'),
    row('B244', 'levitation under a ceiling', 'e_levitation_under_ceiling', '1.9.4'),
    row('B244', 'gravity at zero, an attribute and not an absence', 'e_attr_gravity_0_jump e_attr_gravity_0_fall', '1.20.5'),
    row('B244', 'scale in partial geometry', 'e_attr_scale_0.25_step e_attr_scale_0.5_step e_attr_scale_2_step', '1.20.5'),
    row('B244', 'enchantments', 'q_depth_strider_1_walk_bottom q_depth_strider_1_swim_surface'),
    row('B244', 'poses at low ceilings', 'g_ceiling_sneak_gap1_875 g_ceiling_sneak_gap1_9375 g_ceiling_sneak_gap2'),
    // B245: vehicles and projectiles
    row('B245', 'a mount into a web, through it and out', 'cf_ride_horse_through_web cf_ride_horse_stops_in_web'),
    row('B245', 'a jump charge and its release', 'v_horse_jump_short_charge v_horse_jump_full_charge v_horse_jump_overcharge'),
    row('B245', 'a boat between water and land', 'v_boat_onto_land v_boat_on_land_push v_boat_ice'),
    row('B245', 'an arrow held by a block before it flies', 'cf_arrow_summoned_inside_stone'),
    row('B245', 'a trident over the ticks after its impact', 'pj_trident_without_loyalty_stays pj_trident_loyalty_from_wall', '1.13'),
    // B236, B247: a run that carries state
    row('B236', 'a world edit, a push and a mounted jump in one case', 'cf_ride_edit_push_jump'),
    row('B247', 'sustained movement, jump cooldown and a world update', 'cf_long_walk_course cf_long_sprint_hop_course cf_long_edit_wall_opens cf_long_turning_jumps'),
];

export type CellStatus = 'matched' | 'different' | 'not recorded' | 'not compiled';

export function cell(version: string, id: string, root: string, compiled: ReadonlySet<string>): CellStatus {
    const scenario = `physrec/${id}`;
    if (!compiled.has(scenario)) return 'not compiled';
    const file = join(root, version, `${scenario}.jsonl.gz`);
    if (!existsSync(file)) return 'not recorded';
    const result = replayNative(loadRecording(file), { phases: true });
    return result.compared > 0 && !result.first && result.problems.length === 0 ? 'matched' : 'different';
}

if (process.argv[1]?.endsWith('matrix.ts')) {
    const { values } = parseArgs({ options: { version: { type: 'string', default: '26.3' }, ticket: { type: 'string' }, json: { type: 'string' } } });
    const report: unknown[] = [];
    for (const version of values.version.split(',')) {
        const compiled = new Set(compiledScenarios(version));
        const tally: Record<CellStatus, number> = { matched: 0, different: 0, 'not recorded': 0, 'not compiled': 0 };
        for (const entry of MATRIX.filter(r => !values.ticket || r.ticket === values.ticket)) {
            const cells = entry.cases.map(id => [id, cell(version, id, recordingsRoot(), compiled)] as const);
            for (const [, status] of cells) tally[status] += 1;
            const gaps = cells.filter(([, status]) => status !== 'matched');
            console.log(`${version} ${entry.ticket} ${gaps.length === 0 ? 'ok ' : 'GAP'} ${entry.requirement}${gaps.length > 0 ? `: ${gaps.map(([id, status]) => `${id} ${status}`).join(', ')}` : ''}`);
            report.push({ version, ...entry, cells: Object.fromEntries(cells) });
        }
        console.log(`${version}: ${Object.entries(tally).map(([status, n]) => `${n} ${status}`).join(', ')}`);
    }
    if (values.json) writeFileSync(values.json, JSON.stringify(report, null, 1));
}
