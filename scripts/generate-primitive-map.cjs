// generated/primitive-map.json: which vanilla declarations each collision primitive of the engine ports, and what those
// call. The table below is reviewed by hand, as porting is. What it claims is checked here: each declaration must exist
// in the release's source, and its fingerprint per release shows where the vanilla method changed, so a change has to be
// looked at. Helpers are read from the source: the methods of the shape classes a declaration calls, followed.
//
// A release before 1.14 has Yarn's names, which this table does not map: it is listed as such and not counted as covered.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { registeredReleases, compareReleases } = require("./registered-releases.cjs");
const { methodsNamed } = require("./java-declarations.cjs");
const { modernTree } = require("./source-roots.cjs");

const repositoryRoot = path.resolve(__dirname, "..");
const outputPath = path.join(repositoryRoot, "generated", "primitive-map.json");

const SHAPES = "net/minecraft/world/phys/shapes";
const FILES = {
  Shapes: `${SHAPES}/Shapes.java`,
  VoxelShape: `${SHAPES}/VoxelShape.java`,
  ArrayVoxelShape: `${SHAPES}/ArrayVoxelShape.java`,
  CubeVoxelShape: `${SHAPES}/CubeVoxelShape.java`,
  DiscreteVoxelShape: `${SHAPES}/DiscreteVoxelShape.java`,
  BitSetDiscreteVoxelShape: `${SHAPES}/BitSetDiscreteVoxelShape.java`,
  IndexMerger: `${SHAPES}/IndexMerger.java`,
  IndirectMerger: `${SHAPES}/IndirectMerger.java`,
  Cursor3D: "net/minecraft/core/Cursor3D.java",
  BlockCollisions: "net/minecraft/world/level/BlockCollisions.java",
  CollisionGetter: "net/minecraft/world/level/CollisionGetter.java",
  BlockGetter: "net/minecraft/world/level/BlockGetter.java",
  AABB: "net/minecraft/world/phys/AABB.java",
  Entity: "net/minecraft/world/entity/Entity.java",
};

/** native module::function -> `Class#method`, or `own` with the reason it ports nothing by itself. */
const PRIMITIVES = {
  "voxel_shape::empty": ["Shapes#empty"],
  "voxel_shape::from_box": ["Shapes#box", "Shapes#create"],
  "voxel_shape::union": ["Shapes#or", "Shapes#joinUnoptimized", "VoxelShape#optimize"],
  "voxel_shape::boxes": ["VoxelShape#toAabbs", "VoxelShape#forAllBoxes", "BitSetDiscreteVoxelShape#forAllBoxes"],
  "voxel_shape::is_empty": ["VoxelShape#isEmpty"],
  "voxel_shape::bounds": ["VoxelShape#bounds"],
  "voxel_shape::collide": ["VoxelShape#collide", "VoxelShape#collideX"],
  "voxel_shape::collide_in": ["VoxelShape#collide", "VoxelShape#collideX"],
  "voxel_shape::translated": ["VoxelShape#move"],
  "voxel_shape::rotated_y_quarters": { own: "a test and table builder: vanilla rotates by Shapes.rotate from 1.21.2, data before" },
  "voxel_shape::rotated_x_quarters": { own: "a test and table builder: see rotated_y_quarters" },
  "voxel_shape::rotated_z_quarters": { own: "a test and table builder: see rotated_y_quarters" },
  "collision::vanilla_equal": ["Shapes#collide"],
  "collision::clip_axis": ["VoxelShape#collide", "VoxelShape#collideX"],
  "collision::resolve_motion": ["Entity#collideBoundingBox", "Entity#collideWithShapes", "Shapes#collide"],
  "collision::reaches_into": ["VoxelShape#collideX"],
  "collision::new": { own: "the constructor of the engine's shape cell" },
  "collision::from_world": ["BlockCollisions#computeNext"],
  "collision::grid": ["ArrayVoxelShape#getCoords", "CubeVoxelShape#getCoords"],
  "collision::sort_in_cursor_order": ["BlockCollisions#computeNext", "Cursor3D#advance"],
  "collision::grid_lines": ["ArrayVoxelShape#getCoords", "CubeVoxelShape#getCoords"],
  "collision::collide_over_grid": ["VoxelShape#collideX"],
  "collision::collide": ["VoxelShape#collide"],
  "collision::collide_shapes": ["Shapes#collide", "Entity#collideWithShapes"],
  "collision::of": { own: "the constructor of a list element" },
  "collision::grid_bits": ["Shapes#findBits"],
  "collision::collide_legacy": { own: "before 1.13: AxisAlignedBB.calculateXOffset, Yarn's names, outside this table" },
  "block_traversal::blocks_visited": ["BlockGetter#traverseBlocks"],
  "block_traversal::blocks_visited_where": ["BlockGetter#traverseBlocks"],
  "block_traversal::box_traverse_blocks": ["BlockGetter#boxTraverseBlocks"],
  "block_traversal::blocks_intersected_between": ["BlockGetter#forEachBlockIntersectedBetween", "BlockGetter#addCollisionsAlongTravel"],
  "block_traversal::blocks_intersected_between_in_direction": ["BlockGetter#forEachBlockIntersectedBetween", "BlockGetter#addCollisionsAlongTravel"],
};

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/** Native's public functions of the modules the table covers. */
function nativePrimitives() {
  const found = [];
  for (const module of ["voxel_shape", "collision", "block_traversal"]) {
    const source = fs.readFileSync(path.join(repositoryRoot, "native", "src", `${module}.rs`), "utf8");
    const code = source.split(/#\[cfg\(test\)\]\s*mod\s/)[0];
    for (const match of code.matchAll(/^\s*pub(?:\(crate\))? fn ([a-z_0-9]+)/gm)) found.push(`${module}::${match[1]}`);
  }
  return [...new Set(found)].sort();
}

function declaredMethods(source) {
  const names = new Set();
  for (const match of source.matchAll(/^\s+(?:public|protected|private|static|final|abstract|default|synchronized|\s)*[\w<>[\], .?]+\s+([a-zA-Z_]\w*)\s*\([^;]*\)\s*(?:throws [\w, .]+)?\s*\{/gm)) names.add(match[1]);
  return names;
}

/** The shape classes' methods a method calls, followed to the end, `Class#method`. */
function helperChain(start, sources) {
  const seen = new Set();
  const visit = (reference) => {
    if (seen.has(reference)) return;
    const [owner, name] = reference.split("#");
    const source = sources.get(owner);
    // (a move's own class is no helper of the shapes: followed, Entity would bring the whole entity in)
    if (!source || (owner === "Entity" && reference !== start)) return;
    const declarations = declared(source, name);
    if (declarations.length === 0) return;
    seen.add(reference);
    for (const { source: body } of declarations) {
      for (const call of body.matchAll(/(?:\b([A-Z]\w*)\.)?\b([a-z]\w*)\(/g)) {
        const target = call[1] && sources.has(call[1]) ? call[1] : owner;
        if (call[2] !== name && sources.get(target)?.declared.has(call[2])) visit(`${target}#${call[2]}`);
      }
    }
  };
  visit(start);
  seen.delete(start);
  return [...seen].sort();
}

const parsed = new Map();
/** methodsNamed once for a text: most releases share these files. */
function declared(source, name) {
  const text = String(source);
  const key = `${sha256(text)}#${name}`;
  if (!parsed.has(key)) parsed.set(key, methodsNamed(text, name));
  return parsed.get(key);
}

function readSources(tree) {
  const sources = new Map();
  for (const [owner, relative] of Object.entries(FILES)) {
    const file = path.join(tree, relative);
    if (!fs.existsSync(file)) continue;
    const text = new String(fs.readFileSync(file, "utf8"));
    text.declared = declaredMethods(String(text));
    sources.set(owner, text);
  }
  return sources;
}

function generate() {
  const versions = registeredReleases().map(({ version }) => version);
  const declarations = {};
  const legacy = [];
  const unavailable = [];
  for (const version of versions) {
    if (compareReleases(version, "1.14") < 0) {
      legacy.push(version);
      continue;
    }
    const tree = modernTree(version);
    if (!tree) {
      unavailable.push(version);
      continue;
    }
    const sources = readSources(tree);
    for (const entry of Object.values(PRIMITIVES)) {
      if (!Array.isArray(entry)) continue;
      for (const reference of entry) {
        const [owner, name] = reference.split("#");
        const source = sources.get(owner);
        const found = source ? declared(source, name) : [];
        const fingerprint = found.length === 0 ? null : sha256(found.map((method) => method.source).join("\n"));
        const row = (declarations[reference] ??= { eras: [], helpers: {} });
        const last = row.eras.at(-1);
        if (!last || last.sha256 !== fingerprint) row.eras.push({ from: version, sha256: fingerprint });
        if (found.length > 0) row.helpers = helperChain(reference, sources);
      }
    }
  }
  return {
    schema: 1,
    generatedBy: "scripts/generate-primitive-map.cjs",
    mapped: versions.filter((version) => !legacy.includes(version) && !unavailable.includes(version)),
    yarnReleases: legacy,
    unavailable,
    primitives: PRIMITIVES,
    declarations: Object.fromEntries(Object.entries(declarations).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function main() {
  const missing = nativePrimitives().filter((name) => !PRIMITIVES[name]);
  if (missing.length > 0) throw new Error(`Native primitives with no entry: ${missing.join(", ")}`);
  const output = `${JSON.stringify(generate(), null, 1)}\n`;
  if (process.argv.includes("--check")) {
    const present = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8").replaceAll("\r\n", "\n") : "";
    if (present !== output) throw new Error("generated/primitive-map.json differs from a fresh generation");
    return;
  }
  fs.writeFileSync(`${outputPath}.tmp`, output);
  fs.renameSync(`${outputPath}.tmp`, outputPath);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { PRIMITIVES, nativePrimitives, helperChain, declaredMethods };
