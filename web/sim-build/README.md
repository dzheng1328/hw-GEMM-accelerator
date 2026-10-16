# Simulator build

This folder builds the committed WebAssembly chip that the "Run it live" section runs.

## What is committed

`web/src/live/sim/artifacts/` holds, for each of the 1x1, 2x2 and 4x4 meshes, an Emscripten ES module (`cifar-<mesh>.mjs`) and its `.wasm`.
It also holds the program image per mesh, the weight image, the TypeScript reference's model (`cifar-model.json`), the ten built-in examples, golden data for tests, and `manifest.json`.
The manifest records the sha256 of every source file the artifacts depend on.
A Vitest test (`web/src/live/sim/freshness.test.ts`) fails in CI when the RTL, the compiler inputs or these scripts change without a rebuild.

## Rebuilding

Needs Verilator and Emscripten on PATH (`brew install verilator emscripten`).

    .venv/bin/python web/sim-build/build_sim.py            everything
    .venv/bin/python web/sim-build/build_sim.py data       the data files only, no toolchain
    .venv/bin/python web/sim-build/build_sim.py wasm 2x2   one mesh (refused if the sources changed since the last full build)

Then run `npm test` in `web/` and commit `web/src/live/sim/artifacts/`.
A rebuild from unchanged sources is byte-identical, so a rebuild that changes the artifacts means a source changed.

## Build traps

- The pytest tests in this folder run locally only; CI protects the committed artifacts through the Vitest tests in `web/src/live/sim/`.
- Verilator's own headers have no spin-wait for WebAssembly, so the build defines `VL_IGNORE_UNKNOWN_ARCH`.
- Verilator adds macOS-only `-U` linker flags and `-pthread`; the build overrides `LDFLAGS` and `LDLIBS`.
- `verilated_threads.cpp` references three thread functions; the harness stubs them, and the model is single-threaded.
- The first `eval()` runs the initial blocks, which zero the memories, so the images are loaded after it.
- `rtl/sim_mem.v` calls `$value$plusargs`; Verilator aborts the first `eval()` unless the context got `commandArgs` first, so `sim_init` sets them.
- The Verilator top module is `accel`, not the cocotb wrapper, so the harness drives the clock itself.
- This folder has `build_sim.py` and not `build.py` because `data.py` imports the compiler's own `build` module.

## Measured, 2026-10-16

Cycles per image (the same for every image): 1x1 313,539; 2x2 139,981; 3x3 138,957 (not built); 4x4 136,987.
Wasm size: 1x1 553 KB, 2x2 1.02 MB, 4x4 2.90 MB.

Chip run time in each browser, main thread, one image, on an Apple-silicon laptop (`web/scripts/bench-browsers.ts`):

| browser | mesh | cycles | load ms | run ms | status |
|---|---|---:|---:|---:|---|
| chromium | 1x1 | 313539 | 28 | 519 | ok |
| chromium | 2x2 | 139981 | 17 | 940 | ok |
| chromium | 4x4 | 136987 | 19 | 5263 | ok |
| firefox | 1x1 | 313539 | 88 | 865 | ok |
| firefox | 2x2 | 139981 | 97 | 1987 | ok |
| firefox | 4x4 | 136987 | 107 | 8840 | ok |
| webkit | 1x1 | 313539 | 23 | 1856 | ok |
| webkit | 2x2 | 139981 | 21 | 3138 | ok |
| webkit | 4x4 | 136987 | 23 | 11361 | ok |

The 4x4 mesh is the slow one, because its model has 16 nodes to evaluate every cycle, even though the run needs about the same number of cycles as 2x2.
A phone will be slower than these numbers, so the page shows a progress state while the worker runs.

Program-address layer spans on 2x2 (from `layers.chip.test.ts`):

- conv1: 0..11528 (11528)
- conv2: 11528..32211 (20683)
- conv3: 32211..71564 (39353)
- conv4: 71564..91285 (19721)
- conv5: 91285..130320 (39035)
- fc: 130320..139981 (9661)
