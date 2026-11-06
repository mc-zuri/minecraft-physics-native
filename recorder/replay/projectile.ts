// The projectile layer of the replay. The server view (row.srv.entities) holds every projectile of the area with its
// target boxes, tick by tick. A projectile is seeded from the first server tick that shows it, then the engine flies it on
// its own among the recorded targets (simulateVersionedArrowHitTick, its trident twin, and
// simulateVersionedProjectileHitTick for the other families): its pierced ids, deflections and left-owner state stay the
// engine's, so the path can only match if they do. Each tick compares the position and motion exactly, and the state
// vanilla saves (inGround, life, PierceLevel, LeftOwner, DealtDamage).
//
// Entity.hurt is the target's decision, which the engine takes as an input: the recording answers it (the target's health
// fell in this server tick). A hit is then compared both ways: every fall in health needs the engine's hit on that target
// in that tick, and the engine's `hurt` hit needs the fall. What takes no health, a snowball's hit, shows in hurtTime.
//
// What the server draws by random and never sends comes from the recording in the same way: a rocket's LifeTime, and the
// delta a shulker bullet steers by (TXD, TYD and TZD, which the tick grows and the next tick's row states).

import type {
    NativeArrowHitTick,
    NativeArrowState,
    NativeProjectileEntityHit,
    NativeProjectileHitState,
    NativeProjectileHitTick,
    NativeProjectileOwner,
    NativeProjectileState,
    NativeProjectileTarget,
    NativeTridentHitTick,
    NativeVec3,
} from '../../dist/native.js';
import type { ExpandedRow, Recording, Snapshot } from '../schema/recording.ts';
import { versionAtLeast } from '../scenarios/dsl/names.ts';
import { BorderTracker } from './border.ts';
import { nativeBinding, worldSync } from './engine.ts';

type Vec = readonly [number, number, number];

/** PlayerSnap.entity, with CompatProjectile.extras. */
interface ServerEntity {
    readonly id: number;
    readonly type: string;
    readonly pos: Vec;
    readonly vel: Vec;
    readonly box: readonly [number, number, number, number, number, number];
    readonly age?: number;
    readonly root?: number;
    readonly pickable?: boolean;
    readonly alive?: boolean;
    readonly noPhysics?: boolean;
    readonly health?: number;
    readonly hurtTime?: number;
    readonly onGround?: boolean;
    readonly nbt?: string;
    /** An ender dragon's parts where its tick left them (DragonFlightMixin). */
    readonly dragon?: { readonly sitting: boolean; readonly parts: readonly { readonly id: number; readonly pos: Vec; readonly box: readonly [number, number, number, number, number, number] }[] };
}

export interface ProjectileDivergence {
    readonly t: number;
    readonly projectile: number;
    readonly field: string;
    readonly expected: unknown;
    readonly actual: unknown;
}

export interface ProjectileReplay {
    readonly id: string;
    /** Projectile ticks compared. */
    readonly compared: number;
    /** Each projectile's hits as the engine reported them, tick by tick. */
    readonly hits: readonly { readonly t: number; readonly projectile: number; readonly target: number; readonly reaction: string }[];
    /** Block hits as [tick, projectile, x, y, z, face]. */
    readonly blockHits: readonly (readonly [number, number, number, number, number, string])[];
    /** What the server's health of the player did in each tick it fell, and the engine's hit on it there. */
    readonly playerHealth: readonly { readonly t: number; readonly before: number; readonly after: number; readonly reaction?: string; readonly damage?: number }[];
    readonly projectiles: number;
    readonly first?: ProjectileDivergence;
    readonly divergences: readonly ProjectileDivergence[];
}

const vec = (v: Vec) => ({ x: v[0], y: v[1], z: v[2] });
const isArrow = (e: ServerEntity) => /arrow|trident/i.test(e.type);
const isTrident = (e: ServerEntity) => /trident/i.test(e.type);
/** The other families, by their ids from 1.8 on (`ProjectileKind::from_name` reads them). */
const FAMILY = /snowball|egg|pearl|potion|experience_?bottle|exp_?bottle|xp_?bottle|fireball|skull|wind_?charge|spit|bullet|firework|bobber|hook/i;
const isProjectile = (e: ServerEntity) => isArrow(e) || FAMILY.test(e.type);
/** What bursts around where it hits, or takes health from what it did not hit. */
const BURSTS = /fireball|skull|wind_?charge|firework|potion/i;
/** The mob that shoots a family, when one stands in the recording. Everything else is the player's. */
/**
 * What a hit costs an ownerless case's player, for the families whose damage is a constant: ThrownTrident's 8, SmallFireball's
 * 5, ShulkerBullet's 4. An arrow's comes from the engine. A large fireball adds its explosion, so it has none here.
 */
const DAMAGE: readonly (readonly [RegExp, number])[] = [[/trident/i, 8], [/small_?fireball/i, 5], [/bullet/i, 4]];
const SHOOTERS: readonly (readonly [RegExp, RegExp])[] = [[/spit/i, /llama/i], [/bullet/i, /shulker/i], [/small_?fireball/i, /blaze/i], [/fireball/i, /ghast/i]];

const entitiesOf = (row: ExpandedRow | undefined): readonly ServerEntity[] => (row?.srv?.entities ?? []) as unknown as readonly ServerEntity[];

/** The numbers of a list the entity saved, as [1.0d,2.0d,3.0d]. */
function nbtList(nbt: string | undefined, key: string): number[] | undefined {
    const found = nbt?.match(new RegExp(`(?:^|[{,])\\s*"?${key}"?\\s*:\\s*\\[([^\\]]*)\\]`));
    return found ? found[1]!.split(',').map(part => Number(part.replace(/^\s*\d+\s*:/, '').replace(/[bsdfL]\s*$/, ''))) : undefined;
}

/** A byte, short or double the entity saved, from its SNBT. */
function nbtNumber(nbt: string | undefined, key: string): number | undefined {
    const found = nbt?.match(new RegExp(`(?:^|[{,])\\s*"?${key}"?\\s*:\\s*(-?[0-9.eE-]+)[bsdfL]?\\b`));
    return found ? Number(found[1]) : undefined;
}

/** The saved flag, 1b or true (SNBT writes both). */
function nbtFlag(nbt: string | undefined, key: string): boolean | undefined {
    const found = nbt?.match(new RegExp(`(?:^|[{,])\\s*"?${key}"?\\s*:\\s*(true|false|[01]b?)`));
    return found ? found[1] === 'true' || found[1]!.startsWith('1') : undefined;
}

/** The owner's mark in the saved data: Owner (1.16), OwnerUUID (1.13), owner (a thrown item's, 1.13 to 1.15), ownerName (before). */
const hasOwner = (nbt: string | undefined) => /(?:^|[{,])\s*"?(Owner|OwnerUUIDMost|owner|ownerName)"?\s*:/.test(nbt ?? '') && !/ownerName\s*:\s*""/.test(nbt ?? '');

/** The Loyalty level in the saved item: the enchantment list, or from 1.20.5 its component. */
function loyaltyOf(nbt: string | undefined): number {
    const level = nbt?.match(/"?minecraft:loyalty"?\s*:\s*(\d+)/) ?? nbt?.match(/id\s*:\s*"minecraft:loyalty"\s*,\s*lvl\s*:\s*(\d+)/) ?? nbt?.match(/lvl\s*:\s*(\d+)s?\s*,\s*id\s*:\s*"minecraft:loyalty"/);
    return level ? Number(level[1]) : 0;
}

/** The player, which srv.entities leaves out: its box from the server's position and pose. */
function playerEntity(recording: Recording, row: ExpandedRow): ServerEntity | undefined {
    const srv = row.srv;
    if (!srv) return undefined;
    const [x, y, z] = srv.pos;
    const height = srv.pose === 'STANDING' ? 1.8 : Math.fround(Number(row.post.bbHeight ?? 1.8));
    const half = Math.fround(0.6) / 2;
    return {
        id: recording.header.player.id, type: 'player', pos: srv.pos, vel: srv.vel,
        box: [x - half, y, z - half, x + half, y + Math.fround(height), z + half],
        pickable: true, alive: srv.health > 0, health: srv.health,
        root: vehicleRoot(row.post, recording.header.player.id),
    };
}

/** What the player rides: its root, the one level the cases ride. */
function vehicleRoot(post: Snapshot, own: number): number {
    const mount = post.vehicleId;
    return typeof mount === 'number' && mount >= 0 ? mount : own;
}

const target = (e: ServerEntity, hurt: boolean, enderman: boolean, invulnerable = false): NativeProjectileTarget => ({
    id: e.id,
    rootVehicle: e.root ?? e.id,
    position: vec(e.pos),
    boundingBox: { min: { x: e.box[0], y: e.box[1], z: e.box[2] }, max: { x: e.box[3], y: e.box[4], z: e.box[5] } },
    pickable: e.pickable ?? true,
    alive: e.alive ?? true,
    hurt,
    enderman,
    deflects: /breeze$/i.test(e.type),
    noPhysics: e.noPhysics ?? false,
    item: /^(minecraft:)?item$/i.test(e.type),
    windCharge: /wind_?charge/i.test(e.type),
    endCrystal: /end_?crystal/i.test(e.type),
    // (Player.getAbilities().invulnerable, as the row states it: only 1.8's arrow asks)
    invulnerablePlayer: invulnerable,
});

/**
 * The scene at this projectile's tick. The level ticks entities in the order they joined it, which here is their ids:
 * those before the projectile have moved in this server tick, so their state is this row's, and those after it are still
 * at the last row's.
 */
function scene(recording: Recording, last: ExpandedRow, row: ExpandedRow, projectile: number, enderman26: boolean, family: boolean): { targets: NativeProjectileTarget[]; fell: Set<number>; struck: Set<number>; partOf: Map<number, number> } {
    const before = new Map(entitiesOf(last).map(e => [e.id, e]));
    const after = new Map(entitiesOf(row).map(e => [e.id, e]));
    const ids = [...new Set([...before.keys(), ...after.keys()])].filter(id => id !== projectile).sort((a, b) => a - b);
    const out: NativeProjectileTarget[] = [];
    const lastParts: NativeProjectileTarget[] = [];
    const follow = !versionAtLeast(recording.header.mc, '1.21.4');
    const fell = new Set<number>();
    const struck = new Set<number>();
    const pushPlayer = () => {
        const player = playerEntity(recording, row);
        const lastPlayer = playerEntity(recording, last);
        if (!player) return;
        const hurt = lastPlayer !== undefined && player.health! < lastPlayer.health!;
        if (hurt) fell.add(player.id);
        out.push(target(player, hurt, false, row.post.invulnerable === true));
    };
    // (the player joined the level first: a thrown item's ignored entity before 1.14 hangs on the list's order)
    if (family) pushPlayer();
    const partOf = new Map<number, number>();
    // (the level lists a dragon's parts among its entities too: they come in below, through their dragon)
    const parts = new Set([...before.values(), ...after.values()].flatMap(e => (e.dragon?.parts ?? []).map(part => part.id)));
    for (const id of ids) {
        // (what appeared after this projectile's tick, as the chicken of its egg, was not there to hit)
        if (family && id > projectile && !before.has(id)) continue;
        // (an enderman runs from the hit itself, which the row shows far away: it was where it stood. The case's has no brain to move it otherwise.)
        const stood = before.get(id);
        const seen = id < projectile && !(stood && /enderman/i.test(stood.type)) ? after.get(id) ?? stood! : stood ?? after.get(id)!;
        if ((isArrow(seen) && !family) || parts.has(id)) continue;
        const up = (after.get(id)?.hurtTime ?? 0) > (before.get(id)?.hurtTime ?? 0);
        if (up) struck.add(id);
        const was = before.get(id)?.health;
        const now = after.get(id)?.health ?? 0;
        const isEnderman = /enderman/i.test(seen.type);
        // (an enderman loses no health to a projectile: pre 26.3 its hurt says true when it teleports, which can take it out of the view)
        if (was !== undefined && now < was && !(isEnderman && !after.has(id))) fell.add(id);
        // (what has no health, a boat, takes any hit)
        const hurt = isEnderman ? !enderman26 : was === undefined ? true : now < was || up;
        out.push(target(seen, hurt, isEnderman));
        // (a dragon's hits are its parts': Level.getEntities gives them after it, or from 1.21.4 after all the others)
        for (const part of seen.dragon?.parts ?? []) {
            partOf.set(part.id, id);
            (follow ? out : lastParts).push({
                // (a part's hurt says true when the dragon loses no health, as only a player's hit or an explosion takes it; a sitting
                // phase turns projectiles away with none to deal: 26.3 AbstractDragonSittingPhase.onHurt)
                ...target({ id: part.id, type: 'dragon_part', pos: part.pos, vel: [0, 0, 0], box: part.box }, !seen.dragon!.sitting, false),
                ...(follow ? { dragonBox: { min: vec([seen.box[0], seen.box[1], seen.box[2]]), max: vec([seen.box[3], seen.box[4], seen.box[5]]) } } : {}),
            });
        }
    }
    out.push(...lastParts);
    if (!family) pushPlayer();
    return { targets: out, fell, struck, partOf };
}

function owner(recording: Recording, row: ExpandedRow, shooter?: ServerEntity): NativeProjectileOwner {
    if (shooter) {
        const width = Math.fround(shooter.box[3] - shooter.box[0]);
        return {
            id: shooter.id, rootVehicle: shooter.root ?? shooter.id, eyePosition: vec(shooter.pos), width,
            alive: shooter.alive ?? true, player: false,
        };
    }
    const player = playerEntity(recording, row)!;
    const eye = Math.fround(row.post.pose === 'CROUCHING' ? 1.27 : 1.62);
    return {
        id: player.id,
        rootVehicle: player.root ?? player.id,
        eyePosition: { x: player.pos[0], y: player.pos[1] + eye, z: player.pos[2] },
        width: Math.fround(0.6),
        alive: player.alive ?? true,
        player: true,
    };
}

interface Flying {
    readonly id: number;
    readonly trident: boolean;
    /** Another family's `kind`, for which `flight` is the state. */
    readonly family?: string;
    readonly hasOwner: boolean;
    /** The mob that shot it: an entity id. */
    readonly shooter?: number;
    state: NativeArrowState & { dealtDamage?: boolean };
    flight?: NativeProjectileState;
    hits: NativeProjectileHitState;
    done: boolean;
}

/** The explosions in a rocket's saved item, the list in its NBT or, from 1.20.5, its component. */
const rocketExplodes = (nbt: string | undefined) => /Explosions\s*:\s*\[\s*\{|explosions"?\s*:\s*\[\s*\{/i.test(nbt ?? '');

/** A shulker bullet's delta while it has a target to steer to. */
function bulletDelta(e: ServerEntity): { x: number; y: number; z: number } | undefined {
    if (!/(?:^|[{,])\s*"?Target"?\s*:/.test(e.nbt ?? '')) return undefined;
    const [x, y, z] = [nbtNumber(e.nbt, 'TXD'), nbtNumber(e.nbt, 'TYD'), nbtNumber(e.nbt, 'TZD')];
    return x !== undefined && y !== undefined && z !== undefined ? { x, y, z } : undefined;
}

/** A family other than the arrows, from its first server tick. */
function seedFamily(e: ServerEntity, entities: readonly ServerEntity[], playerId: number, mc: string): Flying {
    const nbt = e.nbt;
    const age = e.age ?? 1;
    const lifeTime = nbtNumber(nbt, 'LifeTime');
    const power = nbtList(nbt, 'power');
    const acceleration = nbtNumber(nbt, 'acceleration_power');
    const shooter = SHOOTERS.find(([family]) => family.test(e.type));
    const mob = shooter ? entities.find(other => shooter[1].test(other.type) && !isProjectile(other)) : undefined;
    return {
        id: e.id,
        trident: false,
        family: e.type.replace(/^minecraft:/, ''),
        hasOwner: mob !== undefined || hasOwner(nbt) || /bobber|hook/i.test(e.type),
        ...(mob ? { shooter: mob.id } : {}),
        done: false,
        state: { position: vec(e.pos), velocity: vec(e.vel) },
        flight: {
            kind: e.type.replace(/^minecraft:/, ''),
            position: vec(e.pos),
            velocity: vec(e.vel),
            firstTick: false,
            onGround: e.onGround ?? false,
            ...(nbtFlag(nbt, 'NoGravity') ? { gravity: 0 } : {}),
            ...(nbtFlag(nbt, 'ShotAtAngle') ? { shotAtAngle: true } : {}),
            ...(nbtFlag(nbt, 'dangerous') ? { dangerous: true } : {}),
            ...(power?.length === 3 ? { power: { x: power[0]!, y: power[1]!, z: power[2]! } } : {}),
            ...(acceleration !== undefined ? { accelerationPower: acceleration } : {}),
            ...(e.noPhysics ? { noPhysics: true } : {}),
            ...(versionAtLeast(mc, '1.17') ? {} : { boundingBox: { min: vec([e.box[0]!, e.box[1]!, e.box[2]!]), max: vec([e.box[3]!, e.box[4]!, e.box[5]!]) } }),
        },
        hits: {
            tickCount: age,
            flyingTicks: age,
            leftOwner: nbtFlag(nbt, 'LeftOwner') ?? false,
            life: nbtNumber(nbt, 'Life') ?? 0,
            ...(lifeTime !== undefined ? { lifeTime } : {}),
            explodes: rocketExplodes(nbt),
            ...(/bullet/i.test(e.type) ? bulletHits(e) : {}),
            // (a thrown item's first tick ignored its thrower from 1.9 until 1.15, saved nowhere)
            ...(thrown(e) && hasOwner(nbt) && versionAtLeast(mc, '1.9') && !versionAtLeast(mc, '1.16')
                ? { ignored: playerId, ignoreTime: 2 } : {}),
        },
    };
}

const thrown = (e: ServerEntity) => /snowball|egg|pearl|potion|bottle/i.test(e.type);

/** The summons of a case's body: a thrown item's first tick has run by the row that first shows it, and these say where it began. */
function summonsOf(header: Recording['header']): { type: string; pos: readonly [number, number, number]; nbt: string | undefined }[] {
    const [x, y, z] = header.world.origin;
    return (header.body as unknown as readonly { op: string; action?: { op: string; summon?: { type: string; pos: readonly [number, number, number]; nbt?: string } } }[])
        .flatMap(step => (step.op === 'server' && step.action?.op === 'summon' && step.action.summon ? [step.action.summon] : []))
        .map(({ type, pos, nbt }) => ({ type: type.replace(/^minecraft:/, ''), pos: [pos[0] + x, pos[1] + y, pos[2] + z] as const, nbt }));
}

/** A summoned thrown item as its first tick found it: the row's state with the summon's place and motion. */
function seedSummoned(e: ServerEntity, summon: ReturnType<typeof summonsOf>[number], entities: readonly ServerEntity[], playerId: number, mc: string): Flying | undefined {
    const motion = nbtList(summon.nbt, 'Motion');
    if (motion?.length !== 3) return undefined;
    const flying = seedFamily(e, entities, playerId, mc);
    const position = { x: summon.pos[0], y: summon.pos[1], z: summon.pos[2] };
    const velocity = { x: motion[0]!, y: motion[1]!, z: motion[2]! };
    return {
        ...flying,
        state: { ...flying.state, position, velocity },
        flight: { ...flying.flight!, position, velocity, firstTick: true, onGround: false },
        hits: { ...flying.hits, tickCount: 0, flyingTicks: 0 },
    };
}

const bulletHits = (e: ServerEntity) => {
    const bulletDeltaNow = bulletDelta(e);
    return bulletDeltaNow ? { bulletDelta: bulletDeltaNow } : {};
};

function seed(e: ServerEntity): Flying {
    const nbt = e.nbt;
    const trident = isTrident(e);
    return {
        id: e.id,
        trident,
        hasOwner: hasOwner(nbt),
        done: false,
        state: {
            position: vec(e.pos),
            velocity: vec(e.vel),
            inGround: nbtFlag(nbt, 'inGround') ?? false,
            life: nbtNumber(nbt, 'life') ?? 0,
            shakeTime: nbtNumber(nbt, 'shake') ?? 0,
            ...(nbtFlag(nbt, 'NoGravity') ? { gravity: 0 } : {}),
            ...(trident ? { dealtDamage: nbtFlag(nbt, 'DealtDamage') ?? false } : {}),
        },
        hits: {
            tickCount: e.age ?? 1,
            flyingTicks: e.age ?? 1,
            leftOwner: nbtFlag(nbt, 'LeftOwner') ?? false,
            pierceLevel: nbtNumber(nbt, 'PierceLevel') ?? 0,
            pierced: [],
            baseDamage: nbtNumber(nbt, 'damage') ?? 2,
            loyalty: trident ? loyaltyOf(nbt) : 0,
            pickupAllowed: nbtNumber(nbt, 'pickup') === 1,
        },
    };
}

export function replayProjectiles(recording: Recording): ProjectileReplay {
    const binding = nativeBinding();
    const mc = recording.header.mc;
    const enderman26 = versionAtLeast(mc, '26.3');
    const { sync, area } = worldSync(recording);
    const flying = new Map<number, Flying>();
    const divergences: ProjectileDivergence[] = [];
    const hits: { t: number; projectile: number; target: number; reaction: string }[] = [];
    const blockHits: (readonly [number, number, number, number, number, string])[] = [];
    const playerHealth: { t: number; before: number; after: number; reaction?: string; damage?: number }[] = [];
    let compared = 0;
    let lastRow: ExpandedRow | undefined;
    // (the border the case set: a projectile clips against it, from either side)
    const border = new BorderTracker(mc);
    let bordered = false;
    const summons = summonsOf(recording.header);
    for (const row of recording.rows) {
        border.tick();
        border.packets(row.s2c);
        for (const [x, y, z, state] of row.blocks) {
            area.setState(x, y, z, state);
            sync.blockChanged({ x, y, z });
        }
        border.packets(row.s2c);
        bordered ||= border.changed;
        const now = entitiesOf(row);
        const byId = new Map(now.map(e => [e.id, e]));
        // (a thrown item that was summoned comes in before its first tick, which is this row's: a first tick has bubble columns of its own)
        for (const e of now) {
            if (flying.has(e.id) || !lastRow || !thrown(e) || e.age !== 1) continue;
            const at = summons.findIndex(s => e.type.endsWith(s.type));
            const seeded = at < 0 ? undefined : seedSummoned(e, summons[at]!, now, recording.header.player.id, mc);
            if (seeded) {
                summons.splice(at, 1);
                flying.set(e.id, seeded);
            }
        }
        for (const p of flying.values()) {
            if (p.done || !lastRow) continue;
            const seen = byId.get(p.id);
            const { position: at, velocity: motion } = p.flight ?? p.state;
            const reach = 6;
            sync.sync(area, {
                minX: Math.min(at.x, at.x + motion.x) - reach, minY: Math.min(at.y, at.y + motion.y) - reach, minZ: Math.min(at.z, at.z + motion.z) - reach,
                maxX: Math.max(at.x, at.x + motion.x) + reach, maxY: Math.max(at.y, at.y + motion.y) + reach, maxZ: Math.max(at.z, at.z + motion.z) + reach,
            }, 2);
            // the level's height, which Entity.checkBelowWorld reads: the release's default, the cases run in the overworld
            // (after the sync, whose first call makes the world anew)
            sync.setWorldBorder(bordered ? border.state() : undefined, versionAtLeast(mc, '1.18') ? { minY: -64, height: 384 } : { minY: 0, height: 256 });
            const { targets, fell, struck, partOf } = scene(recording, lastRow, row, p.id, enderman26, p.family !== undefined);
            const mob = p.shooter === undefined ? undefined : byId.get(p.shooter) ?? new Map(entitiesOf(lastRow).map(e => [e.id, e])).get(p.shooter);
            const shooter = p.hasOwner ? owner(recording, row, mob) : undefined;
            let tick: NativeArrowHitTick | NativeTridentHitTick | NativeProjectileHitTick;
            let result: NativeArrowHitTick['arrow'] & { dealtDamage?: boolean };
            let noPhysics = false;
            let familyTick: NativeProjectileHitTick | undefined;
            if (p.flight) {
                // a rocket the client holds attached follows the server's player (its yaw is the client's, which the server takes)
                if (/firework/i.test(p.family ?? '') && (p.hits.attached || ((row.post.attachedRockets ?? []) as { id: number }[]).some(r => r.id === p.id)) && row.srv) {
                    // (the rocket's motion is its holder's after the boost, which its own row states, and the client's on the row that ends it)
                    // (before 1.14 a kept box rounds the server's position by a bit between the rocket's tick and the row: the rocket's own says where it was)
                    const holder = { position: vec(versionAtLeast(mc, '1.14') ? row.srv.pos : seen?.pos ?? row.srv.pos), velocity: vec(seen?.vel ?? (row.post.vel as Vec)), gliding: /fall_?flying/i.test(String(lastRow.srv?.pose ?? row.srv.pose)), yawDegrees: row.pre.yRot as number };
                    p.hits = { ...p.hits, attached: true, holder };
                }
                // the delta that steers this tick is the one the last row left, which the server may have just drawn
                const lastSeen = entitiesOf(lastRow).find(e => e.id === p.id);
                if (lastSeen && /bullet/i.test(lastSeen.type)) {
                    const delta = bulletDelta(lastSeen);
                    p.hits = { ...p.hits };
                    if (delta) p.hits.bulletDelta = delta;
                    else delete p.hits.bulletDelta;
                }
                // what frees a hook from a block before 1.11 is the server's random: the row's motion, or its move, states it
                if (p.hits.inGround && seen && !versionAtLeast(mc, '1.11')) {
                    const was = p.flight.position;
                    const v = p.flight.velocity;
                    // (a draw is at most 0.2: a larger share of the motion is a move too small for the position to show)
                    const stood = seen.pos[0] === was.x && seen.pos[1] === was.y && seen.pos[2] === was.z && Math.abs(seen.vel[1] / v.y) <= 0.2000001;
                    // (0.5F against a block, 0.92F in the air, and the motion keeps digits a move on top of a position has lost)
                    const blocked = seen.onGround === true || (seen.vel[0] === 0 && v.x !== 0) || (seen.vel[2] === 0 && v.z !== 0);
                    const inertia = Math.fround(blocked ? 0.5 : 0.92);
                    const axis = (pos: number, at: number, vel: number, by: number, falls: boolean) => {
                        if (by === 0) return 0;
                        if (stood) return Math.fround(vel / by);
                        if (!falls && vel !== 0) return Math.fround(vel / (by * inertia));
                        // (a block took this axis's move, and no ray met it: any draw under the ray's 1.0E-7 cutoff does)
                        return pos === at ? Math.min(0.1, 1e-4 / Math.abs(by)) : Math.fround((pos - at) / by);
                    };
                    p.hits = {
                        ...p.hits,
                        groundRelease: { x: axis(seen.pos[0], was.x, seen.vel[0], v.x, false), y: axis(seen.pos[1], was.y, seen.vel[1], v.y, true), z: axis(seen.pos[2], was.z, seen.vel[2], v.z, false) },
                    };
                }
                const t = binding.simulateVersionedProjectileHitTick(mc, sync.world as never, p.flight, p.hits, targets, shooter);
                tick = t;
                familyTick = t;
                result = { ...t.projectile, inGround: false, inGroundTime: 0, shakeTime: 0, startedFalling: false, life: 0 } as never;
            } else if (p.trident) {
                const t = binding.simulateVersionedTridentHitTick(mc, sync.world as never, p.state, p.hits, targets, shooter);
                tick = t;
                result = t.trident;
                noPhysics = t.noPhysics;
            } else {
                const t = binding.simulateVersionedArrowHitTick(mc, sync.world as never, p.state, p.hits, targets, shooter);
                tick = t;
                result = t.arrow;
            }
            compared += 1;
            const out = (field: string, expected: unknown, actual: unknown) => divergences.push({ t: row.t, projectile: p.id, field, expected, actual });
            for (const hit of tick.entityHits as NativeProjectileEntityHit[]) hits.push({ t: row.t, projectile: p.id, target: hit.target, reaction: hit.reaction });
            if (tick.blockHit) blockHits.push([row.t, p.id, tick.blockHit.block.x, tick.blockHit.block.y, tick.blockHit.block.z, tick.blockHit.face]);
            // the falls in health this tick, and the engine's hits, one for one (several projectiles may share a target)
            const entityHits = tick.entityHits as NativeProjectileEntityHit[];
            const bursts = p.family !== undefined && BURSTS.test(p.family);
            for (const id of new Set([...fell, ...struck])) {
                const claimed = flying.size > 1 || bursts || entityHits.some(hit => hit.target === id || partOf.get(hit.target) === id);
                if (!claimed) out('hit', `#${id} is hit`, 'no hit');
            }
            for (const hit of entityHits) {
                const t = targets.find(x => x.id === hit.target);
                if (hit.reaction === 'hurt' && t && !t.hurt && !t.enderman) out('hit', 'no hurt', `#${hit.target} ${hit.reaction}`);
            }
            const playerId = recording.header.player.id;
            const before = lastRow.srv?.health;
            const after = row.srv?.health;
            if (fell.has(playerId) && before !== undefined && after !== undefined) {
                const hit = entityHits.find(h => h.target === playerId);
                playerHealth.push({ t: row.t, before, after, ...(hit ? { reaction: hit.reaction, ...(hit.damage != null ? { damage: hit.damage } : {}) } : {}) });
                const type = byId.get(p.id)?.type ?? entitiesOf(lastRow).find(e => e.id === p.id)?.type ?? '';
                // (a mob's hit scales with the difficulty)
                const damage = hit?.damage ?? (p.shooter === undefined ? DAMAGE.find(([family]) => family.test(type))?.[1] : undefined);
                if (hit?.reaction === 'hurt' && damage !== undefined && before - after !== damage) out('health', before - damage, after);
            }
            if (!seen) {
                p.done = true;
                // a player picks up what stopped flying (AbstractArrow.playerTouch), which the engine leaves to the caller
                const pickedUp = !p.flight && (result.inGround || noPhysics);
                if (!result.discarded && !pickedUp) out('discarded', true, false);
                continue;
            }
            if (result.discarded) {
                p.done = true;
                out('discarded', false, true);
                continue;
            }
            // (the snapshot reads through a Vec3, whose constructor makes -0 of +0 before 1.13)
            const equal = versionAtLeast(mc, '1.13') ? Object.is : (x: number, y: number) => x === y;
            const same = (a: Vec, b: NativeVec3) => equal(a[0], b.x) && equal(a[1], b.y) && equal(a[2], b.z);
            if (!same(seen.pos, result.position)) out('pos', seen.pos, result.position);
            if (!same(seen.vel, result.velocity)) out('vel', seen.vel, result.velocity);
            const saved = (field: string, expected: unknown, actual: unknown) => {
                if (expected !== undefined && expected !== actual) out(field, expected, actual);
            };
            if (p.flight) {
                saved('onGround', /bobber|hook|firework/i.test(seen.type) ? seen.onGround : undefined, familyTick!.projectile.onGround);
                saved('Life', nbtNumber(seen.nbt, 'Life'), familyTick!.hitState.life);
            } else {
                saved('inGround', nbtFlag(seen.nbt, 'inGround'), result.inGround);
                saved('life', nbtNumber(seen.nbt, 'life'), result.life);
                saved('pierceLevel', nbtNumber(seen.nbt, 'PierceLevel'), tick.hitState.pierceLevel);
            }
            // (a fishing hook saves nothing of it)
            if (!/bobber|hook/i.test(seen.type)) saved('leftOwner', nbtFlag(seen.nbt, 'LeftOwner') ?? (versionAtLeast(mc, '1.16') ? false : undefined), tick.hitState.leftOwner);
            if (p.trident) saved('dealtDamage', nbtFlag(seen.nbt, 'DealtDamage'), result.dealtDamage);
            if (p.flight) {
                const t = familyTick!;
                p.flight = {
                    ...p.flight,
                    position: t.projectile.position,
                    velocity: t.projectile.velocity,
                    ...(t.projectile.boundingBox ? { boundingBox: t.projectile.boundingBox } : {}),
                    inWater: t.projectile.inWater,
                    firstTick: t.projectile.firstTick,
                    horizontalCollision: t.projectile.horizontalCollision,
                    onGround: t.projectile.onGround,
                    bobbing: t.projectile.bobbing,
                    accelerationPower: t.accelerationPower,
                    power: t.power,
                };
                p.hits = t.hitState;
                continue;
            }
            p.state = {
                ...p.state, ...result,
                ...(p.trident ? { dealtDamage: result.dealtDamage ?? false } : {}),
                noPhysics,
            } as Flying['state'];
            p.hits = tick.hitState;
        }
        for (const e of now) {
            if (isProjectile(e) && !flying.has(e.id)) flying.set(e.id, isArrow(e) ? seed(e) : seedFamily(e, now, recording.header.player.id, mc));
        }
        lastRow = row;
    }
    return {
        id: recording.header.scenario.id, compared, hits, blockHits, playerHealth, projectiles: flying.size, divergences,
        ...(divergences.length > 0 ? { first: divergences[0]! } : {}),
    };
}

export const describeProjectile = (d: ProjectileDivergence): string =>
    `t=${d.t} #${d.projectile} ${d.field}: vanilla ${JSON.stringify(d.expected)}, engine ${JSON.stringify(d.actual)}`;
