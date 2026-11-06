// The version gates of the shared native code (B007, B018, docs/shared-code-audit.md): which function
// branches on which release, read from the Rust itself. generated/shared-gates.json is that list, so
// a gate added, moved or removed without regenerating it fails test/shared-gates.test.cjs: an interval
// cannot widen or shift unreviewed.
//
// Each function gets a status, computed and never set by hand:
//   source-compared  every boundary of the function is one where the source audit of the release
//                    finds a method or class change (generated/physics-breakpoints.json)
//   unverified       at least one boundary has no such finding at its first registered release
// A boundary's trace coverage is a separate question, answered by generated/conformance-evidence.json.
// `unverified` is the incomplete marker: it claims nothing.
//   node scripts/shared-gates.cjs            writes generated/shared-gates.json
//   node scripts/shared-gates.cjs --check    fails on a difference
const fs = require("node:fs");
const path = require("node:path");
const { canonicalReleases } = require("./release-inventory.cjs");
const { compareReleases } = require("./registered-releases.cjs");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "generated", "shared-gates.json");
const sourceRoot = path.join(root, "native", "src");

/**
 * The lines of a Rust source without its test items. Each #[cfg(test)] takes the one item after it, to the
 * brace that closes it: a helper can sit early in a file, with real code after it.
 */
function codeLines(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    const attribute = /^(\s*)#\[cfg\(test\)\]/.exec(lines[index]);
    if (!attribute) {
      kept.push(lines[index]);
      continue;
    }
    let at = index + 1;
    while (at < lines.length && !/[;{]\s*$/.test(lines[at])) at += 1;
    if (/\{\s*$/.test(lines[at] ?? "")) {
      const close = `${attribute[1]}}`;
      while (at < lines.length && lines[at].trimEnd() !== close) at += 1;
    }
    index = at;
  }
  return kept;
}

/** The gates of one Rust source, by the function holding them. Test items are left out. */
function gatesOf(text) {
  const functions = new Map();
  let current = "<module>";
  for (const line of codeLines(text)) {
    const declared = /^\s*(?:pub(?:\([a-z]+\))? )?(?:const )?fn (\w+)/.exec(line);
    if (declared) current = declared[1];
    for (const [, major, minor, patch] of line.matchAll(/\.at_least\((\d+),\s*(\d+),\s*(\d+)\)/g)) {
      const boundary = patch === "0" ? `${major}.${minor}` : `${major}.${minor}.${patch}`;
      if (!functions.has(current)) functions.set(current, new Set());
      functions.get(current).add(boundary);
    }
  }
  return functions;
}

function sourceBoundaries(report) {
  return new Set(report.breakpoints.filter((entry) => entry.categories.includes("source")).map((entry) => entry.current));
}

/** Every gated function of the native sources. */
function sharedGates(registered = canonicalReleases(), audited = sourceBoundaries(JSON.parse(fs.readFileSync(path.join(root, "generated", "physics-breakpoints.json"), "utf8")))) {
  const files = fs.readdirSync(sourceRoot).filter((name) => name.endsWith(".rs") && !/tests\.rs$/.test(name)).sort();
  const entries = [];
  for (const file of files) {
    for (const [name, boundaries] of gatesOf(fs.readFileSync(path.join(sourceRoot, file), "utf8"))) {
      const sorted = [...boundaries].sort(compareReleases);
      // a gate at 1.14 first takes effect at the first registered release of that line, 1.14.4
      const effective = (boundary) => registered.find((release) => compareReleases(release, boundary) >= 0);
      const compared = sorted.every((boundary) => audited.has(effective(boundary)));
      entries.push({ file, function: name, boundaries: sorted, status: compared ? "source-compared" : "unverified" });
    }
  }
  return entries;
}

const document = (entries) => `${JSON.stringify({ schema: 1, generatedBy: "scripts/shared-gates.cjs", entries }, null, 2)}\n`;

if (require.main === module) {
  const text = document(sharedGates());
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(outputPath, "utf8").replace(/\r\n/g, "\n") !== text) {
      console.error("generated/shared-gates.json is stale: review the gates that moved and run scripts/shared-gates.cjs");
      process.exit(1);
    }
  } else {
    fs.writeFileSync(outputPath, text);
  }
}

module.exports = { codeLines, document, gatesOf, sharedGates };
