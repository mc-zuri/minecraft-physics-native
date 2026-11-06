// Writes src/mineflayer/flow-blockers.json: what FlowingFluid.getFlow asks a block's neighbour
// besides its shape, by source tree.
//
// Up to 1.19.4 the neighbour's Material.blocksMotion (1.16.5 FlowableFluid.java:52-75): `open` names
// the blocks of a material that lets motion through. 1.20 - 26.2 BlockState.blocksMotion, the
// forced solid flags over a shape-size test (1.20.4 AbstractBlock.java:466-488, 508-510): `solid`
// and `notSolid` name the forced blocks. 26.3 asks #blocks_fluid_flow, generated data of its own.
//
// Trees come from MC_DECOMPILED_ROOT (Yarn and Mojang names alike) and, for 26.2, MC_SOURCE_ROOT.
const fs = require("node:fs");
const path = require("node:path");
const { javaCode, matchingBracket } = require("./java-source.cjs");
const { blockReferences, symbolicRegistrations } = require("./block-references.cjs");
const { modernTree } = require("./source-roots.cjs");

const repositoryRoot = path.resolve(__dirname, "..");
const decompiledRoot = process.env.MC_DECOMPILED_ROOT ?? path.join(repositoryRoot, "..", "..", "pr", "mc-decompiled");
const outputPath = path.join(repositoryRoot, "src", "mineflayer", "flow-blockers.json");
const MATERIAL_TREES = ["1.13.2", "1.14", "1.15", "1.16", "1.16.5", "1.17", "1.18", "1.19", "1.19.2", "1.19.3", "1.19.4"];
const SOLID_TREES = ["1.20", "1.20.2", "1.20.4", "1.20.5", "1.21", "1.21.3", "1.21.4", "1.21.5", "1.21.6", "1.21.7", "1.21.8", "1.21.9", "1.21.10", "1.21.11"];

/** A file of a tree, under its Yarn or Mojang package. */
function treeFile(version, name) {
  const root = path.join(decompiledRoot, version, "net", "minecraft");
  const found = [
    ["block", name], ["block", "material", name], ["world", "level", "block", name], ["world", "level", "material", name],
  ].map((parts) => path.join(root, ...parts)).find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`${version}: no ${name}`);
  return found;
}

/** The registrations of a Blocks.java, in order: [field, id, initializer text]. */
function registrations(source) {
  const code = javaCode(source);
  const found = [];
  for (const match of code.matchAll(/public static final Block ([A-Z0-9_]+) = [A-Za-z_.]+\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = matchingBracket(code, open);
    const text = source.slice(open + 1, close);
    const id = /^\s*"([a-z0-9_]+)"/.exec(text)?.[1];
    found.push([match[1], id, text]);
  }
  return found;
}

/** The static helpers of Blocks.java that build settings: name -> body. */
function helpers(source) {
  const code = javaCode(source);
  const bodies = new Map();
  for (const match of code.matchAll(/^\s*(?:private|public)\s+static\s+[\w.<>]+\s+([A-Za-z0-9_]+)\([^)]*\)\s*\{/gm)) {
    const open = match.index + match[0].length - 1;
    bodies.set(match[1], source.slice(open, matchingBracket(code, open)));
  }
  return bodies;
}

const COPIED = /(?:Settings\.copy(?:Shallow)?|\.copy|ofFullCopy|ofLegacyCopy)\(\s*(?:Blocks\.)?([A-Z0-9_]+)\s*\)/;

/** A material's blocksMotion by Material.java: its builder allows movement or not. */
function openMaterials(source) {
  const open = new Set();
  const declarations = [...source.matchAll(/public static final Material (\w+) = ([^;]+);/g)];
  // method_17829 is 1.13.2's allowsMovement (class_63$class_4031.java: blocksMovement = false)
  for (const [, name, text] of declarations) {
    if (/\.(?:allowsMovement|method_17829)\(\)/.test(text)) open.add(name);
  }
  return open;
}

/** 1.13.2's Block.setup: `X lv = new X(...)`, `register("id", lv)`, `register("id", new X(...))` or air's `add(default id, lv)`. */
function setupTree(source, open) {
  const start = source.indexOf("public static void setup()");
  const body = source.slice(start, source.indexOf("\n    }\n", start));
  const materialOf = new Map();
  const blocks = [];
  const materialIn = (text) => /\bMaterial\.([A-Za-z0-9_]+)/.exec(text)?.[1]
    ?? materialOf.get(/\bfromBlock\(\s*(lv\d*|Blocks\.[A-Z0-9_]+)\s*\)/.exec(text)?.[1])
    ?? materialOf.get(/\b(?:Block\.Builder\.\w+|\w+)\(\s*(lv\d*)\s*\)/.exec(text)?.[1]);
  for (const statement of body.matchAll(/(?:\b[A-Za-z_]\w* (lv\d*) = |register\(\s*"([a-z0-9_]+)",\s*)([\s\S]*?)\);?\n\s*(?=[A-Za-z_]\w* lv\d* = |register\(|add\(|for |\}|Iterator|Registry)/g)) {
    const [, variable, id, text] = statement;
    const direct = /^lv\d*$/.test(text.trim()) ? materialOf.get(text.trim()) : materialIn(text);
    if (variable) materialOf.set(variable, direct);
    if (id && direct) materialOf.set(`Blocks.${id.toUpperCase()}`, direct);
    if (id && open.has(direct)) blocks.push(id);
  }
  const air = /add\(Registry\.BLOCK\.getDefaultId\(\),\s*(lv\d*)\)/.exec(body)?.[1];
  if (open.has(materialOf.get(air))) blocks.push("air");
  return { open: blocks.sort() };
}

function materialTree(version) {
  const materialSource = fs.readFileSync(treeFile(version, "Material.java"), "utf8");
  const open = openMaterials(materialSource);
  if (version === "1.13.2") return setupTree(fs.readFileSync(treeFile(version, "Block.java"), "utf8"), open);
  const source = fs.readFileSync(treeFile(version, "Blocks.java"), "utf8");
  const bodies = helpers(source);
  const materialOf = new Map();
  const blocks = [];
  for (const [field, id, text] of registrations(source)) {
    const direct = /\bMaterial\.([A-Za-z0-9_]+)/.exec(text)?.[1];
    const copied = COPIED.exec(text)?.[1];
    const helper = /\b(create[A-Za-z]*)\(/.exec(text)?.[1];
    const material = direct
      ?? (copied && materialOf.get(copied))
      ?? (helper && /\bMaterial\.([A-Za-z0-9_]+)/.exec(bodies.get(helper) ?? "")?.[1]);
    if (!material) throw new Error(`${version}: no material for ${field}`);
    materialOf.set(field, material);
    if (id && open.has(material)) blocks.push(id);
  }
  return { open: blocks.sort() };
}

const forced = (text, bodies) => {
  const helper = /\b(create[A-Za-z]*|wallVariant|[a-z]+Properties)\(/.exec(text)?.[1];
  const all = `${text}\n${bodies.get(helper) ?? ""}`;
  return {
    solid: /\.(?:solid|forceSolidOn)\(\)/.test(all),
    notSolid: /\.(?:notSolid|forceSolidOff)\(\)/.test(all),
  };
};

/** The forced flags from a list of [id, field, initializer], a copy inheriting the original's. */
function solidTree(entries, bodies) {
  const flags = new Map();
  const solid = [];
  const notSolid = [];
  for (const [field, id, text] of entries) {
    const own = forced(text, bodies);
    const copied = flags.get(COPIED.exec(text)?.[1] ?? /(?:ofFullCopy|ofLegacyCopy|wallVariant|Stairs?Block|Stair)\(\s*([A-Z0-9_]+)/.exec(text)?.[1]);
    const copiesFlags = /ofFullCopy|Settings\.copy\(/.test(text);
    const result = {
      solid: own.solid || (copiesFlags && copied?.solid),
      notSolid: own.notSolid || (copiesFlags && copied?.notSolid),
    };
    flags.set(field, result);
    if (!id) continue;
    if (result.solid) solid.push(id);
    else if (result.notSolid) notSolid.push(id);
  }
  return { solid: solid.sort(), notSolid: notSolid.sort() };
}

function classicSolidTree(version) {
  const source = fs.readFileSync(treeFile(version, "Blocks.java"), "utf8");
  return solidTree(registrations(source), helpers(source));
}

function symbolicSolidTree(version) {
  const tree = modernTree(version);
  const source = fs.readFileSync(path.join(tree, "net", "minecraft", "world", "level", "block", "Blocks.java"), "utf8");
  const classes = symbolicRegistrations(source, blockReferences(tree));
  const entries = Object.entries(classes).map(([id, entry]) => [`${entry.field}:${id}`, id, entry.initializer]);
  // a registerWall forces solid in the helper (26.2 Blocks.java:1028-1030)
  const walls = new Set(Object.entries(classes).filter(([, entry]) => entry.className === "WallBlock").map(([id]) => id));
  const result = solidTree(entries, helpers(source));
  result.solid = [...new Set([...result.solid, ...walls])].sort();
  return result;
}

const output = {
  // the trees' flags hold from their release to the next tree's
  material: Object.fromEntries(MATERIAL_TREES.map((version) => [version, materialTree(version)])),
  solid: Object.fromEntries([
    ...SOLID_TREES.map((version) => [version, classicSolidTree(version)]),
    ["26.2", symbolicSolidTree("26.2")],
  ]),
};
fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`);
for (const [version, tree] of Object.entries(output.material)) console.log(version, "open", tree.open.length);
for (const [version, tree] of Object.entries(output.solid)) console.log(version, "solid", tree.solid.length, "notSolid", tree.notSolid.length);
