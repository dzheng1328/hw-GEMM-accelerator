import { describe, expect, it } from "vitest";
import { b64, exampleEntries, extremeEntries, loadModel, requantCases } from "../sim/artifacts.testlib";
import { argmax10, requant, runNetwork } from "./network";

describe("requant", () => {
  it("equals model/fixedpoint.requant for the int32 extremes and every shift range", () => {
    const cases = requantCases();
    expect(cases.length).toBeGreaterThan(100);
    for (const [acc, m, sh, out] of cases) {
      expect(requant(acc!, m!, sh!), `acc=${acc} m=${m} sh=${sh}`).toBe(out);
    }
  });

  it("rounds half up and saturates", () => {
    expect(requant(3, 1, 1)).toBe(2); // (3 + 1) >> 1
    expect(requant(-5, 1, 0)).toBe(0); // ReLU
    expect(requant(2 ** 31 - 1, 65535, 0)).toBe(127);
  });
});

describe("runNetwork", () => {
  const model = loadModel();

  it("reproduces the Python golden logits for every built-in example", () => {
    for (const e of exampleEntries()) {
      expect(Array.from(runNetwork(model, b64(e.pixels))), e.name).toEqual(e.logits);
    }
  });

  it("reproduces the golden logits for noise, all-white and all-black images", () => {
    for (const [name, e] of Object.entries(extremeEntries())) {
      expect(Array.from(runNetwork(model, b64(e.pixels))), name).toEqual(e.logits);
    }
  });

  it("rejects an image of the wrong size", () => {
    expect(() => runNetwork(model, new Uint8Array(10))).toThrow(/3072/);
  });
});

describe("argmax10", () => {
  it("ignores the six padding cells", () => {
    const logits = new Int32Array(16);
    logits[3] = 5;
    logits[12] = 999;
    expect(argmax10(logits)).toBe(3);
  });
  it("breaks ties toward the lower class, like numpy argmax", () => {
    const logits = new Int32Array(16);
    logits[2] = 4;
    logits[7] = 4;
    expect(argmax10(logits)).toBe(2);
  });
});
