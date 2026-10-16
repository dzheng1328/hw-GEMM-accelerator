// Runs one built mesh once on the first built-in example and prints {cycles, recordBytes} as JSON.
// Used by build_sim.py to record the cycle count in the manifest; needs no browser.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const art = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "live", "sim", "artifacts");
const mesh = process.argv[2];
if (!mesh) throw new Error("usage: node measure.mjs <mesh>");

const create = (await import(pathToFileURL(join(art, `cifar-${mesh}.mjs`)).href)).default;
const m = await create();
const program = readFileSync(join(art, `program-${mesh}.bin`));
const weights = readFileSync(join(art, "weights.bin"));
const example = JSON.parse(readFileSync(join(art, "examples.json"), "utf8"))[3];
const image = Buffer.from(example.packed, "base64");

const put = (bytes) => {
  const ptr = m._malloc(bytes.length);
  m.HEAPU8.set(bytes, ptr);
  return ptr;
};
m._sim_init();
const p = put(program);
const w = put(weights);
const i = put(image);
if (m._sim_load(p, program.length / 8, w, weights.length / 8) !== 0) throw new Error("sim_load failed");
if (m._sim_set_input(i, image.length / 8) !== 0) throw new Error("sim_set_input failed");
const cycles = m._sim_run(2_000_000);
if (cycles <= 0) throw new Error(`sim_run returned ${cycles}`);
console.log(JSON.stringify({ cycles, recordBytes: m._sim_record_bytes() }));
