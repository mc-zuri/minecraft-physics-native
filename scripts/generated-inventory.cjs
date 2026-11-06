// Every generated file the package or its build depends on, with the step that makes it and what that
// step reads, so nothing shipped comes from nowhere (docs/release-build.md). `pass` says how a run
// reaches it: `all` is a stage of scripts/generate-all.cjs, `network` and `oracle` are run by hand
// because their inputs are Mojang's live list or dumps and jars of running clients, and `build` is the
// native or TypeScript build. Checks that each tracked generated file is listed and each generator
// exists; running the generators is generate-all's --check.
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");

const GENERATED = [
  { output: "generated/minecraft-versions.json", step: "scripts/generate-version-manifest.cjs", pass: "all", inputs: "exact release sources" },
  { output: "generated/block-registries.json", step: "scripts/generate-block-registry-manifest.cjs", pass: "all", inputs: "exact release sources" },
  { output: "generated/block-state-definitions.json", step: "scripts/generate-block-state-manifest.cjs", pass: "all", inputs: "exact release sources" },
  { output: "generated/legacy-release-data.json", step: "scripts/generate-legacy-release-manifest.cjs", pass: "all", inputs: "MC_DECOMPILED_ROOT, the six legacy trees" },
  { output: "native/data/", step: "scripts/generate-native-data.cjs", pass: "all", inputs: "the manifests above" },
  { output: "generated/block-friction.json", step: "scripts/generate-block-friction.cjs", pass: "all", inputs: "exact release sources" },
  { output: "generated/fluid-tables.json", step: "scripts/generate-fluid-tables.cjs", pass: "all", inputs: "exact release sources" },
  { output: "generated/physics-methods.json", step: "scripts/extract-physics-methods.cjs", pass: "all", inputs: "exact release sources" },
  { output: "generated/release-manifest.json", step: "scripts/generate-release-manifest.cjs", pass: "all", inputs: "the manifests above, generated/mojang-releases.json, generated/release-aliases.json" },
  { output: "generated/physics-breakpoints.json", step: "scripts/report-physics-breakpoints.cjs", pass: "all", inputs: "the manifests above, minecraft-data at the pin" },
  { output: "generated/block-tags.json", step: "scripts/generate-block-tags.cjs", pass: "all", inputs: "exact release sources" },
  { output: "generated/projectile-capabilities.json", step: "scripts/generate-projectile-capabilities.cjs", pass: "all", inputs: "exact release sources" },
  { output: "generated/block-shapes.json", step: "scripts/generate-block-shapes.cjs", pass: "all", inputs: "each release's pinned jar and libraries, run by a JDK" },
  { output: "generated/block-shapes", step: "scripts/generate-block-shapes.cjs", pass: "all", inputs: "each release's pinned jar and libraries, run by a JDK" },
  { output: "generated/entity-data.json", step: "scripts/generate-entity-data.cjs", pass: "all", inputs: "each release's pinned jar and libraries, run by a JDK" },
  { output: "generated/block-shapes-legacy.json", step: "scripts/generate-legacy-shapes.cjs", pass: "all", inputs: "the recorder's Mojang-named jars of 1.8.8 to 1.13.2" },
  { output: "generated/block-shapes-legacy", step: "scripts/generate-legacy-shapes.cjs", pass: "all", inputs: "the recorder's Mojang-named jars of 1.8.8 to 1.13.2" },
  { output: "generated/primitive-map.json", step: "scripts/generate-primitive-map.cjs", pass: "all", inputs: "exact release sources, native/src" },
  { output: "generated/movement-constants.json", step: "scripts/generate-movement-constants.cjs", pass: "all", inputs: "exact release sources, native/src, src/mineflayer" },
  { output: "generated/provenance.json", step: "scripts/provenance.cjs", pass: "all", inputs: "the generated files and their generators" },
  { output: "generated/conformance-evidence.json", step: "scripts/pin-conformance.cjs", pass: "oracle", inputs: "recorded traces (REPLAY_RECORDINGS)" },
  { output: "generated/shared-gates.json", step: "scripts/shared-gates.cjs", pass: "oracle", inputs: "generated/conformance-evidence.json" },
  { output: "generated/tag-audit-dispositions.json", step: "scripts/classify-tag-audit.cjs", pass: "oracle", inputs: "generated/block-tags.json, reviewed" },
  { output: "generated/mojang-releases.json", step: "scripts/generate-mojang-releases.cjs", pass: "network", inputs: "Mojang's version manifest" },
  { output: "generated/runtime-registries.json", step: "scripts/generate-runtime-registries.cjs", pass: "oracle", inputs: "MC_PHYSICS_DATA_GENERATOR client dumps" },
  { output: "generated/release-aliases.json", step: "scripts/generate-release-aliases.cjs", pass: "oracle", inputs: "client jars of the aliased releases" },
  { output: "src/mineflayer/data-aliases.json", step: "scripts/generate-data-aliases.cjs", pass: "oracle", inputs: "client and server jars, the JDK of MC_JAVA" },
  { output: "src/mineflayer/flow-blockers.json", step: "scripts/generate-flow-blockers.cjs", pass: "oracle", inputs: "exact release sources" },
  { output: "src/mineflayer/vehicle-versions.ts", step: "scripts/generate-vehicle-engines.cjs", pass: "oracle", inputs: "native/src/versioned" },
  { output: "recorder/mod/common/src/generated/", step: "recorder/schema/gen-java.ts", pass: "oracle", inputs: "recorder/schema" },
  { output: "native/artifacts/index.*.node", step: "napi build", pass: "build", inputs: "native/, native/Cargo.lock, rust-toolchain.toml" },
  { output: "native/artifacts/index.wasi-browser.js", step: "scripts/patch-wasi-loader.cjs", pass: "build", inputs: "napi build's loader" },
  { output: "native/artifacts/index.wasip1-browser.js", step: "scripts/patch-wasi-loader.cjs", pass: "build", inputs: "napi build's loader" },
  { output: "native/artifacts/*.wasm", step: "napi build --target wasm32-*", pass: "build", inputs: "native/, native/Cargo.lock, emnapi" },
  { output: "native/artifacts/native.js", step: "napi build", pass: "build", inputs: "package.json napi" },
  { output: "native/artifacts/native.d.ts", step: "napi build", pass: "build", inputs: "the #[napi] items of native/src" },
  { output: "native/artifacts/provenance.*.json", step: "scripts/release-build.cjs", pass: "build", inputs: "the build it records" },
  { output: "dist/", step: "tsc", pass: "build", inputs: "src/, tsconfig.json, pnpm-lock.yaml" },
];

/** What is unaccounted for: `tracked` are the files of generated/, `exists` says whether a path does. */
function inventoryGaps(tracked, exists) {
  const gaps = [];
  const outputs = new Set(GENERATED.map(({ output }) => output));
  for (const file of tracked) if (!outputs.has(file)) gaps.push(`${file} has no generator on record`);
  for (const { output, step } of GENERATED) {
    if (step.endsWith(".cjs") || step.endsWith(".ts")) {
      if (!exists(step)) gaps.push(`${output} names ${step}, which does not exist`);
    }
  }
  return gaps;
}

if (require.main === module) {
  const tracked = fs.readdirSync(path.join(repositoryRoot, "generated")).map((name) => `generated/${name}`);
  const gaps = inventoryGaps(tracked, (file) => fs.existsSync(path.join(repositoryRoot, file)));
  for (const gap of gaps) console.error(gap);
  if (gaps.length > 0) process.exit(1);
  console.log(`generated inventory: ${GENERATED.length} outputs, each with its step`);
}

module.exports = { GENERATED, inventoryGaps };
