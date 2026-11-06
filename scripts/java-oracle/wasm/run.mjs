// Runs oracle-wasm.wasm under Node's WASI: node scripts/java-oracle/wasm/run.mjs path/to/oracle-wasm.wasm
import { readFile } from 'node:fs/promises';
import { WASI } from 'node:wasi';

const wasi = new WASI({ version: 'preview1', args: ['oracle-wasm'] });
const module = await WebAssembly.compile(await readFile(process.argv[2]));
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
process.exitCode = wasi.start(instance);
