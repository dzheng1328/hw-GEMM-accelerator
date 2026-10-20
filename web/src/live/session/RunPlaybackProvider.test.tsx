// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeScheduler } from "../../replay/fakeScheduler";
import { manifest } from "../sim/manifest";
import { makeRun } from "../view/testRun.testlib";
import { RunAnnouncer, RunPlaybackProvider, useReportOnScreen, useRunPlayback } from "./RunPlaybackProvider";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let latest: ReturnType<typeof useRunPlayback> = null;
function Probe() {
  const rp = useRunPlayback();
  useEffect(() => {
    latest = rp;
  });
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

  it("builds the activity index with the trace, and offers none without a trace", () => {
    render(provider(makeRun(), { reduced: true }));
    expect(latest!.activity).not.toBeNull();
    expect(latest!.activity!.countsAt(latest!.run.cycles).busy).toBe(latest!.run.cycles); // makeRun marks node 0 busy every cycle
    cleanup();
    const broken = makeRun();
    broken.trace = new Uint8Array(3); // not whole records
    render(provider(broken, { reduced: true }));
    expect(latest!.trace).toBeNull();
    expect(latest!.activity).toBeNull();
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

  it("keeps the end of a finished run when reduced motion is switched off, and still jumps to the end when it is switched on", () => {
    const scheduler = fakeScheduler();
    const run = makeRun();
    const { rerender } = render(provider(run, { reduced: true, scheduler }));
    expect(text()).toBe(`fc|${run.cycles}|false|true|cat|trace`);
    rerender(provider(run, { reduced: false, scheduler }));
    expect(text()).toBe(`fc|${run.cycles}|false|true|cat|trace`);
    cleanup();
    const playing = render(provider(run, { reduced: false, scheduler }));
    expect(text()).toContain("|true|false|");
    playing.rerender(provider(run, { reduced: true, scheduler }));
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

  it("plays every new run at normal speed, whatever speed the last one was set to", () => {
    const scheduler = fakeScheduler();
    const { rerender } = render(provider(makeRun(), { scheduler }));
    act(() => latest!.playback.setSpeed(0.01));
    expect(latest!.playback.speed).toBe(0.01);
    rerender(provider(null, { scheduler }));
    rerender(provider(makeRun("4x4"), { scheduler }));
    expect(latest!.playback.speed).toBe(1);
    act(() => latest!.playback.setSpeed(16));
    rerender(provider(makeRun("1x1"), { scheduler }));
    expect(latest!.playback.speed).toBe(1);
  });

  it("commits playback slowly while no stage reports itself on screen, and every frame while one does", () => {
    const scheduler = fakeScheduler();
    function Watcher() {
      useReportOnScreen(true);
      return null;
    }
    const withWatcher = (watching: boolean) => (
      <RunPlaybackProvider run={makeRun()} golden={null} reduced={false} scheduler={scheduler} classNames={manifest.classNames}>
        <Probe />
        {watching ? <Watcher /> : null}
      </RunPlaybackProvider>
    );
    const { rerender } = render(withWatcher(false));
    act(() => scheduler.advance(100));
    expect(latest!.playback.cycle).toBe(0);
    rerender(withWatcher(true));
    act(() => scheduler.advance(16));
    expect(latest!.playback.cycle).toBeGreaterThan(0);
    rerender(withWatcher(false));
    const seen = latest!.playback.cycle;
    act(() => scheduler.advance(100));
    expect(latest!.playback.cycle).toBe(seen);
  });

  it("a stage that is not on screen does not count as watching", () => {
    const scheduler = fakeScheduler();
    function Watcher() {
      useReportOnScreen(false);
      return null;
    }
    render(
      <RunPlaybackProvider run={makeRun()} golden={null} reduced={false} scheduler={scheduler} classNames={manifest.classNames}>
        <Probe />
        <Watcher />
      </RunPlaybackProvider>,
    );
    act(() => scheduler.advance(100));
    expect(latest!.playback.cycle).toBe(0);
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
