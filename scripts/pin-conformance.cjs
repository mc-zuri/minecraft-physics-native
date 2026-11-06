// Pins what a replay of one release showed into generated/conformance-evidence.json, one interaction
// of the contract at a time. It runs the replay itself and records its result, so a pin cannot be
// written by hand short of forging its facts: see docs/parity-contract.md for what the seal does and
// does not stop.
//   node scripts/pin-conformance.cjs --version 26.3 --interaction player.ground [--recordings <dir>]
// --interaction takes a comma list. A pin says what it replayed: a selection smaller than the
// cell's scenarios of the recorded corpus leaves the cell partial however well it went.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs } = require("node:util");
const { INTERACTIONS, engineDigest, scopeHash, sealOf } = require("./parity-contract.cjs");

const repositoryRoot = path.resolve(__dirname, "..");
const evidencePath = path.join(repositoryRoot, "generated", "conformance-evidence.json");
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

/** The ids of a recorded index a contract's scenarios select, as the replay's --case selects them. */
function selectedIds(ids, patterns) {
  const regexes = patterns.map((pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`));
  return ids.filter((id) => regexes.some((regex) => regex.test(id)));
}

/** What a replay's last line says: how many ran and how many matched. Null when it says neither. */
function replaySummary(line) {
  const ran = /^(\d+) recording\(s\)/.exec(line);
  if (!ran) return null;
  const selected = Number(ran[1]);
  const matching = /, (\d+) matching/.exec(line);
  const unexpected = /(\d+) unexpected/.exec(line);
  return { selected, matching: matching ? Number(matching[1]) : selected - Number(unexpected?.[1] ?? selected) };
}

function pinOne(version, interaction, recordings, record) {
  const indexText = fs.readFileSync(path.join(recordings, version, "index.json"));
  const index = JSON.parse(indexText);
  const ids = selectedIds(index.scenarios.map((scenario) => scenario.id), interaction.scenarios);
  // (the native layer's replay compares the intermediate phases too; the others have their own comparison)
  const flags = interaction.replay ?? ["--phases"];
  const run = spawnSync(process.execPath, ["recorder/replay/cli.ts", "--version", version, "--case", interaction.scenarios.join(","), ...flags], {
    cwd: repositoryRoot, encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, REPLAY_RECORDINGS: recordings },
  });
  const lines = run.stdout.trim().split("\n");
  const summary = replaySummary(lines.at(-1) ?? "");
  if (!summary) throw new Error(`${version} ${interaction.id}: the replay gave no summary: ${(run.stderr || run.stdout).slice(-400)}`);
  const addon = fs.readdirSync(path.join(repositoryRoot, "native", "artifacts")).find((name) => name.endsWith(".node"));
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).stdout.trim();
  const pin = {
    scope: scopeHash(interaction),
    source: sha256(JSON.stringify(record.source)),
    tables: record.tables.sha256,
    engine: engineDigest(),
    addon: sha256(fs.readFileSync(path.join(repositoryRoot, "native", "artifacts", addon))),
    commit: head,
    recordings: sha256(indexText),
    build: index.build,
    ids: sha256(ids.join("\n")),
    corpus: ids.length,
    selected: summary.selected,
    matching: summary.matching,
    exit: run.status,
    phases: flags.includes("--phases"),
    summary: lines.at(-1),
  };
  return { ...pin, seal: sealOf(pin) };
}

if (require.main === module) {
  const { values } = parseArgs({ options: { version: { type: "string" }, interaction: { type: "string" }, recordings: { type: "string" } } });
  const recordings = path.resolve(values.recordings ?? process.env.REPLAY_RECORDINGS ?? path.join(repositoryRoot, "recorder", "out", "recordings"));
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "generated", "release-manifest.json"), "utf8")).releases;
  const evidence = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, "utf8")) : { schema: 1, generatedBy: "scripts/pin-conformance.cjs", releases: {} };
  for (const version of values.version.split(",")) {
    if (!manifest[version]) throw new Error(`${version} is not a registered release`);
    for (const id of values.interaction.split(",")) {
      const interaction = INTERACTIONS.find((candidate) => candidate.id === id);
      if (!interaction) throw new Error(`${id} is no interaction of the contract`);
      const pin = pinOne(version, interaction, recordings, manifest[version]);
      evidence.releases[version] = { ...evidence.releases[version], [id]: pin };
      console.log(`${version} ${id}: ${pin.summary} (corpus ${pin.corpus}, exit ${pin.exit})`);
      fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    }
  }
}

module.exports = { replaySummary, selectedIds };
