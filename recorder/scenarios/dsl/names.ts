// Name and version helpers shared by the DSL, the build and the generators.

/** "JumpBoost" / "jumpBoost" -> "jump_boost". */
export function snake(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** Releases minecraft-data files under another release: the one whose protocol and registries they really have. */
export const SAME_DATA: Readonly<Record<string, string>> = { '1.19.1': '1.19.2', '1.21.2': '1.21.3', '1.21.7': '1.21.8', '1.21.10': '1.21.9', '26.1.1': '26.1', '26.1.2': '26.1' };

/** Compares release names numerically ("1.20.4" < "1.20.10" < "26.1"). */
export function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0) return d;
    }
    return 0;
}

export function versionAtLeast(version: string, min: string): boolean {
    return compareVersions(version, min) >= 0;
}

/**
 * Whether `version` is in `range`: space-separated comparators that must all hold
 * (">=1.19.4 <1.21"), or "*" / undefined for every release.
 */
export function inRange(version: string, range: string | undefined): boolean {
    if (!range || range.trim() === '*') return true;
    return range.trim().split(/\s+/).every(part => {
        const match = /^(>=|<=|>|<|=)?(\d+(?:\.\d+)*)$/.exec(part);
        if (!match) throw new Error(`bad version range "${range}"`);
        const d = compareVersions(version, match[2]!);
        switch (match[1] ?? '=') {
            case '>=': return d >= 0;
            case '<=': return d <= 0;
            case '>': return d > 0;
            case '<': return d < 0;
            default: return d === 0;
        }
    });
}
