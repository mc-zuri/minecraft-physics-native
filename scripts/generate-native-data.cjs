const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { Worker } = require("node:worker_threads");

const root = path.resolve(__dirname, "..");
const stateManifest = JSON.parse(fs.readFileSync(
  path.join(root, "generated", "block-state-definitions.json"),
  "utf8",
));
const registryManifest = JSON.parse(fs.readFileSync(
  path.join(root, "generated", "block-registries.json"),
  "utf8",
));
const versionsManifest = JSON.parse(fs.readFileSync(
  path.join(root, "generated", "minecraft-versions.json"),
  "utf8",
));
const outputDir = path.join(root, "native", "data");
const releaseDir = path.join(outputDir, "releases");
const output = path.join(outputDir, "mod.rs");

function rustString(value) {
  return JSON.stringify(String(value));
}

function rustFloat(value) {
  const text = String(value);
  return text.includes(".") ? text : `${text}.0`;
}

function versionName(version) {
  return `v${version.replaceAll(".", "_")}`;
}

function methodFingerprint(source, name) {
  const signature = new RegExp(`\\b${name}\\s*\\([^)]*\\)\\s*\\{`, "m").exec(source);
  if (!signature) return null;
  const body = methodBody(source, name);
  return crypto
    .createHash("sha256")
    .update(`${signature[0]}${body}`)
    .digest("hex");
}

function hasShapeMethod(source, name) {
  return new RegExp(`\\b(?:public|protected|private)\\s+(?:static\\s+)?VoxelShape\\s+${name}\\s*\\(`).test(source);
}

function methodBody(source, name) {
  let sourceCache = methodBody.cache.get(source);
  if (!sourceCache) {
    sourceCache = new Map();
    methodBody.cache.set(source, sourceCache);
  }
  const cached = sourceCache.get(name);
  if (cached !== undefined) return cached;
  const signature = new RegExp(`\\b${name}\\s*\\([^)]*\\)\\s*\\{`, "m").exec(source);
  if (!signature) {
    sourceCache.set(name, "");
    return "";
  }
  const opening = signature.index + signature[0].lastIndexOf("{");
  let depth = 0;
  let state = "code";
  for (let index = opening; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (current === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (state === "string") {
      if (current === "\\" ) index += 1;
      else if (current === "\"") state = "code";
      continue;
    }
    if (state === "char") {
      if (current === "\\" ) index += 1;
      else if (current === "'") state = "code";
      continue;
    }
    if (current === "/" && next === "/") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      state = "block-comment";
      index += 1;
      continue;
    }
    if (current === "\"") {
      state = "string";
      continue;
    }
    if (current === "'") {
      state = "char";
      continue;
    }
    if (current === "{") {
      depth += 1;
      continue;
    }
    if (current === "}") {
      depth -= 1;
      if (depth === 0) {
        const body = source.slice(opening + 1, index);
        sourceCache.set(name, body);
        return body;
      }
    }
  }
  sourceCache.set(name, "");
  return "";
}
methodBody.cache = new Map();

function shapeBoxes(source) {
  const boxes = [...source.matchAll(
    /(?:(?:Block|Shapes)\.)?box\(\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:F|D)?)\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:F|D)?)\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:F|D)?)\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:F|D)?)\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:F|D)?)\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:F|D)?)\s*\)/g,
  )].map((match) => match.slice(1).map((value) => Number(value.replace(/[FD]$/, ""))));
  return [...new Map(boxes.map((box) => [box.join(","), box])).values()];
}

function shapeConstantBoxes(source) {
  const constants = new Map();
  for (const match of source.matchAll(
    /\b(?:public|protected|private)?\s*static\s+(?:final\s+)?VoxelShape\s+([A-Z0-9_]+)\s*=\s*([\s\S]*?);/g,
  )) {
    constants.set(match[1], match[2]);
  }
  return constants;
}

function methodShapeBoxes(source, name) {
  const body = methodBody(source, name);
  const constants = shapeConstantBoxes(source);
  const expressions = [body];
  const visited = new Set();
  while (expressions.length > 0) {
    const expression = expressions.pop();
    for (const identifier of expression.match(/[A-Z][A-Z0-9_]+/g) ?? []) {
      if (visited.has(identifier)) continue;
      const constant = constants.get(identifier);
      if (!constant) continue;
      visited.add(identifier);
      expressions.push(constant);
    }
  }
  return shapeBoxes([body, ...visited].map((entry) => constants.get(entry) ?? entry).join("\n"));
}

function shapeLiteral(boxes) {
  return boxes
    .map((box) => `GeneratedShapeBox { min: [${rustFloat(box[0] / 16)}, ${rustFloat(box[1] / 16)}, ${rustFloat(box[2] / 16)}], max: [${rustFloat(box[3] / 16)}, ${rustFloat(box[4] / 16)}, ${rustFloat(box[5] / 16)}] }`)
    .join(", ");
}

function shapePropertyDependencies(source) {
  return [...new Set(
    [...javaCode(source).matchAll(/\.getValue\(\s*(?:(?:BlockStateProperties|[A-Za-z0-9_]+)\.)?([A-Z][A-Z0-9_]*)\s*\)/g)]
      .map((match) => match[1]),
  )].sort();
}

function methodShapePropertyDependencies(source, name) {
  return shapePropertyDependencies(methodBody(source, name));
}

function shapePredicates(source) {
  const code = javaCode(source);
  const predicates = [];
  for (const match of code.matchAll(/getValue\(\s*(?:(?:BlockStateProperties|[A-Za-z0-9_]+)\.)?([A-Z][A-Z0-9_]*)\s*\)\s*(==|!=)\s*([A-Za-z0-9_.]+)/g)) {
    predicates.push([match[1], match[2], match[3]]);
  }
  for (const match of code.matchAll(/([A-Za-z0-9_.]+)\s*(==|!=)\s*getValue\(\s*(?:(?:BlockStateProperties|[A-Za-z0-9_]+)\.)?([A-Z][A-Z0-9_]*)\s*\)/g)) {
    predicates.push([match[3], match[2], match[1]]);
  }
  return [...new Map(predicates.map((predicate) => [predicate.join("\0"), predicate])).values()]
    .sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
}

function methodShapePredicates(source, name) {
  return shapePredicates(methodBody(source, name));
}

function javaCode(source) {
  let result = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (current === "\n") {
        state = "code";
        result += current;
      } else {
        result += " ";
      }
      continue;
    }
    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        state = "code";
        result += "  ";
        index += 1;
      } else {
        result += current === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state === "string" || state === "char") {
      if (current === "\\") {
        result += "  ";
        index += 1;
      } else if ((state === "string" && current === "\"") || (state === "char" && current === "'")) {
        state = "code";
        result += " ";
      } else {
        result += current === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (current === "/" && next === "/") {
      state = "line-comment";
      result += "  ";
      index += 1;
    } else if (current === "/" && next === "*") {
      state = "block-comment";
      result += "  ";
      index += 1;
    } else if (current === "\"") {
      state = "string";
      result += " ";
    } else if (current === "'") {
      state = "char";
      result += " ";
    } else {
      result += current;
    }
  }
  return result;
}

function methodShapeIsStateDependent(source, name) {
  const body = javaCode(methodBody(source, name));
  return /\.getValue\s*\(|\bgetFluidState\s*\(|\bswitch\s*\(|\bis\s*\(|\?/.test(body);
}

function indexJavaSources(rootPath) {
  const index = new Map();
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".java")) {
        const className = entry.name.slice(0, -5);
        if (index.has(className)) {
          index.set(className, null);
        } else {
          index.set(className, entryPath);
        }
      }
    }
  };
  visit(rootPath);
  return index;
}

function precomputeSourceIndexes(sourceRoots) {
  const roots = [...new Set(sourceRoots)].sort();
  if (roots.length < 2) return new Map([[roots[0], indexJavaSources(roots[0])]]);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mineflayer-physics-index-"));
  const completion = new SharedArrayBuffer(4);
  const completed = new Int32Array(completion);
  const requestedWorkers = Number.parseInt(process.env.GENERATOR_WORKERS ?? "", 10);
  const defaultWorkers = os.availableParallelism?.() ?? 4;
  const maxWorkers = Math.max(1, Math.min(8, Number.isFinite(requestedWorkers) ? requestedWorkers : defaultWorkers));
  for (let offset = 0; offset < roots.length; offset += maxWorkers) {
    const batch = roots.slice(offset, offset + maxWorkers);
    const workers = batch.map((sourceRoot, batchIndex) => {
      const index = offset + batchIndex;
      return new Worker(`
    const fs = require("node:fs");
    const path = require("node:path");
    const { workerData } = require("node:worker_threads");
    const result = {};
    function visit(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(entryPath);
        } else if (entry.isFile() && entry.name.endsWith(".java")) {
          const className = entry.name.slice(0, -5);
          if (Object.prototype.hasOwnProperty.call(result, className)) result[className] = null;
          else result[className] = entryPath;
        }
      }
    }
    try {
      visit(workerData.sourceRoot);
      fs.writeFileSync(workerData.outputPath, JSON.stringify(result));
    } catch (error) {
      fs.writeFileSync(workerData.outputPath + ".error", String(error && (error.stack || error)));
    }
    Atomics.add(new Int32Array(workerData.completion), 0, 1);
    Atomics.notify(new Int32Array(workerData.completion), 0);
      `, {
        eval: true,
        workerData: {
          sourceRoot,
          outputPath: path.join(temporaryRoot, `${index}.json`),
          completion,
        },
      });
    });
    while (Atomics.load(completed, 0) < offset + batch.length) {
      Atomics.wait(completed, 0, Atomics.load(completed, 0), 1000);
    }
    for (const worker of workers) worker.unref();
    for (let index = offset; index < offset + batch.length; index += 1) {
      const errorPath = path.join(temporaryRoot, `${index}.json.error`);
      if (fs.existsSync(errorPath)) throw new Error(fs.readFileSync(errorPath, "utf8"));
    }
  }
  const indexes = new Map();
  for (const [index, sourceRoot] of roots.entries()) {
    const entries = JSON.parse(fs.readFileSync(path.join(temporaryRoot, `${index}.json`), "utf8"));
    indexes.set(sourceRoot, new Map(Object.entries(entries)));
  }
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  return indexes;
}

function sourceWithSuperclasses(sourcePath, sourceIndex) {
  const cacheKey = `${sourcePath}\0${sourceIndex.size}`;
  const cached = sourceWithSuperclasses.cache?.get(cacheKey);
  if (cached !== undefined) return cached;
  const sources = [];
  const visited = new Set();
  let currentPath = sourcePath;
  for (let depth = 0; currentPath && depth < 16; depth += 1) {
    if (visited.has(currentPath)) break;
    visited.add(currentPath);
    const source = sourceWithSuperclasses.sourceCache.get(currentPath)
      ?? sourceWithSuperclasses.sourceCache.set(currentPath, fs.readFileSync(currentPath, "utf8")).get(currentPath);
    sources.push(source);
    const parent = /(?:class|interface|enum)\s+\w+\s+extends\s+([A-Za-z0-9_]+)/.exec(source)?.[1];
    currentPath = parent ? sourceIndex.get(parent) : null;
  }
  const result = sources.join("\n");
  sourceWithSuperclasses.cache ??= new Map();
  sourceWithSuperclasses.cache.set(cacheKey, result);
  return result;
}
sourceWithSuperclasses.sourceCache = new Map();
sourceWithSuperclasses.cache = new Map();

const lines = [
  "// @generated by scripts/generate-native-data.cjs; do not edit.",
  "#![allow(dead_code)]",
  "",
  "pub struct GeneratedBlock<'a> {",
  "    pub id: &'a str,",
  "    pub class_name: Option<&'a str>,",
  "    pub properties: &'a [GeneratedProperty<'a>],",
  "    pub property_order: &'a [&'a str],",
  "    pub state_count: Option<usize>,",
  "    pub has_collision_shape_method: bool,",
  "    pub has_outline_shape_method: bool,",
  "    pub has_interaction_shape_method: bool,",
  "    pub collision_shape_sha256: Option<&'a str>,",
  "    pub outline_shape_sha256: Option<&'a str>,",
  "    pub interaction_shape_sha256: Option<&'a str>,",
  "    pub source_shape_boxes: &'a [GeneratedShapeBox],",
  "    pub collision_shape_boxes: &'a [GeneratedShapeBox],",
  "    pub outline_shape_boxes: &'a [GeneratedShapeBox],",
  "    pub interaction_shape_boxes: &'a [GeneratedShapeBox],",
  "    pub shape_property_dependencies: &'a [&'a str],",
  "    pub collision_shape_property_dependencies: &'a [&'a str],",
  "    pub outline_shape_property_dependencies: &'a [&'a str],",
  "    pub interaction_shape_property_dependencies: &'a [&'a str],",
  "    pub collision_shape_predicates: &'a [GeneratedShapePredicate<'a>],",
  "    pub outline_shape_predicates: &'a [GeneratedShapePredicate<'a>],",
  "    pub interaction_shape_predicates: &'a [GeneratedShapePredicate<'a>],",
  "    pub collision_shape_state_dependent: bool,",
  "    pub outline_shape_state_dependent: bool,",
  "    pub interaction_shape_state_dependent: bool,",
  "}",
  "",
  "pub struct GeneratedProperty<'a> {",
  "    pub name: &'a str,",
  "    pub kind: &'a str,",
  "    pub values: &'a [&'a str],",
  "    pub defaults: &'a [&'a str],",
  "}",
  "",
  "#[derive(Clone, Copy)]",
  "pub struct GeneratedShapeBox {",
  "    pub min: [f64; 3],",
  "    pub max: [f64; 3],",
  "}",
  "",
  "pub struct GeneratedShapeProvenance<'a> {",
  "    pub source_sha256: Option<&'a str>,",
  "    pub has_method: bool,",
  "    pub state_dependent: bool,",
  "    pub property_dependencies: &'a [&'a str],",
  "    pub candidate_box_count: usize,",
  "}",
  "",
  "pub struct GeneratedShapePredicate<'a> {",
  "    pub property: &'a str,",
  "    pub operator: &'a str,",
  "    pub value: &'a str,",
  "}",
  "",
  "pub struct GeneratedRelease<'a> {",
  "    pub version: &'a str,",
  "    pub blocks: &'a [GeneratedBlock<'a>],",
  "    pub fluids: &'a [GeneratedFluid<'a>],",
  "    pub fluid_tags: &'a [GeneratedFluidTag<'a>],",
  "    pub block_tags: &'a [GeneratedBlockTag<'a>],",
  "}",
  "",
  "pub struct GeneratedFluid<'a> {",
  "    pub id: &'a str,",
  "    pub source: bool,",
  "    pub state_count: usize,",
  "    pub property_names: &'a [&'a str],",
  "    pub property_values: &'a [&'a str],",
  "    pub property_domains: &'a [&'a [&'a str]],",
  "    pub tick_delay: Option<u32>,",
  "    pub normal_drop_off: Option<u32>,",
  "    pub source_sha256: &'a str,",
  "    pub flow_sha256: Option<&'a str>,",
  "    pub height_sha256: Option<&'a str>,",
  "    pub amount_sha256: Option<&'a str>,",
  "}",
  "",
  "pub struct GeneratedFluidTag<'a> {",
  "    pub id: &'a str,",
  "    pub source_sha256: &'a str,",
  "}",
  "",
  "pub struct GeneratedBlockTag<'a> {",
  "    pub id: &'a str,",
  "    pub source_sha256: &'a str,",
  "    pub blocks: &'a [&'a str],",
  "    pub includes: &'a [&'a str],",
  "    pub membership_sha256: &'a str,",
  "}",
  "",
];

const sourceRoots = Object.keys(registryManifest.versions).map((version) => {
  const state = stateManifest.releases[version];
  return path.resolve(root, "generated", state.sourceRoot, "..", "..", "..", "..", "..");
});
const sourceIndexes = precomputeSourceIndexes(sourceRoots);
for (const version of Object.keys(registryManifest.versions).sort()) {
  const registry = registryManifest.versions[version];
  const state = stateManifest.releases[version];
  const name = versionName(version);
  const sourceRoot = path.resolve(
    root,
    "generated",
    state.sourceRoot,
    "..", "..", "..", "..", "..",
  );
  const sourceIndex = sourceIndexes.get(sourceRoot);
  const fluidRoot = path.join(sourceRoot, "net", "minecraft", "world", "level", "material");
  const fluidFiles = {
    water: path.join(fluidRoot, "WaterFluid.java"),
    lava: path.join(fluidRoot, "LavaFluid.java"),
  };
  const fluidTagsPath = path.join(sourceRoot, "net", "minecraft", "tags", "FluidTags.java");
  const fluidTagsSource = fs.readFileSync(fluidTagsPath, "utf8");
  const fluidTags = [
    ...fluidTagsSource.matchAll(/public\s+static\s+final\s+(?:[A-Za-z0-9_<>]+)<Fluid>\s+([A-Z0-9_]+)\s*=\s*(?:create|bind)\("([^"]+)"\)/g),
  ];
  const fluidTagsSha256 = crypto.createHash("sha256").update(fluidTagsSource).digest("hex");
  const blockTagsPath = path.join(sourceRoot, "net", "minecraft", "tags", "BlockTags.java");
  const blockTagsSource = fs.readFileSync(blockTagsPath, "utf8");
  const blockTags = [
    ...blockTagsSource.matchAll(/public\s+static\s+final\s+(?:[A-Za-z0-9_<>]+)<Block>\s+([A-Z0-9_]+)\s*=\s*(?:create|bind)\("([^"]+)"\)/g),
  ];
  const blockTagsSha256 = crypto.createHash("sha256").update(blockTagsSource).digest("hex");
  const tagMemberships = new Map(blockTags.map((match) => [match[1], { blocks: new Set(), includes: new Set() }]));
  const tagProviderRoot = path.join(sourceRoot, "net", "minecraft", "data", "tags");
  const tagProviderFiles = fs.readdirSync(tagProviderRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".java"))
    .map((entry) => path.join(tagProviderRoot, entry.name));
  const tagMembershipSource = tagProviderFiles
    .sort()
    .map((filePath) => `${path.basename(filePath)}:${fs.readFileSync(filePath, "utf8")}`)
    .join("\n");
  const tagMembershipSha256 = crypto.createHash("sha256").update(tagMembershipSource).digest("hex");
  for (const filePath of tagProviderFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    for (const match of source.matchAll(/this\.tag\(BlockTags\.([A-Z0-9_]+)\)([\s\S]*?);/g)) {
      const membership = tagMemberships.get(match[1]);
      if (!membership) continue;
      for (const block of match[2].matchAll(/Blocks\.([A-Z0-9_]+)/g)) membership.blocks.add(block[1].toLowerCase());
      for (const included of match[2].matchAll(/BlockTags\.([A-Z0-9_]+)/g)) {
        if (included[1] !== match[1]) membership.includes.add(included[1].toLowerCase());
      }
    }
  }
  for (const flowing of [false, true]) {
    for (const fluid of Object.keys(fluidFiles)) {
      const propertyId = `${name}_${flowing ? "FLOWING_" : ""}${fluid}`.toUpperCase();
      const flowingSource = fs.readFileSync(path.join(fluidRoot, "FlowingFluid.java"), "utf8");
      const propertiesSource = fs.readFileSync(
        path.join(sourceRoot, "net", "minecraft", "world", "level", "block", "state", "properties", "BlockStateProperties.java"),
        "utf8",
      );
      const levelDomain = /LEVEL_FLOWING\s*=\s*IntegerProperty\.create\(\s*"[^"]+"\s*,\s*(-?\d+)\s*,\s*(\d+)\s*\)/.exec(propertiesSource);
      const fallingDefined = /createFluidStateDefinition\s*\([^)]*\)\s*\{[\s\S]*?\.add\(\s*FALLING\s*\)/.test(flowingSource);
      if (!levelDomain || !fallingDefined) {
        throw new Error(`Cannot prove flowing-fluid state definition for ${version}: ${fluid}`);
      }
      const levelValues = levelDomain
        ? Array.from({ length: Number(levelDomain[2]) - Number(levelDomain[1]) + 1 }, (_, index) => String(Number(levelDomain[1]) + index))
        : [];
      const propertyNames = flowing ? ["LEVEL", "FALLING"] : ["FALLING"];
      const propertyValues = flowing
        ? [...levelValues, "false", "true"]
        : ["false", "true"];
      const domainIds = flowing
        ? [`${propertyId}_LEVEL_VALUES`, `${propertyId}_FALLING_VALUES`]
        : [`${propertyId}_FALLING_VALUES`];
      if (flowing) {
        lines.push(`pub static ${propertyId}_LEVEL_VALUES: &[&str] = &[${levelValues.map(rustString).join(", ")}];`);
      }
      lines.push(`pub static ${propertyId}_FALLING_VALUES: &[&str] = &[${["false", "true"].map(rustString).join(", ")}];`);
      lines.push(`pub static ${propertyId}_PROPERTY_DOMAINS: &[&[&str]] = &[${domainIds.join(", ")}];`);
      lines.push(`pub static ${propertyId}_PROPERTY_NAMES: &[&str] = &[${propertyNames.map(rustString).join(", ")}];`);
      lines.push(`pub static ${propertyId}_PROPERTY_VALUES: &[&str] = &[${propertyValues.map(rustString).join(", ")}];`);
      lines.push(`pub static ${propertyId}_STATE_COUNT: usize = ${flowing && fallingDefined && levelValues.length > 0 ? levelValues.length * 2 : (!flowing && fallingDefined ? 2 : 0)};`);
    }
  }
  lines.push(`pub static ${name.toUpperCase()}_FLUIDS: &[GeneratedFluid<'static>] = &[`);
  for (const [fluid, filePath] of Object.entries(fluidFiles)) {
    const source = fs.readFileSync(filePath, "utf8");
    const tick = /getTickDelay\([\s\S]*?return\s+(\d+);/.exec(source)?.[1] ?? null;
    const drop = /getDropOff\([\s\S]*?return\s+(\d+);/.exec(source)?.[1] ?? null;
    for (const flowing of [false, true]) {
      const sourceSha256 = crypto.createHash("sha256").update(source).digest("hex");
      const flowSha256 = methodFingerprint(source, "getFlow");
      const heightSha256 = methodFingerprint(source, "getHeight");
      const amountSha256 = methodFingerprint(source, "getAmount");
      const propertyId = `${name}_${flowing ? "FLOWING_" : ""}${fluid}`.toUpperCase();
      lines.push(`    GeneratedFluid { id: ${rustString(`${flowing ? "flowing_" : ""}${fluid}`)}, source: ${!flowing}, state_count: ${propertyId}_STATE_COUNT, property_names: ${propertyId}_PROPERTY_NAMES, property_values: ${propertyId}_PROPERTY_VALUES, property_domains: ${propertyId}_PROPERTY_DOMAINS, tick_delay: ${tick === null ? "None" : `Some(${tick})`}, normal_drop_off: ${drop === null ? "None" : `Some(${drop})`}, source_sha256: ${rustString(sourceSha256)}, flow_sha256: ${flowSha256 === null ? "None" : `Some(${rustString(flowSha256)})`}, height_sha256: ${heightSha256 === null ? "None" : `Some(${rustString(heightSha256)})`}, amount_sha256: ${amountSha256 === null ? "None" : `Some(${rustString(amountSha256)})`} },`);
    }
  }
  lines.push("];", "");
  lines.push(`pub static ${name.toUpperCase()}_FLUID_TAGS: &[GeneratedFluidTag<'static>] = &[`);
  for (const match of fluidTags) {
    lines.push(`    GeneratedFluidTag { id: ${rustString(match[2])}, source_sha256: ${rustString(fluidTagsSha256)} },`);
  }
  lines.push("];", "");
  for (const match of blockTags) {
    const membership = tagMemberships.get(match[1]) ?? { blocks: new Set(), includes: new Set() };
    const tagId = `${name}_${match[2]}`.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
    lines.push(`pub static ${tagId}_BLOCKS: &[&str] = &[${[...membership.blocks].sort().map(rustString).join(", ")}];`);
    lines.push(`pub static ${tagId}_INCLUDES: &[&str] = &[${[...membership.includes].sort().map(rustString).join(", ")}];`);
  }
  lines.push(`pub static ${name.toUpperCase()}_BLOCK_TAGS: &[GeneratedBlockTag<'static>] = &[`);
  for (const match of blockTags) {
    const tagId = `${name}_${match[2]}`.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
    lines.push(`    GeneratedBlockTag { id: ${rustString(match[2].toLowerCase())}, source_sha256: ${rustString(blockTagsSha256)}, blocks: ${tagId}_BLOCKS, includes: ${tagId}_INCLUDES, membership_sha256: ${rustString(tagMembershipSha256)} },`);
  }
  lines.push("];", "");
  for (const id of registry.blocks) {
    const className = registry.classes[id]?.className;
    const block = className ? state.blocks[className] : null;
    const properties = block ? Object.entries(block.properties) : [];
    for (const [propertyName, property] of properties) {
      const propertyId = `${name}_${id}_${propertyName}`.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
      const values = property.domain.values ?? [];
      const defaults = property.defaults ?? [];
      lines.push(`pub static ${propertyId}_VALUES: &[&str] = &[${values.map(rustString).join(", ")}];`);
      lines.push(`pub static ${propertyId}_DEFAULTS: &[&str] = &[${defaults.map(rustString).join(", ")}];`);
    }
    if (properties.length > 0) lines.push("");
    const blockId = `${name}_${id}`.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
    lines.push(`pub static ${blockId}_PROPERTIES: &[GeneratedProperty<'static>] = &[`);
    for (const [propertyName, property] of properties) {
      const propertyId = `${name}_${id}_${propertyName}`.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
      lines.push(`    GeneratedProperty { name: ${rustString(propertyName)}, kind: ${rustString(property.domain.kind)}, values: ${propertyId}_VALUES, defaults: ${propertyId}_DEFAULTS },`);
    }
    lines.push("];", "");
  }
  for (const id of registry.blocks) {
    const className = registry.classes[id]?.className ?? null;
    const blockId = `${name}_${id}`.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
    const orderId = `${blockId}_PROPERTY_ORDER`;
    const propertyOrder = className && state.blocks[className]?.propertyOrder
      ? state.blocks[className].propertyOrder
      : [];
    lines.push(`pub static ${orderId}: &[&str] = &[${propertyOrder.map(rustString).join(", ")}];`);
  }
  lines.push("");
  const shapePool = new Map();
  let shapePoolIndex = 0;
  const pooledShapeId = (boxes) => {
    const key = JSON.stringify(boxes);
    const existing = shapePool.get(key);
    if (existing) return existing;
    const id = `${name.toUpperCase()}_SHAPE_POOL_${shapePoolIndex}`;
    shapePoolIndex += 1;
    shapePool.set(key, id);
    lines.push(`pub static ${id}: &[GeneratedShapeBox] = &[${shapeLiteral(boxes)}];`);
    return id;
  };
  const dependencyPool = new Map();
  let dependencyPoolIndex = 0;
  const pooledDependencies = (properties) => {
    const key = JSON.stringify(properties);
    const existing = dependencyPool.get(key);
    if (existing) return existing;
    const id = `${name.toUpperCase()}_DEPENDENCY_POOL_${dependencyPoolIndex}`;
    dependencyPoolIndex += 1;
    dependencyPool.set(key, id);
    lines.push(`pub static ${id}: &[&str] = &[${properties.map(rustString).join(", ")}];`);
    return id;
  };
  const predicatePool = new Map();
  let predicatePoolIndex = 0;
  const pooledPredicates = (predicates) => {
    const key = JSON.stringify(predicates);
    const existing = predicatePool.get(key);
    if (existing) return existing;
    const id = `${name.toUpperCase()}_PREDICATE_POOL_${predicatePoolIndex}`;
    predicatePoolIndex += 1;
    predicatePool.set(key, id);
    lines.push(`pub static ${id}: &[GeneratedShapePredicate<'static>] = &[${predicates.map(([property, operator, value]) => `GeneratedShapePredicate { property: ${rustString(property)}, operator: ${rustString(operator)}, value: ${rustString(value)} }`).join(", ")}];`);
    return id;
  };
  for (const id of registry.blocks) {
    const className = registry.classes[id]?.className ?? null;
    const block = className ? state.blocks[className] : null;
    const source = block
      ? sourceWithSuperclasses(path.resolve(root, "generated", block.source), sourceIndex)
      : "";
    const directSource = block
      ? fs.readFileSync(path.resolve(root, "generated", block.source), "utf8")
      : "";
    const sourceShapeBoxes = shapeBoxes(source);
    const blockId = `${name}_${id}`.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
    const shapeId = pooledShapeId(sourceShapeBoxes);
    const methodShapeIds = {
      collision: pooledShapeId(methodShapeBoxes(source, "getCollisionShape")),
      outline: pooledShapeId(methodShapeBoxes(source, "getShape")),
      interaction: pooledShapeId(methodShapeBoxes(source, "getInteractionShape")),
    };
    const dependencyId = pooledDependencies(shapePropertyDependencies(source));
    const methodDependencyIds = {
      collision: pooledDependencies(methodShapePropertyDependencies(source, "getCollisionShape")),
      outline: pooledDependencies(methodShapePropertyDependencies(source, "getShape")),
      interaction: pooledDependencies(methodShapePropertyDependencies(source, "getInteractionShape")),
    };
    const methodPredicateIds = {
      collision: pooledPredicates(methodShapePredicates(source, "getCollisionShape")),
      outline: pooledPredicates(methodShapePredicates(source, "getShape")),
      interaction: pooledPredicates(methodShapePredicates(source, "getInteractionShape")),
    };
    const methodStateDependent = {
      collision: methodShapeIsStateDependent(source, "getCollisionShape"),
      outline: methodShapeIsStateDependent(source, "getShape"),
      interaction: methodShapeIsStateDependent(source, "getInteractionShape"),
    };
  }
  lines.push("");
  lines.push(`pub static ${name.toUpperCase()}_BLOCKS: &[GeneratedBlock<'static>] = &[`);
  for (const id of registry.blocks) {
    const className = registry.classes[id]?.className ?? null;
    const blockId = `${name}_${id}`.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
    const block = className ? state.blocks[className] : null;
    const properties = block ? Object.values(block.properties) : [];
    const stateCount = properties.every((property) => Array.isArray(property.domain.values) && property.domain.values.length > 0)
      ? properties.reduce((count, property) => count * property.domain.values.length, 1)
      : null;
    const source = block
      ? sourceWithSuperclasses(path.resolve(root, "generated", block.source), sourceIndex)
      : "";
    const directSource = block
      ? fs.readFileSync(path.resolve(root, "generated", block.source), "utf8")
      : "";
    const hasCollisionShapeMethod = hasShapeMethod(directSource, "getCollisionShape");
    const hasOutlineShapeMethod = hasShapeMethod(directSource, "getShape");
    const hasInteractionShapeMethod = hasShapeMethod(directSource, "getInteractionShape");
    const collisionShapeSha256 = methodFingerprint(directSource, "getCollisionShape");
    const outlineShapeSha256 = methodFingerprint(directSource, "getShape");
    const interactionShapeSha256 = methodFingerprint(directSource, "getInteractionShape");
    const shapeId = pooledShapeId(shapeBoxes(source));
    const methodShapeIds = {
      collision: pooledShapeId(methodShapeBoxes(source, "getCollisionShape")),
      outline: pooledShapeId(methodShapeBoxes(source, "getShape")),
      interaction: pooledShapeId(methodShapeBoxes(source, "getInteractionShape")),
    };
    const orderId = `${blockId}_PROPERTY_ORDER`;
    const dependencyId = pooledDependencies(shapePropertyDependencies(source));
    const methodDependencyIds = {
      collision: pooledDependencies(methodShapePropertyDependencies(source, "getCollisionShape")),
      outline: pooledDependencies(methodShapePropertyDependencies(source, "getShape")),
      interaction: pooledDependencies(methodShapePropertyDependencies(source, "getInteractionShape")),
    };
    const methodPredicateIds = {
      collision: pooledPredicates(methodShapePredicates(source, "getCollisionShape")),
      outline: pooledPredicates(methodShapePredicates(source, "getShape")),
      interaction: pooledPredicates(methodShapePredicates(source, "getInteractionShape")),
    };
    const methodStateDependent = {
      collision: hasCollisionShapeMethod && methodShapeIsStateDependent(source, "getCollisionShape"),
      outline: hasOutlineShapeMethod && methodShapeIsStateDependent(source, "getShape"),
      interaction: hasInteractionShapeMethod && methodShapeIsStateDependent(source, "getInteractionShape"),
    };
    lines.push(`    GeneratedBlock { id: ${rustString(id)}, class_name: ${className === null ? "None" : `Some(${rustString(className)})`}, properties: ${blockId}_PROPERTIES, property_order: ${orderId}, state_count: ${stateCount === null ? "None" : `Some(${stateCount})`}, has_collision_shape_method: ${hasCollisionShapeMethod}, has_outline_shape_method: ${hasOutlineShapeMethod}, has_interaction_shape_method: ${hasInteractionShapeMethod}, collision_shape_sha256: ${collisionShapeSha256 === null ? "None" : `Some(${rustString(collisionShapeSha256)})`}, outline_shape_sha256: ${outlineShapeSha256 === null ? "None" : `Some(${rustString(outlineShapeSha256)})`}, interaction_shape_sha256: ${interactionShapeSha256 === null ? "None" : `Some(${rustString(interactionShapeSha256)})`}, source_shape_boxes: ${shapeId}, collision_shape_boxes: ${methodShapeIds.collision}, outline_shape_boxes: ${methodShapeIds.outline}, interaction_shape_boxes: ${methodShapeIds.interaction}, shape_property_dependencies: ${dependencyId}, collision_shape_property_dependencies: ${methodDependencyIds.collision}, outline_shape_property_dependencies: ${methodDependencyIds.outline}, interaction_shape_property_dependencies: ${methodDependencyIds.interaction}, collision_shape_predicates: ${methodPredicateIds.collision}, outline_shape_predicates: ${methodPredicateIds.outline}, interaction_shape_predicates: ${methodPredicateIds.interaction}, collision_shape_state_dependent: ${methodStateDependent.collision}, outline_shape_state_dependent: ${methodStateDependent.outline}, interaction_shape_state_dependent: ${methodStateDependent.interaction} },`);
  }
  lines.push("];", "");
  lines.push(`pub static ${name.toUpperCase()}_STATE_CLASS_COUNT: usize = ${state.blockClassCount};`, "");
}

lines.push("pub static RELEASES: &[GeneratedRelease<'static>] = &[");
for (const version of Object.keys(registryManifest.versions).sort()) {
  lines.push(`    GeneratedRelease { version: ${rustString(version)}, blocks: ${versionName(version).toUpperCase()}_BLOCKS, fluids: ${versionName(version).toUpperCase()}_FLUIDS, fluid_tags: ${versionName(version).toUpperCase()}_FLUID_TAGS, block_tags: ${versionName(version).toUpperCase()}_BLOCK_TAGS },`);
}
lines.push("];", "");
lines.push("pub fn release(version: &str) -> Option<&'static GeneratedRelease<'static>> {");
lines.push("    RELEASES.iter().find(|release| release.version == version)");
lines.push("}", "");
lines.push("pub fn block(version: &str, id: &str) -> Option<&'static GeneratedBlock<'static>> {");
lines.push("    release(version)?.blocks.iter().find(|block| block.id == id)");
lines.push("}", "");
lines.push("pub fn source_shape_boxes(version: &str, id: &str) -> Option<&'static [GeneratedShapeBox]> {");
lines.push("    Some(block(version, id)?.source_shape_boxes)");
lines.push("}", "");
lines.push("pub fn method_shape_boxes(version: &str, id: &str, kind: &str) -> Option<&'static [GeneratedShapeBox]> {");
lines.push("    let block = block(version, id)?;");
lines.push("    match kind {");
lines.push("        \"collision\" => block.has_collision_shape_method.then_some(block.collision_shape_boxes),");
lines.push("        \"outline\" => block.has_outline_shape_method.then_some(block.outline_shape_boxes),");
lines.push("        \"interaction\" => block.has_interaction_shape_method.then_some(block.interaction_shape_boxes),");
lines.push("        _ => None,");
lines.push("    }");
lines.push("}", "");
lines.push("pub fn exact_method_shape_boxes(version: &str, id: &str, kind: &str) -> Option<&'static [GeneratedShapeBox]> {");
lines.push("    let block = block(version, id)?;");
lines.push("    match kind {");
lines.push("        \"collision\" if block.has_collision_shape_method && !block.collision_shape_state_dependent => Some(block.collision_shape_boxes),");
lines.push("        \"outline\" if block.has_outline_shape_method && !block.outline_shape_state_dependent => Some(block.outline_shape_boxes),");
lines.push("        \"interaction\" if block.has_interaction_shape_method && !block.interaction_shape_state_dependent => Some(block.interaction_shape_boxes),");
lines.push("        _ => None,");
lines.push("    }");
lines.push("}", "");
lines.push("pub fn shape_property_dependencies(version: &str, id: &str) -> Option<&'static [&'static str]> {");
lines.push("    Some(block(version, id)?.shape_property_dependencies)");
lines.push("}", "");
lines.push("pub fn method_shape_predicates(version: &str, id: &str, kind: &str) -> Option<&'static [GeneratedShapePredicate<'static>]> {");
lines.push("    let block = block(version, id)?;");
lines.push("    match kind {");
lines.push("        \"collision\" => block.has_collision_shape_method.then_some(block.collision_shape_predicates),");
lines.push("        \"outline\" => block.has_outline_shape_method.then_some(block.outline_shape_predicates),");
lines.push("        \"interaction\" => block.has_interaction_shape_method.then_some(block.interaction_shape_predicates),");
lines.push("        _ => None,");
lines.push("    }");
lines.push("}", "");
lines.push("pub fn method_shape_predicates_match_state(version: &str, id: &str, kind: &str, values: &[(&str, &str)]) -> Option<bool> {");
lines.push("    let block = block(version, id)?;");
lines.push("    state_index(version, id, values)?;");
lines.push("    let predicates = match kind {");
lines.push("        \"collision\" if block.has_collision_shape_method => block.collision_shape_predicates,");
lines.push("        \"outline\" if block.has_outline_shape_method => block.outline_shape_predicates,");
lines.push("        \"interaction\" if block.has_interaction_shape_method => block.interaction_shape_predicates,");
lines.push("        _ => return None,");
lines.push("    };");
lines.push("    Some(predicates.iter().all(|predicate| values.iter().find(|(name, _)| *name == predicate.property).map(|(_, value)| { let expected = predicate.value.rsplit('.').next().unwrap_or(predicate.value); match predicate.operator { \"==\" => value.eq_ignore_ascii_case(expected), \"!=\" => !value.eq_ignore_ascii_case(expected), _ => false } }).unwrap_or(false)))");
lines.push("}", "");
lines.push("pub fn method_shape_property_dependencies(version: &str, id: &str, kind: &str) -> Option<&'static [&'static str]> {");
lines.push("    let block = block(version, id)?;");
lines.push("    match kind {");
lines.push("        \"collision\" => block.has_collision_shape_method.then_some(block.collision_shape_property_dependencies),");
lines.push("        \"outline\" => block.has_outline_shape_method.then_some(block.outline_shape_property_dependencies),");
lines.push("        \"interaction\" => block.has_interaction_shape_method.then_some(block.interaction_shape_property_dependencies),");
lines.push("        _ => None,");
lines.push("    }");
lines.push("}", "");
lines.push("pub fn method_shape_is_state_dependent(version: &str, id: &str, kind: &str) -> Option<bool> {");
lines.push("    let block = block(version, id)?;");
lines.push("    match kind {");
lines.push("        \"collision\" => block.has_collision_shape_method.then_some(block.collision_shape_state_dependent),");
lines.push("        \"outline\" => block.has_outline_shape_method.then_some(block.outline_shape_state_dependent),");
lines.push("        \"interaction\" => block.has_interaction_shape_method.then_some(block.interaction_shape_state_dependent),");
lines.push("        _ => None,");
lines.push("    }");
lines.push("}", "");
lines.push("pub fn method_shape_provenance(version: &str, id: &str, kind: &str) -> Option<GeneratedShapeProvenance<'static>> {");
lines.push("    let block = block(version, id)?;");
lines.push("    match kind {");
lines.push("        \"collision\" => Some(GeneratedShapeProvenance { source_sha256: block.collision_shape_sha256, has_method: block.has_collision_shape_method, state_dependent: block.collision_shape_state_dependent, property_dependencies: block.collision_shape_property_dependencies, candidate_box_count: block.collision_shape_boxes.len() }),");
lines.push("        \"outline\" => Some(GeneratedShapeProvenance { source_sha256: block.outline_shape_sha256, has_method: block.has_outline_shape_method, state_dependent: block.outline_shape_state_dependent, property_dependencies: block.outline_shape_property_dependencies, candidate_box_count: block.outline_shape_boxes.len() }),");
lines.push("        \"interaction\" => Some(GeneratedShapeProvenance { source_sha256: block.interaction_shape_sha256, has_method: block.has_interaction_shape_method, state_dependent: block.interaction_shape_state_dependent, property_dependencies: block.interaction_shape_property_dependencies, candidate_box_count: block.interaction_shape_boxes.len() }),");
lines.push("        _ => None,");
lines.push("    }");
lines.push("}", "");
lines.push("pub fn state_index(version: &str, id: &str, values: &[(&str, &str)]) -> Option<usize> {");
lines.push("    let block = block(version, id)?;");
lines.push("    if block.properties.iter().any(|property| property.values.is_empty()) { return None; }");
lines.push("    if values.len() != block.properties.len() { return None; }");
lines.push("    if values.iter().any(|(name, _)| block.properties.iter().filter(|property| property.name == *name).count() != 1) { return None; }");
lines.push("    if block.properties.iter().any(|property| values.iter().filter(|(name, _)| *name == property.name).count() != 1) { return None; }");
lines.push("    let mut properties: Vec<&GeneratedProperty<'static>> = block.properties.iter().collect();");
lines.push("    properties.sort_by_key(|property| property.name);");
lines.push("    let mut index = 0usize;");
lines.push("    let mut stride = 1usize;");
lines.push("    for property in properties.iter().rev() {");
lines.push("        let value = values.iter().find(|(name, _)| *name == property.name)?.1;");
lines.push("        let position = property.values.iter().position(|candidate| *candidate == value)?;");
lines.push("        index = index.checked_add(position.checked_mul(stride)?)?;");
lines.push("        stride = stride.checked_mul(property.values.len())?;");
lines.push("    }");
lines.push("    (values.len() == block.properties.len()).then_some(index)");
lines.push("}", "");
lines.push("pub fn fluid(version: &str, id: &str) -> Option<&'static GeneratedFluid<'static>> {");
lines.push("    release(version)?.fluids.iter().find(|fluid| fluid.id == id)");
lines.push("}", "");
lines.push("pub fn fluid_state_index(version: &str, id: &str, values: &[(&str, &str)]) -> Option<usize> {");
lines.push("    let fluid = fluid(version, id)?;");
lines.push("    if fluid.state_count == 0 || values.len() != fluid.property_names.len() { return None; }");
lines.push("    if fluid.property_names.iter().any(|property_name| values.iter().filter(|(name, _)| *name == *property_name).count() != 1) { return None; }");
lines.push("    if values.iter().any(|(name, _)| fluid.property_names.iter().filter(|property_name| **property_name == *name).count() != 1) { return None; }");
lines.push("    let mut positions: Vec<(&str, usize, usize)> = Vec::with_capacity(fluid.property_names.len());");
lines.push("    for property_name in fluid.property_names {");
lines.push("        let value = values.iter().find(|(name, _)| *name == *property_name)?.1;");
lines.push("        let property_index = fluid.property_names.iter().position(|candidate| *candidate == *property_name)?;");
lines.push("        let domain = *fluid.property_domains.get(property_index)?;");
lines.push("        let position = domain.iter().position(|candidate| *candidate == value)?;");
lines.push("        let domain_len = domain.len();");
lines.push("        positions.push((*property_name, position, domain_len));");
lines.push("    }");
lines.push("    positions.sort_by_key(|(name, _, _)| *name);");
lines.push("    let mut index = 0usize;");
lines.push("    let mut stride = 1usize;");
lines.push("    for (_, position, domain_len) in positions.iter().rev() {");
lines.push("        index = index.checked_add(position.checked_mul(stride)?)?;");
lines.push("        stride = stride.checked_mul(*domain_len)?;");
lines.push("    }");
lines.push("    (index < fluid.state_count).then_some(index)");
lines.push("}", "");
lines.push("pub fn fluid_tag(version: &str, id: &str) -> Option<&'static GeneratedFluidTag<'static>> {");
lines.push("    release(version)?.fluid_tags.iter().find(|tag| tag.id == id)");
lines.push("}", "");
lines.push("pub fn block_tag(version: &str, id: &str) -> Option<&'static GeneratedBlockTag<'static>> {");
lines.push("    release(version)?.block_tags.iter().find(|tag| tag.id == id)");
lines.push("}", "");
lines.push("pub fn block_has_tag(version: &str, block: &str, tag: &str) -> bool {");
lines.push("    fn visit(release: &GeneratedRelease<'static>, block: &str, tag: &str, visited: &mut Vec<&'static str>) -> bool {");
lines.push("        if visited.contains(&tag) { return false; }");
lines.push("        let Some(definition) = release.block_tags.iter().find(|candidate| candidate.id == tag) else { return false; };");
lines.push("        if definition.blocks.iter().any(|candidate| *candidate == block) { return true; }");
lines.push("        visited.push(definition.id);");
lines.push("        let found = definition.includes.iter().any(|included| visit(release, block, included, visited));");
lines.push("        visited.pop();");
lines.push("        found");
lines.push("    }");
lines.push("    release(version).is_some_and(|release| visit(release, block, tag, &mut Vec::new()))");
lines.push("}", "");

const firstReleaseLine = lines.findIndex((line) => /^pub static V\d+_\d+.*_WATER_FALLING_VALUES:/.test(line));
const releasesLine = lines.findIndex((line) => line === "pub static RELEASES: &[GeneratedRelease<'static>] = &[");
if (firstReleaseLine < 0 || releasesLine < 0 || firstReleaseLine >= releasesLine) {
  throw new Error("Generated data layout markers are missing");
}

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(releaseDir, { recursive: true });
for (const entry of fs.readdirSync(outputDir)) {
  if (/^v\d+_\d+(?:_\d+)?\.rs$/.test(entry)) fs.unlinkSync(path.join(outputDir, entry));
}
for (const entry of fs.readdirSync(releaseDir)) {
  if (/^v\d+_\d+(?:_\d+)?\.rs$/.test(entry)) fs.unlinkSync(path.join(releaseDir, entry));
}

const header = lines.slice(0, firstReleaseLine);
const releaseData = lines.slice(firstReleaseLine, releasesLine);
const versionStarts = [];
for (let index = 0; index < releaseData.length; index += 1) {
  const match = /^pub static (V\d+_\d+(?:_\d+)?)_WATER_FALLING_VALUES:/.exec(releaseData[index]);
  if (match) versionStarts.push({ index, module: match[1].toLowerCase() });
}
if (versionStarts.length !== Object.keys(registryManifest.versions).length) {
  throw new Error(`Expected ${Object.keys(registryManifest.versions).length} generated release modules, found ${versionStarts.length}`);
}
for (let index = 0; index < versionStarts.length; index += 1) {
  const current = versionStarts[index];
  const next = versionStarts[index + 1]?.index ?? releaseData.length;
  fs.writeFileSync(
    path.join(releaseDir, `${current.module}.rs`),
    `// @generated by scripts/generate-native-data.cjs; do not edit.\n#![allow(dead_code)]\nuse super::*;\n\n${releaseData.slice(current.index, next).join("\n")}\n`,
  );
}

const modules = versionStarts
  .map(({ module }) => `#[path = "releases/${module}.rs"]\nmod ${module};\npub use ${module}::*;`)
  .join("\n");
fs.writeFileSync(
  output,
  `${header.join("\n")}\n${modules}\n\n${lines.slice(releasesLine).join("\n")}\n`,
);
const legacyOutput = path.join(root, "native", "src", "generated_data.rs");
if (fs.existsSync(legacyOutput)) fs.unlinkSync(legacyOutput);
