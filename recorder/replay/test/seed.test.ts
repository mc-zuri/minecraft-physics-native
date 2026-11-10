// The conversion of a recorded state to the engine's, against values worked out by hand: a seed that read the wrong
// phase, dropped a zero or rounded a double would still compare equal to itself after the same conversion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entityKind, floatRadians, nearbyEntities, toNative } from '../seed.ts';
import { replayNative } from '../engine.ts';
import { toBoat, toHorse } from '../vehicle.ts';
import { PLAYER_FIELDS } from '../../schema/fields.ts';
import type { ExpandedRow, Recording, RecordingFooter, RecordingHeader, Snapshot } from '../../schema/recording.ts';

const KEYS = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false };
const state: Snapshot = {
    pos: [1.5, 2.5, -3.5], vel: [-0, 0, 0.25], oldPos: [1, 2, -3], box: [1.2, 2.5, -3.8, 1.8, 4.3, -3.2], look: [0, -1, 0],
    bbWidth: 0.6000000238418579, bbHeight: 1.7999999523162842, eyeHeight: 1.6200000047683716,
    yRot: 90, xRot: 0, keys: KEYS, onGround: false, stuckSpeedMultiplier: [0, 0, 0],
    noJumpDelay: 0, autoJumpTime: 0, fallDistance: 0, tickCount: 0, ticksFrozen: 0, ticksRequiredToFreeze: 0, remainingFireTicks: 0,
    depthStrider: 0, soulSpeed: 0, frostWalker: 0, fireProtection: 0, movementSpeed: 0,
};
const seed = (start: Snapshot = {}, decided: Snapshot = {}) => toNative({ ...state, ...start }, { ...state, ...decided }) as unknown as Record<string, unknown>;

/** Where the seed reads each field the tick's phases can tell apart: the tick's start, or the decisions before LivingEntity.aiStep. */
const FROM_START: Readonly<Record<string, string>> = {
    onGround: 'onGround', horizontalCollision: 'collidedHorizontally', verticalCollision: 'collidedVertically', isInWater: 'inWater', isInLava: 'inLava',
    eyeInWater: 'eyeInWater', eyeInLava: 'eyeInLava', passenger: 'passenger', noGravity: 'noGravity', sleeping: 'sleeping', isInWall: 'insideWall',
    autoJumpEnabled: 'autoJump', invulnerable: 'invulnerable', mayfly: 'fallDamageImmune',
};
const FROM_DECIDED: Readonly<Record<string, string>> = {
    sprinting: 'sprinting', sprintModifier: 'sprintModifier', shiftKeyDown: 'sneaking', movingSlowly: 'movingSlowly', steppingCarefully: 'steppingCarefully',
    usingItem: 'usingItem', swimming: 'swimming', flying: 'flying', fallFlying: 'fallFlying', noPhysics: 'noPhysics', removed: 'removed',
};
const NUMBERS_FROM_START: Readonly<Record<string, string>> = {
    noJumpDelay: 'jumpTicks', autoJumpTime: 'autoJumpTime', fallDistance: 'fallDistance', tickCount: 'tickCount', ticksFrozen: 'ticksFrozen',
    ticksRequiredToFreeze: 'ticksRequiredToFreeze', remainingFireTicks: 'remainingFireTicks',
};
const NUMBERS_FROM_DECIDED: Readonly<Record<string, string>> = {
    bbHeight: 'height', eyeHeight: 'eyeHeight', depthStrider: 'depthStrider', soulSpeed: 'soulSpeed', fireProtection: 'fireProtection', movementSpeed: 'movementSpeedValue',
};

test('a flag is read from its phase and from no other', () => {
    for (const [recorded, native] of Object.entries(FROM_START)) {
        assert.ok(recorded in PLAYER_FIELDS, recorded);
        assert.equal(seed({ [recorded]: true })[native], true, `${recorded} at the start`);
        assert.equal(seed({}, { [recorded]: true })[native], false, `${recorded} decided`);
    }
    for (const [recorded, native] of Object.entries(FROM_DECIDED)) {
        assert.ok(recorded in PLAYER_FIELDS, recorded);
        assert.equal(seed({}, { [recorded]: true })[native], true, `${recorded} decided`);
        assert.equal(seed({ [recorded]: true })[native], false, `${recorded} at the start`);
    }
    // sprinting is the decision, and what the tick began with is the other field
    assert.equal(seed({ sprinting: true }).wasSprinting, true);
    assert.equal(seed({}, { sprinting: true }).wasSprinting, false);
});

test('a number is read from its phase, and a zero stays a zero', () => {
    for (const [recorded, native] of Object.entries(NUMBERS_FROM_START)) {
        assert.equal(seed({ [recorded]: 7 })[native], 7, recorded);
        assert.equal(seed({ [recorded]: 0 })[native], 0, recorded);
        assert.equal(seed({}, { [recorded]: 7 })[native], 0, recorded);
    }
    for (const [recorded, native] of Object.entries(NUMBERS_FROM_DECIDED)) {
        assert.equal(seed({}, { [recorded]: 7 })[native], 7, recorded);
        assert.equal(seed({}, { [recorded]: 0 })[native], 0, recorded);
    }
});

test('the vectors keep every bit, the sign of a zero included', () => {
    const native = seed();
    assert.deepEqual(native.position, { x: 1.5, y: 2.5, z: -3.5 });
    assert.ok(Object.is((native.velocity as { x: number }).x, -0));
    assert.ok(Object.is((native.velocity as { y: number }).y, 0));
    assert.deepEqual(native.previousPosition, { x: 1, y: 2, z: -3 });
    assert.deepEqual(native.boundingBox, { min: { x: 1.2, y: 2.5, z: -3.8 }, max: { x: 1.8, y: 4.3, z: -3.2 } });
    assert.equal((seed({ vel: [0.1, 0.2, 0.30000000000000004] }).velocity as { z: number }).z, 0.30000000000000004);
    // half of the float width, as a double
    assert.equal(native.halfWidth, 0.30000001192092896);
});

test('an angle is the float product of float degrees and Mth.DEG_TO_RAD', () => {
    // 90F * 0.017453292F is 1.5707963146..., whose nearest float is this
    assert.equal(seed({}, { yRot: 90 }).yaw, 1.5707963705062866);
    assert.equal(floatRadians(0), 0);
    assert.ok(Object.is(floatRadians(-0), -0));
    assert.equal(seed({}, { xRot: 0 }).pitch, 0);
});

test('the keys are the input: left +x, right -x, forward +z, back -z, opposite keys nothing', () => {
    const input = (keys: Partial<typeof KEYS>) => seed({ keys: { ...KEYS, ...keys } }).input;
    assert.deepEqual(input({ left: true, back: true }), { x: 1, y: 0, z: -1 });
    assert.deepEqual(input({ right: true, forward: true }), { x: -1, y: 0, z: 1 });
    assert.deepEqual(input({ left: true, right: true, forward: true, back: true }), { x: 0, y: 0, z: 0 });
    // (the keys of the tick's start, not of a later phase)
    assert.deepEqual(toNative({ ...state, keys: KEYS }, { ...state, keys: { ...KEYS, forward: true } }).input, { x: 0, y: 0, z: 0 });
    assert.equal(seed({ keys: { ...KEYS, jump: true } }).jumpRequested, true);
});

test('effects and worn armour become what the engine asks', () => {
    const decided = (effects: { id: string; amplifier: number }[]) => seed({}, { effects });
    const none = seed({}, { effects: [] });
    for (const absent of ['speedEffectAmplifier', 'slownessEffectAmplifier', 'jumpBoostAmplifier', 'levitationAmplifier']) assert.ok(!(absent in none), absent);
    assert.deepEqual([none.levitation, none.slowFalling, none.weaving, none.fireResistance, none.dolphinsGrace], [false, false, false, false, 0]);
    // (amplifier 0 is the first level, not no effect)
    assert.equal(decided([{ id: 'speed', amplifier: 0 }]).speedEffectAmplifier, 0);
    assert.equal(decided([{ id: 'jump_boost', amplifier: 3 }]).jumpBoostAmplifier, 3);
    const levitating = decided([{ id: 'levitation', amplifier: 0 }]);
    assert.deepEqual([levitating.levitation, levitating.levitationAmplifier], [true, 0]);
    assert.equal(decided([{ id: 'fire_resistance', amplifier: 0 }]).fireResistance, true);
    assert.equal(decided([{ id: 'dolphins_grace', amplifier: 0 }]).dolphinsGrace, 1);
    assert.equal(seed({ effects: [{ id: 'fire_resistance', amplifier: 0 }] }, { effects: [] }).fireResistance, false);
    assert.equal(seed({}, { frostWalker: 1 }).frostWalker, true);
    assert.equal(seed({}, { frostWalker: 0 }).frostWalker, false);
    const worn = (equipment: Record<string, { id: string }>) => seed({}, { equipment });
    assert.deepEqual([worn({ feet: { id: 'leather_boots' } }).powderSnowImmune, worn({ feet: { id: 'leather_boots' } }).powderSnowWalkable], [true, true]);
    assert.deepEqual([worn({ head: { id: 'leather_helmet' } }).powderSnowImmune, worn({ head: { id: 'leather_helmet' } }).powderSnowWalkable], [true, false]);
    assert.deepEqual([worn({ feet: { id: 'iron_boots' } }).powderSnowImmune, worn({ feet: { id: 'iron_boots' } }).powderSnowWalkable], [false, false]);
});

test('a supporting block is there or is not, a block at 0, 0, 0 included', () => {
    assert.deepEqual(seed({}, { mainSupportingBlockPos: [0, 0, 0] }).supportingBlock, { x: 0, y: 0, z: 0 });
    assert.ok(!('supportingBlock' in seed({}, { mainSupportingBlockPos: null })));
    assert.ok(!('supportingBlock' in seed()));
});

test('nothing undefined crosses to the engine', () => {
    assert.deepEqual(Object.entries(seed()).filter(([, v]) => v === undefined), []);
});

const vehicle = {
    type: 'oak_boat', pos: [1, 2, 3], vel: [-0, 0, 0.5], oldPos: [1, 2, 3], yRot: 90, xRot: 0, onGround: false, box: [0, 2, 2, 2, 3, 4],
    horizontalCollision: false, verticalCollision: false, fallDistance: 0, noGravity: false, isInWater: false, isInLava: false,
    fluidHeightWater: 0, fluidHeightLava: 0, bbWidth: 1.375, bbHeight: 0.5625, stuckSpeedMultiplier: [0, 0, 0],
};
const boat = {
    status: 'in_water', oldStatus: 'in_air', deltaRotation: 0, waterLevel: 0, landFriction: 0, inputLeft: false, inputRight: false, inputUp: true, inputDown: false,
    lastYd: -0, aboveBubbleColumn: false, bubbleColumnDirectionIsDown: false, bubbleTime: 0,
};

test('a boat keeps its zeros, and its statuses say whether it is in water', () => {
    const native = toBoat({ ...vehicle, boat } as never, { yRot: 0, zza: 0, xxa: 0 });
    assert.ok(Object.is(native.velocity.x, -0));
    assert.ok(Object.is(native.lastVerticalVelocity, -0));
    assert.deepEqual([native.landFriction, native.waterLevel, native.deltaRotation, native.bubbleTime, native.forward, native.left], [0, 0, 0, 0, true, false]);
    assert.deepEqual([native.status, native.previousStatus], ['in_water', 'in_air']);
    assert.equal(native.yawDegrees, 90);
    assert.equal(native.yaw, 1.5707963705062866);
    const wet = (status: string) => toBoat({ ...vehicle, boat: { ...boat, status } } as never, { yRot: 0, zza: 0, xxa: 0 }).inWater;
    assert.deepEqual(['in_water', 'under_water', 'under_flowing_water', 'on_land', 'in_air'].map(wet), [true, true, true, false, false]);
    // (a boat the client has not given a status yet)
    const fresh = toBoat({ ...vehicle, boat: { ...boat, status: null, oldStatus: null } } as never, { yRot: 0, zza: 0, xxa: 0 });
    assert.ok(!('status' in fresh) && !('previousStatus' in fresh));
});

test('a mount takes its rider\'s input, a released jump and a rear only when they are there', () => {
    const mount = { movementSpeed: 0.2, jumping: false, noAi: false, zza: 0, speed: 0, effects: [{ id: 'jump_boost', amplifier: 0 }] };
    const horse = { ...vehicle, type: 'camel_husk', mount };
    const rider = { yRot: 12, xRot: 3, zza: 0.98, xxa: -0.98, jumping: true, sprinting: true };
    const native = toHorse(horse as never, rider);
    assert.deepEqual([native.forward, native.strafe, native.jumpRequested, native.riderSprinting], [0.98, -0.98, true, true]);
    assert.deepEqual([native.riderYaw, native.riderPitch], [12, 3]);
    assert.equal(native.entityType, 'camel');
    assert.equal(native.jumpBoostAmplifier, 0);
    assert.ok(!('riderJump' in native) && !('levitationAmplifier' in native));
    // (a jump released at no strength is still one)
    assert.equal(toHorse(horse as never, rider, 0).riderJump, 0);
    assert.deepEqual([toHorse(horse as never, rider, undefined, true).standing, toHorse(horse as never, rider, undefined, true).standCounter], [true, 1]);
    // the interpolation's step: from where it is, a share of the way there
    const lerped = toHorse({ ...horse, mount: { ...mount, lerpSteps: 2, lerpTo: [3, 2, 3] } } as never, rider);
    assert.deepEqual(lerped.lerpPosition, { x: 2, y: 2, z: 3 });
});

/** A recording of `rows`, in an area of nothing. */
function recording(rows: Partial<ExpandedRow>[], footer: Partial<RecordingFooter> = {}): Recording {
    const header = {
        kind: 'header', schema: 1, mc: '1.20.4', protocol: 765, scenario: { id: 't/seed', hash: 'h' }, fields: [], phases: [],
        world: { origin: [0, 0, 0], area: { name: 'a', box: [0, 0, 0, 0, 0, 0], fills: [] }, dimension: 'overworld',
            blocks: { from: [0, 0, 0], to: [0, 0, 0], palette: ['air'], runs: [0, 1] } },
        server: { wire: false, ownerChecks: 'dedicated', allowFlight: true }, player: { id: 1, uuid: '', name: '' }, start: {}, setup: { equipment: {}, commands: [] }, body: [],
    } as unknown as RecordingHeader;
    const row = (r: Partial<ExpandedRow>, t: number) => ({ t, s2c: [], c2s: [], blocks: [], pre: state, post: state, phases: [], input: { keys: [], yRot: 0, xRot: 0 }, playerTicked: true, srv: undefined, ...r }) as unknown as ExpandedRow;
    return { header, rows: rows.map(row), footer: { kind: 'footer', status: 'ok', touched: [], corrections: 0, wallMs: 0, ...footer } as RecordingFooter };
}

test('a tick without its phases, a recording that did not finish and one with no rows are no match', () => {
    const phaseless = replayNative(recording([{}]));
    assert.match(phaseless.problems[0]!, /t=0: the player ticked without beforeLivingAiStep/);
    assert.equal(phaseless.compared, 0);
    assert.match(replayNative(recording([{ playerTicked: false }], { status: 'error' as never, reason: 'cut' })).problems[0]!, /the recording ended error: cut/);
    assert.match(replayNative(recording([])).problems[0]!, /no rows/);
});

test('a tick the player sat out compares nothing, and says so', () => {
    const idle = replayNative(recording([{ playerTicked: false }]));
    assert.deepEqual(idle.problems, []);
    assert.equal(idle.compared, 0);
});

test('a tick with its decisions and no state after them is no match', () => {
    const decided = { name: 'beforeLivingAiStep', state };
    assert.match(replayNative(recording([{ phases: [decided] }])).problems[0]!, /without afterAiStep/);
});

test('an entity with a NaN box meets nothing, and the one beside it still counts', () => {
    const entity = (id: number, box: unknown[]) => ({ id, type: 'small_fireball', pos: [1, 2, 3], box, vel: [0, 0, 0], tickedBeforePlayer: false, order: id });
    const start = { nearbyEntities: [entity(1, ['NaN', 'NaN', 'NaN', 'NaN', 'NaN', 'NaN']), entity(2, [0, 0, 0, 1, 1, 1])] } as never;
    const seeded = nearbyEntities(start, { version: '1.9.4', pre: start, post: start, swiftSneak: 0 });
    assert.equal(seeded.length, 1);
    assert.deepEqual(seeded[0]!.boundingBox, { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } });
});

test('a type minecraft-data gives no kind goes by a later release, not by being a mob', () => {
    // (1.15 to 1.16.5: type mob, category UNKNOWN, for a rocket as for a bee)
    const kind = (version: string, type: string) => entityKind(version, { type } as never);
    for (const version of ['1.15', '1.16.5']) {
        for (const type of ['firework_rocket', 'trident', 'experience_orb', 'eye_of_ender', 'end_crystal', 'fishing_bobber']) assert.equal(kind(version, type), 'inert', `${version} ${type}`);
        assert.equal(kind(version, 'bee'), 'living', version);
        assert.equal(kind(version, 'cow'), 'living', version);
    }
    assert.equal(kind('1.16.5', 'piglin'), 'living');
});
