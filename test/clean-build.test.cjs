'use strict';

// What stops a clean build before it claims anything: a missing or wrong-release source, a table kept from an earlier run
// without saying so, and two runs that are not one release.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { describe, it, before, after } = require('node:test');
const { inputProblems } = require('../scripts/bootstrap-inputs.cjs');
const { comparisonProblems } = require('../scripts/compare-builds.cjs');
const { MINECRAFT_DATA } = require('../scripts/source-pins.cjs');
const { patchedLoader, patchedNoThreadsLoader } = require('../scripts/patch-wasi-loader.cjs');

const root = path.resolve(__dirname, '..');

/** A legacy tree that embeds `embedded`, as 1.8 - 1.13 do. */
function legacyTree(parent, folder, embedded) {
    const realms = path.join(parent, folder, 'net', 'minecraft', 'realms');
    fs.mkdirSync(realms, { recursive: true });
    fs.writeFileSync(path.join(realms, 'RealmsSharedConstants.java'), `class RealmsSharedConstants {\n    public static String VERSION_STRING = "${embedded}";\n}\n`);
}

describe('the inputs of a clean build', () => {
    let directory;
    let repository;
    let data;
    const legacy = [{ version: '1.8.8', source: '1.8.9' }, { version: '1.12.2', source: '1.12.2' }];
    const problemsWith = legacyRoot => inputProblems({ modern: [], jars: [], legacy, trees: [], legacyRoot, data, repository });

    before(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-physics-inputs-'));
        repository = path.join(directory, 'repository');
        fs.mkdirSync(repository);
        data = path.join(directory, 'minecraft-data');
        fs.mkdirSync(data);
        fs.writeFileSync(path.join(data, 'package.json'), '{}');
        spawnSync('git', ['init', '-q', data]);
    });
    after(() => fs.rmSync(directory, { recursive: true, force: true }));

    it('names a release with no source', () => {
        const empty = path.join(directory, 'empty');
        fs.mkdirSync(empty);
        const problems = problemsWith(empty).join('\n');
        assert.match(problems, /1\.8\.8: no legacy source tree 1\.8\.9/);
        assert.match(problems, /1\.12\.2: no legacy source tree 1\.12\.2/);
    });

    it('refuses a tree that is another release, whatever its folder says', () => {
        const trees = path.join(directory, 'wrong');
        legacyTree(trees, '1.8.9', '1.8.9');
        legacyTree(trees, '1.12.2', '1.12.1');
        const problems = problemsWith(trees);
        assert.match(problems.join('\n'), /1\.12\.2: the tree 1\.12\.2 embeds 1\.12\.1, a wrong-release source/);
        assert.doesNotMatch(problems.join('\n'), /1\.8\.8/);
    });

    it('holds minecraft-data to its pin, and refuses a missing repository', () => {
        const trees = path.join(directory, 'right');
        legacyTree(trees, '1.8.9', '1.8.9');
        legacyTree(trees, '1.12.2', '1.12.2');
        assert.match(problemsWith(trees).join('\n'), new RegExp(`pinned ${MINECRAFT_DATA.commit}`));
        const gone = inputProblems({ modern: [], jars: [], legacy, trees: [], legacyRoot: trees, data: path.join(directory, 'absent'), repository: path.join(directory, 'absent') }).join('\n');
        assert.match(gone, /no minecraft-data at/);
        assert.match(gone, /no extracted data repository at/);
    });

    it('needs minecraft-data built, not only cloned', () => {
        const pinned = path.join(directory, 'pinned');
        fs.mkdirSync(pinned);
        fs.writeFileSync(path.join(pinned, 'package.json'), '{}');
        const git = (...args) => spawnSync('git', ['-C', pinned, ...args], { encoding: 'utf8' });
        git('init', '-q');
        const head = () => git('rev-parse', 'HEAD').stdout.trim();
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.');
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x');
        const problems = () => inputProblems({ modern: [], jars: [], legacy: [], trees: [], data: pinned, repository, pin: head() });
        assert.match(problems().join('\n'), /is not built: run scripts\/bootstrap-inputs\.cjs/);
        fs.writeFileSync(path.join(pinned, 'data.js'), '');
        assert.deepEqual(problems(), []);
    });

    it('needs the trees generators prefer, since their absence changes the output without an error', () => {
        const trees = path.join(directory, 'modern');
        legacyTree(trees, '1.19', '1.19.1');
        const problems = inputProblems({ modern: [], jars: [], legacy: [], trees: ['1.19', '1.20'], legacyRoot: trees, data, repository }).join('\n');
        assert.match(problems, /the tree 1\.19 embeds 1\.19\.1, a wrong-release source/);
        assert.match(problems, /no tree 1\.20 under MC_DECOMPILED_ROOT/);
    });

    it('names a release whose jar is not at hand', () => {
        const before_ = process.env.MC_CLIENT_JAR_ROOT;
        process.env.MC_CLIENT_JAR_ROOT = path.join(directory, 'no-jars');
        try {
            assert.match(inputProblems({ modern: [], legacy: [], trees: [], jars: ['1.20.4'], data, repository }).join('\n'), /1\.20\.4: no pinned jar to run/);
        } finally {
            if (before_ === undefined) delete process.env.MC_CLIENT_JAR_ROOT;
            else process.env.MC_CLIENT_JAR_ROOT = before_;
        }
    });

    it('keeps a legacy table only when the run says so', () => {
        const output = path.join(directory, 'legacy-release-data.json');
        fs.copyFileSync(path.join(root, 'generated', 'legacy-release-data.json'), output);
        const before_ = fs.readFileSync(output);
        const empty = path.join(directory, 'nothing');
        fs.mkdirSync(empty);
        const env = { ...process.env, MC_DECOMPILED_ROOT: empty, MC_LEGACY_RELEASE_MANIFEST: output };
        const script = path.join(root, 'scripts', 'generate-legacy-release-manifest.cjs');
        const refused = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
        assert.notEqual(refused.status, 0);
        assert.match(refused.stderr, /Missing legacy source tree for 1\.8\.8/);
        assert.equal(spawnSync(process.execPath, [script, '--cached'], { env }).status, 0);
        assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')).releases['1.8.8'], JSON.parse(before_.toString()).releases['1.8.8']);
    });
});

describe('the threaded browser loader', () => {
    const worker = "      const worker = new Worker(url)\n      __wasiWorkers.add(worker)\n      return worker\n";

    it('says when a worker fails, once however often it is patched', () => {
        const patched = patchedLoader(worker);
        assert.match(patched, /worker\.addEventListener\('error'/);
        assert.equal(patchedLoader(patched), patched);
        assert.equal(patchedLoader(worker.replaceAll('\n', '\r\n')), patched);
    });

    it('refuses a loader it does not know', () => {
        assert.throws(() => patchedLoader('new Worker(url)'), /no longer starts its workers/);
        assert.throws(() => patchedNoThreadsLoader('fetch(url)'), /no longer instantiates its module/);
    });

    it('instantiates the no-threads module asynchronously, which browsers need above 8 MB', () => {
        const loader = '  instantiateNapiModuleSync as __emnapiInstantiateNapiModuleSync,\n} = __emnapiInstantiateNapiModuleSync(__wasmFile, {\n';
        const patched = patchedNoThreadsLoader(loader);
        assert.equal(patched, '  instantiateNapiModule as __emnapiInstantiateNapiModule,\n} = await __emnapiInstantiateNapiModule(__wasmFile, {\n');
        assert.equal(patchedNoThreadsLoader(patched), patched);
    });
});

describe('the reproducibility policy', () => {
    const record = (overrides = {}) => ({
        target: 'x86_64-unknown-linux-gnu', dataGeneration: 'full', inputs: { sourceHash: 's', generatedHash: 'g' },
        toolchain: { rustc: 'r', cargo: 'c', napiCli: 'n', typescript: 't' }, files: { 'native/artifacts/index.linux-x64-gnu.node': 'a', 'dist/index.js': 'b' }, ...overrides,
    });

    it('takes two equal builds of a target', () => assert.deepEqual(comparisonProblems(record(), record()), []));

    it('refuses a binary that differs between builds of one target', () => {
        const other = record({ files: { 'native/artifacts/index.linux-x64-gnu.node': 'x', 'dist/index.js': 'b' } });
        assert.match(comparisonProblems(record(), other).join(), /index\.linux-x64-gnu\.node differs between two builds/);
    });

    it('refuses other tables or another toolchain', () => {
        assert.match(comparisonProblems(record(), record({ inputs: { sourceHash: 's', generatedHash: 'h' } })).join(), /inputs\.generatedHash differs/);
        assert.match(comparisonProblems(record(), record({ toolchain: { ...record().toolchain, rustc: 'other' } })).join(), /toolchain\.rustc differs/);
    });

    it('holds different targets to their inputs alone', () => {
        const windows = record({ target: 'x86_64-pc-windows-msvc', dataGeneration: 'tracked', toolchain: { rustc: 'r' }, files: { other: 'z' } });
        assert.deepEqual(comparisonProblems(record(), windows), []);
        assert.match(comparisonProblems(record(), { ...windows, inputs: { sourceHash: 'other', generatedHash: 'g' } }).join(), /inputs\.sourceHash differs/);
    });
});
