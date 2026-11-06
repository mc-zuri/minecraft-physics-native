# Building a release

How a package is rebuilt from a clean checkout, what is pinned, and what reproducibility is claimed. Nothing here publishes
anything.

## Targets

`package.json` `napi.targets` and `TARGETS` in `scripts/native-artifacts.cjs` are the declared targets, and a test keeps
them equal:

| target | package | built on |
| --- | --- | --- |
| `x86_64-pc-windows-msvc` | `index.win32-x64-msvc.node` | Windows x64 |
| `x86_64-unknown-linux-gnu` | `index.linux-x64-gnu.node` | Linux x64, glibc |
| `wasm32-wasip1-threads` | `index.wasm32-wasi.wasm`, loaders, workers | any, with the wasm target added |
| `wasm32-wasip1` | `index.wasm32-wasip1.wasm`, loaders | any, with the wasm target added |

Not declared: macOS (no host has built or run it), Linux musl, Linux arm64. The generated loader has branches for them, and
an addon under one of those names is refused.

A tarball holds the targets named on its build, so it is one host's distribution; there is no combined tarball yet, since
no host builds both native targets.

## Pinned inputs

| input | pin |
| --- | --- |
| Rust | `rust-toolchain.toml`; `release-build.cjs` refuses another `rustc` |
| Rust dependencies | `native/Cargo.lock` |
| Node | major in `package.json` `engines`, checked by `release-build.cjs`; the exact version is recorded |
| pnpm and JavaScript dependencies | `package.json` `packageManager`, `pnpm-lock.yaml` |
| modern release sources | `PINNED_SOURCES`, `PINNED_CLIENTS` in `scripts/source-pins.cjs`, each held to the release it embeds |
| legacy release sources | the trees under `MC_DECOMPILED_ROOT`, held to the release they embed |
| minecraft-data | `MINECRAFT_DATA` in `scripts/source-pins.cjs` (commit, with its data submodule) |

The Rust pin is exact. With rustup, a checkout selects that toolchain by itself, and a host whose toolchain has another name
sets `RUSTUP_TOOLCHAIN`. A Rust install outside rustup ignores the file and is checked all the same; it has no wasm standard
library.

## Locations

Every external input is named by a variable. The defaults are a development layout; a clean host sets them all.
Manifests record a source as `<pin>:<path>` or `mc-source:<path>`, never by where these happen to be, so the layout does not reach
generated output. All of `MODERN_TREES` are required: generators prefer such a tree when it exists, so one that is merely absent
would change the output with no error.

| variable | holds |
| --- | --- |
| `MC_SOURCE_ROOT` | `26.2/client`, `26.3/client` |
| `MC_SOURCE_CACHE` | what `scripts/materialize-sources.cjs` unpacks and decompiles |
| `MC_DECOMPILED_ROOT` | the Yarn-named trees: the six legacy releases and `MODERN_TREES` of `scripts/bootstrap-inputs.cjs`; each tree's `net/` and `data/minecraft/tags/` are what is read |
| `MC_EXTRACTED_DATA_REPO`, `MC_DATA_REPO` | the extracted data repository, with `origin/client<release>` |
| `MC_CLIENT_JAR_ROOT`, `MC_DECOMPILER_JAR` | client jars and Vineflower, to materialize a pinned client and to run `generate-block-shapes` and `generate-entity-data` |
| `MC_LIBRARY_ROOT`, `MC_GRADLE_MODULES` | the libraries those jars run with, found by coordinates and sha1 |
| `MC_MINECRAFT_DATA` | the minecraft-data checkout, when it is not `../minecraft-data` (a worktree) |

## From a clean checkout

```sh
git clone <repository> minecraft-physics-native && cd minecraft-physics-native
corepack enable                               # or a pnpm of the pinned version
node scripts/bootstrap-inputs.cjs             # clones ../minecraft-data at its pin, checks every source and jar (--cached leaves out the jars)
pnpm install --frozen-lockfile
node scripts/materialize-sources.cjs          # only where MC_SOURCE_CACHE is not already filled
node scripts/release-build.cjs --out ../out                       # data, addon, types, provenance, tarball
node scripts/consumer-check.cjs ../out/<tarball> --work <empty> --out ../out/consumer
```

`release-build.cjs` takes `--target <triple>` (repeated, the host's native target by default) and `--data`:

- `full` regenerates everything. Before it starts, `bootstrap-inputs.cjs` must find every release's exact source; a missing or
  wrong-release input stops the run and names the release.
- `cached` keeps the tables of a release whose sources or jars are absent, and the record says `cached`. Everything whose input
  is at hand is still regenerated, so on a host with the sources but not the jars the block shapes and entity data stay as committed.
- `tracked` regenerates nothing and takes the committed tables, for a target that does not need them made twice. The record
  says `tracked`; `generatedHash` and `sourceHash` still say which tables they were.

The WebAssembly targets need `rustup target add wasm32-wasip1 wasm32-wasip1-threads` on the pinned toolchain.
`scripts/wasm-check.cjs <tarball>` needs a tarball holding the host's addon and both wasm builds.

## What a package says of itself

The addon and the wasm modules carry the hash of the sources they were compiled from and their Rust target (`native/build.rs`,
`buildIdentity()`). `native/artifacts/provenance.<artifact>.json` records for one target the commit, toolchain, compiler
settings, input hashes and the sha256 of every file shipped with it. It holds no time and no path.

`scripts/build-provenance.cjs` `packageProblems` holds a package to its records, in the staged copy, in the unpacked tarball
and in the installed package: each file has its hash, each binary carries the recorded sources and target (read from its
bytes, so this works on a host that cannot load it), all records are of one build, and nothing is unrecorded.
`scripts/verify-native-package.cjs` does what a working tree allows: the host's addon was built from the sources now here, the
declarations and `NativePhysicsBinding` agree with its exports, and the release inventory holds.

## Generated files

`GENERATED` in `scripts/generated-inventory.cjs` lists every generated file with the step that makes it and what that step
reads. `pass: all` files are stages of `scripts/generate-all.cjs`, whose `--check` regenerates and compares them. The rest
cannot be made from the pinned sources alone: `network` reads Mojang's live list and `oracle` reads jars and dumps of running
clients. Those stay as committed in a clean build, and their pinned identity is the commit.

## Reproducibility policy

`scripts/compare-builds.cjs <a.report.json> <b.report.json>` applies this to two runs:

- **Inputs** must be equal on every host, line endings aside: `sourceHash`, `generatedHash`, `adapterHash`, the locks and pins.
  Two runs that disagree here are not the same release.
- **Two builds of one target** must give equal bytes for every shipped file, the binary included. The build strips the
  checkout and Cargo home from the binaries with `--remap-path-prefix`, so the directory does not count, and links with
  `/Brepro` on MSVC, whose linker would otherwise stamp the time and a random PDB id.
- **Different targets** share their inputs and differ in their binaries by construction. Each has its own record. Identical
  results between them are shown by running them (`wasm-check.cjs` compares ticks to the bit), never by their hashes.

