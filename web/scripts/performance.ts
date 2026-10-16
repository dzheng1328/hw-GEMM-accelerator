import type { CifarRun, LmRuns, LmTrace, Scaling } from "./schema";

const PORT_KEYS = ["operand", "go", "stall", "wait", "credit", "other"] as const;
type PortKey = (typeof PORT_KEYS)[number];

interface Counters {
  run_cyc: number;
  slot_cyc: number;
  go_cyc: number;
  inj_stall_cyc: number;
  wait_cyc: number;
  credit_cyc: number;
  other_cyc: number;
}

interface MeshInput {
  mesh: string;
  cycles: number;
  units: number;
  counters: Counters;
  mesh_perf: {
    corner: { lcl_in_xfer: number; lcl_in_stall: number; out_xfer_l: number; out_xfer_n: number; out_xfer_e: number };
    feed_cyc: number[];
  };
}

function port(c: Counters) {
  const cycles: Record<PortKey, number> = {
    operand: c.slot_cyc,
    go: c.go_cyc,
    stall: c.inj_stall_cyc,
    wait: c.wait_cyc,
    credit: c.credit_cyc,
    other: c.other_cyc,
  };
  const sum = PORT_KEYS.reduce((a, k) => a + cycles[k], 0);
  if (sum !== c.run_cyc) throw new Error(`the injection-port partition sums to ${sum}, not run_cyc ${c.run_cyc}`);
  const shares = Object.fromEntries(PORT_KEYS.map((k) => [k, cycles[k] / c.run_cyc])) as Record<PortKey, number>;
  return { cycles, shares };
}

function dimensions(mesh: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(mesh);
  if (!m) throw new Error(`unexpected mesh name "${mesh}"`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

function meshRecord(input: MeshInput, baselineCycles: number) {
  const { width, height } = dimensions(input.mesh);
  const run = input.counters.run_cyc;
  if (input.cycles !== run) throw new Error(`${input.mesh}: cycles ${input.cycles} differ from run_cyc ${run}`);
  const tileUtilization = input.mesh_perf.feed_cyc.map((f) => f / run);
  if (tileUtilization.length !== width * height) {
    throw new Error(`${input.mesh}: ${tileUtilization.length} tiles in the counters, expected ${width * height}`);
  }
  const corner = input.mesh_perf.corner;
  return {
    mesh: input.mesh,
    width,
    height,
    tiles: width * height,
    cycles: input.cycles,
    cyclesPerUnit: input.cycles / input.units,
    speedup: baselineCycles / input.cycles,
    macUtilization: tileUtilization.reduce((a, b) => a + b, 0) / tileUtilization.length,
    tileUtilization,
    cornerBusy: corner.lcl_in_xfer / run,
    cornerStalled: corner.lcl_in_stall / run,
    port: port(input.counters),
    links: { east: corner.out_xfer_e / run, north: corner.out_xfer_n / run, local: corner.out_xfer_l / run },
  };
}

export function buildPerformance(inputs: { trace: LmTrace; lm: LmRuns; cifar: CifarRun; scaling: Scaling }) {
  const { trace, lm, cifar, scaling } = inputs;

  const cifarOne = scaling.find((s) => s.mesh === "1x1");
  if (!cifarOne) throw new Error('docs/perf/scaling.json has no "1x1" mesh');
  const cifarMeshes = scaling.map((s) =>
    meshRecord({ mesh: s.mesh, cycles: s.cycles, units: s.images, counters: s.counters, mesh_perf: s.mesh_perf }, cifarOne.cycles),
  );

  const lmRun = (mesh: string) => {
    const run = lm.runs[`${mesh}_t256`];
    if (!run) throw new Error(`docs/perf/lm.json has no run "${mesh}_t256"`);
    return run;
  };
  const lmOne = lmRun("1x1");
  const lmMeshes = ["1x1", "2x2", "4x4"].map((mesh) => {
    const run = lmRun(mesh);
    return meshRecord({ mesh, cycles: run.cycles, units: run.steps, counters: run.counters, mesh_perf: run.mesh_perf }, lmOne.cycles);
  });

  const vpuCycles = lmRun("2x2").vpu[0];
  if (vpuCycles === undefined) throw new Error("docs/perf/lm.json has no VPU busy-cycle total");
  for (const mesh of ["1x1", "2x2", "4x4"]) {
    if (lmRun(mesh).vpu[0] !== vpuCycles) throw new Error(`the VPU's busy cycles differ on ${mesh}`);
  }

  const sums = trace.steps.reduce(
    (a, s) => ({
      weights: a.weights + s.categories["weight matmuls"],
      attention: a.attention + s.categories.attention,
      vpu: a.vpu + s.categories.VPU,
      other: a.other + s.categories.other,
    }),
    { weights: 0, attention: 0, vpu: 0, other: 0 },
  );
  const stepTotal = sums.weights + sums.attention + sums.vpu + sums.other;

  return {
    _generated: {
      sources: ["docs/perf/scaling.json", "docs/perf/lm.json", "docs/perf/lm_trace.json", "docs/perf/cifar.json"],
      regenerate: "npm run build:data (in web/)",
      note: "generated, do not edit by hand",
    },
    floorFlitsPerImage: (cifar.counters.slot_cyc + cifar.counters.go_cyc) / cifar.images,
    cifar: {
      images: cifar.images,
      accuracy: { int8: cifar.int8_accuracy, float: cifar.float_accuracy, agreement: cifar.float_agreement },
      meshes: cifarMeshes,
    },
    lm: {
      steps: lmOne.steps,
      vpuCycles,
      meshes: lmMeshes,
      categories2x2: {
        cycles: sums,
        shares: {
          weights: sums.weights / stepTotal,
          attention: sums.attention / stepTotal,
          vpu: sums.vpu / stepTotal,
          other: sums.other / stepTotal,
        },
        tail: lmRun("2x2").cycles - stepTotal,
      },
    },
  };
}
