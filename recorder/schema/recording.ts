// The recording format, schema 1: `<case>.jsonl.gz`, written by the mod's RecordingWriter.
//
//   line 1        RecordingHeader  { kind: "header", ... }
//   lines 2..n-1  RecordingRow     one per client tick of the scenario's body
//   line n        RecordingFooter  { kind: "footer", status, ... }
//
// Player state is delta-encoded against one running state carried through each row in order:
// the previous row's post, each s2c[i].after, pre, each phase in the order it ran, post. A delta
// holds only the fields that changed; null means the field went away. A row with "kf": true holds
// the whole pre. Numbers follow json.ts: doubles exact, floats widened, -0.0 kept, "NaN" / "+Inf" /
// "-Inf" for non-finite values. Packet bytes are base64 of the varint packet id and the payload.
//
// Compatibility: `vph` joined schema 1 as `provenance` did, with no other line changing meaning: a replay that does not read it
// reads the rest as before, and a recording without it has no vehicle phases.
//
// Compatibility: `provenance` joined schema 1 without changing what any other line means, so a recording from before it
// reads as before and simply says nothing of its build (the replay reports it as unrecorded). A recording's provenance is
// what it was made with, and nothing rewrites it: a replay gives its own build beside it.

import type { CompiledScenario, Step } from './scenario.ts';

export type Snapshot = Record<string, unknown>;

export interface RecordingHeader {
    readonly kind: 'header';
    readonly schema: 1;
    readonly mc: string;
    readonly protocol: number;
    readonly scenario: { readonly id: string; readonly hash: string };
    /** The experiments the world was made with (record.ts --features). */
    readonly features?: readonly string[];
    /** The build it was made with (runner/provenance.ts BuildIdentity), when record.ts started the client. */
    readonly provenance?: { readonly id: string; readonly release: string; readonly commit: string; readonly dirty: string } & Readonly<Record<string, unknown>>;
    /** The player field keys the snapshots write (null before the first row checked them). */
    readonly fields: readonly string[] | null;
    readonly phases: readonly string[];
    readonly world: {
        readonly origin: readonly [number, number, number];
        readonly area: CompiledScenario['area'];
        readonly dimension: string;
        /**
         * The world's blocks over the area box when the body starts (absolute, inclusive): x outermost, then y, then
         * z; runs is [paletteIndex, count, ...]. What the player meets: the fills after neighbour updates, setup and
         * settling. Later changes are the rows' `blocks`.
         */
        readonly blocks?: { readonly from: readonly [number, number, number]; readonly to: readonly [number, number, number]; readonly palette: readonly string[]; readonly runs: readonly number[] };
    };
    readonly server: { readonly wire: boolean; readonly ownerChecks: 'dedicated' | 'owner'; readonly allowFlight: boolean; readonly viewDistance?: number };
    /** The local player: its entity id (in the packets), UUID and name. */
    readonly player: { readonly id: number; readonly uuid: string; readonly name: string };
    readonly start: CompiledScenario['start'];
    readonly setup: CompiledScenario['setup'];
    readonly body: readonly Step[];
}

export interface PacketIn {
    readonly seq: number;
    /** The client's packet class name (ClientboundSetEntityMotionPacket...). */
    readonly name: string;
    readonly id: number;
    /** base64 of the packet id varint and its payload. */
    readonly b: string;
    /** The player state change the handling made (a delta), when it changed anything. */
    readonly after?: Snapshot;
}

export interface PacketOut {
    readonly seq: number;
    /** The phase the client was in when it sent it (phases.ts), or packetHandling / betweenTicks. */
    readonly phase: string;
    readonly name: string;
    readonly id: number;
    readonly b: string;
    /** The seq of the server packet being handled when it was sent. */
    readonly re?: number;
}

export interface RecordingRow {
    readonly t: number;
    readonly s2c?: readonly PacketIn[];
    readonly pre: Snapshot;
    readonly kf?: true;
    readonly in: { readonly keys: readonly string[]; readonly yRot: number; readonly xRot: number };
    /** Phase name -> delta, in the order the phases ran. */
    readonly ph?: Readonly<Record<string, Snapshot>>;
    /** The ridden vehicle, whole, at the head and tail of its own move: vehicleBeforeMove, vehicleAfterMove, and "#1" on for a repeat. */
    readonly vph?: Readonly<Record<string, Snapshot>>;
    readonly c2s?: readonly PacketOut[];
    readonly post: Snapshot;
    /** False when LocalPlayer.tick skipped the entity tick (its chunk was not loaded). */
    readonly playerTicked?: false;
    /** The server's tick between the previous client tick and this one. */
    readonly srv?: ServerView;
    /** The riding jump the rider released during this tick, in percent (the mount jumps with it at its next tick). */
    readonly ridingJump?: number;
    /** Blocks the server changed on the client before this tick: [x, y, z, state] (absolute). */
    readonly blocks?: readonly (readonly [number, number, number, string])[];
    /** Teleports the server sent to correct the client during that server tick. */
    readonly corrections?: readonly { readonly pos: readonly [number, number, number]; readonly yRot: number; readonly xRot: number }[];
}

export interface ServerView {
    readonly tick: number;
    readonly pos: readonly [number, number, number];
    readonly vel: readonly [number, number, number];
    readonly onGround: boolean;
    readonly fallDistance: number;
    readonly pose: string;
    readonly health: number;
    readonly awaitingTeleport: boolean;
    readonly entities: readonly Snapshot[];
}

export interface RecordingFooter {
    readonly kind: 'footer';
    readonly status: 'ok' | 'invalid';
    readonly reason?: string;
    readonly touched: readonly string[];
    readonly corrections: number;
    readonly wallMs: number;
    readonly rows: number;
}

/** A row with every state expanded to a full snapshot. */
export interface ExpandedRow {
    readonly t: number;
    readonly s2c: readonly (PacketIn & { readonly state: Snapshot })[];
    readonly pre: Snapshot;
    readonly input: RecordingRow['in'];
    readonly phases: readonly { readonly name: string; readonly state: Snapshot }[];
    /** The ridden vehicle at the head and tail of each of its moves, in order. Absent from recordings made before them. */
    readonly vehiclePhases: readonly { readonly name: string; readonly state: Snapshot }[];
    readonly c2s: readonly PacketOut[];
    readonly post: Snapshot;
    readonly playerTicked: boolean;
    readonly srv?: ServerView;
    readonly corrections: NonNullable<RecordingRow['corrections']>;
    readonly blocks: NonNullable<RecordingRow['blocks']>;
    readonly ridingJump?: number;
}

export interface Recording {
    readonly header: RecordingHeader;
    readonly rows: readonly ExpandedRow[];
    readonly footer: RecordingFooter;
}
