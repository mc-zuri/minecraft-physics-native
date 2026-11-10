// The bot layer: a whole mineflayer bot on a client with no connection. The bot is put where the vanilla client was when the
// body began, each row delivers the recorded server packets in order, sets the keys and the look and runs one physics tick, and
// what the bot writes is held to what the client sent: by name, order and bytes, the answers to a packet apart from the tick's
// own. Each server packet is delivered exactly once, which a repeat would show as an extra answer or a move applied twice.
//
// Compared are the packets of movement and input (MOVEMENT), those of a player's hands (HANDS) and of the clicks on a container's
// screen (SCREEN). The keys and the slot of each row drive the fork's own calls as Minecraft.handleKeybinds would (Hands, at the
// start of the tick: the hotbar, inventory, swap, drop, attack and use keys, a held use key's repeat and a held attack's dig); a
// click on a screen, which no key tells, is driven as the client sent it (its slot, button and mode, the trade picked, the name
// typed, the Leave Bed button), and what it sends is the fork's. What the client sent of anything else (a chat line, a sign, a
// book) is counted by name as not compared, never as matching, and what differs from the first such action on is `afterHands`,
// coverage this layer lacks and not behaviour. A packet the codec cannot read is a `codec` problem of its own, so that a codec gap
// is not read as behaviour either. What the client sent outside the player's tick and outside a packet's handling is `betweenTicks`:
// Minecraft.handleKeybinds and a ridden boat's own tick (Boat.controlBoat, ServerboundPaddleBoatPacket to 1.21.1), both ahead of
// the player's tick in the same client tick, where the bot writes them too. So the two lists go in order as one, and a difference
// in what the client sent between ticks is reported as `betweenTicks`, apart from the tick's own.

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { ExpandedRow, Recording, Snapshot } from '../schema/recording.ts';
import { packetBytes } from './load.ts';
import { minecraftProtocol, mineflayerRequire, readClientbound } from './packets.ts';
import { TeamTracker } from './teams.ts';
import { AreaWorld } from './world.ts';

const require = createRequire(import.meta.url);
const root = new URL('../../', import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'] as const;
/** minecraft-protocol's names of the packets a press of a key or a choice of a slot sends (26.3 attacks with its own packet, ServerboundAttackPacket). */
export const HANDS: ReadonlySet<string> = new Set(['arm_animation', 'block_dig', 'block_place', 'use_item', 'use_entity', 'held_item_slot', 'punch', 'attack']);
/**
 * minecraft-protocol's names of the packets a click on a container's screen sends (AbstractContainerScreen.slotClicked,
 * MultiPlayerGameMode.handleInventoryMouseClick; LocalPlayer.closeContainer; a merchant's trade picked, MerchantScreen.postButtonClick;
 * an anvil's name typed, AnvilScreen.onNameChanged; an enchantment picked, MultiPlayerGameMode.handleInventoryButtonClick), which the
 * recorded click drives through the fork.
 */
export const SCREEN: ReadonlySet<string> = new Set(['window_click', 'close_window', 'select_trade', 'name_item', 'enchant_item']);
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
    let c = codecs.get(version);
    if (!c) {
        const mc = minecraftProtocol() as Any;
        c = {
            toServer: mc.createSerializer({ state: 'play', isServer: false, version }),
            fromServer: mc.createDeserializer({ state: 'play', isServer: false, version }),
            toClient: mc.createSerializer({ state: 'play', isServer: true, version }),
            readServerbound: mc.createDeserializer({ state: 'play', isServer: true, version }),
        };
        codecs.set(version, c);
    }
    return c;
}

/** A recorded client packet as minecraft-protocol reads it (its name and fields), or undefined when the codec cannot read it. */
function serverbound(version: string, bytes: Buffer): { name: string; params: Any } | undefined {
    try {
        const { data } = codecsFor(version).readServerbound.parsePacketBuffer(bytes);
        return { name: data.name as string, params: data.params };
    } catch {
        return undefined;
    }
}

/** A minecraft-protocol client with no connection: what the bot writes is encoded and kept, what the server sent is decoded and emitted. */
function fakeClient(version: string, username: string): Any {
    const codec = codecsFor(version);
    const client: Any = new EventEmitter();
    client.setMaxListeners(0);
    client.version = version;
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
    // (the recorder's world is the Superflat preset, of plains: WorldPresets.FLAT, FlatLevelGeneratorSettings.getDefault; a case's
    // fillbiome comes as its chunk_biomes packet. The sky light is full down to the first block from the top of the area, which
    // the open sky is above: what Level.isRainingAt's canSeeSky reads, Entity.isInRain)
    const plains = (bot.registry.biomesByName?.plains ?? bot.registry.biomesByName?.['minecraft:plains'])?.id;
    for (let x = blocks.from[0]; x <= blocks.to[0]; x += 1) {
        for (let z = blocks.from[2]; z <= blocks.to[2]; z += 1) {
            const id = `${x >> 4},${z >> 4}`;
            if (!built.has(id)) built.set(id, new Chunk({ minY: bot.game.minY ?? 0, worldHeight: bot.game.height ?? 256 }));
            const column = built.get(id);
            let sky: number | undefined;
            for (let y = blocks.to[1]; y >= blocks.from[1]; y -= 1) {
                const at = new Vec3(x & 15, y, z & 15);
                const state = area.getBlockStateId({ x, y, z });
                if (state !== air) {
                    column.setBlockStateId(at, state);
                    sky ??= y;
                }
                if (plains !== undefined && (y & 3) === 0) column.setBiome(at, plains);
            }
            // (after the blocks: a section a block makes keeps the light, which one that is not there yet would lose, 1.13's chunk)
            for (let y = blocks.to[1]; y > (sky ?? blocks.from[1] - 1); y -= 1) column.setSkyLight(new Vec3(x & 15, y, z & 15), 15);
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

/**
 * The effects and attributes the server had synced when the body began, as the packets that synced them. An attribute's modifiers
 * go in the order the server added them, which its packet keeps (AttributeInstance.getModifiers, an Object2ObjectArrayMap's
 * values: 1.16 AttributeInstance.java:22, 60-61) and which orders those of one operation in the same bucket of the client's
 * HashSet (1.16 - 1.20.4, :57): the setup's order, the rows' (sorted) for any other.
 */
function receiveSynced(client: Any, registry: Any, start: Snapshot, entityId: number, recording: Recording): void {
    for (const { id, amplifier } of (start.effects ?? []) as { id: string; amplifier: number }[]) {
        const effect = registry.effectsByName[pascal(bare(id))];
        if (effect) client.receiveWritten('entity_effect', { entityId, effectId: effect.id, amplifier, duration: 32767, hideParticles: 0, flags: 0 });
    }
    const packetName = registry.version['>=']('1.9') ? 'entity_update_attributes' : 'update_attributes';
    const [keyField] = registry.protocol.play.toClient.types[`packet_${packetName}`][1][1].type[1].type[1];
    const properties: Any[] = [];
    // (where the setup added each modifier of an attribute: its list's place, else after them)
    const setupAttributes = (recording.header.setup.attributes ?? []) as readonly { id: string; modifiers?: readonly { uuid?: string }[] }[];
    const addedAt = (name: string, id: string) => {
        const listed = setupAttributes.find(entry => bare(entry.id).replace(/^(generic|player)./, '') === bare(name).replace(/^(generic|player)./, ''));
        const at = listed?.modifiers?.findIndex(modifier => modifier.uuid === id) ?? -1;
        return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    };
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
            // (in the order the setup added them, as the server's own container holds them and its packet lists them: the rows list
            // them by id; a modifier's bucket ties go by that order, base.ts iterationOrder)
            modifiers: [...(attribute.modifiers ?? [])].sort((a, b) => addedAt(name, a.id) - addedAt(name, b.id))
                .map(m => ({ uuid: m.id, amount: m.amount, operation: typeof m.operation === 'number' ? m.operation : OPERATIONS[m.operation.toLowerCase()] ?? 0 })),
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
    // (with its enchantments, which the setup gave it and the bot's travel reads: depth strider, soul speed, swift sneak)
    const give = (slot: number, spec: { id: string; count?: number; enchantments?: Readonly<Record<string, number>> }) => {
        const known = registry.itemsByName[spec.id];
        if (!known) return;
        const item = new Item(known.id, spec.count ?? 1, 0);
        const enchants = Object.entries(spec.enchantments ?? {}).filter(([name]) => registry.enchantmentsByName[name]).map(([name, lvl]) => ({ name, lvl }));
        if (enchants.length > 0) item.enchants = enchants;
        client.receiveWritten('set_slot', { windowId: 0, stateId: 0, slot, item: Item.toNotch(item) });
    };
    for (const [slot, spec] of Object.entries((recording.header.setup.equipment ?? {}) as Record<string, { id: string; count?: number; enchantments?: Readonly<Record<string, number>> }>)) {
        if (slots[slot] !== undefined) give(slots[slot]!, spec);
    }
    // (the inventory's own numbers: the hotbar 0 to 8 is the window's 36 to 44, the armour 36 to 39 its 8 to 5, the off hand 40 its 45)
    for (const [slot, spec] of Object.entries((recording.header.setup.inventory ?? {}) as Record<string, { id: string; count?: number; enchantments?: Readonly<Record<string, number>> }>)) give(Number(slot) < 9 ? 36 + Number(slot) : Number(slot) === 40 ? 45 : Number(slot) >= 36 ? 44 - Number(slot) : Number(slot), spec);
}

/** The client's state when the body began: motion, contacts, and what it last sent the server. */
function useStart(bot: Any, start: Snapshot): void {
    const entity = bot.entity;
    entity.position.set(...(start.pos as number[]));
    // (before 1.17 the box the player keeps, which its position need not be the middle of: Entity.move moves the box and the
    // position follows its middle; the engine keeps it while the position is the one it left, adapter keptFor)
    const engineState = bot.physicsEngineCtx?.state;
    const kept = start.box as number[] | undefined;
    if (Array.isArray(kept) && bot.registry.version['<']('1.17') && engineState?.getBB) {
        const bb = engineState.getBB();
        bb.set(...kept);
        engineState.pos.set(...(start.pos as number[]));
        engineState.keptBoundingBox = { bb, pos: engineState.pos.clone(), width: Math.fround(kept[3]! - kept[0]!), height: Math.fround(kept[4]! - kept[1]!) };
    }
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
    // (the world's experiments, which the configuration phase's feature_flags tells a client and this one skips: with
    // minecart_improvements a cart takes ClientboundMoveMinecartPacket's steps, NewMinecartBehavior, from 1.21.2)
    if (carts) carts.improvements = (recording.header.features ?? []).includes('minecart_improvements');
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
    receiveSynced(client, registry, start, entityId, recording);
    receiveAbilities(client, start);
    const [x, y, z] = start.pos as number[];
    const [yaw, pitch] = [(start.lastSentYRot ?? start.yRot) as number, (start.lastSentXRot ?? start.xRot) as number];
    client.receive('position', {
        x, y, z, yaw, pitch, dx: 0, dy: 0, dz: 0, teleportId: 0,
        flags: registry.supportFeature('positionPacketHasBitflags') ? { x: false, y: false, z: false, yaw: false, pitch: false } : 0,
    });
    bot.physics.autoJump = !!start.autoJumpEnabled;
    // (the look a vanilla client sends: its held degrees as they are, whole turns kept: LocalPlayer.sendPosition's yRot - yRotLast,
    // 1.16.5 LocalPlayer.java:229-243), not the fork's Grim-safe shortest turn)
    bot.physics.vanillaYaw = true;
    // the bot's first tick is its own, for what it keeps of the look it last sent; then it stands where the client stood
    // (with nothing around it yet: what that tick pushed, from where the bot is not, would be in the first of the body)
    if (registry.version['>=']('1.9') && registry.version['<']('1.17')) bot.physicsTick();
    setLook(bot, yaw, pitch);
    // (1.21.4+: the level counts as loaded while the recorded client ticks its player, LocalPlayer.hasClientLoaded: a body that
    // begins in the wait after a login or respawn keeps the bot waiting until the rows' player ticks)
    if (registry.version['>=']('1.21.4')) {
        bot._replayLevel = { ready: recording.rows[0]?.playerTicked !== false };
        bot.levelLoaded = () => bot._replayLevel.ready;
    }
    bot.physicsTick();
    useEntities(bot, start, recording);
    useReadyMounts(bot, client, recording, start);
    useTeams(bot, client, recording);
    useMerchantOffers(bot, client, recording);
    useVehicle(bot, client, recording, start, carts);
    useStart(bot, start);
    useInventoryCount(bot, recording);
    client.written.length = 0;
    return { bot, client };
}

/**
 * The count the player's inventory menu was at when the body began, which the server keeps and the client echoes in each click:
 * from 1.17.1 its state id (AbstractContainerMenu.stateId, which the server's container packets set, ClientPacketListener
 * .handleContainerContent; 1.20.4 AbstractContainerMenu.java:776-783), before 1.17 its last transaction id (the menu's own count
 * of clicks, AbstractContainerMenu.backup, 1.16.5 MultiPlayerGameMode.java:350-355), both run up over the session before the
 * body. The rows do not carry it: the
 * first click on the menu (window 0) says it, when no server packet set it before that click.
 */
function useInventoryCount(bot: Any, recording: Recording): void {
    const version = recording.header.mc;
    const codec = codecsFor(version);
    for (const row of recording.rows) {
        for (const p of row.s2c) {
            if (!/ContainerSetContent|ContainerSetSlot|WindowItems|SetSlot/.test(p.name)) continue;
            try {
                const { data } = codec.fromServer.parsePacketBuffer(packetBytes(p.b));
                if (data.params.windowId === 0 && data.params.stateId !== undefined) return;
            } catch {
                // (a packet the codec cannot read sets nothing)
            }
        }
        for (const p of row.c2s) {
            let data: Any;
            try {
                data = codec.readServerbound.parsePacketBuffer(packetBytes(p.b)).data;
            } catch {
                continue;
            }
            if (data.name !== 'window_click' || data.params.windowId !== 0) continue;
            if (data.params.stateId !== undefined) bot.inventory.stateId = data.params.stateId;
            else if (typeof data.params.action === 'number') bot.inventory.actionNumber = data.params.action - 1;
            return;
        }
    }
}

/** The client's sends that are not its hands: what the network layer answers by itself. */
const HANDLESS: ReadonlySet<string> = new Set(['chunk_batch_received', 'keep_alive', 'pong', 'ping_request', 'abilities', 'client_command', 'settings', 'configuration_acknowledged', 'player_loaded', 'selected_slot']);

/** The other entities the client held when the body began, in bot.entities as their spawn packets would have left them. */
function useEntities(bot: Any, start: Snapshot, recording: Recording): void {
    const fork = mineflayerRequire();
    const Entity = fork(fork.resolve('prismarine-entity'))(bot.version);
    const { Vec3 } = fork('vec3');
    const conv = fork('./lib/conversions');
    const { JavaFloat } = fork('./lib/javamath');
    type Listed = { id: number; type: string; pos: number[]; box?: number[]; yRot?: number; xRot?: number; onGround?: boolean };
    const listed = [...(start.nearbyEntities ?? []) as Listed[], ...heldBefore(recording, start)];
    const vehicle = start.vehicle as { id: number; type: string; pos: number[]; box?: number[]; yRot?: number; xRot?: number } | null | undefined;
    for (const { id, type, pos, box, yRot, xRot, onGround } of [...listed, ...(vehicle ? [vehicle] : [])] as typeof listed) {
        const data = bot.registry.entitiesByName[type] ?? legacyEntity(bot.registry, type);
        const entity = bot.entities[id] ?? (bot.entities[id] = new Entity(id));
        Object.assign(entity, { type: data?.type ?? 'other', name: type, displayName: data?.displayName, entityType: data?.id, kind: data?.category, width: data?.width, height: data?.height });
        // (another player comes by its own spawn packet, which the fork makes a player of whatever minecraft-data says: entities.js
        // addNewPlayer; minecraft-data has no player before 1.13 and calls it a mob on 1.14 - 1.17)
        if (type === 'RemotePlayer' || type === 'player') Object.assign(entity, { type: 'player', name: 'player', width: 0.6, height: 1.8, eyeHeight: 1.62 });
        entity.position = new Vec3(...pos);
        // (on the ground as the client held it: a spawn leaves it off, Entity.onGround's false, until a move says otherwise)
        entity.onGround = onGround ?? false;
        if (box !== undefined) entity.box = box;
        // (its look, as its spawn packet gives it: where it seats a rider it turns the seat by, a llama's)
        if (yRot !== undefined) Object.assign(entity, { yaw: conv.fromNotchianYaw(yRot), yawDegrees: new JavaFloat(yRot) });
        if (xRot !== undefined) Object.assign(entity, { pitch: conv.fromNotchianPitch(xRot), pitchDegrees: new JavaFloat(xRot) });
        bot.entityInterpolation?.spawn(entity);
    }
    for (const id of [...listed.map(e => e.id)].sort((a, b) => a - b)) bot._entityTickOrder?.add(id);
}

/**
 * The entities the client held when the body began that its first snapshot leaves out (it lists those around the player): one a
 * later row lists that no spawn packet of the rows made, as its first listing has it. Its moves come by the rows' packets.
 */
function heldBefore(recording: Recording, start: Snapshot): { id: number; type: string; pos: number[]; box?: number[]; yRot?: number; xRot?: number; onGround?: boolean }[] {
    const known = new Set(((start.nearbyEntities ?? []) as { id: number }[]).map(e => e.id));
    const vehicle = start.vehicle as { id?: number } | null | undefined;
    if (vehicle?.id !== undefined) known.add(vehicle.id);
    const spawned = new Set<number>();
    const found = new Map<number, { id: number; type: string; pos: number[]; box?: number[]; yRot?: number; xRot?: number; onGround?: boolean }>();
    for (const row of recording.rows) {
        for (const packet of row.s2c) {
            if (!/Add(Entity|Mob|Player|ExperienceOrb|Painting)|SpawnEntity/.test(packet.name)) continue;
            try {
                const id = (readClientbound(recording.header.mc, packetBytes(packet.b)).params as { entityId?: number }).entityId;
                if (typeof id === 'number') spawned.add(id);
            } catch { /* (a packet the codec cannot read spawns nothing the bot would hold) */ }
        }
        const snapshots = [row.pre, ...row.phases.map(phase => phase.state), row.post] as ({ nearbyEntities?: unknown } | undefined)[];
        for (const snapshot of snapshots) {
            for (const entity of (snapshot?.nearbyEntities ?? []) as { id: number; type: string; pos: number[] }[]) {
                if (known.has(entity.id) || spawned.has(entity.id) || found.has(entity.id) || entity.type === 'player') continue;
                found.set(entity.id, entity);
            }
        }
    }
    return [...found.values()];
}

/**
 * minecraft-data's entity of a type the rows name as the flattened releases do, on a release whose data names it otherwise: before
 * 1.11 every minecart is one entity, MinecartRideable (its kind in the spawn's data), and the others go by their class's
 * name (Villager, EntityHorse, MushroomCow). What a spawn packet would have given the bot: its size, which the crosshair meets.
 */
function legacyEntity(registry: Any, type: string): Any {
    if (/minecart$/.test(type)) return registry.entitiesByName.MinecartRideable;
    if (/^(horse|donkey|mule|skeleton_horse|zombie_horse)$/.test(type)) return registry.entitiesByName.EntityHorse;
    if (type === 'mooshroom') return registry.entitiesByName.MushroomCow;
    const plain = type.replace(/_/g, '').toLowerCase();
    return (registry.entitiesArray as Any[] | undefined)?.find(e => e.name.toLowerCase() === plain);
}

/**
 * Before 1.14 a merchant's offers come on a plugin channel (MC|TrList, minecraft:trader_list from 1.13), which the rows do not
 * hold: the offers the setup's villager was summoned with, as the server read them, go to the fork when its screen opens. Before
 * 1.20.5 an item's count is its NBT's Count: a summon written with count leaves it 0, which the server sells as it is (a count 0
 * stack, kept as such before 1.11: 1.10.2 ScreenHandler.java:204-213; EMPTY from 1.11).
 */
function useMerchantOffers(bot: Any, client: Any, recording: Recording): void {
    const registry = bot.registry;
    if (!registry.version['<']('1.14')) return;
    const summons = (recording.header.setup.summons ?? []) as readonly { type: string; nbt?: string }[];
    const nbt = summons.find(summon => /villager/i.test(summon.type) && /Offers/.test(summon.nbt ?? ''))?.nbt;
    if (!nbt) return;
    const countOf = (key: string, value: string) => (key === 'Count' || registry.version['>=']('1.20.5') ? Number(value) : 0);
    const item = (name: string, key: string, value: string) => {
        const id = registry.itemsByName[name]?.id ?? -1;
        const count = countOf(key, value);
        return registry.version['>=']('1.13') ? { present: id >= 0, itemId: id, itemCount: count } : { blockId: id, itemCount: count, itemDamage: 0 };
    };
    const recipe = /buy:\{id:"(?:minecraft:)?(\w+)",(count|Count):(\d+)\w?\}(?:,buyB:\{id:"(?:minecraft:)?(\w+)",(count|Count):(\d+)\w?\})?,sell:\{id:"(?:minecraft:)?(\w+)",(count|Count):(\d+)\w?\}(?:,maxUses:(\d+))?/g;
    const trades = [...nbt.matchAll(recipe)].map(m => ({
        inputItem1: item(m[1]!, m[2]!, m[3]!),
        outputItem: item(m[7]!, m[8]!, m[9]!),
        hasItem2: m[4] !== undefined,
        ...(m[4] !== undefined ? { inputItem2: item(m[4], m[5]!, m[6]!) } : {}),
        tradeDisabled: false,
        nbTradeUses: 0,
        maximumNbTradeUses: m[10] !== undefined ? Number(m[10]) : 12,
    }));
    if (trades.length === 0) return;
    const channel = registry.version['>=']('1.13') ? 'minecraft:trader_list' : 'MC|TrList';
    // (after the screen opens, as the server sends them: MerchantMenu's window, VillagerTrades on the open)
    client.on('open_window', (packet: { windowId: number; inventoryType?: unknown }) => {
        if (!/villager|merchant/i.test(String(packet.inventoryType))) return;
        setImmediate(() => client.emit(channel, { windowId: packet.windowId, trades }));
    });
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
    const recorded = start.vehicle as { id: number; type: string; pos: number[]; vel: number[]; yRot: number; xRot: number; onGround: boolean; age?: number; oldPos?: number[]; minecart?: { lerp?: { steps: number; target: [number, number, number]; yRot: number; xRot: number } }; mount?: { movementSpeed?: number; flyingSpeed?: number; jumpStrength?: number; lerpNext?: number[]; lerpSteps?: number; lerpTo?: number[]; saddled?: boolean } } | null | undefined;
    if (!recorded) return;
    const vehicle = bot.entities[recorded.id];
    const registry = bot.registry;
    const fork = mineflayerRequire();
    const conv = fork('./lib/conversions');
    const { JavaFloat } = fork('./lib/javamath');
    vehicle.velocity.set(...recorded.vel);
    vehicle.yaw = conv.fromNotchianYaw(recorded.yRot);
    vehicle.yawDegrees = new JavaFloat(recorded.yRot);
    vehicle.pitch = conv.fromNotchianPitch(recorded.xRot);
    vehicle.pitchDegrees = new JavaFloat(recorded.xRot);
    vehicle.onGround = recorded.onGround;
    vehicle.spentSpawnBoost = true;
    // (the steering the rows say it was in: a pig's or strider's boost under way, the speed its last tick set)
    const steering = recorded.mount as { boosting?: boolean; boostTime?: number; boostTimeTotal?: number; speed?: number } | undefined;
    if (steering && (vehicle.name === 'pig' || vehicle.name === 'strider')) {
        vehicle.riddenSeed = { boosting: steering.boosting, boostTime: steering.boostTime, boostTimeTotal: steering.boostTimeTotal, speed: steering.speed };
    }
    // (a mount's walk animation, which a strider's seat bobs with: one tick old, the client's first tick of it moved it from xo to x,
    // from rest, LivingEntity.calculateEntityAnimation, WalkAnimationState.update (1.20.4 LivingEntity.java:2204,
    // WalkAnimationState.java:18); an older one's the rows do not carry, docs/limitations.md)
    if (recorded.mount && recorded.age === 1 && recorded.oldPos) {
        const f32 = Math.fround;
        const [dx, dz] = [recorded.pos[0]! - recorded.oldPos[0]!, recorded.pos[2]! - recorded.oldPos[2]!];
        const target = Math.min(f32(f32(Math.sqrt(dx * dx + dz * dz)) * 4), 1);
        const speed = f32(f32(target) * f32(0.4));
        vehicle.walkAnimation = { speed, position: speed };
    }
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
    // (the interpolation of the server's moves a mount was still in, 1.21.2 - 26.2, which goes on under its rider and whose target the
    // vehicle move says while it runs: 1.21.2 LivingEntity.java:2724-2726, 3013-3023, ServerboundMoveVehiclePacket.java:17-24)
    const { lerpSteps, lerpTo } = recorded.mount ?? {};
    if (lerpSteps && lerpSteps > 0 && lerpTo && registry.version['>=']('1.21.2') && registry.version['<']('26.3') && vehicle.interpolation) {
        vehicle.interpolation.target.set(...lerpTo);
        vehicle.interpolation.steps = lerpSteps;
        vehicle.interpolatedPosition?.set(...recorded.pos);
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
    if (recorded.mount?.movementSpeed != null) vehicle.attributes[attributeKey(registry, 'movement_speed', 'generic.movement_speed', 'generic.movementSpeed')] ??= { value: recorded.mount.movementSpeed, modifiers: [] };
    if (recorded.mount?.flyingSpeed != null) vehicle.attributes[attributeKey(registry, 'flying_speed', 'generic.flying_speed', 'generic.flyingSpeed')] = { value: recorded.mount.flyingSpeed, modifiers: [] };
    readyMount(bot, vehicle, recorded.mount, summons?.find(summon => summon.ref === mount));
    sizeMount(bot, client, vehicle, summons?.find(summon => summon.ref === mount)?.attributes, recording.header.setup.commands);
    void recording;
    if (registry.version['>=']('1.9')) client.receive('set_passengers', { entityId: recorded.id, passengers: [recording.header.player.id] });
    else client.receive('attach_entity', { entityId: recording.header.player.id, vehicleId: recorded.id, leash: false });
}

/**
 * A mount as the recorder makes one ready (tamed and saddled, a ghast harnessed), in the data its spawn packets would have
 * given the bot: a horse's flags (tamed 0x02, saddled 0x04), a pig's or strider's saddle, from 1.21.5 the saddle it wears.
 */
type Modifier = { id?: string; amount: number; operation: string | number };

function readyMount(bot: Any, vehicle: Any, mount?: { movementSpeed?: number; movementSpeedBase?: number; movementSpeedModifiers?: readonly Modifier[]; jumpStrength?: number; saddled?: boolean; noAi?: boolean }, summon?: { equipment?: Readonly<Record<string, string>> }): void {
    const registry = bot.registry;
    const fork = mineflayerRequire();
    const Item = fork(fork.resolve('prismarine-item'))(registry);
    // (a mob summoned without AI: Mob's flags, bit 1, as its spawn's data gives them; the fork reads it by name, which minecraft-data
    // gives from 1.19.4)
    const mobFlags = registry.entitiesByName[vehicle.name]?.metadataKeys?.indexOf('mob_flags') ?? -1;
    if (mount?.noAi && mobFlags >= 0) (vehicle.metadata ??= [])[mobFlags] = ((vehicle.metadata[mobFlags] as number | undefined) ?? 0) | 0x01;
    // (its base and modifiers, as the attributes packet gives them: a strider's suffocating modifier is the fork's to add and take off,
    // Strider.setSuffocating, 1.21.2 Strider.java:164-175)
    if (mount?.movementSpeedBase != null) {
        const modifiers = (mount.movementSpeedModifiers ?? []).map(m => ({ uuid: m.id, amount: m.amount, operation: typeof m.operation === 'number' ? m.operation : OPERATIONS[m.operation.toLowerCase()] ?? 0 }));
        (vehicle.attributes ??= {})[attributeKey(registry, 'movement_speed', 'generic.movement_speed', 'generic.movementSpeed')] = { value: mount.movementSpeedBase, modifiers };
    } else if (mount?.movementSpeed != null) (vehicle.attributes ??= {})[attributeKey(registry, 'movement_speed', 'generic.movement_speed', 'generic.movementSpeed')] = { value: mount.movementSpeed, modifiers: [] };
    if (HORSES.has(vehicle.name)) {
        const named = registry.entitiesByName.horse?.metadataKeys?.indexOf('flags') ?? -1;
        const v = registry.version;
        const flags = named >= 0 ? named : v['<']('1.9') ? 16 : v['<']('1.10') ? 12 : v['<']('1.14') ? 13 : v['<']('1.15') ? 15 : v['<']('1.17') ? 16 : 17;
        vehicle.metadata ??= [];
        vehicle.metadata[flags] = 0x02 | 0x04;
        vehicle.attributes ??= {};
        if (mount?.jumpStrength != null) vehicle.attributes[attributeKey(registry, 'jump_strength', 'horse.jump_strength', 'horse.jumpStrength')] = { value: mount.jumpStrength, modifiers: [] };
    }
    // (a nautilus goes by its saddle, a happy ghast by its harness: its body slot, physics.js isHappyGhastController)
    // (a ghast the setup harnessed: its summon's body slot)
    if (vehicle.name === 'happy_ghast' && registry.itemsByName.white_harness && (summon ? /harness$/.test(summon.equipment?.body ?? '') : mount?.saddled !== false)) vehicle.setEquipment(6, new Item(registry.itemsByName.white_harness.id, 1));
    // (the saddle, which a llama takes none of: the recorder's saddle is one the mount can equip, 1.21.5 CompatServer.saddle and
    // Mob.isEquippableInSlot, and its rows say saddled false; on 1.21.5 a saddle would have its rider steer it, Mob.isSaddled)
    else if (registry.version['>=']('1.21.5') && registry.itemsByName.saddle && mount?.saddled !== false && (HORSES.has(vehicle.name) || /^(zombie_)?nautilus$/.test(vehicle.name) || vehicle.name === 'pig' || vehicle.name === 'strider')) vehicle.setEquipment(7, new Item(registry.itemsByName.saddle.id, 1));
    else if (vehicle.name === 'pig' || vehicle.name === 'strider') {
        const saddle = registry.entitiesByName[vehicle.name]?.metadataKeys?.indexOf('saddle') ?? -1;
        if (saddle >= 0) (vehicle.metadata ??= [])[saddle] = true;
    }
}

/**
 * A summon's SCALE attribute (1.20.5+), as its attributes packet gives the client: the fork sizes the entity by it
 * (LivingEntity.getDimensions, 1.21.2 LivingEntity.java:3406-3408) and seats its rider at its scaled attachment (:3661-3662).
 */
function sizeMount(bot: Any, client: Any, entity: Any, attributes?: Readonly<Record<string, number>>, commands?: readonly string[]): void {
    // (the summon's, or a setup command's of its type: attribute @e[type=strider,limit=1] minecraft:scale base set 1.5)
    const commanded = (commands ?? []).map(command => /^attribute @e\[type=(?:minecraft:)?(\w+)[^\]]*\] (?:minecraft:)?(?:generic\.)?scale base set ([\d.]+)$/.exec(command))
        .find(match => match?.[1] === entity.name)?.[2];
    const scale = attributes?.scale ?? (commanded === undefined ? undefined : Number(commanded));
    if (scale == null || !bot.registry.version['>=']('1.20.5')) return;
    client.receive('entity_update_attributes', { entityId: entity.id, properties: [{ key: attributeKey(bot.registry, 'scale', 'generic.scale', 'generic.scale'), value: scale, modifiers: [] }] });
}

/**
 * The name the release's attributes packet gives an attribute, which the server's later packets update: from 1.20.5 by the
 * id it maps (generic.scale on 1.20.5, minecraft:scale from 1.21.2), before by its name, namespaced and snake case from 1.16
 * (minecraft:generic.movement_speed), camel case before (generic.movementSpeed).
 */
function attributeKey(registry: Any, name: string, modern: string, legacy: string): string {
    const mappings = registry.protocol?.play?.toClient?.types?.packet_entity_update_attributes?.[1]?.[1]?.type?.[1]?.type?.[1]?.[0]?.type?.[1]?.mappings as Record<string, string> | undefined;
    const mapped = Object.values(mappings ?? {}).find(key => new RegExp(`(^|[.:])${name}$`).test(key));
    return mapped ?? (registry.version['>=']('1.16') ? `minecraft:${modern}` : legacy);
}

/**
 * The mounts the setup summoned ready that the client held when the body began (a click mounts one later): the summons of a
 * type in their order, which is their ids', as their spawn packets would have left them.
 */
function useReadyMounts(bot: Any, client: Any, recording: Recording, start: Snapshot): void {
    const summons = (recording.header.setup.summons ?? []) as readonly { type: string; ready?: boolean; noAi?: boolean; attributes?: Readonly<Record<string, number>> }[];
    const listed = ((start.nearbyEntities ?? []) as { id: number; type: string }[]).slice().sort((a, b) => a.id - b.id);
    for (const type of new Set(summons.map(summon => summon.type))) {
        const ofType = summons.filter(summon => summon.type === type);
        const held = listed.filter(entity => entity.type === type);
        ofType.forEach((summon, index) => {
            const entity = held[index] && bot.entities[held[index]!.id];
            // (its attributes as the rows have them once the player rides it: what its spawn's attributes packet gave the client)
            const ridden = recording.rows.find(row => (row.post as { vehicle?: { id?: number } } | undefined)?.vehicle?.id === entity?.id)?.post as { vehicle?: { mount?: { movementSpeed?: number; jumpStrength?: number } } } | undefined;
            if (summon.ready && entity && entity !== bot.vehicle) readyMount(bot, entity, ridden?.vehicle?.mount, summon as { equipment?: Readonly<Record<string, string>> });
            if (entity && entity !== bot.vehicle) sizeMount(bot, client, entity, summon.attributes, recording.header.setup.commands);
            // (a summon without AI: Mob's flags, bit 1, as its spawn's data gives them, a mount not made ready too)
            const mobFlags = entity ? bot.registry.entitiesByName[entity.name]?.metadataKeys?.indexOf('mob_flags') ?? -1 : -1;
            if (summon.noAi && entity && mobFlags >= 0) (entity.metadata ??= [])[mobFlags] = ((entity.metadata[mobFlags] as number | undefined) ?? 0) | 0x01;
        });
    }
    // (and a mob the setup made otherwise, its NoAI as the rows that ride it have it)
    for (const { id } of listed) {
        const entity = bot.entities[id];
        const mount = (recording.rows.find(row => (row.post as { vehicle?: { id?: number } } | undefined)?.vehicle?.id === id)?.post as { vehicle?: { mount?: { noAi?: boolean } } } | undefined)?.vehicle?.mount;
        const mobFlags = entity ? bot.registry.entitiesByName[entity.name]?.metadataKeys?.indexOf('mob_flags') ?? -1 : -1;
        if (mount?.noAi && entity && mobFlags >= 0) (entity.metadata ??= [])[mobFlags] = ((entity.metadata[mobFlags] as number | undefined) ?? 0) | 0x01;
    }
}

/** The plugin channels a screen's own action goes on before 1.13: the trade picked, the name typed in an anvil. */
const SCREEN_CHANNELS: ReadonlySet<string> = new Set(['MC|TrSel', 'MC|ItemName']);
const isCompared = (p: WrittenPacket, driven: boolean) => MOVEMENT.has(p.name)
    || (driven && (HANDS.has(p.name) || SCREEN.has(p.name) || (p.name === 'custom_payload' && SCREEN_CHANNELS.has(String(p.params?.channel)))));
const moved = (written: readonly WrittenPacket[], driven = false) => written.filter(p => isCompared(p, driven));

/** The keys of the hands in a recording: only what uses them runs with the fork's actions at the tick's start. */
const usesHands = (recording: Recording) => recording.rows.some(row => row.input.keys.some(key => CLICKED.has(key) || key === 'attack' || /^hotbar\d$/.test(key))
    || row.pre.selectedSlot !== recording.rows[0]!.pre.selectedSlot || leavesBed(recording.header.mc, row) || screenClicks(recording.header.mc, row).length > 0);

/**
 * The clicks on a screen the client made before the row's tick (the case's own steps, which no key tells), as minecraft-protocol
 * reads them: those it made between ticks, or, on a release whose client ran them with its queued tasks, while it handled packets.
 */
function screenClicks(version: string, row: ExpandedRow, phase?: 'betweenTicks' | 'packetHandling'): { name: string; params: Any }[] {
    return row.c2s.filter(p => (phase ? p.phase === phase : p.phase === 'betweenTicks' || p.phase === 'packetHandling')).flatMap(p => {
        try {
            const { data } = codecsFor(version).readServerbound.parsePacketBuffer(packetBytes(p.b));
            // (before 1.13 the trade picked and the name typed go on plugin channels: MC|TrSel, MC|ItemName)
            const channel = data.name === 'custom_payload' ? String(data.params.channel) : undefined;
            if (channel === 'MC|TrSel') return [{ name: 'select_trade', params: { slot: (data.params.data as Buffer).readInt32BE(0) } }];
            if (channel === 'MC|ItemName') return [{ name: 'name_item', params: { name: readLegacyString(data.params.data as Buffer) } }];
            return SCREEN.has(data.name) ? [{ name: data.name as string, params: data.params }] : [];
        } catch {
            return [];
        }
    });
}

/** A string as a plugin channel's data carries it: its varint length, then UTF-8. */
function readLegacyString(data: Buffer): string {
    let length = 0;
    let at = 0;
    for (let shift = 0; at < data.length; shift += 7) {
        const byte = data[at++]!;
        length |= (byte & 0x7f) << shift;
        if (!(byte & 0x80)) break;
    }
    return data.subarray(at, at + length).toString('utf8');
}

/**
 * The Leave Bed button (InBedChatScreen.sendWakeUp, ServerboundPlayerCommandPacket STOP_SLEEPING: 1.20.4 InBedChatScreen.java:69-72),
 * a click on a screen the client handles before its tick, which no key of the row tells: the row the client sent it in.
 */
function leavesBed(version: string, row: ExpandedRow): boolean {
    return row.c2s.some(p => {
        if (p.phase !== 'betweenTicks') return false;
        try {
            const { data } = codecsFor(version).readServerbound.parsePacketBuffer(packetBytes(p.b));
            // (1.15 - 1.18.1's protocol gives the action as its id, STOP_SLEEPING's 2: ServerboundPlayerCommandPacket.Action)
            const action = data.params?.actionId;
            return data.name === 'entity_action' && (typeof action === 'number' ? action === 2 : /stop_sleeping|leave_bed/.test(String(action)));
        } catch {
            return false;
        }
    });
}

/** The keys Minecraft.handleKeybinds acts on by their clicks (KeyMapping.consumeClick), a press each, and the attack key's hold. */
const CLICKED: ReadonlySet<string> = new Set(['use', 'drop', 'swapHands', 'inventory']);

type Quiet = (run: () => unknown) => void;

/** Runs a call of the fork's, as the client acts: one the state refuses sends nothing, which the comparison shows. */
const quiet: Quiet = run => {
    try {
        void Promise.resolve(run()).catch(() => undefined);
    } catch {
        // (refused at once)
    }
};

/**
 * Minecraft.handleKeybinds by the fork's calls, in its order (1.20.4 Minecraft.java:1928-2035, 26.3 :1880-1990): the hotbar keys,
 * the inventory key, the swap of the hands, the drop, then the attack and the use keys on what the crosshair is on, the use key
 * held once rightClickDelay is 0, and the attack key held (continueAttack). What each call sends, and when, is the fork's.
 */
class Hands {
    private readonly held = new Set<string>();
    private readonly bot: Any;
    private slot: number;
    private useDelay = 0;
    private missTime = 0;
    /** LocalPlayer.handsBusy: the boat the player steers was paddled in the tick before (rideTick), from 1.9. */
    private handsBusy = false;
    /** A screen the keys opened this tick (a book and quill's editor) released every key for the rest of it (Minecraft.setScreen: KeyMapping.releaseAll). */
    keysReleased = false;

    private readonly version: string;

    constructor(bot: Any, start: Snapshot, version: string) {
        this.bot = bot;
        this.version = version;
        this.slot = (start.selectedSlot as number | undefined) ?? 0;
        // (the crosshair is where the row looks: the fork's activateBlock turns to a block's centre first, which a key press does not)
        bot.lookAt = async () => undefined;
    }

    /** Before the tick of `row`. */
    act(row: ExpandedRow): void {
        const { bot } = this;
        const keys = row.input.keys;
        const down = (key: string) => keys.includes(key);
        const pressed = (key: string) => down(key) && !this.held.has(key);
        this.keysReleased = false;
        const spectator = bot.game.gameMode === 'spectator';
        // (Minecraft.tick: rightClickDelay runs down ahead of handleKeybinds)
        if (this.useDelay > 0) this.useDelay -= 1;
        if (leavesBed(this.version, row) && bot.isSleeping) quiet(() => bot.wake());
        this.screen(row, 'betweenTicks');
        // a hotbar key selects at once, and MultiPlayerGameMode.tick tells the server at the next tick's start (ensureHasSentCarriedItem);
        // a slot a step chose with no key is told with this tick
        const key = keys.find(k => /^hotbar\d$/.test(k) && !this.held.has(k));
        if (key && !spectator) {
            this.slot = Number(key.slice(6)) - 1;
            quiet(() => bot.setQuickBarSlot(this.slot));
        } else if (!keys.some(k => /^hotbar\d$/.test(k)) && row.pre.selectedSlot !== undefined && row.pre.selectedSlot !== this.slot) {
            this.slot = row.pre.selectedSlot as number;
            quiet(() => {
                bot.setQuickBarSlot(this.slot);
                bot._ensureHasSentCarriedItem();
            });
        }
        // the inventory key: the rider of a vehicle with an inventory asks the server to open it (MultiPlayerGameMode.isServerControlledInventory,
        // LocalPlayer.sendOpenInventory); otherwise the player's own screen opens, which tells the server nothing from 1.12
        if (pressed('inventory')) {
            if (bot.vehicle && bot._hasCustomInventoryScreen?.(bot.vehicle)) quiet(() => bot.openEntity(bot.vehicle));
            else quiet(() => bot.openInventoryScreen?.());
        }
        // the swap of the hands (SWAP_ITEM_WITH_OFFHAND) and the drop (LocalPlayer.drop; 26.3 MultiPlayerGameMode.dropItem)
        if (pressed('swapHands') && !spectator) quiet(() => bot.swapHands());
        if (pressed('drop') && !spectator) quiet(() => bot.dropHeldItem(false));
        const range = bot.game.gameMode === 'creative' ? 5 : 4.5;
        const pick = () => bot.raycastHitResult(range, 3);
        let instant = false;
        if (bot.usingHeldItem) {
            // (isUsingItem && !keyUse.isDown(): a key let go with no item in use sends nothing)
            if (!down('use')) quiet(() => bot.deactivateItem());
        } else {
            if (pressed('attack')) instant = this.startAttack(pick());
            if (pressed('use')) this.startUseItem(pick());
        }
        // (the use key held at rightClickDelay 0 uses again: startUseItem sets it to 4)
        if (down('use') && this.useDelay === 0 && !bot.usingHeldItem) this.startUseItem(pick());
        this.continueAttack(!instant && down('attack'), pick);
        this.held.clear();
        for (const k of keys) this.held.add(k);
        // (LocalPlayer.rideTick, after the tick's input: the movement keys paddle the boat the player controls, and keep the hands
        // busy for the next tick's keys; 1.20.4 LocalPlayer.java:853-861, 26.3 :964-968)
        const vehicle = bot.vehicle;
        const steers = !!vehicle && /(^|_)(boat|raft)$|^Boat$/.test(vehicle.name ?? '') && (vehicle.passengers?.[0] ?? bot.entity) === bot.entity;
        this.handsBusy = steers && bot.registry.version['>=']('1.9') && ['left', 'right', 'forward', 'back'].some(down);
    }

    /**
     * The clicks on the open screen the client made in a phase of the row (screenClicks): the slot, the button and the mode the case
     * clicked with (bot.clickWindow, whose prediction of the menu says the rest), the screen closed (bot.closeWindow), the trade
     * picked, the name typed, the enchantment chosen.
     */
    screen(row: ExpandedRow, phase: 'betweenTicks' | 'packetHandling'): void {
        const { bot } = this;
        for (const { name, params } of screenClicks(this.version, row, phase)) {
            if (name === 'window_click') quiet(() => bot.clickWindow(params.slot, params.mouseButton, params.mode));
            else if (name === 'close_window') {
                const window = bot.currentWindow?.id === params.windowId ? bot.currentWindow : params.windowId === 0 ? bot.inventory : (bot.currentWindow ?? bot.inventory);
                quiet(() => bot.closeWindow(window));
            } else if (name === 'select_trade') quiet(() => bot.selectTrade(params.slot));
            else if (name === 'name_item') quiet(() => bot.setAnvilItemName(params.name));
            else if (name === 'enchant_item') quiet(() => bot.clickEnchantment(params.enchantment));
        }
    }

    /**
     * Minecraft.startAttack (1.20.4 Minecraft.java:1670-1714): true when the block broke at once, which holds the key off this tick.
     * From 1.21.11 an item that needs a charge it lacks does nothing (Player.cannotAttackWithItem), and a piercing weapon stabs
     * whatever the crosshair is on (MultiPlayerGameMode.piercingAttack), which holds the key off too (1.21.11 Minecraft.java
     * startAttack).
     */
    private startAttack(hit: Any): boolean {
        const { bot } = this;
        if (this.missTime > 0 || this.handsBusy) return false;
        const held = bot.heldItem;
        if (bot.cannotAttackWithItem?.(held, 0)) return false;
        if (bot.isPiercingWeapon?.(held) && bot.game.gameMode !== 'spectator') {
            quiet(() => bot.stab());
            return true;
        }
        if (hit.type === 'entity') quiet(() => bot.attack(hit.entity));
        else if (hit.type === 'block') {
            quiet(() => bot.dig(hit.block, 'ignore', 'auto', hit.face));
            return bot.blockAt(hit.block.position)?.type === 0;
        } else {
            if (bot.game.gameMode !== 'creative') this.missTime = 10;
            // (a miss resets the attack strength, Minecraft.startAttack's MISS: 1.16.5 Minecraft.java:1291-1296, 1.20.4 :1702-1707)
            bot.resetAttackStrengthTicker?.();
            quiet(() => bot.swingArm());
        }
        return false;
    }

    /**
     * Minecraft.continueAttack (1.20.4 Minecraft.java:1648-1668): the key held on a block goes on digging it (the fork's tick does it,
     * MultiPlayerGameMode.continueDestroyBlock), a new block or face at the crosshair is dug instead, and the key let go or the
     * crosshair off the block stops it (stopDestroyBlock). missTime runs down in Minecraft.tick after handleKeybinds.
     */
    private continueAttack(holding: boolean, pick: () => Any): void {
        const { bot } = this;
        if (!holding) this.missTime = 0;
        if (this.missTime <= 0 && !bot.usingHeldItem) {
            const hit = holding ? pick() : undefined;
            if (hit?.type === 'block' && bot.blockAt(hit.block.position)?.type !== 0) {
                const on = bot.targetDigBlock?.position;
                if (!(on && on.equals(hit.block.position) && bot.targetDigFace === hit.face)) quiet(() => bot.dig(hit.block, 'ignore', 'auto', hit.face, { held: true }));
            } else if (bot.targetDigBlock || bot.isDestroying) quiet(() => bot.stopDigging());
        }
        if (this.missTime > 0) this.missTime -= 1;
    }

    /** Minecraft.startUseItem (1.20.4 Minecraft.java:1716-1775): what the crosshair is on, then the item, with each hand. */
    private startUseItem(hit: Any): void {
        const { bot } = this;
        if (bot.isDestroying) return;
        this.useDelay = 4;
        if (this.handsBusy) return;
        const direction = (face: number) => [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][face]!;
        // (for each hand: what the crosshair is on, then the hand's item, which an empty hand has none of; a hand that acted ends the
        // use. From 1.13 a use on the block or the entity that failed ends it too, and an item's use acts when it consumes the action;
        // before, only a SUCCESS ends it, the item's use coming after any other (1.12.2 Minecraft.rightClickMouse, 1.13.2
        // Minecraft.startUseItem, 1.20.4 Minecraft.java:1716-1775); 1.8 has one hand)
        const { Vec3 } = mineflayerRequire()('vec3');
        const version = bot.registry.version;
        const acted = (result: unknown) => result === 'success' || result === 'success_server' || result === 'consume';
        const useWith = async (offHand: boolean): Promise<boolean> => {
            const stack = offHand ? bot.inventory?.slots?.[45] : bot.heldItem;
            let result: unknown = 'pass';
            if (hit.type === 'entity') result = await bot._interactEntity(hit.entity, hit.intersect, offHand);
            else if (hit.type === 'block') result = await bot.activateBlock(hit.block, new Vec3(...direction(hit.face)), hit.intersect.minus(hit.block.position), offHand);
            if (acted(result) || (result !== 'pass' && version['>=']('1.13'))) return true;
            if (!stack) return false;
            const used = bot.activateItem(offHand);
            // (a book and quill opens its editor on the client: WritableBookItem.use, Player.openItemGui, 1.20.4
            // WritableBookItem.java:38-40)
            if (stack.name === 'writable_book' && acted(used)) this.keysReleased = true;
            return acted(used);
        };
        quiet(async () => {
            if (!await useWith(false) && version['>=']('1.9')) await useWith(true);
        });
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
    const readSent = (row: ExpandedRow, pick: (p: ExpandedRow['c2s'][number]) => boolean): WrittenPacket[] => row.c2s.filter(pick).flatMap(p => {
        const bytes = packetBytes(p.b);
        const read = serverbound(version, bytes);
        if (read === undefined) {
            codec.push(`t=${row.t}: c2s ${p.name}`);
            return [];
        }
        return [{ name: read.name, bytes, params: read.params }];
    });
    const count = (into: Record<string, number>, name: string) => { into[name] = (into[name] ?? 0) + 1; };
    // (from 1.21.5 a click's items carry their components as hashes in an IdentityHashMap, HashedPatchMap.create, 1.21.10
    // HashedPatchMap.java:25-29: the order the client writes them in is its JVM's identity hashes, no behaviour; both sides'
    // go by the component's id, the bytes otherwise as written)
    const unordered = (packet: WrittenPacket): WrittenPacket => {
        if (packet.name !== 'window_click' || !packet.params) return packet;
        const sorted = (item: Any) => (Array.isArray(item?.components) ? { ...item, components: [...item.components].sort((a: Any, b: Any) => String(a.type).localeCompare(String(b.type))) } : item);
        const params = { ...packet.params, cursorItem: sorted(packet.params.cursorItem), changedSlots: (packet.params.changedSlots ?? []).map((slot: Any) => ({ ...slot, item: sorted(slot.item) })) };
        if (!Array.isArray(packet.params.changedSlots) || JSON.stringify(params) === JSON.stringify(packet.params)) return packet;
        return { ...packet, bytes: codecsFor(version).toServer.createPacketBuffer({ name: packet.name, params }) };
    };
    try {
        started = await startBot(recording, options);
        const { bot, client } = started;
        const driven = usesHands(recording);
        const hands = driven ? new Hands(bot, recording.rows[0]!.pre, version) : undefined;
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
            // (a click the client made while it handled its queued tasks, as a release's client ran the case's steps there)
            hands?.screen(row, 'packetHandling');
            const answers = moved(client.written, driven);
            const theirAnswers = moved(readSent(row, p => p.phase === 'packetHandling'), driven);
            client.written.length = 0;
            // (what the delivery put off to a later turn of the loop, a task of the client, and the recorder's own presses: outside a tick)
            setLook(bot, row.input.yRot, row.input.xRot);
            const looked = [bot.entity.yaw, bot.entity.pitch];
            hands?.act(row);
            // (a use that turns the player, a horse it climbs on before 1.13 (AbstractHorse.mountTo), turns it after the recorder's
            // look of the tick: that rotation stands for the tick)
            const turned = bot.entity.yaw !== looked[0] || bot.entity.pitch !== looked[1];
            await new Promise(resolve => setImmediate(resolve));
            const between = moved(client.written, driven);
            const theirBetween = moved(readSent(row, p => p.phase === 'betweenTicks'), driven);
            client.written.length = 0;
            setKeys(bot, hands?.keysReleased ? [] : row.input.keys);
            if (!turned) setLook(bot, row.input.yRot, row.input.xRot);
            if (options.forgetRiderCollision && !bot.vehicle) delete bot.entity.horizontalCollision;
            // (a snapshot says the interpolation goes on and not for how long: the tick that ends with none has its last step)
            const steps = bot.vehicle?.interpolation?.stepped?.steps;
            if (steps && !(row.post.vehicle as { mount?: { lerpNext?: unknown } } | null | undefined)?.mount?.lerpNext) steps.length = 0;
            // (a client tick whose player waits for the level, 1.21.4+, still ends with its tick end: the fork does not tick the player)
            if (bot._replayLevel) bot._replayLevel.ready = !!row.playerTicked;
            if (row.playerTicked || (!row.playerTicked && bot.awaitingLevel?.())) {
                clock.advance(50);
                bot.physicsTick();
                if (row.playerTicked) compared += 1;
            } else {
                // (a client tick that did not tick the player still ran its level's chunk check of it, which puts a new player
                // in a chunk that has loaded since: 1.12.2 Level.checkChunk :1449-1510, the player ticked from the next tick)
                bot._checkChunk?.();
            }
            const ours = moved(client.written, driven);
            options.trace?.(row, ours, bot);
            const all = readSent(row, p => p.phase !== 'packetHandling' && p.phase !== 'betweenTicks');
            const theirs = moved(all, driven);
            for (const packet of [...theirAnswers, ...theirBetween, ...theirs]) count(packets, packet.name);
            for (const packet of readSent(row, () => true)) {
                if (isCompared(packet, driven)) continue;
                count(notCompared, packet.name);
                if (!HANDLESS.has(packet.name)) handsAt ??= row.t;
            }
            const report = (divergence: BotDivergence) => (handsAt === undefined ? divergences : afterHands).push(divergence);
            const answered = comparePackets(theirAnswers.map(unordered), answers.map(unordered));
            if (answered) report({ t: row.t, at: 'responses', difference: answered });
            const ticked = comparePackets([...theirBetween, ...theirs].map(unordered), [...between, ...ours].map(unordered));
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
