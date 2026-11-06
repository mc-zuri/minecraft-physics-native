// The bot layer: a whole mineflayer bot on a client with no connection. The bot is put where the vanilla client was when the
// body began, each row delivers the recorded server packets in order, sets the keys and the look and runs one physics tick, and
// what the bot writes is held to what the client sent: by name, order and bytes, the answers to a packet apart from the tick's
// own. Each server packet is delivered exactly once, which a repeat would show as an extra answer or a move applied twice.
//
// Compared are the packets of movement and input (MOVEMENT) and those of a player's hands (HANDS), which the keys and the slot of
// each row drive through the fork's own calls as Minecraft.handleKeybinds would (Hands, at the start of the tick). A press is what
// is driven: the 4-tick repeat of a held use key is not, nor is what the recorded scenario does on a screen (a click, a menu).
// Those are counted by name as not compared, never as matching, and what differs from the first such action on is `afterHands`,
// coverage this layer lacks and not behaviour. A packet the codec cannot read is a `codec` problem of its own, so that a codec gap
// is not read as behaviour either. What the client sent outside the player's tick and outside a packet's handling is `betweenTicks`:
// Minecraft.handleKeybinds and a ridden boat's own tick (Boat.controlBoat, ServerboundPaddleBoatPacket to 1.21.1), both ahead of
// the player's tick in the same client tick, where the bot writes them too. So the two lists go in order as one, and a difference
// in what the client sent between ticks is reported as `betweenTicks`, apart from the tick's own.

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { ExpandedRow, Recording, Snapshot } from '../schema/recording.ts';
import { SAME_DATA } from '../scenarios/dsl/names.ts';
import { packetBytes } from './load.ts';
import { minecraftProtocol, mineflayerRequire } from './packets.ts';
import { TeamTracker } from './teams.ts';
import { AreaWorld } from './world.ts';

const require = createRequire(import.meta.url);
const root = new URL('../../', import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'] as const;
/** minecraft-protocol's names of the packets a press of a key or a choice of a slot sends. */
export const HANDS: ReadonlySet<string> = new Set(['arm_animation', 'block_dig', 'block_place', 'use_item', 'use_entity', 'held_item_slot', 'punch']);
/** minecraft-protocol's names of the packets a client tick sends about movement and input. */
export const MOVEMENT: ReadonlySet<string> = new Set(['position', 'position_look', 'look', 'flying', 'player_input', 'entity_action', 'tick_end',
    'teleport_confirm', 'steer_vehicle', 'vehicle_move', 'steer_boat']);
const OPERATIONS: Readonly<Record<string, number>> = { add_value: 0, addition: 0, add_multiplied_base: 1, multiply_base: 1, add_multiplied_total: 2, multiply_total: 2 };
const GAME_MODES = ['survival', 'creative', 'adventure', 'spectator'];

export interface WrittenPacket { readonly name: string; readonly bytes: Buffer; readonly params?: Any }

/** What is wrong with a list of packets: the first kind found, which says where to look. */
export type PacketDifference =
    | { readonly kind: 'missing'; readonly names: readonly string[] }
    | { readonly kind: 'extra'; readonly names: readonly string[] }
    | { readonly kind: 'reordered'; readonly expected: readonly string[]; readonly actual: readonly string[] }
    | { readonly kind: 'bytes'; readonly index: number; readonly name: string; readonly expected: string; readonly actual: string };

function without(from: readonly string[], taken: readonly string[]): string[] {
    const left = [...from];
    for (const name of taken) {
        const at = left.indexOf(name);
        if (at >= 0) left.splice(at, 1);
    }
    return left;
}

/** The first difference between what the client sent and what the bot wrote; none when they are the same to the byte. */
export function comparePackets(expected: readonly WrittenPacket[], actual: readonly WrittenPacket[]): PacketDifference | undefined {
    const [want, got] = [expected.map(p => p.name), actual.map(p => p.name)];
    const missing = without(want, got);
    if (missing.length > 0) return { kind: 'missing', names: missing };
    const extra = without(got, want);
    if (extra.length > 0) return { kind: 'extra', names: extra };
    if (want.some((name, i) => name !== got[i])) return { kind: 'reordered', expected: want, actual: got };
    for (const [index, packet] of expected.entries()) {
        if (!packet.bytes.equals(actual[index]!.bytes)) return { kind: 'bytes', index, name: packet.name, expected: packet.bytes.toString('hex'), actual: actual[index]!.bytes.toString('hex') };
    }
    return undefined;
}

export interface BotDivergence {
    readonly t: number;
    /** `responses`: while a server packet was handled; `betweenTicks`: after it, outside a tick; `tick`: the tick's own packets; `state`: where the tick left the bot. */
    readonly at: 'responses' | 'betweenTicks' | 'tick' | 'state';
    readonly difference?: PacketDifference;
    readonly field?: string;
    readonly expected?: unknown;
    readonly actual?: unknown;
}

export interface BotResult {
    readonly id: string;
    readonly ticks: number;
    /** Ticks the bot ran; packets compared, by name. */
    readonly compared: number;
    readonly packets: Readonly<Record<string, number>>;
    /** What the client sent and this layer does not compare, by name. */
    readonly notCompared: Readonly<Record<string, number>>;
    readonly divergences: readonly BotDivergence[];
    readonly first?: BotDivergence;
    /** The first tick the client acted with its hands, which the bot did not; what differs from it on is here, not in `divergences`. */
    readonly handsAt?: number;
    readonly afterHands: readonly BotDivergence[];
    /** Packets the codec could not read: a codec gap, not a behaviour. */
    readonly codec: readonly string[];
    /** Why the recording could not be run at all. */
    readonly unsupported?: string;
    /** Server packets delivered, each exactly once. */
    readonly delivered: number;
}

interface Codecs { toServer: Any; fromServer: Any; toClient: Any; readServerbound: Any }
const codecs = new Map<string, Codecs>();
function codecsFor(version: string): Codecs {
    const data = SAME_DATA[version] ?? version;
    let c = codecs.get(data);
    if (!c) {
        const mc = minecraftProtocol() as Any;
        c = {
            toServer: mc.createSerializer({ state: 'play', isServer: false, version: data }),
            fromServer: mc.createDeserializer({ state: 'play', isServer: false, version: data }),
            toClient: mc.createSerializer({ state: 'play', isServer: true, version: data }),
            readServerbound: mc.createDeserializer({ state: 'play', isServer: true, version: data }),
        };
        codecs.set(data, c);
    }
    return c;
}

/** The name of a recorded client packet as minecraft-protocol calls it, or undefined when the codec cannot read it. */
function serverboundName(version: string, bytes: Buffer): string | undefined {
    try {
        return codecsFor(version).readServerbound.parsePacketBuffer(bytes).data.name as string;
    } catch {
        return undefined;
    }
}

/** A minecraft-protocol client with no connection: what the bot writes is encoded and kept, what the server sent is decoded and emitted. */
function fakeClient(version: string, username: string): Any {
    const codec = codecsFor(version);
    const client: Any = new EventEmitter();
    client.setMaxListeners(0);
    client.version = SAME_DATA[version] ?? version;
    client.username = username;
    client.state = 'handshaking';
    client.written = [] as WrittenPacket[];
    client.write = (name: string, params: unknown) => client.written.push({ name, params, bytes: codec.toServer.createPacketBuffer({ name, params }) });
    client.end = (reason?: string) => client.emit('end', reason ?? 'replay ended');
    mineflayerRequire()('minecraft-protocol/src/client/pluginChannels')(client, { version: client.version });
    client.receive = (name: string, params: unknown) => client.emit(name, params, { name, state: client.state });
    client.receiveBytes = (bytes: Buffer) => {
        const { data } = codec.fromServer.parsePacketBuffer(bytes);
        client.receive(data.name, data.params);
        return data.name as string;
    };
    client.receiveWritten = (name: string, params: unknown) => client.receiveBytes(codec.toClient.createPacketBuffer({ name, params }));
    client.setState = (state: string) => {
        const previous = client.state;
        client.state = state;
        client.emit('state', state, previous);
    };
    return client;
}

function loginPacket(registry: Any, start: Snapshot, entityId: number): Any {
    const gameMode = Math.max(0, GAME_MODES.indexOf(start.gameMode as string));
    if (registry.supportFeature('usesLoginPacket')) {
        const packet = structuredClone(registry.loginPacket);
        packet.entityId = entityId;
        if (packet.worldState) packet.worldState.gamemode = GAME_MODES[gameMode];
        else packet.gameMode = gameMode;
        return packet;
    }
    return { entityId, levelType: 'default', gameMode, dimension: 0, difficulty: 0, maxPlayers: 20, reducedDebugInfo: false };
}

/** The world of the recording as chunk columns: what the player meets, resolved, not the area's fills. */
function placeWorld(bot: Any, recording: Recording, version: string): void {
    const blocks = recording.header.world.blocks;
    if (!blocks) return;
    const fork = mineflayerRequire();
    const Chunk = fork(fork.resolve('prismarine-chunk'))(bot.registry);
    const { Vec3 } = fork('vec3');
    const area = new AreaWorld(recording.header);
    const built = new Map<string, Any>();
    const air = area.getBlockStateId({ x: 2 ** 40, y: 0, z: 0 });
    for (let x = blocks.from[0]; x <= blocks.to[0]; x += 1) {
        for (let z = blocks.from[2]; z <= blocks.to[2]; z += 1) {
            const id = `${x >> 4},${z >> 4}`;
            if (!built.has(id)) built.set(id, new Chunk({ minY: bot.game.minY ?? 0, worldHeight: bot.game.height ?? 256 }));
            const column = built.get(id);
            for (let y = blocks.from[1]; y <= blocks.to[1]; y += 1) {
                const state = area.getBlockStateId({ x, y, z });
                if (state !== air) column.setBlockStateId(new Vec3(x & 15, y, z & 15), state);
            }
        }
    }
    for (const [id, column] of built) {
        const [x, z] = id.split(',').map(Number);
        bot.world.setColumn(x, z, column);
    }
    void version;
}

const pascal = (name: string) => name.split('_').map(part => part[0]!.toUpperCase() + part.slice(1)).join('');
const camel = (name: string) => name.replace(/[._]([a-z])/g, (_, c: string) => c.toUpperCase());
const bare = (name: string) => name.replace(/^minecraft:/, '');

/** The effects and attributes the server had synced when the body began, as the packets that synced them. */
function receiveSynced(client: Any, registry: Any, start: Snapshot, entityId: number): void {
    for (const { id, amplifier } of (start.effects ?? []) as { id: string; amplifier: number }[]) {
        const effect = registry.effectsByName[pascal(bare(id))];
        if (effect) client.receiveWritten('entity_effect', { entityId, effectId: effect.id, amplifier, duration: 32767, hideParticles: 0, flags: 0 });
    }
    const packetName = registry.version['>=']('1.9') ? 'entity_update_attributes' : 'update_attributes';
    const [keyField] = registry.protocol.play.toClient.types[`packet_${packetName}`][1][1].type[1].type[1];
    const properties: Any[] = [];
    for (const [name, attribute] of Object.entries((start.attributes ?? {}) as Record<string, { base: number; modifiers?: { id: string; amount: number; operation: string | number }[] }>)) {
        const plain = bare(name).replace(/^(generic|player)\./, '');
        const known = [name, plain, `generic.${plain}`, `player.${plain}`].map(n => registry.attributesByName[camel(bare(n))]).find(Boolean);
        if (!known) continue;
        let key: unknown = registry.version['>=']('1.16') ? `minecraft:${bare(known.resource)}` : known.resource;
        if (Array.isArray(keyField.type)) {
            key = Object.values(keyField.type[1].mappings as Record<string, string>).find(mapped => bare(mapped) === bare(known.resource));
            if (key === undefined) continue;
        }
        properties.push({
            [keyField.name]: key, value: attribute.base,
            modifiers: (attribute.modifiers ?? []).map(m => ({ uuid: m.id, amount: m.amount, operation: typeof m.operation === 'number' ? m.operation : OPERATIONS[m.operation.toLowerCase()] ?? 0 })),
        });
    }
    if (properties.length > 0) client.receiveWritten(packetName, { entityId, properties });
}

function receiveAbilities(client: Any, start: Snapshot): void {
    const creative = start.gameMode === 'creative';
    const flags = (start.invulnerable ? 1 : 0) | (start.flying ? 2 : 0) | (start.mayfly ? 4 : 0) | (creative ? 8 : 0);
    client.receiveWritten('abilities', { flags, flyingSpeed: start.flyingSpeed ?? 0.05, walkingSpeed: 0.1 });
}

/** The equipment the setup gave, as the server gives it: a set_slot into the player's window. */
function equip(client: Any, registry: Any, recording: Recording): void {
    const fork = mineflayerRequire();
    const Item = fork(fork.resolve('prismarine-item'))(registry);
    const slots: Readonly<Record<string, number>> = { head: 5, chest: 6, legs: 7, feet: 8, mainhand: 36, offhand: 45 };
    const give = (slot: number, spec: { id: string; count?: number }) => {
        const known = registry.itemsByName[spec.id];
        if (known) client.receiveWritten('set_slot', { windowId: 0, stateId: 0, slot, item: Item.toNotch(new Item(known.id, spec.count ?? 1, 0)) });
    };
    for (const [slot, spec] of Object.entries((recording.header.setup.equipment ?? {}) as Record<string, { id: string; count?: number }>)) {
        if (slots[slot] !== undefined) give(slots[slot]!, spec);
    }
    // (the inventory's own numbers: the hotbar 0 to 8 is the window's 36 to 44, the armour 36 to 39 its 8 to 5, the off hand 40 its 45)
    for (const [slot, spec] of Object.entries((recording.header.setup.inventory ?? {}) as Record<string, { id: string; count?: number }>)) give(Number(slot) < 9 ? 36 + Number(slot) : Number(slot) === 40 ? 45 : Number(slot) >= 36 ? 44 - Number(slot) : Number(slot), spec);
}

/** The client's state when the body began: motion, contacts, and what it last sent the server. */
function useStart(bot: Any, start: Snapshot): void {
    const entity = bot.entity;
    entity.position.set(...(start.pos as number[]));
    entity.velocity.set(...(start.vel as number[]));
    entity.onGround = start.onGround;
    entity.lastOnGround = start.onGround;
    entity.isCollidedHorizontally = start.horizontalCollision;
    entity.isCollidedVertically = start.verticalCollision;
    entity.isInWater = start.isInWater;
    entity.swimming = !!start.swimming;
    entity.isInLava = start.isInLava;
    entity.isInPowderSnow = !!start.isInPowderSnow;
    entity.isUnderWater = !!start.isUnderWater;
    entity.crouching = start.crouching;
    bot.jumpTicks = start.noJumpDelay;
    const state = bot.physicsEngineCtx?.state;
    if (state && start.stuckSpeedMultiplier) state.stuckSpeedMultiplier.set(...(start.stuckSpeedMultiplier as number[]));
    const sent = bot._lastSent;
    if (Array.isArray(start.lastSentPos)) [sent.x, sent.y, sent.z] = start.lastSentPos as number[];
    sent.yaw = start.lastSentYRot ?? start.yRot;
    sent.pitch = start.lastSentXRot ?? start.xRot;
    sent.onGround = start.lastOnGround ?? start.onGround;
    sent.flags = { onGround: sent.onGround, hasHorizontalCollision: !!start.lastHorizontalCollision };
    sent.positionReminder = start.positionReminder ?? 0;
    sent.sprintState = !!start.wasSprinting;
    sent.sneakState = !!start.wasShiftKeyDown;
}

function setLook(bot: Any, yaw: number, pitch: number): void {
    const fork = mineflayerRequire();
    const conv = fork('./lib/conversions');
    const { JavaFloat } = fork('./lib/javamath');
    bot.entity.yawDegrees = new JavaFloat(yaw);
    bot.entity.pitchDegrees = new JavaFloat(pitch);
    bot.entity.yaw = conv.fromNotchianYaw(yaw);
    bot.entity.pitch = conv.fromNotchianPitch(pitch);
}

function setKeys(bot: Any, keys: readonly string[]): void {
    for (const key of KEYS) if (bot.getControlState(key) !== keys.includes(key)) bot.setControlState(key, keys.includes(key));
}

/** The tick clock of a replay: mineflayer times what it does by it, 50 ms a tick. */
function virtualClock(): { advance(ms: number): void; restore(): void } {
    const { performance } = require('node:perf_hooks') as typeof import('node:perf_hooks');
    const own = Object.prototype.hasOwnProperty.call(performance, 'now');
    const previous = performance.now;
    let now = performance.now();
    (performance as Any).now = () => now;
    return {
        advance(ms) { now += ms; },
        restore() {
            if (own) (performance as Any).now = previous;
            else delete (performance as Any).now;
        },
    };
}

async function startBot(recording: Recording, options: BotOptions): Promise<{ bot: Any; client: Any }> {
    const version = recording.header.mc;
    const start = recording.rows[0]!.pre;
    const entityId = recording.header.player.id;
    const client = fakeClient(version, recording.header.player.name);
    client.uuid = recording.header.player.uuid;
    const mineflayer = mineflayerRequire()('.') as Any;
    const adapter = require(new URL('dist/index.js', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    // (the plugin keeps its MinecartTracker to itself, and the cart the client rode at the start has to go in it)
    let carts: Any;
    const nativePhysics = Object.create(adapter, {
        MinecartTracker: {
            value: class extends adapter.MinecartTracker {
                constructor(...made: unknown[]) {
                    super(...made);
                    carts = this;
                }
            },
        },
    });
    const bot = mineflayer.createBot({ client, version: client.version, username: client.username, physicsManual: true, respawn: false, hideErrors: true, logErrors: false, nativePhysics });
    client.setState('play');
    await new Promise(resolve => setImmediate(resolve));
    if (options.keepLastSentOnTeleport) {
        // (26.3 ClientPacketListener.handleMovePlayer leaves LocalPlayer.xLast, which only sendPosition sets)
        let before: { x: number; y: number; z: number } | undefined;
        client.prependListener('position', () => {
            const { x, y, z } = bot._lastSent;
            before = { x, y, z };
        });
        client.on('position', () => {
            if (before) Object.assign(bot._lastSent, before);
        });
    }
    const registry = bot.registry;
    const codec = registry.registryCodec ?? registry.loginPacket?.dimensionCodec;
    if (registry.supportFeature('segmentedRegistryCodecData')) for (const entry of Object.values(codec ?? {})) client.receive('registry_data', entry);
    else if (registry.supportFeature('hasConfigurationState')) client.receive('registry_data', { codec: codec ?? {} });
    client.receive('login', loginPacket(registry, start, entityId));
    if (registry.version['>=']('1.21.4')) client.receive('game_state_change', { reason: 'level_chunks_load_start', gameMode: 0 });
    placeWorld(bot, recording, version);
    equip(client, registry, recording);
    client.receive('update_health', { health: start.health ?? 20, food: start.food ?? 20, foodSaturation: 5 });
    receiveSynced(client, registry, start, entityId);
    receiveAbilities(client, start);
    const [x, y, z] = start.pos as number[];
    const [yaw, pitch] = [(start.lastSentYRot ?? start.yRot) as number, (start.lastSentXRot ?? start.xRot) as number];
    client.receive('position', {
        x, y, z, yaw, pitch, dx: 0, dy: 0, dz: 0, teleportId: 0,
        flags: registry.supportFeature('positionPacketHasBitflags') ? { x: false, y: false, z: false, yaw: false, pitch: false } : 0,
    });
    bot.physics.autoJump = !!start.autoJumpEnabled;
    // the bot's first tick is its own, for what it keeps of the look it last sent; then it stands where the client stood
    // (with nothing around it yet: what that tick pushed, from where the bot is not, would be in the first of the body)
    if (registry.version['>=']('1.9') && registry.version['<']('1.17')) bot.physicsTick();
    setLook(bot, yaw, pitch);
    bot.physicsTick();
    useEntities(bot, start);
    useTeams(bot, client, recording);
    useVehicle(bot, client, recording, start, carts);
    useStart(bot, start);
    client.written.length = 0;
    return { bot, client };
}

/** The client's sends that are not its hands: what the network layer answers by itself. */
const HANDLESS: ReadonlySet<string> = new Set(['chunk_batch_received', 'keep_alive', 'pong', 'ping_request', 'abilities', 'client_command', 'settings', 'configuration_acknowledged', 'player_loaded', 'selected_slot']);

/** The other entities the client held when the body began, in bot.entities as their spawn packets would have left them. */
function useEntities(bot: Any, start: Snapshot): void {
    const fork = mineflayerRequire();
    const Entity = fork(fork.resolve('prismarine-entity'))(bot.version);
    const { Vec3 } = fork('vec3');
    const listed = (start.nearbyEntities ?? []) as { id: number; type: string; pos: number[]; box?: number[] }[];
    const vehicle = start.vehicle as { id: number; type: string; pos: number[]; box?: number[] } | null | undefined;
    for (const { id, type, pos, box } of [...listed, ...(vehicle ? [vehicle] : [])]) {
        const data = bot.registry.entitiesByName[type];
        const entity = bot.entities[id] ?? (bot.entities[id] = new Entity(id));
        Object.assign(entity, { type: data?.type ?? 'other', name: type, displayName: data?.displayName, entityType: data?.id, kind: data?.category, width: data?.width, height: data?.height });
        entity.position = new Vec3(...pos);
        if (box !== undefined) entity.box = box;
        bot.entityInterpolation?.spawn(entity);
    }
    for (const id of [...listed.map(e => e.id)].sort((a, b) => a - b)) bot._entityTickOrder?.add(id);
}

/** The scoreboard teams the setup made, whose packets came before the first row: a member by name, an entity by a uuid of its own. */
function useTeams(bot: Any, client: Any, recording: Recording): void {
    for (const { team, rule, members } of new TeamTracker(recording.header).teams()) {
        const players = members.flatMap(member => (member === recording.header.player.name ? [member] : (Object.values(bot.entities) as Any[]).filter(entity => entity !== bot.entity && entity.name === member).map(entity => {
            entity.uuid ??= `entity-${entity.id}`;
            return entity.uuid as string;
        })));
        client.receive('teams', { team, mode: 0, name: team, friendlyFire: 0, nameTagVisibility: 'always', collisionRule: rule, color: 0, prefix: '', suffix: '', players });
    }
}

const HORSES = new Set(['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'llama', 'trader_llama', 'camel', 'camel_husk']);

type Xyz = { x: number; y: number; z: number };

/** The vehicle the client rode when the body began, as the server put it there, a mount ready as the recorder made it. */
function useVehicle(bot: Any, client: Any, recording: Recording, start: Snapshot, carts: Any): void {
    const recorded = start.vehicle as { id: number; type: string; pos: number[]; vel: number[]; yRot: number; xRot: number; onGround: boolean; minecart?: { lerp?: { steps: number; target: [number, number, number]; yRot: number; xRot: number } }; mount?: { movementSpeed?: number; flyingSpeed?: number; jumpStrength?: number; lerpNext?: number[]; saddled?: boolean } } | null | undefined;
    if (!recorded) return;
    const vehicle = bot.entities[recorded.id];
    const registry = bot.registry;
    const fork = mineflayerRequire();
    const conv = fork('./lib/conversions');
    const { JavaFloat } = fork('./lib/javamath');
    const Item = fork(fork.resolve('prismarine-item'))(registry);
    vehicle.velocity.set(...recorded.vel);
    vehicle.yaw = conv.fromNotchianYaw(recorded.yRot);
    vehicle.yawDegrees = new JavaFloat(recorded.yRot);
    vehicle.pitch = conv.fromNotchianPitch(recorded.xRot);
    vehicle.pitchDegrees = new JavaFloat(recorded.xRot);
    vehicle.onGround = recorded.onGround;
    vehicle.spentSpawnBoost = true;
    // (the interpolation the mount was still in, which 26.3's ServerboundMoveVehiclePacket says the end of: Entity.getClientPositionAndRotation)
    if (recorded.mount?.lerpNext && registry.version['>=']('26.3')) bot.entityInterpolation?.move(vehicle, 0, 0, 0, { yaw: recorded.yRot, pitch: recorded.xRot });
    // (the interpolation a cart was still in, whose packet came before the body: the tracker seats the rider, as bot-carts.ts takes
    // a cart up, and the entity is where the rest of the plugin sees it)
    const lerp = recorded.minecart?.lerp;
    if (lerp && lerp.steps > 0) {
        const [position, target] = [recorded.pos, lerp.target].map(([x, y, z]) => ({ x: x!, y: y!, z: z! })) as [Xyz, Xyz];
        const velocity = { x: recorded.vel[0]!, y: recorded.vel[1]!, z: recorded.vel[2]! };
        carts?.adopt({
            id: recorded.id, variant: recorded.type, position, yRot: recorded.yRot, xRot: recorded.xRot, velocity, targetVelocity: velocity,
            onGround: recorded.onGround, tracked: target, lerp: { position, yRot: recorded.yRot, xRot: recorded.xRot, steps: lerp.steps, target, targetYRot: lerp.yRot, targetXRot: lerp.xRot },
        });
        vehicle.interpolation?.target.set(...lerp.target);
        if (vehicle.interpolation) vehicle.interpolation.steps = lerp.steps;
    }
    // (a raft before 1.21.2 is a boat of the bamboo type, in its "type" data, the 12th, which minecraft-data names from 1.19.4; the 8th
    // type in 1.19.3, the 9th from 1.19.4, whose CHERRY comes before it (mineflayer-replay/lib/bot.js): the recorder mounted one)
    const { summons, mount } = recording.header.setup;
    if ((vehicle.name === 'boat' || vehicle.name === 'chest_boat') && /_raft$/.test(summons?.find(summon => summon.ref === mount)?.type ?? '')) {
        const keys = registry.entitiesByName[vehicle.name]?.metadataKeys as string[] | undefined;
        const typeIndex = keys ? keys.indexOf('type') : 11;
        vehicle.metadata ??= [];
        if (typeIndex >= 0) vehicle.metadata[typeIndex] = registry.version['>=']('1.19.4') ? 8 : 7;
    }
    vehicle.attributes ??= {};
    if (recorded.mount?.movementSpeed != null) vehicle.attributes['generic.movement_speed'] ??= { value: recorded.mount.movementSpeed, modifiers: [] };
    if (recorded.mount?.flyingSpeed != null) vehicle.attributes['generic.flying_speed'] = { value: recorded.mount.flyingSpeed, modifiers: [] };
    if (HORSES.has(vehicle.name)) {
        const named = registry.entitiesByName.horse?.metadataKeys?.indexOf('flags') ?? -1;
        const v = registry.version;
        const flags = named >= 0 ? named : v['<']('1.9') ? 16 : v['<']('1.10') ? 12 : v['<']('1.14') ? 13 : v['<']('1.15') ? 15 : v['<']('1.17') ? 16 : 17;
        vehicle.metadata ??= [];
        vehicle.metadata[flags] = 0x02 | 0x04;
        vehicle.attributes ??= {};
        if (recorded.mount?.movementSpeed != null) vehicle.attributes['generic.movement_speed'] = { value: recorded.mount.movementSpeed, modifiers: [] };
        if (recorded.mount?.jumpStrength != null) vehicle.attributes['horse.jump_strength'] = { value: recorded.mount.jumpStrength, modifiers: [] };
    }
    // (a nautilus goes by its saddle, a happy ghast by its harness: its body slot, physics.js isHappyGhastController)
    if (vehicle.name === 'happy_ghast' && registry.itemsByName.white_harness && recorded.mount?.saddled !== false) vehicle.setEquipment(6, new Item(registry.itemsByName.white_harness.id, 1));
    else if (registry.version['>=']('1.21.5') && registry.itemsByName.saddle && (HORSES.has(vehicle.name) || /^(zombie_)?nautilus$/.test(vehicle.name) || vehicle.name === 'pig' || vehicle.name === 'strider')) vehicle.setEquipment(7, new Item(registry.itemsByName.saddle.id, 1));
    else if (vehicle.name === 'pig' || vehicle.name === 'strider') {
        const saddle = registry.entitiesByName[vehicle.name]?.metadataKeys?.indexOf('saddle') ?? -1;
        if (saddle >= 0) (vehicle.metadata ??= [])[saddle] = true;
    }
    void recording;
    if (registry.version['>=']('1.9')) client.receive('set_passengers', { entityId: recorded.id, passengers: [recording.header.player.id] });
    else client.receive('attach_entity', { entityId: recording.header.player.id, vehicleId: recorded.id, leash: false });
}

const moved = (written: readonly WrittenPacket[], driven = false) => written.filter(p => MOVEMENT.has(p.name) || (driven && HANDS.has(p.name)));

/** The keys of the hands in a recording: only what uses them runs with the fork's actions at the tick's start. */
const usesHands = (recording: Recording) => recording.rows.some(row => row.input.keys.some(key => key === 'use' || key === 'attack' || key.startsWith('hotbar')) || row.pre.selectedSlot !== recording.rows[0]!.pre.selectedSlot);

/** Minecraft.handleKeybinds, by the fork's calls: a press of the attack or the use key on what the crosshair is on, its release, the slot. */
class Hands {
    private readonly held = new Set<string>();
    private readonly bot: Any;
    private slot: number;
    private useDelay = 0;

    constructor(bot: Any, start: Snapshot) {
        this.bot = bot;
        this.slot = (start.selectedSlot as number | undefined) ?? 0;
        // (the crosshair is where the row looks: the fork's activateBlock turns to a block's centre first, which a key press does not)
        bot.lookAt = async () => undefined;
    }

    /** Before the tick of `row`. */
    act(row: ExpandedRow): void {
        const { bot } = this;
        const quiet = (run: () => unknown) => {
            try {
                void Promise.resolve(run()).catch(() => undefined);
            } catch {
                // (a call the state refuses sends nothing, which the comparison shows)
            }
        };
        // (a hotbar key, which MultiPlayerGameMode.tick tells the server of ahead of the player's tick, or the slot a step chose)
        const key = row.input.keys.find(k => /^hotbard$/.test(k) && !this.held.has(k));
        const slot = key ? Number(key.slice(6)) - 1 : (row.pre.selectedSlot as number | undefined);
        if (slot !== undefined && slot !== this.slot) {
            this.slot = slot;
            quiet(() => {
                bot.setQuickBarSlot(slot);
                bot._ensureHasSentCarriedItem();
            });
        }
        for (const k of row.input.keys) if (/^hotbard$/.test(k)) this.held.add(k);
        for (const k of this.held) if (/^hotbard$/.test(k) && !row.input.keys.includes(k)) this.held.delete(k);
        const pressed = (key: string) => row.input.keys.includes(key) && !this.held.has(key);
        // (Minecraft.tick: rightClickDelay runs down ahead of handleKeybinds, and a use key held at 0 uses again, startUseItem setting it to 4)
        if (this.useDelay > 0) this.useDelay -= 1;
        const repeats = row.input.keys.includes('use') && this.held.has('use') && this.useDelay === 0 && !bot.usingHeldItem;
        const released = (key: string) => !row.input.keys.includes(key) && this.held.has(key);
        const range = bot.game.gameMode === 'creative' ? 5 : 4.5;
        if (pressed('attack')) {
            const hit = bot.raycastHitResult(range, 3);
            if (hit.type === 'entity') quiet(() => bot.attack(hit.entity));
            else if (hit.type === 'block') quiet(() => bot.dig(hit.block, 'ignore', 'auto', hit.face));
            else quiet(() => bot.swingArm());
        }
        else if (row.input.keys.includes('attack')) {
            // (Minecraft.continueAttack: the key held on a block digs it, and the next one the crosshair comes to)
            const hit = bot.raycastHitResult(range, 3);
            const on = bot.targetDigBlock?.position;
            if (hit.type === 'block' && !(on && on.equals(hit.block.position))) quiet(() => bot.dig(hit.block, 'ignore', 'auto', hit.face, { held: true }));
        }
        if (released('attack')) quiet(() => bot.stopDigging());
        if (pressed('use') || repeats) {
            this.useDelay = 4;
            const hit = bot.raycastHitResult(range, 3);
            const direction = (face: number) => [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][face]!;
            // (Minecraft.startUseItem, for each hand: what the crosshair is on, what passes on that to the hand's item, which an empty hand
            // has none of; a hand that took it ends the use)
            const { Vec3 } = mineflayerRequire()('vec3');
            const useWith = async (offHand: boolean): Promise<unknown> => {
                const stack = offHand ? bot.inventory?.slots?.[45] : bot.heldItem;
                let result: unknown = 'pass';
                if (hit.type === 'entity') result = await bot._interactEntity(hit.entity, hit.intersect, offHand);
                else if (hit.type === 'block') result = await bot.activateBlock(hit.block, new Vec3(...direction(hit.face)), hit.intersect.minus(hit.block.position), offHand);
                return result === 'pass' && stack ? bot.activateItem(offHand) : result;
            };
            quiet(async () => {
                if (await useWith(false) === 'pass') await useWith(true);
            });
        }
        // (Minecraft.handleKeybinds: isUsingItem && !keyUse.isDown(), so a key let go with no item in use sends nothing)
        if (released('use') && bot.usingHeldItem) quiet(() => bot.deactivateItem());
        for (const key of ['attack', 'use']) {
            if (row.input.keys.includes(key)) this.held.add(key);
            else this.held.delete(key);
        }
    }
}

/** LocalPlayer.jumpRidingScale for a count of jumpRidingTicks (1.20.4 LocalPlayer.java aiStep, 26.3 the same). */
function chargeOf(ticks: number): number {
    const f = Math.fround;
    return ticks < 10 ? f(ticks * f(0.1)) : f(f(0.8) + f(f(2 / (ticks - 9)) * f(0.1)));
}

export interface BotOptions {
    /** Delivers each row's packets, as a test changes them: a repeat must show. */
    readonly deliver?: (row: ExpandedRow) => readonly { readonly seq: number; readonly b: string }[];
    /**
     * Undoes what the fork's teleport handler does to bot._lastSent, to measure the change the fork needs (the report lists it).
     * Off by default: the replay reports the fork as it is.
     */
    readonly keepLastSentOnTeleport?: boolean;
    /**
     * Undoes what the fork's riding path leaves in bot.entity.horizontalCollision, which getHorizontalCollision reads before the
     * isCollidedHorizontally a tick on foot sets: the second change the report lists.
     */
    readonly forgetRiderCollision?: boolean;
    /** Called with each row and what the bot wrote for its tick, to look into a difference. */
    readonly trace?: (row: ExpandedRow, written: readonly WrittenPacket[], bot: Any) => void;
}

/** Replays a recording through a mineflayer bot. */
export async function replayBot(recording: Recording, options: BotOptions = {}): Promise<BotResult> {
    const version = recording.header.mc;
    const id = recording.header.scenario.id;
    const empty = { id, ticks: recording.rows.length, compared: 0, packets: {}, notCompared: {}, divergences: [], afterHands: [], codec: [], delivered: 0 };
    if (recording.rows.length === 0) return { ...empty, unsupported: 'the recording has no rows' };
    const clock = virtualClock();
    const packets: Record<string, number> = {};
    const notCompared: Record<string, number> = {};
    const divergences: BotDivergence[] = [];
    const afterHands: BotDivergence[] = [];
    let handsAt: number | undefined;
    const codec: string[] = [];
    let compared = 0;
    let delivered = 0;
    let started: { bot: Any; client: Any } | undefined;
    const seen = new Set<number>();
    const readSent = (row: ExpandedRow, pick: (p: ExpandedRow['c2s'][number]) => boolean) => row.c2s.filter(pick).flatMap(p => {
        const bytes = packetBytes(p.b);
        const name = serverboundName(version, bytes);
        if (name === undefined) {
            codec.push(`t=${row.t}: c2s ${p.name}`);
            return [];
        }
        return [{ name, bytes }];
    });
    const count = (into: Record<string, number>, name: string) => { into[name] = (into[name] ?? 0) + 1; };
    try {
        started = await startBot(recording, options);
        const { bot, client } = started;
        const driven = usesHands(recording);
        const hands = driven ? new Hands(bot, recording.rows[0]!.pre) : undefined;
        for (const row of recording.rows) {
            client.written.length = 0;
            for (const packet of options.deliver?.(row) ?? row.s2c) {
                if (seen.has(packet.seq) && !options.deliver) throw new Error(`t=${row.t}: packet ${packet.seq} delivered twice`);
                seen.add(packet.seq);
                delivered += 1;
                try {
                    client.receiveBytes(packetBytes(packet.b));
                } catch (e) {
                    codec.push(`t=${row.t}: s2c #${packet.seq}: ${(e as Error).message.split('\n')[0]}`);
                }
            }
            const answers = moved(client.written, driven);
            const theirAnswers = moved(readSent(row, p => p.phase === 'packetHandling'), driven);
            client.written.length = 0;
            // (what the delivery put off to a later turn of the loop, a task of the client, and the recorder's own presses: outside a tick)
            setLook(bot, row.input.yRot, row.input.xRot);
            hands?.act(row);
            await new Promise(resolve => setImmediate(resolve));
            const between = moved(client.written, driven);
            const theirBetween = moved(readSent(row, p => p.phase === 'betweenTicks'), driven);
            client.written.length = 0;
            setKeys(bot, row.input.keys);
            setLook(bot, row.input.yRot, row.input.xRot);
            if (options.forgetRiderCollision && !bot.vehicle) delete bot.entity.horizontalCollision;
            // (a snapshot says the interpolation goes on and not for how long: the tick that ends with none has its last step)
            const steps = bot.vehicle?.interpolation?.stepped?.steps;
            if (steps && !(row.post.vehicle as { mount?: { lerpNext?: unknown } } | null | undefined)?.mount?.lerpNext) steps.length = 0;
            if (row.playerTicked) {
                clock.advance(50);
                bot.physicsTick();
                compared += 1;
            }
            const ours = moved(client.written, driven);
            options.trace?.(row, ours, bot);
            const all = readSent(row, p => p.phase !== 'packetHandling' && p.phase !== 'betweenTicks');
            const theirs = moved(all, driven);
            for (const packet of [...theirAnswers, ...theirBetween, ...theirs]) count(packets, packet.name);
            for (const packet of readSent(row, () => true)) {
                if (MOVEMENT.has(packet.name) || (driven && HANDS.has(packet.name))) continue;
                count(notCompared, packet.name);
                if (!HANDLESS.has(packet.name)) handsAt ??= row.t;
            }
            const report = (divergence: BotDivergence) => (handsAt === undefined ? divergences : afterHands).push(divergence);
            const answered = comparePackets(theirAnswers, answers);
            if (answered) report({ t: row.t, at: 'responses', difference: answered });
            const ticked = comparePackets([...theirBetween, ...theirs], [...between, ...ours]);
            if (ticked) {
                const named = ticked.kind === 'bytes' ? [ticked.name] : ticked.kind === 'reordered' ? ticked.expected : ticked.names;
                report({ t: row.t, at: named.some(name => theirBetween.some(p => p.name === name)) ? 'betweenTicks' : 'tick', difference: ticked });
            }
            if (row.playerTicked) {
                const entity = bot.entity;
                const check = (field: string, expected: unknown, actual: unknown) => {
                    // (bit for bit, a signed zero included, which JSON would drop)
                    const same = Array.isArray(expected) ? (expected as unknown[]).every((v, i) => Object.is(v, (actual as unknown[])[i])) : Object.is(expected, actual);
                    if (!same) report({ t: row.t, at: 'state', field, expected, actual });
                };
                check('pos', row.post.pos, [entity.position.x, entity.position.y, entity.position.z]);
                check('vel', row.post.vel, [entity.velocity.x, entity.velocity.y, entity.velocity.z]);
                check('onGround', row.post.onGround, entity.onGround);
                // (the charge the fork keeps to itself, as the release tells the server: LocalPlayer.aiStep's onPlayerJump, floor(scale * 100))
                const released = ours.find(p => p.name === 'entity_action' && /riding_jump/.test(String(p.params?.actionId)));
                const [scale, charged] = [row.pre.jumpRidingScale as number | undefined, row.pre.jumpRidingTicks as number | undefined];
                if (released && scale !== undefined) check('jumpRidingScale', Math.floor(Math.fround(scale * 100)), released.params.jumpBoost);
                if (released && charged !== undefined && charged >= 0) check('jumpRidingTicks', Math.floor(Math.fround(chargeOf(charged) * 100)), released.params.jumpBoost);
            }
        }
    } finally {
        started?.bot.end();
        clock.restore();
    }
    return {
        id, ticks: recording.rows.length, compared, packets, notCompared, divergences, afterHands, codec, delivered,
        ...(handsAt === undefined ? {} : { handsAt }),
        ...(divergences[0] ? { first: divergences[0] } : {}),
    };
}
