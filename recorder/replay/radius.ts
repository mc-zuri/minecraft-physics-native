// Whether what the recorder observes around the player is enough: PlayerSnap.scene lists the entities within 16 blocks of it at the
// start of a tick, and nothing outside can touch it in that tick if the player's move, the other's move and both their half sizes do
// not reach that far. Each row is held to that bound, with the fastest and the largest entity the recording shows anywhere: what is
// unseen is no faster or larger than what was seen. A recording whose margin is not positive is one the list may have missed
// something in, and says at which tick.
//
//   node recorder/replay/radius.ts [--version 26.3] [--case "physrec/v_*"]
//
// The moving pistons go by chunks: scene lists those of the 3 by 3 chunks around the player (PlayerSnap.java), which are never less than
// these 16 blocks away, so the same bound holds them, a piston's push reaching a block past its own cell at most.

import { parseArgs } from 'node:util';
import { idMatcher } from '../scenarios/build.ts';
import type { ExpandedRow, Recording } from '../schema/recording.ts';
import { loadRecording } from './load.ts';
import { findRecordings, recordingsRoot } from './recordings.ts';

/** PlayerSnap.NEARBY. */
export const OBSERVATION_RADIUS = 16;

interface Listed { readonly pos: readonly number[]; readonly vel?: readonly number[]; readonly box?: readonly number[] }

const length = (v: readonly number[]) => Math.hypot(...v);
const halfSize = (box: readonly number[] | undefined) => (box ? Math.max(box[3]! - box[0]!, box[4]! - box[1]!, box[5]! - box[2]!) / 2 : 0);

function listed(row: ExpandedRow): Listed[] {
    return [...((row.pre.nearbyEntities ?? []) as Listed[]), ...((row.srv?.entities ?? []) as unknown as Listed[])];
}

export interface RadiusResult {
    /** The least room left in any tick, and that tick. */
    readonly margin: number;
    readonly t: number;
    /** The fastest and largest seen; what the bound takes for the unseen. */
    readonly fastest: number;
    readonly largest: number;
}

/** How much of the observation radius a recording's worst tick leaves. */
export function observationMargin(recording: Pick<Recording, 'rows'>, radius = OBSERVATION_RADIUS): RadiusResult {
    let fastest = 0;
    let largest = 0;
    for (const row of recording.rows) {
        for (const entity of listed(row)) {
            fastest = Math.max(fastest, entity.vel ? length(entity.vel) : 0);
            largest = Math.max(largest, halfSize(entity.box));
        }
    }
    let margin = Infinity;
    let at = 0;
    for (const row of recording.rows) {
        const [a, b] = [row.pre.pos as number[], row.post.pos as number[]];
        const moved = length([b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]);
        const room = radius - (moved + fastest + largest + Math.max(row.post.bbWidth as number, row.post.bbHeight as number) / 2);
        if (room < margin) {
            margin = room;
            at = row.t;
        }
    }
    return { margin, t: at, fastest, largest };
}

if (process.argv[1]?.endsWith('radius.ts')) {
    const { values } = parseArgs({ options: { version: { type: 'string' }, case: { type: 'string' } } });
    const matches = idMatcher(values.case);
    const files = findRecordings(recordingsRoot(), values.version?.split(',')).filter(f => matches(f.id));
    let worst: (RadiusResult & { key: string }) | undefined;
    let closest: (RadiusResult & { key: string }) | undefined;
    let short = 0;
    for (const f of files) {
        const result = observationMargin(loadRecording(f.file));
        if (result.margin <= 0) {
            short += 1;
            console.log(`SHORT ${f.version}/${f.id}: ${result.margin.toFixed(3)} at t=${result.t} (fastest ${result.fastest.toFixed(3)}, largest ${result.largest.toFixed(3)})`);
        }
        if (!worst || result.margin < worst.margin) worst = { ...result, key: `${f.version}/${f.id}` };
        if (result.margin > 0 && (!closest || result.margin < closest.margin)) closest = { ...result, key: `${f.version}/${f.id}` };
    }
    console.log(`${files.length} recording(s), ${short} short; the least room ${worst?.margin.toFixed(3)} blocks of ${OBSERVATION_RADIUS}, ${worst?.key} t=${worst?.t} (fastest ${worst?.fastest.toFixed(3)}, largest ${worst?.largest.toFixed(3)})`);
    if (closest && short > 0) console.log(`the least room in the rest ${closest.margin.toFixed(3)}, ${closest.key} t=${closest.t} (fastest ${closest.fastest.toFixed(3)}, largest ${closest.largest.toFixed(3)})`);
    process.exitCode = short > 0 ? 1 : 0;
}
