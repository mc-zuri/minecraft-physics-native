// The scoreboard teams that keep entities from pushing the player. A case makes them in its setup, whose packets come
// before the first row: the header's setup commands say what they were, and the rows' packets what became of them.

import type { RecordingHeader } from '../schema/recording.ts';
import { packetBytes } from './load.ts';
import { decodeClientbound } from './packets.ts';

const PLAYER = '@player';
/** ClientboundSetPlayerTeamPacket's methods by their numbers. */
const MODES = ['create', 'remove', 'change', 'join', 'leave'];
/** Team.CollisionRule by its id (1.21.5 - 1.21.8 send the id) and its names (push_other_teams from 1.21.9). */
const RULES = ['always', 'never', 'pushOtherTeams', 'pushOwnTeam'];

function ruleName(rule: unknown): string {
    if (typeof rule === 'number') return RULES[rule] ?? 'always';
    const name = String(rule).replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    return RULES.includes(name) ? name : 'always';
}

/** The members a command's target names: the player, or an entity type lower case. */
function target(selector: string): string | undefined {
    if (selector === '@p' || selector === '@s') return PLAYER;
    return /^@e\[type=(?:minecraft:)?(\w+)\]$/.exec(selector)?.[1]?.toLowerCase();
}

export class TeamTracker {
    private readonly version: string;
    private readonly playerName: string;
    private readonly rules = new Map<string, string>();
    private readonly held = new Map<string, { collisionRule: string }>();
    /** The members of each team: PLAYER, and entity types. */
    private readonly members = new Map<string, Set<string>>();

    constructor(header: RecordingHeader) {
        this.version = header.mc;
        this.playerName = header.player.name;
        for (const command of header.setup.commands as readonly string[]) {
            const added = /^(?:team|scoreboard teams) add (\S+)/.exec(command);
            if (added) this.add(added[1]!);
            const rule = /^(?:team modify|scoreboard teams option) (\S+) collisionRule (\S+)$/.exec(command);
            if (rule) this.rules.set(rule[1]!, ruleName(rule[2]));
            const joined = /^(?:team|scoreboard teams) join (\S+) (\S+)$/.exec(command);
            const member = joined && target(joined[2]!);
            if (member) this.members.get(joined[1]!)?.add(member);
        }
    }

    private add(team: string): void {
        this.rules.set(team, 'always');
        this.members.set(team, new Set());
    }

    /** ClientPacketListener.handleSetPlayerTeamPacket, as far as a push reads it. */
    packets(s2c: readonly { readonly name: string; readonly b: string }[]): void {
        for (const packet of s2c) {
            if (packet.name !== 'ClientboundSetPlayerTeamPacket' && packet.name !== 'S3EPacketTeams') continue;
            const { params } = decodeClientbound(this.version, packetBytes(packet.b));
            const team = String(params.team);
            // (a number, or its name where the protocol maps it)
            const mode = typeof params.mode === 'string' ? MODES.indexOf(params.mode) : Number(params.mode);
            if (mode === 0) this.add(team);
            if (mode === 1) {
                this.rules.delete(team);
                this.members.delete(team);
            }
            if ((mode === 0 || mode === 2) && params.collisionRule !== undefined) this.rules.set(team, ruleName(params.collisionRule));
            if (mode === 0 || mode === 3 || mode === 4) {
                for (const name of (params.players ?? []) as string[]) {
                    if (name !== this.playerName) continue;
                    if (mode === 4) this.members.get(team)?.delete(PLAYER);
                    else this.members.get(team)?.add(PLAYER);
                }
            }
        }
    }

    /** A team as bot.teamMap holds one, or none: one object for each team, so that allies compare equal. */
    private team(name: string | undefined): { collisionRule: string } | undefined {
        if (name === undefined) return undefined;
        let team = this.held.get(name);
        if (!team) this.held.set(name, team = { collisionRule: 'always' });
        team.collisionRule = this.rules.get(name) ?? 'always';
        return team;
    }
    teamOfPlayer(): { collisionRule: string } | undefined { return this.team(this.teamOf(PLAYER)); }
    teamOfType(type: string): { collisionRule: string } | undefined { return this.team(this.teamOf(type.toLowerCase().replace(/^minecraft:/, ''))); }

    /** Each team as a bot's scoreboard holds it: its rule, and its members, the player's name for itself. */
    teams(): { readonly team: string; readonly rule: string; readonly members: readonly string[] }[] {
        return [...this.members].map(([team, members]) => ({ team, rule: this.rules.get(team)!, members: [...members].map(member => (member === PLAYER ? this.playerName : member)) }));
    }

    private teamOf(member: string): string | undefined {
        for (const [team, members] of this.members) if (members.has(member)) return team;
        return undefined;
    }

    /** EntitySelector.pushableBy(entity).test(player) for the team rules (26.3 EntitySelector.java:39-70). */
    pushes(type: string): boolean {
        const own = this.teamOf(type.toLowerCase());
        const theirs = this.teamOf(PLAYER);
        const ownRule = own === undefined ? 'always' : this.rules.get(own)!;
        const theirRule = theirs === undefined ? 'always' : this.rules.get(theirs)!;
        if (ownRule === 'never' || theirRule === 'never') return false;
        const allied = own !== undefined && own === theirs;
        if ((ownRule === 'pushOwnTeam' || theirRule === 'pushOwnTeam') && allied) return false;
        return (ownRule !== 'pushOtherTeams' && theirRule !== 'pushOtherTeams') || allied;
    }
}
