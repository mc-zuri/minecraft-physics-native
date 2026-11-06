// A build's identity is its content: the same inputs agree wherever they are installed, and a changed input is named.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adapterChain, type Launch } from '../launch.ts';
import { buildManifest, checkoutIdentity, identityChanges, jdkIdentity, treeDigest } from '../provenance.ts';

/** A small install, in a folder with spaces in its path: the adapter 26.3 on 26.2, a classes folder, a jar. */
function install(root: string): { launch: Launch; recorderRoot: string; modRoot: string; scenariosDir: string; jdk: string } {
    const recorderRoot = join(root, 'a recorder');
    const modRoot = join(recorderRoot, 'mod');
    const write = (file: string, text: string) => {
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, text);
    };
    write(join(modRoot, 'common', 'src', 'A.java'), 'class A {}');
    write(join(modRoot, 'mc', '26.3', 'src', 'B.java'), 'class B {}');
    write(join(modRoot, 'mc', '26.3', 'base'), '26.2\n-removed/Thing.java\n');
    write(join(modRoot, 'mc', '26.2', 'src', 'C.java'), 'class C {}');
    write(join(modRoot, 'build.gradle'), 'allprojects {}');
    write(join(modRoot, 'mc', '26.3', 'build', 'classes', 'B.class'), 'classes');
    write(join(recorderRoot, 'schema', 'fields.ts'), 'fields');
    write(join(recorderRoot, 'schema', 'test', 'fields.test.ts'), 'a test');
    write(join(recorderRoot, 'scenarios', 'cases', 'walk.ts'), 'walk');
    write(join(recorderRoot, 'scenarios', 'dsl', 'core.ts'), 'core');
    write(join(recorderRoot, 'package.json'), '{}');
    write(join(recorderRoot, 'node_modules', 'minecraft-data', 'package.json'), '{"version":"3.0.0","main":"index.js"}');
    write(join(recorderRoot, 'node_modules', 'minecraft-data', 'index.js'), '');
    write(join(recorderRoot, 'node_modules', 'minecraft-protocol', 'package.json'), '{"version":"1.0.0","main":"index.js"}');
    write(join(recorderRoot, 'node_modules', 'minecraft-protocol', 'index.js'), '');
    const scenariosDir = join(recorderRoot, 'out', 'scenarios', '26.3');
    write(join(scenariosDir, 'index.json'), '{"scenarios":[]}');
    const gameJar = join(root, 'libraries', 'minecraft.jar');
    write(gameJar, 'the game');
    const launch: Launch = {
        version: '26.3', java: 'java', workingDir: join(modRoot, 'mc', '26.3', 'run'),
        jvmArgs: [`-Dfabric.classPathGroups=${join(modRoot, 'mc', '26.3', 'build', 'classes')}`, '-Drecorder.out=somewhere'],
        classpath: [join(modRoot, 'mc', '26.3', 'build', 'classes'), gameJar], mainClass: 'Knot', args: ['--gameDir', join(modRoot, 'mc', '26.3', 'run')],
    };
    return { launch, recorderRoot, modRoot, scenariosDir, jdk: 'java version "21.0.11"' };
}

function twoInstalls(run: (a: ReturnType<typeof install>, b: ReturnType<typeof install>) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'identity with spaces '));
    try {
        run(install(join(dir, 'first')), install(join(dir, 'moved elsewhere', 'second')));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('the same content is the same build wherever it is installed', () => {
    twoInstalls((a, b) => {
        const x = buildManifest(a).identity;
        const y = buildManifest(b).identity;
        assert.deepEqual({ ...x, commit: '', dirty: '' }, { ...y, commit: '', dirty: '' });
        assert.deepEqual(identityChanges(x, y), []);
    });
});

test('what a file was touched at, the checkout it is in and the recorder properties are not the build', () => {
    twoInstalls((a, b) => {
        utimesSync(join(b.modRoot, 'mc', '26.2', 'src', 'C.java'), 1000, 1000);
        const launch = { ...b.launch, jvmArgs: [...b.launch.jvmArgs, '-Drecorder.shard=3'] };
        assert.equal(buildManifest(a).identity.id, buildManifest({ ...b, launch }).identity.id);
    });
});

test('a changed input changes the id and is named', () => {
    const changed = (change: (b: ReturnType<typeof install>) => ReturnType<typeof install> | void): string[] => {
        let names: string[] = [];
        twoInstalls((a, b) => {
            names = identityChanges(buildManifest(a).identity, buildManifest(change(b) ?? b).identity);
        });
        return names;
    };
    assert.deepEqual(changed(b => writeFileSync(b.launch.classpath[1]!, 'another game')), ['libraries']);
    assert.deepEqual(changed(b => writeFileSync(join(b.modRoot, 'mc', '26.3', 'build', 'classes', 'B.class'), 'other classes')), ['mod']);
    // (an adapter between the release and the base of the chain, which a build copies in)
    assert.deepEqual(changed(b => writeFileSync(join(b.modRoot, 'mc', '26.2', 'src', 'C.java'), 'class C { int x; }')), ['sources']);
    assert.deepEqual(changed(b => writeFileSync(join(b.recorderRoot, 'schema', 'fields.ts'), 'other fields')), ['schema']);
    assert.deepEqual(changed(b => writeFileSync(join(b.recorderRoot, 'scenarios', 'cases', 'walk.ts'), 'run')), ['scenarioSources']);
    assert.deepEqual(changed(b => writeFileSync(join(b.scenariosDir, 'index.json'), '{"scenarios":[1]}')), ['scenarios']);
    assert.deepEqual(changed(b => ({ ...b, jdk: 'java version "25"' })), ['jdk']);
    assert.deepEqual(changed(b => ({ ...b, launch: { ...b.launch, mainClass: 'Other' } })), ['launch']);
    assert.deepEqual(changed(b => writeFileSync(join(b.recorderRoot, 'node_modules', 'minecraft-data', 'package.json'), '{"version":"3.1.0","main":"index.js"}')), ['codec']);
});

test('a test under schema is not the schema', () => {
    twoInstalls((a, b) => {
        writeFileSync(join(b.recorderRoot, 'schema', 'test', 'fields.test.ts'), 'another test');
        assert.equal(buildManifest(a).identity.id, buildManifest(b).identity.id);
    });
});

test('the chain of a release ends at the adapter with no base, and a loop is refused', () => {
    twoInstalls((_, b) => {
        assert.deepEqual(adapterChain(b.modRoot, '26.3'), [join(b.modRoot, 'mc', '26.3'), join(b.modRoot, 'mc', '26.2')]);
        writeFileSync(join(b.modRoot, 'mc', '26.2', 'base'), '26.3\n');
        assert.throws(() => adapterChain(b.modRoot, '26.3'), /go round/);
    });
});

test('a folder is its relative paths and bytes', () => {
    twoInstalls((a, b) => {
        const left = join(a.modRoot, 'common');
        const right = join(b.modRoot, 'common copy');
        cpSync(left, right, { recursive: true });
        assert.equal(treeDigest(left), treeDigest(right));
        writeFileSync(join(right, 'src', 'B.java'), '');
        assert.notEqual(treeDigest(left), treeDigest(right));
    });
});

test('the JDK says what it is, and one that cannot is an error', () => {
    assert.throws(() => jdkIdentity(join(tmpdir(), 'no such java')), /-version failed/);
});

test('outside a checkout the commit is unknown, and says so', () => {
    const dir = mkdtempSync(join(tmpdir(), 'no checkout '));
    try {
        assert.deepEqual(checkoutIdentity(dir), { commit: 'unknown', dirty: 'unknown' });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
