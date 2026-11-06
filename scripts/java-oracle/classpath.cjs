// The classpath of a release's jar: the jar with Mojang's names at its pin, and the libraries its version json lists,
// found by their maven coordinates in Mojang's or Gradle's library folders with the sha1 the json gives. A jar that
// is not the pinned one throws: the oracle's answer is only that release's answer if the code running is.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PINNED_CLIENTS, CLIENT_DATA, clientJarRoot } = require("../source-pins.cjs");

const sha1 = (file) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");

/** The Mojang-named jar of a release: its client from 26.1, which ships unobfuscated, else the jar unimined remapped. */
function namedJar(version, root = clientJarRoot()) {
  const directory = path.join(root, version);
  const client = path.join(directory, `minecraft-${version}-client.jar`);
  const pinned = PINNED_CLIENTS[version]?.client ?? CLIENT_DATA[version] ?? null;
  if (!fs.existsSync(client)) throw new Error(`No client jar of ${version}: ${client}`);
  const digest = sha1(client);
  if (pinned && digest !== pinned) throw new Error(`The client jar of ${version} is ${digest}, pinned ${pinned}`);
  if (Number(version.split(".")[0]) >= 26) return { jar: client, client: digest, remapped: false };
  const mapped = path.join(directory, `intermediary-${version}-mojmap-${version}`,
    `minecraft-${version}-fabric-merged+custom-no-environment+fixed-mojmap+intermediary.jar`);
  if (!fs.existsSync(mapped)) throw new Error(`No Mojang-named jar of ${version}: ${mapped}`);
  return { jar: mapped, client: digest, remapped: true };
}

function libraryRoots() {
  const home = os.homedir();
  return {
    mojang: process.env.MC_LIBRARY_ROOT ?? path.join(home, "AppData", "Roaming", ".minecraft", "libraries"),
    gradle: process.env.MC_GRADLE_MODULES ?? path.join(home, ".gradle", "caches", "modules-2", "files-2.1"),
  };
}

function findLibrary(artifactPath, expected, roots) {
  const mojang = path.join(roots.mojang, artifactPath);
  if (fs.existsSync(mojang) && sha1(mojang) === expected) return mojang;
  const parts = artifactPath.split("/");
  const file = parts.pop();
  const release = parts.pop();
  const name = parts.pop();
  // (Gradle names the folder after the sha1 as a number: leading zeros dropped)
  const gradle = path.join(roots.gradle, parts.join("."), name, release, expected.replace(/^0+/, ""), file);
  return fs.existsSync(gradle) && sha1(gradle) === expected ? gradle : null;
}

/** The jars a release runs on; a library with no copy of the json's sha1 is named, not swapped for a neighbour. */
function classpath(version, root = clientJarRoot()) {
  const { jar, client, remapped } = namedJar(version, root);
  const json = JSON.parse(fs.readFileSync(path.join(root, version, "version.json"), "utf8"));
  const roots = libraryRoots();
  const jars = [jar];
  const missing = [];
  for (const library of json.libraries) {
    const artifact = library.downloads?.artifact;
    if (!artifact) continue;
    const allowed = (library.rules ?? []).every((rule) => rule.action === "allow"
      ? !rule.os || rule.os.name === "windows" : rule.os?.name !== "windows");
    if (!allowed) continue;
    const found = findLibrary(artifact.path, artifact.sha1, roots);
    if (found) jars.push(found);
    else missing.push(library.name);
  }
  return { jars, missing, client, remapped, java: json.javaVersion?.majorVersion ?? 8 };
}

module.exports = { classpath, namedJar };
