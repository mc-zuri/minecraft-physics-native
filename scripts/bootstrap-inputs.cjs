// What a clean host needs before it may regenerate anything, checked before anything is generated:
// every release's exact source, under the name it embeds, and the pinned minecraft-data beside the
// checkout (pnpm-workspace.yaml links ../minecraft-data).
//   node scripts/bootstrap-inputs.cjs            clones minecraft-data at its pin when absent, then checks
//   node scripts/bootstrap-inputs.cjs --check    only checks
//   --cached                                     leaves out the jars, for a --data cached build
// The locations are explicit: MC_SOURCE_ROOT, MC_SOURCE_CACHE, MC_DECOMPILED_ROOT,
// MC_EXTRACTED_DATA_REPO, MC_DATA_REPO (docs/release-build.md). A release that cannot be proved is an
// error naming it; a neighbouring release never stands in.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { directoryIdentity } = require("./source-identity.cjs");
const { LEGACY_RELEASES } = require("./legacy-release-data.cjs");
const { MINECRAFT_DATA, extractedRepo } = require("./source-pins.cjs");

const repositoryRoot = path.resolve(__dirname, "..");
const dataCheckout = () => process.env.MC_MINECRAFT_DATA ?? path.join(repositoryRoot, "..", "minecraft-data");
const decompiledRoot = () => process.env.MC_DECOMPILED_ROOT ?? path.join(repositoryRoot, "..", "..", "pr", "mc-decompiled");

// The modern Yarn-named trees of MC_DECOMPILED_ROOT. Generators prefer one where it exists (the friction
// of a release, a 1.14 table's shapes), so a tree that is merely absent changes the output without an
// error: a run needs all of them.
const MODERN_TREES = ["1.14", "1.15", "1.16", "1.16.5", "1.17", "1.18", "1.19", "1.19.2", "1.19.3", "1.19.4", "1.20", "1.20.2", "1.20.4", "1.20.5",
  "1.21", "1.21.3", "1.21.4", "1.21.5", "1.21.6", "1.21.7", "1.21.8", "1.21.9", "1.21.10", "1.21.11"];

const head = (directory) => spawnSync("git", ["-C", directory, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim();

/** The index minecraft-data's own `prepare` writes, which its commit does not hold. */
function buildMinecraftData(target = dataCheckout()) {
  execFileSync(process.execPath, [path.join(target, "bin", "generate_data.js")], { cwd: target, stdio: "inherit" });
}

/** minecraft-data at its pin, submodule included and built, cloned beside the checkout. */
function cloneMinecraftData(target = dataCheckout()) {
  execFileSync("git", ["clone", "--no-checkout", MINECRAFT_DATA.repository, target], { stdio: "inherit" });
  execFileSync("git", ["-C", target, "checkout", "--detach", MINECRAFT_DATA.commit], { stdio: "inherit" });
  execFileSync("git", ["-C", target, "submodule", "update", "--init", "--depth", "1"], { stdio: "inherit" });
  buildMinecraftData(target);
}

/** Everything in the way of a source-backed run: each entry names a release or an input. */
function inputProblems({ modern = null, legacy = LEGACY_RELEASES, trees = MODERN_TREES, legacyRoot = decompiledRoot(), data = dataCheckout(), repository = extractedRepo(), pin = MINECRAFT_DATA.commit, jars = null } = {}) {
  const { modernTree, manifest } = require("./source-roots.cjs");
  const problems = [];
  for (const version of modern ?? manifest.versions) {
    if (!modernTree(version)) problems.push(`${version}: no exact source. Set MC_SOURCE_ROOT or MC_SOURCE_CACHE, or run scripts/materialize-sources.cjs ${version}`);
  }
  for (const { version, source } of legacy) {
    const tree = path.join(legacyRoot, source);
    if (!fs.existsSync(path.join(tree, "net", "minecraft"))) {
      problems.push(`${version}: no legacy source tree ${source} under MC_DECOMPILED_ROOT (${legacyRoot})`);
      continue;
    }
    const embedded = directoryIdentity(tree);
    if (embedded !== source) problems.push(`${version}: the tree ${source} embeds ${embedded}, a wrong-release source`);
  }
  for (const name of trees) {
    const tree = path.join(legacyRoot, name);
    if (!fs.existsSync(path.join(tree, "net", "minecraft"))) {
      problems.push(`no tree ${name} under MC_DECOMPILED_ROOT (${legacyRoot}), which generators prefer when it exists`);
      continue;
    }
    const embedded = directoryIdentity(tree);
    // (1.14 embeds its name and a build id)
    if (embedded?.split(" ")[0] !== name) problems.push(`the tree ${name} embeds ${embedded}, a wrong-release source`);
  }
  // what generate-block-shapes and generate-entity-data run: each release's own code
  const { classpath } = require("./java-oracle/classpath.cjs");
  for (const version of jars ?? manifest.versions) {
    try {
      classpath(version);
    } catch (error) {
      problems.push(`${version}: no pinned jar to run: ${error.message}. Set MC_CLIENT_JAR_ROOT, MC_LIBRARY_ROOT and MC_GRADLE_MODULES, or build with --data cached, which says so`);
    }
  }
  if (!fs.existsSync(repository)) problems.push(`no extracted data repository at ${repository}: set MC_EXTRACTED_DATA_REPO`);
  if (!fs.existsSync(path.join(data, "package.json"))) problems.push(`no minecraft-data at ${data}: run scripts/bootstrap-inputs.cjs`);
  else if (head(data) !== pin) problems.push(`minecraft-data at ${data} is at ${head(data)}, pinned ${pin}`);
  else if (!fs.existsSync(path.join(data, "data.js"))) problems.push(`minecraft-data at ${data} is not built: run scripts/bootstrap-inputs.cjs`);
  return problems;
}

if (require.main === module) {
  if (!process.argv.includes("--check")) {
    if (!fs.existsSync(dataCheckout())) cloneMinecraftData();
    else if (!fs.existsSync(path.join(dataCheckout(), "data.js"))) buildMinecraftData();
  }
  const problems = inputProblems(process.argv.includes("--cached") ? { jars: [] } : {});
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log("inputs: every release has its exact source, minecraft-data is at its pin");
}

module.exports = { inputProblems, cloneMinecraftData };
