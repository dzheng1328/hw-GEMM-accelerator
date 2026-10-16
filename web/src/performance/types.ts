export const PORT_KEYS = ["operand", "go", "stall", "wait", "credit", "other"] as const;
export type PortKey = (typeof PORT_KEYS)[number];
export type PortNumbers = Record<PortKey, number>;

export interface MeshPerf {
  mesh: string;
  width: number;
  height: number;
  tiles: number;
  cycles: number;
  /** Cycles per image for CIFAR-10, per step for the story model. */
  cyclesPerUnit: number;
  speedup: number;
  macUtilization: number;
  tileUtilization: number[];
  cornerBusy: number;
  cornerStalled: number;
  port: { cycles: PortNumbers; shares: PortNumbers };
  links: { east: number; north: number; local: number };
}

export interface FourWay {
  weights: number;
  attention: number;
  vpu: number;
  other: number;
}

export interface PerformanceData {
  _generated: { sources: string[]; regenerate: string; note: string };
  floorFlitsPerImage: number;
  cifar: {
    images: number;
    accuracy: { int8: number; float: number; agreement: number };
    meshes: MeshPerf[];
  };
  lm: {
    steps: number;
    vpuCycles: number;
    meshes: MeshPerf[];
    categories2x2: { cycles: FourWay; shares: FourWay; tail: number };
  };
}
