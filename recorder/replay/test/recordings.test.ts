// The recordings are complete and their scenarios test what they say: every one finished ok, holds
// the data the native comparison and a mineflayer replay need, and its server actions reached the
// player (an explosion that pushes nobody or a velocity nobody gets would test nothing).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRecording, packetBytes } from '../load.ts';
import { decodeClientbound, decodeServerbound } from '../packets.ts';
import { findRecordings } from '../recordings.ts';
import { validateRecording } from '../validate.ts';
import { inRange } from '../../scenarios/dsl/names.ts';
import type { Recording } from '../../schema/recording.ts';

const files = findRecordings();
/** A packet the codec reads but writes differently, and no physics reads: particles, whose data it does not keep exactly. */
const ROUGH_CODECS = new Set(['ClientboundLevelParticlesPacket']);
/**
 * 1.20.3 and 1.20.4's explosion ends in a SoundEvent written whole, which the protocol data reads as a registry id: its
 * name's length comes out as the id and the name stays unread. The player's motion comes before it and reads true.
 */
const roughExplosion = (name: string, version: string) => name === 'ClientboundExplodePacket' && inRange(version, '>=1.20.3 <1.20.5');

/** Whether an explosion moves the player: the knockback of its own field from 1.21.2, three motions before. */
function pushes(params: Record<string, unknown>): boolean {
    const knockback = params.playerKnockback as { x: number; y: number; z: number } | undefined;
    if ('playerKnockback' in params || 'playerMotionX' in params === false) return !!knockback && (knockback.x !== 0 || knockback.y !== 0 || knockback.z !== 0);
    return params.playerMotionX !== 0 || params.playerMotionY !== 0 || params.playerMotionZ !== 0;
}

function check(r: Recording, version: string, id: string): string[] {
    const problems = validateRecording(r, version, id, true);
    if (!r.header.player || !Number.isInteger(r.header.player.id) || !r.header.player.uuid) problems.push('the header has no player identity');
    if (!r.header.world?.area?.fills?.length) problems.push('the header has no world');
    // the world as the body found it, filling the area box
    const blocks = r.header.world?.blocks;
    if (!blocks) problems.push('the header has no world blocks');
    else {
        const cells = (blocks.to[0] - blocks.from[0] + 1) * (blocks.to[1] - blocks.from[1] + 1) * (blocks.to[2] - blocks.from[2] + 1);
        let n = 0;
        for (let i = 1; i < blocks.runs.length; i += 2) n += blocks.runs[i]!;
        if (n !== cells) problems.push(`the world blocks cover ${n} of ${cells} cells`);
        if (blocks.runs.some((v, i) => i % 2 === 0 && v >= blocks.palette.length)) problems.push('a world block run points past the palette');
    }
    if (typeof r.header.server.viewDistance !== 'number') problems.push('the header does not say the view distance the case ran with');
    // every packet decodes with mineflayer's codec, and to all of its bytes
    const playerId = r.header.player?.id;
    let received = 0;
    for (const row of r.rows) {
        for (const p of row.s2c) {
            try {
                const decoded = decodeClientbound(r.header.mc, packetBytes(p.b));
                if (!decoded.roundTrip && !ROUGH_CODECS.has(p.name) && !roughExplosion(p.name, r.header.mc)) problems.push(`t=${row.t}: s2c ${p.name} does not encode back to its bytes`);
                // server actions reach the player: an explosion pushes it, a velocity arrives for it
                // (a case's own action: a cart's blast is another matter, held to its power in replay/minecart.ts)
                if (p.name === 'ClientboundExplodePacket' && /"op":"explode"/.test(JSON.stringify(r.header.body)) && !pushes(decoded.params)) problems.push(`t=${row.t}: an explosion that does not push the player`);
                if (p.name === 'ClientboundSetEntityMotionPacket' && decoded.params.entityId === playerId) received += 1;
            } catch (e) { problems.push(`t=${row.t}: s2c ${p.name} does not decode: ${(e as Error).message}`); }
        }
        for (const p of row.c2s) {
            try {
                if (!decodeServerbound(r.header.mc, packetBytes(p.b)).roundTrip) problems.push(`t=${row.t}: c2s ${p.name} does not encode back to its bytes`);
            } catch (e) { problems.push(`t=${row.t}: c2s ${p.name} does not decode: ${(e as Error).message}`); }
        }
    }
    const velocities = r.header.body.filter(s => s.op === 'server' && s.action.op === 'velocity' && !s.action.target).length;
    if (velocities > 0 && received < velocities) problems.push(`${velocities} velocity action(s), ${received} velocity packet(s) for the player`);
    return problems;
}

test('recordings are present', { skip: files.length === 0 && process.env.CONFORMANCE !== 'strict' ? 'no recordings' : false }, () => {
    assert.ok(files.length > 1000, `only ${files.length} recordings`);
});

for (const f of files) {
    test(`recording ${f.version}/${f.id} is complete and valid`, () => {
        assert.deepEqual(check(loadRecording(f.file), f.version, f.id), []);
    });
}
