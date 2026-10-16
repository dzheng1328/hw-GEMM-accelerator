import { describe, expect, it } from "vitest";
import { DEFAULT_EXAMPLE, initialState, reducer, type LiveState } from "./state";
import { makeRun } from "./view/testRun.testlib";

const run = makeRun();
const started = (s: LiveState = initialState) => reducer(s, { type: "start" });

describe("reducer", () => {
  it("starts on the 2x2 mesh with the cat selected and nothing run", () => {
    expect(initialState).toMatchObject({ mesh: "2x2", source: { kind: "example", index: DEFAULT_EXAMPLE }, phase: { name: "idle" }, notice: null });
  });

  it("start moves to running with a new token", () => {
    const s = started();
    expect(s.phase).toMatchObject({ name: "running", stage: "starting" });
    expect(s.token).toBe(initialState.token + 1);
  });

  it("applies stage, done and failed for the current token only", () => {
    const s = started();
    const staged = reducer(s, { type: "stage", token: s.token, stage: "simulating" });
    expect(staged.phase).toMatchObject({ name: "running", stage: "simulating" });
    expect(reducer(staged, { type: "done", token: s.token, run }).phase).toMatchObject({ name: "done" });
    expect(reducer(staged, { type: "failed", token: s.token, message: "boom", fault: true }).phase).toMatchObject({
      name: "error",
      message: "boom",
      fault: true,
    });
  });

  it("ignores a result for a run that was replaced by pressing Run again", () => {
    const first = started();
    const second = started(first);
    const stale = reducer(second, { type: "done", token: first.token, run });
    expect(stale).toBe(second);
  });

  it("changing the mesh clears the result and ignores the in-flight run", () => {
    const running = started();
    const changed = reducer(running, { type: "selectMesh", mesh: "4x4" });
    expect(changed).toMatchObject({ mesh: "4x4", phase: { name: "idle" } });
    expect(reducer(changed, { type: "done", token: running.token, run })).toBe(changed);
  });

  it("selecting the same mesh or the same example changes nothing", () => {
    const done = reducer(started(), { type: "done", token: 1, run });
    expect(reducer(done, { type: "selectMesh", mesh: "2x2" })).toBe(done);
    expect(reducer(done, { type: "selectExample", index: DEFAULT_EXAMPLE })).toBe(done);
  });

  it("choosing another example or uploading clears the result and the notice", () => {
    const done = reducer(reducer(started(), { type: "done", token: 1, run }), { type: "uploadFailed", message: "x" });
    expect(done.notice).toBe("x");
    const other = reducer(done, { type: "selectExample", index: 0 });
    expect(other).toMatchObject({ source: { kind: "example", index: 0 }, phase: { name: "idle" }, notice: null });
    const pixels = new Uint8Array(3072);
    const uploaded = reducer(done, { type: "upload", name: "me.png", pixels });
    expect(uploaded.source).toMatchObject({ kind: "upload", name: "me.png" });
    expect(uploaded.phase.name).toBe("idle");
  });

  it("a failed upload only sets a notice and keeps the result and the source", () => {
    const done = reducer(started(), { type: "done", token: 1, run });
    const next = reducer(done, { type: "uploadFailed", message: "not an image" });
    expect(next.notice).toBe("not an image");
    expect(next.phase).toBe(done.phase);
    expect(next.source).toBe(done.source);
  });

  it("start clears a notice", () => {
    const s = reducer(initialState, { type: "uploadFailed", message: "x" });
    expect(started(s).notice).toBeNull();
  });
});
