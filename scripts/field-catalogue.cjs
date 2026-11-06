// The public field catalogue (B271, docs/field-catalogue.md), read from the declarations the addon's build wrote and from the
// adapter's own sources, so that a field exported without an entry fails test/field-catalogue.test.cjs. The packed layouts
// come from the compiled package and are held to scripts/state-bridge.cjs.
//   node scripts/field-catalogue.cjs           writes docs/field-catalogue.md
//   node scripts/field-catalogue.cjs --check   fails on a difference
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { FLAGS, OUTPUTS, OUTPUT_FLAGS, PACKED } = require("./state-bridge.cjs");

const root = path.resolve(__dirname, "..");
const catalogue = path.join(root, "docs", "field-catalogue.md");

/** Where an interface has its contract by hand. */
const MAPPED = { NativeSimulationState: "state-contract.md" };
for (const name of ["NativeBoatState", "NativeHorseState", "NativeMinecartState", "NativeMovingEntityState", "NativeProjectileState", "NativeArrowState",
  "NativeTridentState", "NativeBlockUpdate", "NativeBlockShape", "NativeMovingPiston", "NativeNearbyEntity"]) MAPPED[name] = "field-maps.md";

const oneLine = (text) => text.replace(/\s+/g, " ").replaceAll("|", "\\|").trim();
const comment = (node) => oneLine(ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).map((doc) => ts.getTextOfJSDocComment(doc.comment) ?? "").join(" "));
const cell = (text) => `\`${oneLine(text).replaceAll("`", "'")}\``;

/** The exported interfaces, functions and class methods of a declaration text. */
function parse(text, name = "source.ts") {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const interfaces = [];
  const entries = [];
  for (const statement of file.statements) {
    const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isInterfaceDeclaration(statement)) {
      interfaces.push({
        name: statement.name.text,
        note: comment(statement),
        members: statement.members.filter((member) => member.name).map((member) => ({
          name: member.name.getText(file),
          type: member.type ? member.type.getText(file) : member.getText(file),
          optional: !!member.questionToken,
          note: comment(member),
        })),
      });
    } else if (ts.isFunctionDeclaration(statement)) {
      entries.push({
        name: statement.name.text,
        parameters: statement.parameters.map((parameter) => parameter.type?.getText(file) ?? ""),
        result: statement.type?.getText(file) ?? "void",
        note: comment(statement),
      });
    } else if (ts.isClassDeclaration(statement)) {
      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member) && !ts.isConstructorDeclaration(member)) continue;
        entries.push({
          name: `${statement.name.text}.${member.name ? member.name.getText(file) : "constructor"}`,
          parameters: member.parameters.map((parameter) => parameter.type?.getText(file) ?? ""),
          result: member.type?.getText(file) ?? statement.name.text,
          note: comment(member),
        });
      }
    }
  }
  return { interfaces, entries };
}

/** Which way each interface crosses the binding: what a call takes and what it gives back, through what they hold. */
function directions(interfaces, entries) {
  const known = new Map(interfaces.map((item) => [item.name, item]));
  const named = (type) => [...type.matchAll(/\b[A-Z]\w+/g)].map(([name]) => name).filter((name) => known.has(name));
  const reach = (types) => {
    const seen = new Set();
    const walk = (name) => {
      if (seen.has(name)) return;
      seen.add(name);
      for (const member of known.get(name).members) named(member.type).forEach(walk);
    };
    types.flatMap(named).forEach(walk);
    return seen;
  };
  const taken = reach(entries.flatMap((entry) => entry.parameters));
  const given = reach(entries.map((entry) => entry.result));
  return (name) => (taken.has(name) && given.has(name) ? "in and out" : taken.has(name) ? "in" : given.has(name) ? "out" : "none");
}

function unit(member) {
  if (/\bboolean\b/.test(member.type)) return "flag";
  if (member.type === "string") return "name";
  if (/Degrees$/.test(member.name)) return "degrees";
  if (/Ticks?$/.test(member.name)) return "ticks";
  return "";
}

function adapterFiles() {
  const listed = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && entry.name !== "native.ts" && !entry.name.includes("__"))
    .map((entry) => `${directory}/${entry.name}`);
  return [...listed("src"), ...listed("src/mineflayer")];
}

function section(item, direction) {
  const lines = [`### ${item.name}`, ""];
  if (item.note) lines.push(item.note, "");
  if (direction) lines.push(`Direction: ${direction}.`, "");
  if (item.members.length === 0) return [...lines, "No members.", ""];
  lines.push("| member | type | absent | unit | note |", "|---|---|---|---|---|");
  for (const member of item.members) lines.push(`| \`${member.name}\` | ${cell(member.type)} | ${member.optional ? "allowed" : "required"} | ${unit(member)} | ${member.note} |`);
  return [...lines, ""];
}

function packedTable(title, layout, fields) {
  const byName = Object.fromEntries(Object.entries(fields).map(([field, name]) => [name, field]));
  const rows = Object.entries(layout).sort(([, a], [, b]) => a - b);
  const lines = [`### ${title}`, "", "| name | value | state field |", "|---|---:|---|"];
  for (const [name, value] of rows) lines.push(`| \`${name}\` | ${value} | ${byName[name] ? `\`${byName[name]}\`` : ""} |`);
  return [...lines, ""];
}

function packedSection(layouts) {
  const { NATIVE_PLAYER_LAYOUT: size, NativePlayerInput, NativePlayerInputFlag, NativePlayerOutput, NativePlayerOutputFlag, NativePlayerEntityFlag } = layouts;
  return [
    "## Packed layouts", "",
    `Layout version ${size.version}: ${size.inputLength} input slots, ${size.outputLength} output slots, ${size.entityLength} numbers per entity. \`nativePlayerLayout()\` says what the addon was built with. A flag value is a bit of the \`FLAGS\` slot. A name with no state field here has no one-to-one field in \`scripts/state-bridge.cjs\`, which is the mapping. \`test/state-bridge.test.cjs\` holds that mapping to these names.`, "",
    ...packedTable("NativePlayerInput", NativePlayerInput, PACKED),
    ...packedTable("NativePlayerInputFlag", NativePlayerInputFlag, FLAGS),
    ...packedTable("NativePlayerOutput", NativePlayerOutput, OUTPUTS),
    ...packedTable("NativePlayerOutputFlag", NativePlayerOutputFlag, OUTPUT_FLAGS),
    ...packedTable("NativePlayerEntityFlag", NativePlayerEntityFlag, {}),
  ];
}

function render({ declarations, adapters, layouts }) {
  const { interfaces, entries } = declarations;
  const direction = directions(interfaces, entries);
  const members = interfaces.reduce((sum, item) => sum + item.members.length, 0);
  const lines = [
    "# Field catalogue", "",
    "Generated by `node scripts/field-catalogue.cjs` from `native/artifacts/native.d.ts`, the adapter's sources and the packed layouts: do not edit. `test/field-catalogue.test.cjs` fails when an exported field has no entry here, and when a packed name changes without this page.", "",
    `The binding exports ${interfaces.length} interfaces with ${members} members, and ${entries.length} functions and methods. A stable reference is the heading of the type and the name of the member, as \`docs/field-catalogue.md#nativesimulationconfig\` and \`gravity\`.`, "",
    "## How to read a row", "",
    "- **absent**: `required` means the type needs it. `allowed` means it may be left out, and left out is not `0` or `false` (`docs/state-contract.md`, Omission).",
    "- **unit**: filled where the name or type settles it. A number with no unit is vanilla's field of that name, in vanilla's unit. Every number is a JavaScript double at the binding, kept as the Rust type its field has in `native/src/napi_api.rs`.",
    "- **note**: the comment of the binding, where it has one. A field with no comment has no contract beyond its name, type and direction here.",
    "- **direction**: `in` is read when the call starts and stays the caller's. `out` is produced by the call and is the engine's. `in and out` is both: the caller hands back what it read, not a guess. Who owns a kept value between ticks is in `docs/state-contract.md` and in the `kept` column of `docs/field-maps.md`. `none` is an interface no entry point names.",
    "- **legal range**: a public position, size, box or config value that is not finite or is out of range is refused with the field's name, before anything changes (`docs/numeric-contract.md`).",
    "- **release**: this page gives no per-field release range. `recorder/schema/fields.ts` says which releases record each vanilla field (`versions`), `docs/capability-table.md` which release has which mechanic, and `docs/version-gates.md` where the rules change. A kind a release does not have is refused by name on the entry points that check it (`docs/projectile-capabilities.md`, `entityTravelSupport`).", "",
    "## Interfaces of the binding", "",
    "| interface | direction | members | contract |", "|---|---|---:|---|",
    ...interfaces.map((item) => {
      const place = MAPPED[item.name] ? `[${MAPPED[item.name]}](${MAPPED[item.name]})` : `[below](#${item.name.toLowerCase()})`;
      return `| \`${item.name}\` | ${direction(item.name)} | ${item.members.length} | ${place} |`;
    }), "",
    ...interfaces.filter((item) => !MAPPED[item.name]).flatMap((item) => section(item, direction(item.name))),
    ...packedSection(layouts),
    "## Entry points", "",
    "| entry point | takes | gives | note |", "|---|---|---|---|",
    ...entries.map((entry) => `| \`${entry.name}\` | ${entry.parameters.map(cell).join(", ")} | ${cell(entry.result)} | ${entry.note} |`), "",
    "## Adapter types", "",
    "The interfaces the TypeScript side declares beside the binding. The adapter reads and writes their fields on the caller's objects.", "",
    ...adapters.flatMap(({ file, interfaces: declared }) => declared.flatMap((item) => [...section(item), `Declared in \`${file}\`.`, ""])),
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

/** What the catalogue is made from, as this checkout has it. */
function current() {
  const declarations = parse(fs.readFileSync(path.join(root, "native", "artifacts", "native.d.ts"), "utf8"));
  const adapters = adapterFiles().map((file) => ({ file, interfaces: parse(fs.readFileSync(path.join(root, file), "utf8"), file).interfaces }))
    .filter(({ interfaces }) => interfaces.length > 0);
  return { declarations, adapters, layouts: require(path.join(root, "dist", "native.js")) };
}

if (require.main === module) {
  const text = render(current());
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(catalogue, "utf8").replace(/\r\n/g, "\n") !== text) {
      console.error("docs/field-catalogue.md differs: node scripts/field-catalogue.cjs");
      process.exit(1);
    }
  } else {
    fs.writeFileSync(catalogue, text);
  }
}

module.exports = { MAPPED, current, parse, render };
