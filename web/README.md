# Portfolio app

A static page that replays this project's recorded RTL-simulation results, and runs the real RTL in the visitor's browser.
It has no backend. The "Run it live" section runs the chip, compiled to WebAssembly, in a Web Worker.

## Commands

Run these in `web/`.

- `npm run dev` starts the dev server.
- `npm run build:data` regenerates `src/data/generated/` from `../docs/perf/*.json`.
- `npm test` runs the unit, component, schema and freshness tests.
- `npm run build` type-checks and builds `dist/`.
- `npm run e2e` runs the Playwright smoke tests at phone and desktop widths.
- `npm run lint` runs ESLint.
- `.venv/bin/python web/sim-build/build_sim.py` (at the repo root) rebuilds the committed simulator in `src/live/sim/artifacts/`; it needs Verilator and Emscripten (see `sim-build/README.md`).

## The one rule about data

`src/data/generated/` is generated and committed, and is never edited by hand.
After re-running `make lm`, `make cifar` or `make scaling` in `tb/accel/`, run `npm run build:data` and commit the result.
After retraining the tokenizer, run `python model/export_vocab.py` first, then `npm run build:data`.
CI fails with the exact fix command until you do.

## Deploy

Vercel builds this directory only.
Project settings: root directory `web/`, build command `npm run build`, output directory `dist`, install command `npm ci`.
Vercel never runs the generator, so the generated files must be committed.

## The timeline is authored, not generated

`src/content/timeline.ts` is written by hand, so the freshness check does not cover it.
`src/content/timeline.test.ts` ties it to the repository instead: each node cites a `docs/decisions.md` entry by date and the start of its title, every number in a node's metric must appear in that entry, and a node can name a field of `performance.json` that its metric must match.
If a decisions heading is renamed, the test fails with the node id and the missing heading, and the fix is a one-line edit to the node.

## The chip and the verification content are authored, not generated

`src/content/architecture.ts` and `src/content/verification.ts` are written by hand, so the freshness check does not cover them.
Their tests read `rtl/`, `tb/*/Makefile`, `test.sh`, `docs/decisions.md` and `docs/specs/` from the repository and fail with the block or row id and the missing path, make target or heading.
Every negative check the page lists must be run by `test.sh`, and every `*-check` target `test.sh` runs must be listed on the page.
A block's number must equal a field of `performance.json` or appear in the decisions entry it cites.
The web workflow runs for changes under those directories as well as under `web/`, so a rename in the RTL or the testbenches fails the web job instead of silently breaking the page.

## The live demo's simulator is committed, not built in CI

`src/live/sim/artifacts/` holds the WebAssembly build of `rtl/accel.v` for the 1x1, 2x2 and 4x4 meshes, its program and weight images, golden test data and a manifest of source hashes.
CI has no Verilator or Emscripten, so it cannot rebuild them; instead `src/live/sim/freshness.test.ts` fails with the exact rebuild command when the RTL, the compiler inputs or the build scripts change without a rebuild, and `chip.test.ts` runs the committed `.wasm` in Node and requires bit-exact logits against the Python reference's golden data.
The page checks every run against an independent TypeScript implementation of the network (`src/live/reference/`), which is tested against the same golden data.
The 3D scene (`three.js`, `@react-three/fiber`) is a lazy chunk that the entry bundle must not contain; `e2e/live.spec.ts` checks that against `dist/`.
