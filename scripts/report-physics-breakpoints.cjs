/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const audit = JSON.parse(fs.readFileSync(
  path.join(root, "generated", "physics-methods.json"),
  "utf8",
));
const versions = Object.keys(audit.releases);
const methods = ["Entity.java:move", "LivingEntity.java:travel", "Player.java:travel"];

function hashes(release, key) {
  const [file, method] = key.split(":");
  return (audit.releases[release]?.files?.[file]?.methods?.[method] ?? [])
    .map((entry) => entry.sha256)
    .join(",");
}

const breakpoints = [];
for (let index = 1; index < versions.length; index += 1) {
  const previous = versions[index - 1];
  const current = versions[index];
  const changed = methods.filter((method) => hashes(previous, method) !== hashes(current, method));
  if (changed.length > 0) {
    breakpoints.push({ previous, current, changed });
  }
}

const output = {
  schema: 1,
  sourceAudit: "generated/physics-methods.json",
  comparedMethods: methods,
  breakpoints,
};
const outputPath = path.join(root, "generated", "physics-breakpoints.json");
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Recorded ${breakpoints.length} source behavior breakpoints.`);
