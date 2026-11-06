// The regression threshold of the replay: what a run may cost against its baseline. Kept apart from the profile so that the rule
// is tested without timing anything, on a machine whose load no test controls.

export interface ProfileBaseline { readonly perRow: number; readonly peakRssMb: number }

export interface ProfileBudget {
    /** How far over its baseline a run may go, as a share: time on a shared machine moves by more than memory does. */
    readonly allowance: { readonly perRow: number; readonly peakRssMb: number };
    /** A set of fixtures: its selection, as the profile takes it, and what it measured. */
    readonly sets: Readonly<Record<string, ProfileBaseline & { readonly version: string; readonly case: string; readonly measured: string }>>;
}

/** What a run spent over its set's budget; nothing when it is within it, and a set the file does not have is an error. */
export function overBudget(budget: ProfileBudget, set: string, run: ProfileBaseline): string[] {
    const base = budget.sets[set];
    if (!base) return [`no set ${set} in the budget`];
    const problems: string[] = [];
    const limit = (name: 'perRow' | 'peakRssMb') => base[name] * (1 + budget.allowance[name]);
    if (run.perRow > limit('perRow')) problems.push(`${set}: ${run.perRow.toFixed(3)} ms a row, past ${limit('perRow').toFixed(3)}`);
    if (run.peakRssMb > limit('peakRssMb')) problems.push(`${set}: ${run.peakRssMb.toFixed(0)} MB, past ${limit('peakRssMb').toFixed(0)}`);
    return problems;
}
