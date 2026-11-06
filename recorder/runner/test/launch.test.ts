// A launch that cannot be the one this run asks for fails before any client starts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchProblem, staleLaunch, type Launch } from '../launch.ts';

function inDir(run: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'launch with spaces-'));
    try {
        run(dir);
    } finally {
        rmSync(dir, { recursive: true });
    }
}

const touched = (file: string, seconds: number) => {
    writeFileSync(file, '');
    utimesSync(file, seconds, seconds);
    return file;
};

test('a launch is for this release, with its java and every classpath entry there', () => {
    inDir(dir => {
        const launch: Launch = { version: '26.3', java: touched(join(dir, 'java'), 1), workingDir: dir, jvmArgs: [], classpath: [touched(join(dir, 'a.jar'), 1)], mainClass: 'M', args: [] };
        assert.equal(launchProblem(launch, '26.3'), null);
        assert.match(launchProblem(launch, '1.20.4')!, /for 26.3, this run for 1.20.4/);
        assert.match(launchProblem({ ...launch, java: join(dir, 'gone') }, '26.3')!, /no java/);
        assert.match(launchProblem({ ...launch, classpath: [] }, '26.3')!, /no classpath/);
        assert.match(launchProblem({ ...launch, classpath: [...launch.classpath, join(dir, 'b.jar')] }, '26.3')!, /1 of the classpath's entries are gone, the first .*b\.jar/);
    });
});

test('a source newer than the launch makes it stale, in any root and at any depth', () => {
    inDir(dir => {
        const launch = touched(join(dir, 'recorder-launch.json'), 1000);
        const root = join(dir, 'src', 'deep');
        mkdirSync(root, { recursive: true });
        const source = touched(join(root, 'A.java'), 900);
        assert.equal(staleLaunch(launch, [join(dir, 'src'), join(dir, 'no such root')]), null);
        utimesSync(source, 1100, 1100);
        assert.match(staleLaunch(launch, [join(dir, 'no such root'), join(dir, 'src')])!, /A\.java is newer than the launch/);
    });
});
