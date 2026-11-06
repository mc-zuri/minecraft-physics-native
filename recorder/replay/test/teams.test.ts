// The teams of a case's setup, which the rows do not say.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RecordingHeader } from '../../schema/recording.ts';
import { TeamTracker } from '../teams.ts';

const header = (commands: string[]) => ({ mc: '26.3', player: { name: 'Dev' }, setup: { commands } }) as unknown as RecordingHeader;
const made = (rule: string, ...joins: string[]) => new TeamTracker(header(['team add push', `team modify push collisionRule ${rule}`, ...joins.map(j => `team join push ${j}`)]));

test('the setup\'s collision rule decides who pushes the player (EntitySelector.pushableBy)', () => {
    const cases: [string, string[], boolean][] = [
        ['never', ['@p', '@e[type=cow]'], false],
        ['never', ['@p'], false],
        ['never', ['@e[type=cow]'], false],
        ['pushOwnTeam', ['@p', '@e[type=cow]'], false],
        ['pushOwnTeam', ['@p'], true],
        ['pushOwnTeam', ['@e[type=cow]'], true],
        ['pushOtherTeams', ['@p', '@e[type=cow]'], true],
        ['pushOtherTeams', ['@p'], false],
        ['pushOtherTeams', ['@e[type=cow]'], false],
        ['always', ['@p', '@e[type=cow]'], true],
    ];
    for (const [rule, joins, pushes] of cases) assert.equal(made(rule, ...joins).pushes('cow'), pushes, `${rule} ${joins}`);
    assert.equal(made('never', '@e[type=cow]').pushes('pig'), true);
});

test('the commands before 1.13 say the same', () => {
    const old = new TeamTracker(header(['scoreboard teams add push', 'scoreboard teams option push collisionRule never', 'scoreboard teams join push @p']));
    assert.equal(old.pushes('cow'), false);
});

test('no team, no rule', () => {
    assert.equal(new TeamTracker(header([])).pushes('cow'), true);
});
