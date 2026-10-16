import { describe, expect, it } from "vitest";
import { b64, readJson } from "../sim/artifacts.testlib";
import { decodeBase64, parseModel } from "./model";

describe("decodeBase64", () => {
  it("decodes bytes, including values above 127", () => {
    expect(Array.from(decodeBase64("AAEC/w=="))).toEqual([0, 1, 2, 255]);
    expect(Array.from(decodeBase64(""))).toEqual([]);
  });
  it("agrees with Node's decoder on a long input", () => {
    const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 37) & 255);
    expect(decodeBase64(Buffer.from(bytes).toString("base64"))).toEqual(bytes);
  });
});

describe("parseModel", () => {
  const raw = () => readJson<{ layers: Record<string, unknown>[] }>("cifar-model.json");

  it("parses the committed model into six layers with the right sizes", () => {
    const model = parseModel(raw());
    expect(model.layers.map((l) => l.name)).toEqual(["conv1", "conv2", "conv3", "conv4", "conv5", "fc"]);
    for (const l of model.layers) {
      expect(l.weights.length).toBe(l.cout * l.cin * l.ksize * l.ksize);
      expect(l.bias.length).toBe(l.biasRows * l.cout);
    }
    expect(model.layers[0]!.cin).toBe(4);
    expect(model.layers[5]!.m).toEqual([]);
  });

  it("keeps int8 weights signed", () => {
    const model = parseModel(raw());
    const first = raw().layers[0]!.weights as string;
    expect(model.layers[0]!.weights[0]).toBe(new Int8Array(b64(first).buffer)[0]);
  });

  it("rejects a model whose weight count does not match its shape", () => {
    const bad = raw();
    bad.layers[1]!.cout = 33;
    expect(() => parseModel(bad)).toThrow(/conv2/);
  });

  it("rejects a model with the wrong number of layers", () => {
    const bad = raw();
    bad.layers.pop();
    expect(() => parseModel(bad)).toThrow(/6 layers/);
  });
});
