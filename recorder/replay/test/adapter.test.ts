// The adapter makes the decisions the native replay seeds: the recorded glides, crouches and poses, asked of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayAdapter } from '../adapter.ts';
import { describe as describeDivergence } from '../compare.ts';
import { loadRecording } from '../load.ts';
import { findRecordings } from '../recordings.ts';
import { validateRecording } from '../validate.ts';

/** Each replay's world goes with its job: the engine's WeakRef keeps a link alive to the end of the job that made or read it. */
const nextJob = () => new Promise(resolve => setImmediate(resolve))

const files = findRecordings().filter(f => /^physrec\/(f_elytra_|bo_pose_)/.test(f.id));

test('the adapter decides what vanilla did', { skip: files.length === 0 ? 'no recordings' : false }, async () => {
    for (const f of files) {
        // (a WeakRef's target lives until the job ends: without a turn of the loop every recording's world stays)
        await new Promise(resolve => setImmediate(resolve));
        const recording = loadRecording(f.file);
        if (validateRecording(recording, f.version, f.id, true).length > 0) continue;
        const { first } = replayAdapter(recording);
        await nextJob();
        assert.equal(first, undefined, `${f.version}/${f.id}: ${first ? describeDivergence(first) : ''}`);
    }
});

// From 1.15 the client starts the glide itself (1.15 ClientPlayerEntity.java:711-713, 26.3 LocalPlayer.java aiStep's
// tryToStartFallFlying); before, the server's flag starts it and the adapter has nothing to decide.
// The releases on each side of a gate in the decision (a whole corpus outgrows one process: cli.ts --adapter has the rest).
const GATES = new Set(['1.15', '1.15.1', '1.15.2', '1.16', '1.21.1', '1.21.2', '26.2', '26.3'])
const decisive = findRecordings().filter(f => GATES.has(f.version))
const starting = decisive.filter(f => /^physrec\/(f_elytra_pitch_0|f_elytra_land_and_relaunch)$/.test(f.id))
const refusing = decisive.filter(f => /^physrec\/(f_elytra_no_deploy_|f_elytra_without_elytra|f_elytra_last_use_)/.test(f.id))

test('each recorded start of a glide is the adapter\'s own decision', { skip: starting.length === 0 ? 'no recordings' : false }, async () => {
    for (const f of starting) {
        const recording = loadRecording(f.file);
        if (validateRecording(recording, f.version, f.id, true).length > 0) continue;
        const { glideStarts, adapterGlideStarts } = replayAdapter(recording, []);
        await nextJob();
        assert.ok(glideStarts.length > 0, `${f.version}/${f.id} starts no glide`);
        assert.deepEqual(adapterGlideStarts, glideStarts, `${f.version}/${f.id}`);
    }
});

test('the adapter starts no glide where vanilla refuses one', { skip: refusing.length === 0 ? 'no recordings' : false }, async () => {
    for (const f of refusing) {
        const recording = loadRecording(f.file);
        if (validateRecording(recording, f.version, f.id, true).length > 0) continue;
        const { glideStarts, adapterGlideStarts } = replayAdapter(recording, []);
        await nextJob();
        assert.deepEqual(adapterGlideStarts, glideStarts, `${f.version}/${f.id}`);
    }
});

test('a decision the adapter did not take is a divergence', { skip: files.length === 0 ? 'no recordings' : false }, async () => {
    const glide = files.find(f => f.id === 'physrec/f_elytra_pitch_0') ?? files.find(f => f.id.startsWith('physrec/f_elytra_pitch_'));
    if (!glide) return;
    const recording = loadRecording(glide.file);
    // (vanilla's end of the tick says otherwise on every tick of the glide)
    const rows = recording.rows.map(row => ({ ...row, post: { ...row.post, fallFlying: false }, phases: row.phases.map(p => (p.name === 'tickEnd' ? { ...p, state: { ...p.state, fallFlying: false } } : p)) }));
    const { first } = replayAdapter({ ...recording, rows });
    assert.equal(first?.field, 'fallFlying');
});

test('the input of a tick is held to what the adapter made of the keys: a wrong one is seen', () => {
    const recording = loadRecording(join(fileURLToPath(new URL('fixtures/26.3/physrec', import.meta.url)), 'j_walk_f.jsonl.gz'));
    assert.equal(replayAdapter(recording).first, undefined);
    const at = recording.rows.find(r => r.playerTicked)!.t + 2;
    for (const [field, value] of [['leftImpulse', 0.5], ['forwardImpulse', 0.5], ['inputJumping', true], ['inputShiftKeyDown', true]] as const) {
        const wrong = { ...recording, rows: recording.rows.map(row => (row.t === at ? { ...row, post: { ...row.post, [field]: value }, phases: row.phases.map(p => (p.name === 'tickEnd' ? { ...p, state: { ...p.state, [field]: value } } : p)) } : row)) };
        const { first } = replayAdapter(wrong);
        assert.deepEqual([first?.tick, first?.field], [at, field]);
    }
});

test('a push from an entity that ticked before the player counts once, and a rocket pushes no one', () => {
    // 1.15.1, one of the releases where the boat ticks before the player: tickStart already holds the push, and the engine gives it
    // again from the row's start; there minecraft-data calls a firework rocket a mob of UNKNOWN category
    for (const name of ['pl_attack_sprint_boat', 'f_elytra_wall_hit_rocket']) {
        const recording = loadRecording(join(fileURLToPath(new URL('fixtures/1.15.1/physrec', import.meta.url)), `${name}.jsonl.gz`));
        assert.equal(replayAdapter(recording, undefined, true).first, undefined, name);
    }
});
