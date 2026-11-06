// The phase model shared by the recorder mod (PhaseIds.java, generated from this file), the native
// engine's opt-in trace (native/src/phase.rs) and the replay. A phase is a named point inside one
// client tick of the local player at which a snapshot of its state is taken. Phases are compared
// by name, never by position: a release may lack one or run two in another order.

/** Where a phase's snapshot can come from on the engine side. */
export type PhaseOwner = 'adapter' | 'native' | 'both' | 'vanilla';

export interface PhaseSpec {
    readonly name: PhaseName;
    /** Essential phases are recorded on every release and compared by default. */
    readonly essential: boolean;
    /** The vanilla hook (mojmap) the mod snapshots at, for 1.20.4. */
    readonly vanilla: string;
    /** The TypeScript adapter's matching point (src/mineflayer/player.ts), if it has one. */
    readonly adapter?: string;
    /** The Rust engine's matching point (native/src/simulation.rs), if it has one. */
    readonly native?: string;
    readonly owner: PhaseOwner;
}

/** The local player's phases in the order 1.20.4 runs them. */
export const PLAYER_PHASES = [
    'tickStart',
    'afterBaseTick',
    'afterInput',
    'beforeLivingAiStep',
    'beforeTravel',
    'beforeMove',
    'afterMove',
    'afterTravel',
    'afterAiStep',
    'beforeSend',
    'tickEnd',
    'clientTickEnd',
] as const;

export type PhaseName = (typeof PLAYER_PHASES)[number];

/** The pseudo-phase of a packet sent while a server packet is being handled (a teleport confirm...). */
export const PACKET_HANDLING = 'packetHandling';
/** The pseudo-phase of a packet sent by a client task outside a tick and outside packet handling. */
export const BETWEEN_TICKS = 'betweenTicks';
export type PacketPhase = PhaseName | typeof PACKET_HANDLING | typeof BETWEEN_TICKS;

export const PHASES: Readonly<Record<PhaseName, PhaseSpec>> = {
    tickStart: {
        name: 'tickStart', essential: true, owner: 'both',
        vanilla: 'LocalPlayer.tick HEAD (after the server packets of the round were handled)',
        adapter: 'NativePhysics.tick entry', native: 'phase::emit: after the riptide launch',
    },
    afterBaseTick: {
        name: 'afterBaseTick', essential: true, owner: 'both',
        vanilla: 'LivingEntity.baseTick TAIL (fluid state, fluid push, effects ticked)',
        adapter: 'after updateFluids + updateSwimming', native: 'phase::emit: after the lava fall-distance halving',
    },
    afterInput: {
        name: 'afterInput', essential: false, owner: 'adapter',
        vanilla: 'LocalPlayer.aiStep after Input.tick (impulses, item-use slowdown)',
        adapter: 'after inputsToCrouch',
    },
    beforeLivingAiStep: {
        name: 'beforeLivingAiStep', essential: true, owner: 'both',
        vanilla: 'LivingEntity.aiStep HEAD (sprint, fly and elytra decisions made)',
        adapter: 'after inputsToFly, before NativePlayer.tick', native: 'phase::emit: before the 0.003 cut',
    },
    beforeTravel: {
        name: 'beforeTravel', essential: true, owner: 'native',
        vanilla: 'Player.travel HEAD (+ the travel vector: xxa, yya, zza after *0.98)',
        native: 'phase::emit: after jump / fall-flying start',
    },
    beforeMove: {
        name: 'beforeMove', essential: true, owner: 'native',
        vanilla: 'Entity.move HEAD, MoverType.SELF, inside travel (+ the movement argument)',
        native: 'phase::emit: before move_slowed',
    },
    afterMove: {
        name: 'afterMove', essential: true, owner: 'native',
        vanilla: 'LocalPlayer.move TAIL (collision flags, onGround, supporting block, block speed factor)',
        native: 'phase::emit: after the block speed factor',
    },
    afterTravel: {
        name: 'afterTravel', essential: true, owner: 'native',
        vanilla: 'Player.travel TAIL (gravity, drag, fluid falling applied)',
        native: 'phase::emit: after glide_stopped',
    },
    afterAiStep: {
        name: 'afterAiStep', essential: true, owner: 'both',
        vanilla: 'LocalPlayer.aiStep TAIL',
        adapter: 'after takeOutput, the spin countdown and the climbable check',
        native: 'phase::emit: tick_local_player_scene, after the spin attack check',
    },
    beforeSend: {
        name: 'beforeSend', essential: true, owner: 'adapter',
        vanilla: 'LocalPlayer.tick after AbstractClientPlayer.tick() (pose updated, packets not sent yet)',
        adapter: 'after updatePoses (mineflayer: entityPhysicsTick)',
    },
    tickEnd: {
        name: 'tickEnd', essential: false, owner: 'adapter',
        vanilla: 'LocalPlayer.tick TAIL', adapter: 'end of NativePhysics.tick',
    },
    clientTickEnd: {
        name: 'clientTickEnd', essential: true, owner: 'both',
        vanilla: 'Minecraft.tick TAIL (entities after the player, rockets, pistons)',
        adapter: 'after pushByMovingPiston', native: 'phase::emit: tick_local_player_scene, after the moving pistons',
    },
};

/** The phases the native trace emits (native/src/phase.rs Phase::ALL, by name). */
export const NATIVE_PHASES: readonly PhaseName[] = PLAYER_PHASES.filter(p => {
    const owner = PHASES[p].owner;
    return owner === 'native' || owner === 'both';
});

export function isPhaseName(name: string): name is PhaseName {
    return (PLAYER_PHASES as readonly string[]).includes(name);
}

export function phaseIndex(name: PhaseName): number {
    return PLAYER_PHASES.indexOf(name);
}
