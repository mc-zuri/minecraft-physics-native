// generated/block-shapes-legacy/<release>.json.gz and generated/block-shapes-legacy.json: each state of the releases before
// 1.14, from their own code in a level of their own (scripts/java-oracle/LegacyShapeDump.java). A block is alone in that
// level, so this says what a state is by itself: what neighbours do to it is for the recordings. A query the blank level
// cannot answer stays as `refused`, with why, and nothing else of the block is taken for it.
//
// The jars are the recorder's, Mojang's names of 1.14.4 mapped on by Calamus ids. A library or jar missing stops the run.
//   node scripts/generate-legacy-shapes.cjs [--dumps DIR] [--check]
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");
const { clientJarRoot } = require("./source-pins.cjs");
const { LEGACY_RELEASES } = require("./legacy-release-data.cjs");

const repositoryRoot = path.resolve(__dirname, "..");
const tableRoot = path.join(repositoryRoot, "generated", "block-shapes-legacy");
const reportPath = path.join(repositoryRoot, "generated", "block-shapes-legacy.json");
const oracleSource = path.join(__dirname, "java-oracle", "LegacyShapeDump.java");
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

function jarsOf(version) {
  const root = clientJarRoot();
  const directory = path.join(root, version);
  const named = fs.readdirSync(directory).filter((name) => name.startsWith(`intermediary-${version}-mojang-`))
    .map((name) => path.join(directory, name, `minecraft-${version}-fabric-merged+custom-no-environment+fixed-named+intermediary.jar`))
    .filter((file) => fs.existsSync(file)).sort((a, b) => sha256(a).localeCompare(sha256(b)));
  if (named.length === 0) throw new Error(`No Mojang-named jar of ${version} under ${directory}`);
  const modules = process.env.MC_GRADLE_MODULES ?? path.join(os.homedir(), ".gradle", "caches", "modules-2", "files-2.1");
  const json = JSON.parse(fs.readFileSync(path.join(directory, "version.json"), "utf8"));
  const jars = [named[0]];
  for (const { downloads } of json.libraries) {
    const artifact = downloads?.artifact;
    if (!artifact) continue;
    const parts = artifact.path.split("/");
    const file = parts.pop();
    const release = parts.pop();
    const name = parts.pop();
    const found = path.join(modules, parts.join("."), name, release, artifact.sha1.replace(/^0+/, ""), file);
    if (fs.existsSync(found)) jars.push(found);
  }
  return jars;
}

const parseBoxes = (text) => (text === "-" ? null : text === "" ? [] : text.split(";").map((box) => box.split(",").map(Number)));

/** A dump as the table: the shapes once, and each state's by its id and properties. */
function parseDump(text, version) {
  const shapes = new Map();
  const shapeId = (boxes) => {
    if (boxes === null) return null;
    const key = JSON.stringify(boxes);
    if (!shapes.has(key)) shapes.set(key, shapes.size);
    return shapes.get(key);
  };
  const blocks = {};
  const refused = {};
  for (const line of text.split(/\r?\n/)) {
    if (line === "") continue;
    const fields = line.split("\t");
    if (fields[0] === "state") {
      const [, name, id, props, collision, outline] = fields;
      (blocks[name] ??= []).push([Number(id), props, shapeId(parseBoxes(collision)), shapeId(parseBoxes(outline))]);
    } else if (fields[0] === "refused") {
      const [, name, , , channel, reason] = fields;
      ((refused[name] ??= {})[channel] ??= {})[reason] = ((refused[name][channel] ?? {})[reason] ?? 0) + 1;
    } else {
      throw new Error(`${version}: unknown dump line ${fields[0]}`);
    }
  }
  if (Object.keys(blocks).length < 100) throw new Error(`${version}: the dump has only ${Object.keys(blocks).length} blocks`);
  return { schema: 1, release: version, shapes: [...shapes.keys()].map((key) => JSON.parse(key)), blocks, refused };
}

function dumpOf(version, classes, directory) {
  const output = path.join(directory, `${version}.tsv`);
  const java = process.env.JAVA_21_HOME ? path.join(process.env.JAVA_21_HOME, "bin", "java") : "java";
  const run = spawnSync(java, ["-Xmx1500m", "-XX:-OmitStackTraceInFastThrow", "-XX:+UnlockDiagnosticVMOptions", "-XX:-BytecodeVerificationRemote",
    "-cp", [classes, ...jarsOf(version)].join(path.delimiter), "LegacyShapeDump", output], { encoding: "utf8", cwd: directory });
  if (run.status !== 0) throw new Error(`The oracle failed on ${version}: ${(run.stderr ?? run.error?.message ?? "").slice(0, 2000)}`);
  return fs.readFileSync(output, "utf8");
}

const compressed = (text) => {
  const bytes = zlib.gzipSync(text, { level: 9 });
  bytes[9] = 0xff;
  return bytes;
};

function generate(dumps) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mc-legacy-shapes-"));
  try {
    let classes = null;
    if (!dumps) {
      classes = path.join(work, "classes");
      const compile = spawnSync("javac", ["-nowarn", "--release", "21", "-d", classes, oracleSource], { encoding: "utf8" });
      if (compile.status !== 0) throw new Error(`The oracle does not compile: ${compile.stderr}`);
    }
    const tables = new Map();
    const releases = {};
    for (const { version } of LEGACY_RELEASES) {
      const text = dumps ? fs.readFileSync(path.join(dumps, `${version}.tsv`), "utf8") : dumpOf(version, classes, work);
      const table = parseDump(text, version);
      tables.set(version, table);
      releases[version] = {
        status: "alone",
        states: Object.values(table.blocks).reduce((sum, rows) => sum + rows.length, 0),
        blocks: Object.keys(table.blocks).length,
        refused: Object.fromEntries(Object.entries(table.refused).sort(([a], [b]) => a.localeCompare(b)).map(([name, channels]) => [name, Object.keys(channels)])),
        sha256: sha256(JSON.stringify(table)),
      };
    }
    return { tables, report: { schema: 1, generatedBy: "scripts/generate-legacy-shapes.cjs", releases } };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function main() {
  const at = process.argv.indexOf("--dumps");
  const { tables, report } = generate(at < 0 ? null : process.argv[at + 1]);
  const text = `${JSON.stringify(report, null, 1)}\n`;
  if (process.argv.includes("--check")) {
    const present = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8").replaceAll("\r\n", "\n") : "";
    if (present !== text) throw new Error("generated/block-shapes-legacy.json differs from a fresh generation");
    return;
  }
  fs.mkdirSync(tableRoot, { recursive: true });
  for (const [version, table] of tables) fs.writeFileSync(path.join(tableRoot, `${version}.json.gz`), compressed(JSON.stringify(table)));
  fs.writeFileSync(reportPath, text);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { parseDump };
