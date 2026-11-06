// JSON helpers that keep what JSON.stringify loses: -0, NaN and infinities are written in the
// recording's number rules ("-0.0"... see recording.ts), and object keys can be sorted for hashing.

/** A number as the recorder writes it: shortest round-trip form, -0 kept, non-finite as strings. */
export function numberText(value: number): string {
    if (Number.isNaN(value)) return '"NaN"';
    if (value === Infinity) return '"+Inf"';
    if (value === -Infinity) return '"-Inf"';
    if (Object.is(value, -0)) return '-0.0';
    return String(value);
}

/** Reads a number written by numberText or by the mod back (strings for non-finite values). */
export function readNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (value === 'NaN') return NaN;
    if (value === '+Inf') return Infinity;
    if (value === '-Inf') return -Infinity;
    throw new TypeError(`not a recorded number: ${JSON.stringify(value)}`);
}

function write(value: unknown, sortKeys: boolean): string {
    if (typeof value === 'number') return numberText(value);
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(v => write(v === undefined ? null : v, sortKeys)).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (sortKeys) entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${write(v, sortKeys)}`).join(',')}}`;
}

/** JSON with the recording's number rules. */
export function writeJson(value: unknown): string {
    return write(value, false);
}

/** JSON with sorted keys and the recording's number rules, for hashing. */
export function stableStringify(value: unknown): string {
    return write(value, true);
}
