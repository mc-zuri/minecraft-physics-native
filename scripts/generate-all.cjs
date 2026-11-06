// Runs every generator in dependency order as one step: a stage that fails puts the whole previous
// artifact set back, so a run publishes all of it or none of it. With --check nothing is kept and a
// difference from the checked-in artifacts (line endings aside) fails. With --cached a release whose
// sources are absent keeps its entries, which is what such a run must say it is doing; without it
// that release fails the run.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repositoryRoot = path.resolve(__dirname, "..");
const artifacts = [path.join(repositoryRoot, "generated"), path.join(repositoryRoot, "native", "data")];
const cachedStages = new Set(["generate-legacy-release-manifest.cjs", "generate-block-registry-manifest.cjs", "generate-block-state-manifest.cjs", "generate-version-manifest.cjs", "extract-physics-methods.cjs", "generate-block-tags.cjs", "generate-block-shapes.cjs", "generate-entity-data.cjs", "report-physics-breakpoints.cjs"]);
const stages = [
  "generate-version-manifest.cjs",
  "generate-block-registry-manifest.cjs",
  "generate-block-state-manifest.cjs",
  "generate-legacy-release-manifest.cjs",
  "generate-native-data.cjs",
  "generate-block-tags.cjs",
  "generate-block-shapes.cjs",
  "generate-legacy-shapes.cjs",
  "generate-entity-data.cjs",
  "generate-block-friction.cjs",
  "generate-fluid-tables.cjs",
  "generate-projectile-capabilities.cjs",
  "generate-primitive-map.cjs",
  "extract-physics-methods.cjs",
  "generate-release-manifest.cjs",
  "report-physics-breakpoints.cjs",
  "generate-movement-constants.cjs",
  "provenance.cjs",
  "verify-generation-invariants.cjs",
];

function filesUnder(directory, base = directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file, base) : [path.relative(base, file)];
  });
}

const normalized = (file) => fs.readFileSync(file).toString("latin1").replaceAll("\r\n", "\n");

/**
 * Runs `stages` over the artifact folders and says how it went: `{ failed, drift }`, the folders back as they were if a
 * stage failed or this is a check.
 */
function runStages({ stages: names, folders, check = false, cached = false, directory = __dirname, cwd = repositoryRoot }) {
  const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-generated-"));
  const copies = folders.map((folder, index) => [folder, path.join(snapshot, String(index))]);
  for (const [folder, copy] of copies) fs.cpSync(folder, copy, { recursive: true });
  const restore = () => {
    for (const [folder, copy] of copies) {
      fs.rmSync(folder, { recursive: true, force: true });
      fs.cpSync(copy, folder, { recursive: true });
    }
  };
  let failed = null;
  for (const stage of names) {
    const args = [path.join(directory, stage), ...(cached && cachedStages.has(stage) ? ["--cached"] : [])];
    if (spawnSync(process.execPath, args, { stdio: "inherit", cwd }).status !== 0) {
      failed = stage;
      break;
    }
  }
  const drift = [];
  if (!failed && check) {
    for (const [folder, copy] of copies) {
      const before = new Set(filesUnder(copy));
      for (const file of filesUnder(folder)) {
        if (!before.delete(file) || normalized(path.join(folder, file)) !== normalized(path.join(copy, file))) drift.push(file);
      }
      drift.push(...before);
    }
  }
  if (failed || check) restore();
  fs.rmSync(snapshot, { recursive: true, force: true });
  return { failed, drift };
}

function main() {
  const { failed, drift } = runStages({
    stages,
    folders: artifacts,
    check: process.argv.includes("--check"),
    cached: process.argv.includes("--cached"),
  });
  if (failed) {
    console.error(`${failed} failed: the previous artifacts are back in place`);
    process.exit(1);
  }
  if (drift.length > 0) {
    console.error(`Regeneration differs from the checked-in artifacts: ${drift.join(", ")}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { runStages };
