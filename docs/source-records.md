# Source records

Every registered release has one record in `generated/release-manifest.json`, written by
`scripts/generate-release-manifest.cjs`. `scripts/source-admission.cjs` decides whether it can be cited, and
`test/source-admission.test.cjs` holds it to that.

## Schema

| Field | Meaning |
| --- | --- |
| `release` | The exact release id. |
| `versionJsonSha1` | Mojang's version json, for the distribution's identity. |
| `mappings.kind`, `mappings.sha1` | `mojang` with the client mappings' sha1, `unobfuscated` for 26.x, `unpublished` before 1.14.4. |
| `source.status` | `embedded`, `alias`, or a refusal: `directory-only`, `rejected`, `stand-in`, `unavailable`. |
| `source.embedded` | The release the source names inside itself, never a branch or folder name. |
| `source.commit` | The immutable commit of the extracted data repository. |
| `source.clientJar.sha1` | The client jar, as Mojang's version json declares it. |
| `source.clientJar.remappedSha256` | The jar remapped to Mojang's names by unimined. |
| `source.decompiler` | The tool and revision that produced the sources. |
| `source.tree` | sha256 of a local tree's `.java` files, by relative path, line endings aside. |
| `source.mapping` | The names the source is in. |
| `source.rejectedRef` | A branch that names this release and embeds another. Never read. |
| `source.scope`, `source.evidence` | For an alias: what it covers, and the hash of its proof. |

The distribution side is the client. Server jars are used only by the alias proofs in
`generated/release-aliases.json` and by `src/mineflayer/data-aliases.json`.

## Admission

`sourceRecordProblems` fails a record, naming the release, when:

- the source embeds another release, or is not `embedded` or `alias`;
- the mappings are missing, or a Mojang mapping has no sha1, or the source is in other names;
- a commit, client jar or remapped jar differs from `scripts/source-pins.cjs`;
- nothing identifies the source.

`node scripts/release-admission.cjs <version>` shows this as its `source` dimension.

## Standing

| Releases | Status | Input |
| --- | --- | --- |
| 1.8.8 | `alias` | 1.8.9, proved by `generated/release-aliases.json` (21 of 2541 classes differ, each reviewed) |
| 1.9.4, 1.10.2, 1.11.2, 1.12.2, 1.13.2 | `blocked` | see below |
| 1.14.4, 1.18.1, 1.19, 1.19.1, 1.19.3, 1.19.4, 1.20 to 1.21.11 except 1.20.x gaps below, 26.1, 26.1.1 | `exact` | pinned commit |
| 1.15, 1.15.1, 1.15.2, 1.16 to 1.16.5, 1.17, 1.17.1, 1.18, 1.18.2, 1.19.2 | `exact` | client jar, unimined remap, vineflower 1.12.0 |
| 26.1.2 | `exact` | client jar, vineflower 1.12.0 |
| 26.2, 26.3 | `exact` | `E:/pr/mc-source` tree, with its hash and the client jar's sha1 |

1.16.4 keeps `rejectedRef`: `origin/client1.16.4` embeds 20w45a. Its record comes from the client jar instead.

### The blocked legacy releases

For 1.9.4 to 1.13.2 the sources are local yarn-named decompiled trees. Each tree embeds its release, and the
record now pins its hash and the client jar. The jar's sha1 is the one the version json pinned in the manifest
declares, and the cached jars have it.

Two things cannot be established, so the status is `blocked` and no release here can be admitted:

- no record says which decompiler or yarn build produced the trees (`yarn +build.541` in the Gradle cache
  is what the recorder uses, which does not show the trees came from it);
- nothing shows that a tree was decompiled from that jar.

The fix is to decompile those jars with a pinned tool, as `scripts/materialize-sources.cjs` does for later
releases, and to record the result. That changes the trees' text and needs the data regenerated and reviewed.

## Downstream

`generated/conformance-evidence.json` cites the hash of the source record, so changing a release's source
takes its trace claims. `node scripts/verify-version-coverage.cjs --fresh` re-reads the inputs of the
generators. An input that changes is replaced in `source-pins.cjs`, and the old value stays in git.
