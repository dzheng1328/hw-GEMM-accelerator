# Portfolio app

A static page that replays this project's recorded RTL-simulation results.
It has no backend and does not run the simulator.

## Commands

Run these in `web/`.

- `npm run dev` starts the dev server.
- `npm run build:data` regenerates `src/data/generated/` from `../docs/perf/*.json`.
- `npm test` runs the unit, component, schema and freshness tests.
- `npm run build` type-checks and builds `dist/`.
- `npm run e2e` runs the Playwright smoke tests at phone and desktop widths.
- `npm run lint` runs ESLint.

## The one rule about data

`src/data/generated/` is generated and committed, and is never edited by hand.
After re-running `make lm`, `make cifar` or `make scaling` in `tb/accel/`, run `npm run build:data` and commit the result.
CI fails with the exact fix command until you do.

## Deploy

Vercel builds this directory only.
Project settings: root directory `web/`, build command `npm run build`, output directory `dist`, install command `npm ci`.
Vercel never runs the generator, so the generated files must be committed.
