/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const repositoryRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(repositoryRoot, "generated", "minecraft-versions.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const sourceRoot = path.resolve(path.dirname(manifestPath), manifest.sourceRoot);

const targets = [
  ["Entity.java", ["move", "collide", "push", "rideTick"]],
  ["LivingEntity.java", ["travel", "travelInFluid", "handleRelativeFrictionAndCalculateMovement", "causeFallDamage"]],
  ["Player.java", ["travel", "aiStep", "rideTick"]],
  ["LocalPlayer.java", ["aiStep", "sendPosition"]],
  ["Boat.java", ["floatBoat", "controlBoat", "tick"]],
  ["AbstractMinecart.java", ["moveAlongTrack", "tick"]],
];

function extractMethods(source, names) {
  const methods = {};
  for (const name of names) {
    const candidates = [];
    const pattern = new RegExp(
      `^[ \\t]*(?:(?:public|protected|private|final|static|abstract|native|synchronized|strictfp)\\s+)*[\\w$<>, ?\\[\\]]+\\s+${name}\\s*\\([^{}\\n]*\\)\\s*(?:throws [^{\\n]+)?\\{`,
      "gm",
    );
    let match;
    while ((match = pattern.exec(source)) !== null) {
      let depth = 0;
      let end = match.index;
      let inString = false;
      let escaped = false;
      for (; end < source.length; end += 1) {
        const character = source[end];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') {
          inString = true;
        } else if (character === "{") {
          depth += 1;
        } else if (character === "}") {
          depth -= 1;
          if (depth === 0) {
            end += 1;
            break;
          }
        }
      }
      if (depth === 0) {
        const text = source.slice(match.index, end);
        const line = source.slice(0, match.index).split("\n").length;
        candidates.push({
          line,
          sha256: crypto.createHash("sha256").update(text).digest("hex"),
          source: text,
        });
      }
    }
    if (candidates.length > 0) methods[name] = candidates;
  }
  return methods;
}

const releases = {};
for (const version of manifest.versions) {
  const versionFamily = version.split(".").slice(0, 2).join(".");
  const versionRoot = path.join(sourceRoot, versionFamily, version);
  const files = {};
  for (const [fileName, methodNames] of targets) {
    const matches = [];
    function visit(directory) {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(entryPath);
        else if (entry.name === fileName) matches.push(entryPath);
      }
    }
    visit(versionRoot);
    if (matches.length === 0) continue;
    const source = fs.readFileSync(matches[0], "utf8");
    files[fileName] = {
      path: path.relative(sourceRoot, matches[0]),
      fileSha256: crypto.createHash("sha256").update(source).digest("hex"),
      methods: extractMethods(source, methodNames),
    };
  }
  releases[version] = {
    files,
    behaviorFeatures: {
      fluidTravelSplit: Boolean(files["LivingEntity.java"]?.methods?.travelInFluid?.length),
      entityPushthrough: Boolean(
        files["Entity.java"]?.methods?.push?.some((method) =>
          /pushthrough/.test(method.source),
        ),
      ),
      clientPredictionSource: Boolean(files["LocalPlayer.java"]),
      boatSource: Boolean(files["Boat.java"]),
      minecartSource: Boolean(files["AbstractMinecart.java"]),
      horseSource: Boolean(files["AbstractHorse.java"]),
    },
  };
}

const output = {
  schema: 1,
  generatedBy: "scripts/extract-physics-methods.cjs",
  sourceRoot: manifest.sourceRoot,
  releases,
};
const outputPath = path.join(repositoryRoot, "generated", "physics-methods.json");
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Extracted physics methods for ${Object.keys(releases).length} releases.`);
