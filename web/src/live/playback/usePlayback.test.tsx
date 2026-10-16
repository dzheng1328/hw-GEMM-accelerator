// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeScheduler } from "../../replay/fakeScheduler";
import { PACE_SECONDS, usePlayback } from "./usePlayback";

afterEach(cleanup);

const TOTAL = 20_000; // 1,000 cycles per second at 1x
function setup(total = TOTAL, initialCycle = 0) {
  const scheduler = fakeScheduler();
  const hook = renderHook(() => usePlayback(total, scheduler, initialCycle));
  const tick = (ms: number) => act(() => scheduler.advance(ms));
  return { scheduler, tick, ...hook };
}

describe("usePlayback", () => {
  it("starts paused at cycle 0 and shows the first cycle", () => {
    const { result } = setup();
    expect(result.current).toMatchObject({ cycle: 0, playing: false, speed: 1, atEnd: false });
    expect(result.current.windowRef.current).toEqual({ from: 0, to: 1 });
  });

  it("a whole run lasts PACE_SECONDS at 1x", () => {
    expect(PACE_SECONDS).toBe(20);
    const { result, tick } = setup();
    act(() => result.current.play());
    tick(1000);
    expect(result.current.cycle).toBe(1000);
    tick(1000);
    expect(result.current.cycle).toBe(2000);
  });

  it("the window is the cycles since the last frame", () => {
    const { result, tick } = setup();
    act(() => result.current.play());
    tick(500);
    expect(result.current.windowRef.current).toEqual({ from: 0, to: 500 });
    tick(250);
    expect(result.current.windowRef.current).toEqual({ from: 500, to: 750 });
  });

  it("speed scales the pace, and can change in the middle of a run", () => {
    const { result, tick } = setup();
    act(() => result.current.setSpeed(4));
    act(() => result.current.play());
    tick(1000);
    expect(result.current.cycle).toBe(4000);
    act(() => result.current.setSpeed(0.25));
    tick(1000);
    expect(result.current.cycle).toBe(4250);
  });

  it("at a very slow speed it holds the window until a whole cycle has passed", () => {
    const { result, tick } = setup(2000); // 100 cycles per second at 1x
    act(() => result.current.setSpeed(0.01)); // 1 cycle per second
    act(() => result.current.play());
    tick(500);
    expect(result.current.cycle).toBe(0);
    tick(500);
    expect(result.current.cycle).toBe(1);
    expect(result.current.windowRef.current).toEqual({ from: 0, to: 1 });
  });

  it("stops at the end, reports atEnd, and play restarts from 0", () => {
    const { result, tick } = setup();
    act(() => result.current.play());
    tick(60_000);
    expect(result.current).toMatchObject({ cycle: TOTAL, playing: false, atEnd: true });
    act(() => result.current.play());
    expect(result.current.cycle).toBe(0);
    expect(result.current.playing).toBe(true);
  });

  it("pause holds the position", () => {
    const { result, tick } = setup();
    act(() => result.current.play());
    tick(1000);
    act(() => result.current.pause());
    tick(5000);
    expect(result.current.cycle).toBe(1000);
  });

  it("seek pauses, clamps, and shows the last completed cycle", () => {
    const { result, tick } = setup();
    act(() => result.current.play());
    act(() => result.current.seek(5000));
    expect(result.current).toMatchObject({ cycle: 5000, playing: false });
    expect(result.current.windowRef.current).toEqual({ from: 4999, to: 5000 });
    tick(1000);
    expect(result.current.cycle).toBe(5000);
    act(() => result.current.seek(-5));
    expect(result.current.cycle).toBe(0);
    act(() => result.current.seek(10 * TOTAL));
    expect(result.current.cycle).toBe(TOTAL);
    expect(result.current.atEnd).toBe(true);
  });

  it("step moves by whole cycles in either direction and pauses", () => {
    const { result } = setup();
    act(() => result.current.seek(100));
    act(() => result.current.step(1));
    expect(result.current.cycle).toBe(101);
    act(() => result.current.step(-2));
    expect(result.current.cycle).toBe(99);
    expect(result.current.windowRef.current).toEqual({ from: 98, to: 99 });
  });

  it("replay starts again from 0 and plays", () => {
    const { result, tick } = setup();
    act(() => result.current.seek(TOTAL));
    act(() => result.current.replay());
    expect(result.current).toMatchObject({ cycle: 0, playing: true });
    tick(1000);
    expect(result.current.cycle).toBe(1000);
  });

  it("can start paused at the end, as reduced motion needs", () => {
    const { result, tick } = setup(TOTAL, TOTAL);
    expect(result.current).toMatchObject({ cycle: TOTAL, playing: false, atEnd: true });
    tick(1000);
    expect(result.current.cycle).toBe(TOTAL);
  });

  it("copes with an empty run", () => {
    const { result } = setup(0);
    act(() => result.current.play());
    expect(result.current.cycle).toBe(0);
    expect(result.current.playing).toBe(false);
  });
});
