// The bot layer: packets are held to the client's by name, order and bytes, and each kind of difference is told apart.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExpandedRow, Recording } from '../../schema/recording.ts';
import { comparePackets, MOVEMENT, replayBot } from '../bot.ts';
import { loadRecording } from '../load.ts';

const fixture = (name: string) => loadRecording(join(fileURLToPath(new URL('fixtures/26.3/physrec', import.meta.url)), `${name}.jsonl.gz`));
const packet = (name: string, byte = 1) => ({ name, bytes: Buffer.from([byte]) });
const rows = (r: Recording, change: (row: ExpandedRow) => ExpandedRow): Recording => ({ ...r, rows: r.rows.map(change) });

test('the same packets are no difference', () => {
    assert.equal(comparePackets([packet('position'), packet('tick_end')], [packet('position'), packet('tick_end')]), undefined);
    assert.equal(comparePackets([], []), undefined);
});

test('a missing, an extra, a reordered and a byte-different packet are each their own kind', () => {
    assert.deepEqual(comparePackets([packet('position'), packet('tick_end')], [packet('tick_end')]), { kind: 'missing', names: ['position'] });
    assert.deepEqual(comparePackets([packet('tick_end')], [packet('position'), packet('tick_end')]), { kind: 'extra', names: ['position'] });
    assert.deepEqual(comparePackets([packet('a'), packet('b')], [packet('b'), packet('a')]), { kind: 'reordered', expected: ['a', 'b'], actual: ['b', 'a'] });
    assert.deepEqual(comparePackets([packet('position', 1)], [packet('position', 2)]), { kind: 'bytes', index: 0, name: 'position', expected: '01', actual: '02' });
});

test('a repeat of one name is counted: two of a packet are not one', () => {
    assert.deepEqual(comparePackets([packet('position')], [packet('position'), packet('position')]), { kind: 'extra', names: ['position'] });
});

test('a recording plays to the byte, and says how much it compared', async () => {
    const result = await replayBot(fixture('j_walk_f'));
    assert.equal(result.first, undefined);
    assert.deepEqual(result.codec, []);
    assert.ok(result.compared > 50);
    assert.ok((result.packets.position ?? 0) > 40);
    assert.ok((result.packets.tick_end ?? 0) > 50);
});

test('a client packet changed in the recording is a byte difference at its tick', async () => {
    const recording = fixture('j_walk_f');
    const at = recording.rows.find(r => r.t > 10 && r.c2s.some(p => /^Pos$/.test(p.name)))!;
    const bytes = (b: string) => {
        const buffer = Buffer.from(b, 'base64');
        buffer[buffer.length - 2]! ^= 1;
        return buffer.toString('base64');
    };
    const changed = rows(recording, row => (row.t === at.t ? { ...row, c2s: row.c2s.map(p => (/^Pos$/.test(p.name) ? { ...p, b: bytes(p.b) } : p)) } : row));
    const result = await replayBot(changed);
    assert.equal(result.first?.t, at.t);
    assert.equal(result.first?.difference?.kind, 'bytes');
});

test('a client packet gone from the recording shows as one the bot wrote more of', async () => {
    const recording = fixture('j_walk_f');
    const at = recording.rows.find(r => r.t > 10 && r.c2s.some(p => /^Pos$/.test(p.name)))!;
    const result = await replayBot(rows(recording, row => (row.t === at.t ? { ...row, c2s: row.c2s.filter(p => !/^Pos$/.test(p.name)) } : row)));
    assert.equal(result.first?.difference?.kind, 'extra');
});

test('client packets swapped in the recording are reordered', async () => {
    const recording = fixture('j_walk_f');
    const at = recording.rows.find(r => r.t > 10 && r.c2s.filter(p => /^Pos$|TickEnd/.test(p.name)).length >= 2)!;
    const result = await replayBot(rows(recording, row => (row.t === at.t ? { ...row, c2s: [...row.c2s].reverse() } : row)));
    assert.equal(result.first?.difference?.kind, 'reordered');
});

test('a teleport is answered once, at the packet, and delivered twice the extra answer shows', async () => {
    const recording = fixture('s_jump_farmland');
    const clean = await replayBot(recording);
    assert.deepEqual(clean.divergences.filter(d => d.at === 'responses'), []);
    assert.ok((clean.packets.teleport_confirm ?? 0) > 0, 'a teleport to answer');
    const position = recording.rows.flatMap(r => r.s2c).find(p => p.name === 'ClientboundPlayerPositionPacket')!;
    const twice = await replayBot(recording, { deliver: r => (r.s2c.includes(position) ? [...r.s2c, position] : r.s2c) });
    assert.deepEqual([twice.first?.at, twice.first?.difference?.kind], ['responses', 'extra']);
});

test('a teleport never delivered leaves the answer missing', async () => {
    const recording = fixture('s_jump_farmland');
    const gone = await replayBot(recording, { deliver: r => r.s2c.filter(p => p.name !== 'ClientboundPlayerPositionPacket') });
    assert.deepEqual([gone.first?.at, gone.first?.difference?.kind], ['responses', 'missing']);
});

test('a blast adds to the motion: delivered twice it is a different tick, as it would be applied twice', async () => {
    const recording = fixture('m_more_explosion_cover');
    assert.equal((await replayBot(recording)).first, undefined);
    const blast = recording.rows.flatMap(r => r.s2c).find(p => p.name === 'ClientboundExplodePacket')!;
    const twice = await replayBot(recording, { deliver: r => (r.s2c.includes(blast) ? [...r.s2c, blast] : r.s2c) });
    assert.ok(twice.first, 'the second blast moved the bot');
});

test('a world edit, a server velocity and effects arrive through the bot, not from a snapshot', async () => {
    const recording = fixture('cf_cut_two_small_components');
    const result = await replayBot(recording);
    assert.equal(result.first, undefined);
    assert.ok(result.delivered > 0);
});

test('what is not movement is counted apart, and no movement packet is', async () => {
    const result = await replayBot(fixture('j_walk_f'));
    for (const name of Object.keys(result.notCompared)) assert.equal(MOVEMENT.has(name), false, name);
});

test('a packet the client sent between ticks is reported there, and the bot\'s must be what stands for it', async () => {
    const recording = fixture('j_walk_f');
    const at = recording.rows.find(row => row.c2s.some(p => p.phase !== 'packetHandling'))!;
    const sent = at.c2s.find(p => p.phase !== 'packetHandling')!;
    const moved = await replayBot(rows(recording, row => (row.t === at.t ? { ...row, c2s: [{ ...sent, seq: sent.seq - 1, phase: 'betweenTicks' }, ...row.c2s] } : row)));
    assert.deepEqual([moved.first?.t, moved.first?.at, moved.first?.difference?.kind], [at.t, 'betweenTicks', 'missing']);
});

test('a riding jump\'s power is held to the charge on the tick of its release', async () => {
    const recording = fixture('v_horse_jump_short_charge');
    assert.deepEqual((await replayBot(recording, { keepLastSentOnTeleport: true })).divergences, []);
    const released = recording.rows.find(row => row.c2s.some(p => p.name === 'ServerboundPlayerCommandPacket' && (row.pre.jumpRidingScale as number) > 0))!;
    const result = await replayBot(rows(recording, row => (row.t === released.t ? { ...row, pre: { ...row.pre, jumpRidingScale: 0.05 } } : row)), { keepLastSentOnTeleport: true });
    assert.deepEqual([result.first?.t, result.first?.at, result.first?.field], [released.t, 'state', 'jumpRidingScale']);
});
