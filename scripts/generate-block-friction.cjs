// Writes generated/block-friction.json: for every registered release, the friction of its blocks out of its own
// block registry source. Each release takes the first of MC_SOURCE_ROOT (26.2, 26.3), its pinned client's decompile
// under MC_SOURCE_CACHE, MC_DECOMPILED_ROOT and the origin/client<release> branch of MC_DATA_REPO; a release with
// none is listed as unverified, and its previous entry stays. A source that does not resolve fails the run (scripts/block-friction.cjs).
// Pass --check to compare instead of writing: it fails when the output differs.

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { registeredReleases } = require("./registered-releases.cjs");
const { PINNED_CLIENTS, sourceCache } = require("./source-pins.cjs");
const { directoryIdentity } = require("./source-identity.cjs");
const {
  parseDefaultFriction, parseRegistryFriction, parseLegacyFriction, parseLegacyClass, sha256,
} = require("./block-friction.cjs");

const repositoryRoot = path.resolve(__dirname, "..");
const outputPath = path.join(repositoryRoot, "generated", "block-friction.json");
const sourceRoot = process.env.MC_SOURCE_ROOT ?? path.join(repositoryRoot, "..", "..", "pr", "mc-source");
const decompiledRoot = process.env.MC_DECOMPILED_ROOT ?? path.join(repositoryRoot, "..", "..", "pr", "mc-decompiled");
const dataRepository = process.env.MC_DATA_REPO ?? "D:/projects/mc-zuri/mc-data/extracted_minecraft_data";

// a registered release read from another's source: exact 1.8.8 is unavailable (VERSION-REFERENCES.md)
const STAND_INS = { "1.8.8": "1.8.9" };
// a branch that is not its release: origin/client1.16.4 embeds 20w45a (VERSION-REFERENCES.md)
const REJECTED = new Set(["1.16.4"]);

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined);

function directoryTree(root, identity, label) {
  const files = (relative) => read(path.join(root, relative));
  const list = (relative) => {
    const directory = path.join(root, relative);
    return fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => name.endsWith(".java")).map((name) => path.join(relative, name)) : [];
  };
  // (git grep on the plain files: a tree holds a thousand of them)
  const grep = (pattern, relative) => {
    const directory = path.join(root, relative);
    if (!fs.existsSync(directory)) return [];
    const found = childProcess.spawnSync("git", ["grep", "--no-index", "-l", "-E", pattern, "--", "."], { cwd: directory, encoding: "utf8", maxBuffer: 1 << 26 });
    if (found.status !== 0 && found.status !== 1) throw new Error(`${label}: git grep failed: ${found.stderr}`);
    return found.stdout.split("\n").filter(Boolean).map((name) => path.join(relative, name));
  };
  return { identity, label, root, read: files, list, grep };
}

function gitTree(release) {
  const ref = `origin/client${release}`;
  const git = (...args) => childProcess.execFileSync("git", ["-C", dataRepository, ...args], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
  let commit;
  try {
    commit = git("rev-parse", ref).trim();
  } catch {
    return undefined;
  }
  return {
    identity: `${ref} ${commit}`,
    label: `git ${ref}`,
    read: (relative) => {
      try {
        return git("show", `${commit}:client/${relative.replaceAll("\\", "/")}`);
      } catch {
        return undefined;
      }
    },
    list: (relative) => git("ls-tree", "--name-only", `${commit}:client/${relative.replaceAll("\\", "/")}`).split("\n").filter((name) => name.endsWith(".java")).map((name) => path.join(relative, name)),
    grep: (pattern, relative) => {
      const found = childProcess.spawnSync("git", ["-C", dataRepository, "grep", "-l", "-E", pattern, commit, "--", `client/${relative.replaceAll("\\", "/")}`], { encoding: "utf8", maxBuffer: 1 << 26 });
      if (found.status !== 0 && found.status !== 1) throw new Error(`git ${ref}: git grep failed: ${found.stderr}`);
      return found.stdout.split("\n").filter(Boolean).map((name) => name.slice(`${commit}:client/`.length));
    },
  };
}

function treeOf(release) {
  const source = path.join(sourceRoot, release, "client");
  if (fs.existsSync(path.join(source, "net", "minecraft"))) return directoryTree(source, `mc-source ${release}`, `mc-source/${release}/client`);
  const pinned = path.join(sourceCache(), release);
  if (PINNED_CLIENTS[release] && fs.existsSync(path.join(pinned, "client", "net", "minecraft")) && directoryIdentity(pinned) === release) {
    return directoryTree(path.join(pinned, "client"), `client ${PINNED_CLIENTS[release].client}`, `client/${release}`);
  }
  if (REJECTED.has(release)) return undefined;
  const name = STAND_INS[release] ?? release;
  const decompiled = path.join(decompiledRoot, name);
  if (fs.existsSync(path.join(decompiled, "net", "minecraft"))) return directoryTree(decompiled, `mc-decompiled ${name}`, `mc-decompiled/${name}`);
  return gitTree(release);
}

const MOJANG = path.join("net", "minecraft", "world", "level", "block");
const YARN = path.join("net", "minecraft", "block");

/** The blocks' friction in a tree: which file registers them and where the default is. */
function frictionOf(tree, release) {
  const family = tree.read(path.join(MOJANG, "Blocks.java")) != null ? MOJANG : YARN;
  const blocks = tree.read(path.join(family, "Blocks.java"));
  if (blocks == null) throw new Error(`${release}: ${tree.label} has no Blocks.java`);
  const blockSource = tree.read(path.join(family, "Block.java"));
  if (blockSource == null) throw new Error(`${release}: ${tree.label} has no Block.java`);
  const statedefault = tree.read(path.join(family, "state", "BlockBehaviour.java")) ?? tree.read(path.join(family, "AbstractBlock.java"));
  const defaultFriction = parseDefaultFriction(`${blockSource}\n${statedefault ?? ""}`, `${release} default`);

  // an override of the getter takes the block out of what the registry says
  const overrides = tree.grep("float +get(Friction|Slipperiness) *\\(", family).filter((file) => !/[\\/](Block|AbstractBlock|BlockBehaviour)\.java$/.test(file));
  if (overrides.length > 0) throw new Error(`${release}: ${overrides.join(", ")} override the friction`);

  const legacy = /\bregister\s*\(\s*\d+\s*,\s*"/.test(blockSource);
  const registry = legacy ? blockSource : /\.(friction|slipperiness)\(/.test(blocks) ? blocks : blockSource;
  let frictions;
  if (legacy) {
    // the classes that set it, and down the classes that extend them
    const classes = {};
    let found = tree.grep("this\.slipperiness *=", family);
    while (found.length > 0) {
      for (const file of found) {
        const parsed = parseLegacyClass(tree.read(file) ?? "");
        if (parsed) classes[parsed.name] = parsed;
      }
      const names = Object.keys(classes).join("|");
      found = tree.grep(`class +[A-Za-z0-9_]+ +extends +(${names})( |$)`, family).filter((file) => !classes[path.basename(file, ".java")]);
    }
    const declared = new Set(tree.list(family).map((file) => path.basename(file, ".java")));
    declared.add("Block");
    frictions = parseLegacyFriction(registry, classes, (name) => declared.has(name), release);
  } else {
    frictions = parseRegistryFriction(registry, release);
  }
  return {
    source: tree.identity,
    file: path.join(family, registry === blocks ? "Blocks.java" : "Block.java").replaceAll("\\", "/"),
    sha256: sha256(registry.replaceAll("\r\n", "\n")),
    default: defaultFriction,
    frictions,
  };
}

function generate() {
  const previous = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, "utf8")).releases ?? {} : {};
  const releases = {};
  const unverified = [];
  for (const { version } of registeredReleases()) {
    const tree = treeOf(version);
    if (tree) {
      releases[version] = frictionOf(tree, version);
    } else if (previous[version] && !REJECTED.has(version)) {
      releases[version] = previous[version];
    } else {
      unverified.push(version);
    }
  }
  return { schema: 1, generatedBy: "scripts/generate-block-friction.cjs", standIns: STAND_INS, unverified, releases };
}

function main() {
  const output = `${JSON.stringify(generate(), null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (read(outputPath)?.replaceAll("\r\n", "\n") !== output) throw new Error(`${outputPath} is out of date`);
    return;
  }
  fs.writeFileSync(outputPath, output);
}

if (require.main === module) main();

module.exports = { frictionOf, treeOf };
