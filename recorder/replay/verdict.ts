// What a replay of one recording comes to. Only `pass` says the engine matched vanilla: what was not compared is never
// counted as matching, and an engine difference someone has explained is still a difference.

import { signature, type KnownFailure } from './recordings.ts';
import type { ReplayResult } from './engine.ts';

/**
 * - pass: compared, and the same on every tick;
 * - known: differs just as known-failures.json says;
 * - unsupported: every tick is one the engine has no model for (a vehicle it does not simulate or that the server drives);
 * - untested: no tick to compare at all;
 * - fail: anything else, which includes a known failure that no longer shows as listed.
 */
export type Verdict = 'pass' | 'known' | 'unsupported' | 'untested' | 'fail';

export function verdict(result: Pick<ReplayResult, 'problems' | 'compared' | 'unmodelled' | 'interpolated' | 'first' | 'results'>, expected: KnownFailure | undefined): Verdict {
    if (result.problems.length > 0) return 'fail';
    if (result.compared === 0) {
        if (expected) return 'fail';
        return result.unmodelled > 0 || result.interpolated > 0 ? 'unsupported' : 'untested';
    }
    if (!result.first) return expected ? 'fail' : 'pass';
    const same = expected && expected.field === result.first.field && expected.tick === result.first.tick
        && JSON.stringify(signature(result.results)) === JSON.stringify(expected.fields);
    return same ? 'known' : 'fail';
}

export type Tally = Record<Verdict, number>;

export const emptyTally = (): Tally => ({ pass: 0, known: 0, unsupported: 0, untested: 0, fail: 0 });

/** A selection succeeds on what it did compare: a failure, or nothing compared at all, is no success. */
export const tallyFails = (tally: Tally) => tally.fail > 0 || tally.pass + tally.known === 0;

export const describeTally = (tally: Tally) => `${tally.pass} matching, ${tally.known} known, ${tally.unsupported} unsupported, ${tally.untested} untested, ${tally.fail} unexpected`;
