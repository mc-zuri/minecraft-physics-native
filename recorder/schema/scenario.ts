// The compiled scenario: what scenarios/build.ts writes per release and the recorder mod reads
// (mod/common/.../model/Scenario.java mirrors these types for Gson). Coordinates are relative to
// the area's origin: blocks at y=-1 are the floor, so a start at y=0 stands on the floor.

export type Vec3 = readonly [number, number, number];
export type BlockPos = readonly [number, number, number];

export const MOVEMENT_KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'] as const;
/** Keys that act on a press (a click): the use and attack buttons, the inventory, the hotbar... */
export const ACTION_KEYS = [
    'use', 'attack', 'inventory', 'drop', 'swapHands', 'pickItem',
    'hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5', 'hotbar6', 'hotbar7', 'hotbar8', 'hotbar9',
] as const;
export type MovementKey = (typeof MOVEMENT_KEYS)[number];
export type Key = MovementKey | (typeof ACTION_KEYS)[number];

/** A block state as the release names it: `oak_slab[type=bottom,waterlogged=false]`. */
export type BlockStateString = string;

export interface CompiledFill {
    readonly from: BlockPos;
    readonly to: BlockPos;
    readonly block: BlockStateString;
    /** Run neighbour updates and shape updates (pistons, redstone, connecting blocks). */
    readonly update?: boolean;
}

export interface CompiledArea {
    readonly name: string;
    /** Inclusive box relative to the origin, [minX, minY, minZ, maxX, maxY, maxZ]: cleared before the fills. */
    readonly box: readonly [number, number, number, number, number, number];
    readonly fills: readonly CompiledFill[];
    /** The client's render distance the area needs (chunks). */
    /** The area's own absolute origin (far coordinates, the world border); the recorder's default when absent. */
    readonly origin?: BlockPos;
}

export interface CompiledEffect {
    readonly id: string; // registry name without namespace: "speed"
    readonly amplifier: number;
    readonly duration: number; // ticks, -1 for infinite
    readonly ambient?: boolean;
    readonly visible?: boolean;
}

export interface CompiledModifier {
    /** A stable UUID derived from the scenario, attribute and name (the modifier id before 1.21). */
    readonly uuid: string;
    /** The resource id (1.21+): "recorder:<name>". */
    readonly key: string;
    readonly amount: number;
    readonly operation: 'add_value' | 'add_multiplied_base' | 'add_multiplied_total';
}

export interface CompiledAttribute {
    /** The release's registry name: "generic.movement_speed" before 1.20.5, "movement_speed" after. */
    readonly id: string;
    readonly base?: number;
    readonly modifiers?: readonly CompiledModifier[];
}

export interface CompiledItem {
    readonly id: string; // item registry name
    readonly count: number;
    /** The variant, before 1.13. */
    readonly damage?: number;
    /** Enchantment registry name -> level. */
    readonly enchantments: Readonly<Record<string, number>>;
}

export interface CompiledSummon {
    readonly ref: string; // the scenario's name for it, used by later actions
    /** Entity registry name; boats as the modern ids ("oak_boat", "oak_chest_boat", "bamboo_raft"), the mod maps them. */
    readonly type: string;
    readonly pos: Vec3;
    readonly vel?: Vec3;
    readonly yRot?: number;
    readonly xRot?: number;
    readonly noAi?: boolean;
    readonly noGravity?: boolean;
    /** Extra entity NBT as SNBT (version-specific; the build checks nothing in it). */
    readonly nbt?: string;
    /** Ready to ride: tamed, and saddled where it takes a saddle. */
    readonly ready?: boolean;
    /** Equipment slot (saddle, body, mainhand, ...) -> item id. */
    readonly equipment?: Readonly<Record<string, string>>;
    /** A donkey, mule or llama carries a chest. */
    readonly chested?: boolean;
    /** Attribute registry name (the release's) -> base value, fixed so random mob stats do not vary. */
    readonly attributes?: Readonly<Record<string, number>>;
}

export interface CompiledSetup {
    readonly gameMode: 'survival' | 'creative' | 'adventure' | 'spectator';
    readonly effects: readonly CompiledEffect[];
    readonly attributes: readonly CompiledAttribute[];
    /** Slot (head, chest, legs, feet, mainhand, offhand) -> item. */
    readonly equipment: Readonly<Record<string, CompiledItem>>;
    /** Player inventory index (0-8 hotbar, 9-35 main, 36-39 armor, 40 offhand) -> item. */
    readonly inventory: Readonly<Record<string, CompiledItem>>;
    readonly selectedSlot: number;
    readonly food: number;
    readonly abilities?: { readonly mayfly?: boolean; readonly flying?: boolean; readonly flyingSpeed?: number; readonly walkingSpeed?: number };
    readonly summons: readonly CompiledSummon[];
    /** Ride this summon (by ref) from the start. */
    readonly mount?: string;
    /** Server commands run at the end of the setup (already chosen for the release). */
    readonly commands: readonly string[];
    readonly autoJump: boolean;
    readonly allowFlight: boolean;
}

/** A condition, evaluated on the client's player after a tick. */
export type Condition =
    | { readonly op: 'onGround' }
    | { readonly op: 'fishBiting' }
    | { readonly op: 'inWater' }
    | { readonly op: 'inLava' }
    | { readonly op: 'fallFlying' }
    | { readonly op: 'collidedHorizontally' }
    | { readonly op: 'stopped'; readonly epsilon: number }
    | { readonly op: 'touching'; readonly block: string; readonly how: 'on' | 'in' | 'against' | 'under' }
    /** x, y, z: area-local feet position; highest, lowest: y over the path so far; distance: horizontal, start to now. */
    | { readonly op: 'cmp'; readonly field: 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz' | 'fallDistance' | 'health' | 'highest' | 'lowest' | 'distance'; readonly cmp: '<' | '<=' | '>' | '>='; readonly value: number }
    | { readonly op: 'and'; readonly all: readonly Condition[] }
    | { readonly op: 'or'; readonly any: readonly Condition[] }
    | { readonly op: 'not'; readonly cond: Condition }
    | { readonly op: 'const'; readonly holds: boolean };

/** A server-side action, run on the server thread between client tick t and server tick t. */
export type ServerAction =
    | { readonly op: 'velocity'; readonly target?: string; readonly vel: Vec3 }
    | { readonly op: 'knockback'; readonly strength: number; readonly dx: number; readonly dz: number }
    | { readonly op: 'teleport'; readonly pos: Vec3; readonly yRot?: number; readonly xRot?: number; readonly relative?: readonly ('x' | 'y' | 'z' | 'yRot' | 'xRot')[] }
    | { readonly op: 'explode'; readonly pos: Vec3; readonly power: number }
    | { readonly op: 'setBlock'; readonly pos: BlockPos; readonly block: BlockStateString; readonly update: boolean }
    | { readonly op: 'fill'; readonly from: BlockPos; readonly to: BlockPos; readonly block: BlockStateString; readonly update: boolean }
    | { readonly op: 'effect'; readonly effect: CompiledEffect }
    | { readonly op: 'removeEffect'; readonly id: string }
    | { readonly op: 'clearEffects' }
    | { readonly op: 'attribute'; readonly attribute: CompiledAttribute }
    | { readonly op: 'abilities'; readonly mayfly?: boolean; readonly flying?: boolean; readonly flyingSpeed?: number; readonly walkingSpeed?: number }
    | { readonly op: 'gameMode'; readonly gameMode: CompiledSetup['gameMode'] }
    | { readonly op: 'food'; readonly food: number }
    | { readonly op: 'summon'; readonly summon: CompiledSummon }
    | { readonly op: 'mount'; readonly ref: string }
    | { readonly op: 'dismount' }
    | { readonly op: 'remove'; readonly ref: string }
    | { readonly op: 'equip'; readonly slot: string; readonly item: CompiledItem }
    | { readonly op: 'command'; readonly command: string }
    | { readonly op: 'tabList'; readonly header: string; readonly footer: string }
    | { readonly op: 'blockDamage'; readonly pos: Vec3; readonly stage: number }
    | { readonly op: 'forgetChunk'; readonly pos: Vec3 }
    | { readonly op: 'kick'; readonly reason: string }
    | { readonly op: 'resourcePack'; readonly url: string; readonly packHash: string; readonly required: boolean; readonly prompt?: string; readonly pop: boolean }
    | { readonly op: 'respawnPoint'; readonly pos: Vec3 }
    | { readonly op: 'noGravity'; readonly noGravity: boolean };

/** One step of the body. Instant steps run at the head of the tick and do not consume it. */
export type Step =
    | { readonly op: 'hold'; readonly keys: readonly Key[] }
    | { readonly op: 'release'; readonly keys: readonly Key[] }
    | { readonly op: 'releaseAll' }
    | { readonly op: 'press'; readonly keys: readonly Key[]; readonly ticks: number }
    | { readonly op: 'look'; readonly yRot: number; readonly xRot: number }
    | { readonly op: 'turn'; readonly dyRot: number; readonly dxRot: number; readonly ticks: number }
    | { readonly op: 'ticks'; readonly ticks: number }
    | { readonly op: 'until'; readonly cond: Condition; readonly max: number; readonly soft?: boolean }
    /** Ticks until the velocity no longer changes (|dvx|, |dvz| < 0.01, and |dvy| unless on the ground), at least `ticks` ticks. */
    | { readonly op: 'stable'; readonly ticks: number; readonly max: number; readonly soft?: boolean }
    /** Ticks until the player has moved less than 1e-7 on every axis for `ticks` ticks in a row. */
    | { readonly op: 'stopped'; readonly ticks: number; readonly max: number; readonly soft?: boolean }
    | { readonly op: 'selectSlot'; readonly slot: number }
    | { readonly op: 'server'; readonly action: ServerAction }
    /** What the player does through the client's own code paths: a click, a screen's button, chat. Instant. */
    | { readonly op: 'client'; readonly client: ClientAction }
    /** Ticks until the open screen's name starts with this: none, death, sign, book, merchant, container:... */
    | { readonly op: 'screen'; readonly screen: string; readonly max: number; readonly soft?: boolean };

export interface ClientAction {
    readonly type: string;
    readonly text?: string;
    readonly slot?: number;
    readonly button?: number;
    readonly mode?: string;
    readonly id?: number;
    readonly lines?: readonly string[];
    readonly front?: boolean;
    readonly pages?: readonly string[];
    readonly title?: string;
    /** A block of the area, by its local position. */
    readonly at?: readonly [number, number, number];
    readonly item?: CompiledItem;
}

export type Expectation =
    | { readonly op: 'touched'; readonly block: string; readonly how: 'on' | 'in' | 'against' | 'under' }
    | { readonly op: 'corrections'; readonly allowed: boolean }
    | { readonly op: 'staysInArea' }
    | { readonly op: 'final'; readonly cond: Condition };

export interface CompiledStart {
    readonly pos: Vec3;
    readonly yRot: number;
    readonly xRot: number;
    readonly vel?: Vec3;
    /** Wait standing on the ground before the body starts (false: the body starts on the arrival tick). */
    readonly grounded: boolean;
    /** Where the player rests before it is teleported to the start (a fall starts mid-air), when not the start. */
    readonly rest?: Vec3;
    /** Wait until the player (or its vehicle) is still at the rest point; false for mounts that never stand still. */
    readonly settle: boolean;
}

export interface CompiledScenario {
    readonly id: string;
    readonly hash: string;
    readonly tags: readonly string[];
    /** A case about the game's features: the screens it opens stay open. */
    readonly features?: boolean;
    /** The player can be hurt and die; every other case keeps it invulnerable. */
    readonly mortal?: boolean;
    /** The world's difficulty; peaceful when absent. */
    readonly difficulty?: string;
    /** The case ends the connection: it runs last and ends its client's run. */
    readonly disconnects?: boolean;
    readonly area: CompiledArea;
    readonly start: CompiledStart;
    readonly setup: CompiledSetup;
    readonly body: readonly Step[];
    readonly expect: readonly Expectation[];
    /** Path checks carried over from physics-data-generator (Conditions syntax), not enforced yet. */
    readonly checks?: readonly string[];
    /**
     * Why two runs of this scenario need not match (the server's timing decides part of it, as when the server moves
     * an entity the player touches): each recording is still self-consistent, but --verify reports it apart.
     */
    readonly serverTimed?: string;
    /** An upper bound of the body's ticks, for sharding and timeouts. */
    readonly maxTicks: number;
}

export interface ScenarioIndex {
    readonly schema: 1;
    readonly version: string;
    readonly scenarios: readonly { readonly id: string; readonly hash: string; readonly file: string; readonly maxTicks: number; readonly serverTimed?: string; readonly needsFeature?: boolean }[];
    readonly skipped: readonly { readonly id: string; readonly reason: string }[];
}
