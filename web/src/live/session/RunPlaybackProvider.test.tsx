// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeScheduler } from "../../replay/fakeScheduler";
import { manifest } from "../sim/manifest";
import { makeRun } from "../view/testRun.testlib";
import { RunAnnouncer, RunPlaybackProvider, useRunPlayback } from "./RunPlaybackProvider";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  const rp = useRunPlayback();
  if (!rp) return <p data-testid="probe">none</p>;
  return (
    <p data-testid="probe">
      {`${rp.layerName}|${rp.playback.cycle}|${rp.playback.playing}|${rp.finished}|${rp.predicted}|${rp.trace ? "trace" : "no-trace"}`}
    </p>
  );
}

const provider = (run: ReturnType<typeof makeRun> | null, extra: { reduced?: boolean; scheduler?: ReturnType<typeof fakeScheduler> } = {}) => (
  <RunPlaybackProvider run={run} golden={null} reduced={extra.reduced ?? false} scheduler={extra.scheduler} classNames={manifest.classNames}>
    <Probe />
    <RunAnnouncer />
  </RunPlaybackProvider>
);
const text = () => screen.getByTestId("probe").textContent;

describe("RunPlaybackProvider", () => {
  it("offers nothing while there is no run", () => {
    render(provider(null));
    expect(text()).toBe("none");
  });

  it("starts playing a new run from cycle 0 and names the layer", () => {
    const scheduler = fakeScheduler();
    render(provider(makeRun(), { scheduler }));
    expect(text()).toBe("conv1|0|true|false|cat|trace");
  });

  it("with reduced motion shows the end of the run, paused, with the prediction", () => {
    const run = makeRun();
    render(provider(run, { reduced: true }));
    expect(text()).toBe(`fc|${run.cycles}|false|true|cat|trace`);
  });

  it("resets to cycle 0 when the run goes away and plays the next run from the start", () => {
    const scheduler = fakeScheduler();
    const first = makeRun();
    const { rerender } = render(provider(first, { scheduler }));
    act(() => scheduler.advance(30_000));
    expect(text()).toContain(`${first.cycles}|false|true`);
    rerender(provider(null, { scheduler }));
    expect(text()).toBe("none");
    rerender(provider(makeRun("4x4"), { scheduler }));
    expect(text()).toMatch(/^conv1\|0\|true\|false\|cat\|trace$/);
  });

  it("keeps its children mounted when a run comes and goes", () => {
    const { rerender } = render(provider(null));
    const node = screen.getByTestId("probe");
    rerender(provider(makeRun()));
    expect(screen.getByTestId("probe")).toBe(node);
  });

  it("offers a run whose trace cannot be decoded without a trace, and does not throw", () => {
    const bad = { ...makeRun(), trace: new Uint8Array(13) };
    render(provider(bad));
    expect(text()).toContain("no-trace");
  });

  it("announces the state in one polite live region", () => {
    const run = makeRun();
    const { container } = render(provider(run, { reduced: true }));
    const regions = container.querySelectorAll("[aria-live='polite']");
    expect(regions).toHaveLength(1);
    expect(regions[0]!.textContent).toBe("Run finished. Predicted cat.");
  });

  it("announces nothing when there is no run", () => {
    const { container } = render(provider(null));
    expect(container.querySelector("[aria-live='polite']")!.textContent).toBe("");
  });
});
