// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeScheduler } from "../replay/fakeScheduler";
import { RunPlaybackProvider, useRunPlayback } from "../live/session/RunPlaybackProvider";
import { manifest } from "../live/sim/manifest";
import { makeRun } from "../live/view/testRun.testlib";
import type { BlockLive } from "./blockStates";
import { useBlockLive } from "./useBlockLive";

afterEach(cleanup);

let live: Record<string, BlockLive> | null = null;
let playback: ReturnType<typeof useRunPlayback> = null;
function Probe() {
  const blocks = useBlockLive();
  const rp = useRunPlayback();
  useEffect(() => {
    live = blocks;
    playback = rp;
  });
  return null;
}
const provider = (run: ReturnType<typeof makeRun> | null, scheduler = fakeScheduler(), reduced = false) => (
  <RunPlaybackProvider run={run} golden={null} reduced={reduced} scheduler={scheduler} classNames={manifest.classNames}>
    <Probe />
  </RunPlaybackProvider>
);

describe("useBlockLive", () => {
  it("is null while there is no run", () => {
    render(provider(null));
    expect(live).toBeNull();
  });

  it("is null when the trace could not be decoded", () => {
    const broken = makeRun();
    broken.trace = new Uint8Array(3);
    render(provider(broken, fakeScheduler(), true));
    expect(live).toBeNull();
  });

  it("starts at cycle 0 with nothing counted and only the clock lit", () => {
    render(provider(makeRun()));
    expect(live!.dma_gather!.text).toBe("0 busy");
    expect(live!.gemm_tile!.lit).toBe(false);
    expect(live!.perf!.lit).toBe(true); // the run is playing
  });

  it("lights the tile and counts as the run plays, and never lights the vector unit", () => {
    const scheduler = fakeScheduler();
    render(provider(makeRun(), scheduler));
    act(() => scheduler.advance(3000));
    expect(live!.gemm_tile!.lit).toBe(true);
    expect(live!.perf!.text).not.toBe("cycle 0");
    expect(live!.vpu!.lit).toBe(false);
  });

  it("rests on the end state after a finished run: final counter, the clock dark", () => {
    const run = makeRun();
    render(provider(run, fakeScheduler(), true));
    expect(live!.perf!.text).toBe(`cycle ${run.cycles}`);
    expect(live!.perf!.lit).toBe(false);
  });

  it("counts back down when the visitor seeks backward, and restarts from zero on replay", () => {
    const scheduler = fakeScheduler();
    const run = makeRun();
    render(provider(run, scheduler));
    act(() => scheduler.advance(30_000));
    expect(live!.perf!.text).toBe(`cycle ${run.cycles}`);
    act(() => playback!.playback.seek(40));
    expect(live!.perf!.text).toBe("cycle 40");
    act(() => playback!.playback.replay());
    expect(live!.perf!.text).toBe("cycle 0");
  });

  it("shows nothing from a run once it is gone", () => {
    const scheduler = fakeScheduler();
    const { rerender } = render(provider(makeRun(), scheduler));
    expect(live).not.toBeNull();
    rerender(provider(null, scheduler));
    expect(live).toBeNull();
  });
});
