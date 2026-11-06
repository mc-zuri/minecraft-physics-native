// The retained evidence of a difference found and fixed (recorder/evidence/*.json). A record says what was seen, how it can be
// seen again and what kind of evidence it is, and `verify` replays it on this build: a fixture that moved, a path that is
// gone or a fix that no longer holds is a failure.
//
//   node recorder/replay/evidence.ts [--record E-001]
//
// Each record's fixture is checked in with its checksum, or named by checksum and marked `planned` when it is too large to
// keep. A kind is never upgraded: a source reading stays a source reading however many tests repeat its formula.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { replayNative } from './engine.ts';
import { loadRecording } from './load.ts';
import { RECORDER_ROOT } from './recordings.ts';

/** executed-vanilla: a recording of the real client. formula-oracle: a vanilla class run on chosen inputs. source-derived: a reading of the source. */
export type EvidenceKind = 'executed-vanilla' | 'formula-oracle' | 'source-derived';

export interface EvidenceRecord {
    readonly id: string;
    readonly release: string;
    /** Side, entity and API entry the finding is about. */
    readonly scope: string;
    readonly summary: string;
    readonly kind: EvidenceKind;
    /** The recording, relative to recorder/evidence, and its bytes. */
    readonly fixture: { readonly path: string; readonly sha256: string; readonly planned?: boolean };
    /** Where the difference first showed, and the values before the fix: what no later run can produce again. */
    readonly firstDifference: { readonly tick: number; readonly phase: string; readonly field: string; readonly expected: unknown; readonly actual: unknown };
    /** Each source reference: a file with its release, as the record's reader can open it. */
    readonly source: readonly string[];
    /** The fix by its commit's subject: a rebase keeps a subject and moves a hash. */
    readonly fix: { readonly subject: string; readonly code: string };
    readonly regression: { readonly test: string };
    /** The replay that shows the fixed outcome. */
    readonly reproduce: { readonly phases: boolean; readonly command: string };
}

export const EVIDENCE_DIR = join(RECORDER_ROOT, 'evidence');
const KINDS: readonly string[] = ['executed-vanilla', 'formula-oracle', 'source-derived'];

export function readRecords(dir = EVIDENCE_DIR): EvidenceRecord[] {
    return readdirSync(dir).filter(name => name.endsWith('.json')).sort().map(name => JSON.parse(readFileSync(join(dir, name), 'utf8')) as EvidenceRecord);
}

/** What is wrong with a record, short of running it. */
export function checkRecord(record: EvidenceRecord, dir = EVIDENCE_DIR, repository = join(RECORDER_ROOT, '..')): string[] {
    const problems: string[] = [];
    const named = `${record.id}:`;
    if (!/^E-\d{3}$/.test(record.id)) problems.push(`${named} not an evidence id`);
    if (!KINDS.includes(record.kind)) problems.push(`${named} unknown kind ${record.kind}`);
    if (record.kind === 'executed-vanilla' && !record.fixture.path.endsWith('.jsonl.gz')) problems.push(`${named} executed vanilla with no recording`);
    if (record.source.length === 0) problems.push(`${named} no source reference`);
    const file = join(dir, record.fixture.path);
    if (!existsSync(file)) {
        if (!record.fixture.planned) problems.push(`${named} no fixture at ${record.fixture.path}, and it is not marked planned`);
    } else if (createHash('sha256').update(readFileSync(file)).digest('hex') !== record.fixture.sha256) {
        problems.push(`${named} the fixture's bytes changed`);
    }
    const [path] = record.regression.test.split('#');
    if (!existsSync(join(repository, path!))) problems.push(`${named} no regression at ${path}`);
    else if (!readFileSync(join(repository, path!), 'utf8').includes(record.regression.test.split('#')[1] ?? '')) problems.push(`${named} the regression ${record.regression.test} is gone`);
    if (!existsSync(join(repository, record.fix.code))) problems.push(`${named} no code at ${record.fix.code}`);
    return problems;
}

/** The record's replay on this build: the fixed outcome is that it matches. */
export function replayRecord(record: EvidenceRecord, dir = EVIDENCE_DIR): string[] {
    const result = replayNative(loadRecording(join(dir, record.fixture.path)), { phases: record.reproduce.phases });
    if (result.compared === 0) return [`${record.id}: nothing compared`];
    if (result.problems.length > 0) return [`${record.id}: ${result.problems[0]}`];
    return result.first ? [`${record.id}: differs at t=${result.first.tick} ${result.first.at} ${result.first.field}`] : [];
}

if (process.argv[1]?.endsWith('evidence.ts')) {
    const { values } = parseArgs({ options: { record: { type: 'string' } } });
    const records = readRecords().filter(r => !values.record || r.id === values.record);
    const problems = records.flatMap(record => {
        const found = checkRecord(record);
        return found.length > 0 ? found : replayRecord(record);
    });
    for (const problem of problems) console.log(problem);
    console.log(`${records.length} record(s), ${problems.length} problem(s)`);
    process.exitCode = problems.length > 0 || records.length === 0 ? 1 : 0;
}
