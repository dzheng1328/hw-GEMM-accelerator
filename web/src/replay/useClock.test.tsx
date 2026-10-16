// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeScheduler } from "./fakeScheduler";
import { useClock } from "./useClock";

function setup(total = 10) {
  const scheduler = fakeScheduler();
  const hook = renderHook(() => useClock(total, scheduler));
  const tick = (ms: number) => act(() => scheduler.advance(ms));
  return { scheduler, hook, tick, clock: () => hook.result.current };
}

describe("useClock", () => {
  it("starts paused at 0 and schedules nothing", () => {
    const { clock, scheduler } = setup();
    expect(clock().elapsed).toBe(0);
    expect(clock().playing).toBe(false);
    expect(scheduler.pending()).toBe(0);
  });

  it("advances with real time while playing", () => {
    const { clock, tick } = setup();
    act(() => clock().play());
    tick(1000);
    expect(clock().elapsed).toBeCloseTo(1, 9);
    tick(500);
    expect(clock().elapsed).toBeCloseTo(1.5, 9);
  });

  it("holds when paused", () => {
    const { clock, tick } = setup();
    act(() => clock().play());
    tick(1000);
    act(() => clock().pause());
    tick(1000);
    expect(clock().elapsed).toBeCloseTo(1, 9);
    expect(clock().playing).toBe(false);
  });

  it("multiplies time by the speed, and a speed change mid-play never moves the clock backwards", () => {
    const { clock, tick } = setup(100);
    act(() => clock().play());
    tick(1000);
    const before = clock().elapsed;
    act(() => clock().setSpeed(4));
    expect(clock().elapsed).toBe(before);
    tick(1000);
    expect(clock().elapsed).toBeCloseTo(before + 4, 9);
    expect(clock().speed).toBe(4);
  });

  it("stops at the total and stops scheduling frames", () => {
    const { clock, tick, scheduler } = setup(2);
    act(() => clock().play());
    tick(5000);
    expect(clock().elapsed).toBe(2);
    expect(clock().playing).toBe(false);
    expect(scheduler.pending()).toBe(0);
  });

  it("seek pauses and sets the position", () => {
    const { clock, tick } = setup();
    act(() => clock().play());
    tick(1000);
    act(() => clock().seek(7));
    expect(clock().playing).toBe(false);
    expect(clock().elapsed).toBe(7);
    tick(1000);
    expect(clock().elapsed).toBe(7);
  });

  it("seek clamps to 0 and the total", () => {
    const { clock } = setup(10);
    act(() => clock().seek(-3));
    expect(clock().elapsed).toBe(0);
    act(() => clock().seek(99));
    expect(clock().elapsed).toBe(10);
  });

  it("play at the end restarts from 0, and replay always does", () => {
    const { clock, tick } = setup(2);
    act(() => clock().seek(2));
    act(() => clock().play());
    expect(clock().elapsed).toBe(0);
    expect(clock().playing).toBe(true);
    tick(1000);
    act(() => clock().replay());
    expect(clock().elapsed).toBe(0);
    expect(clock().playing).toBe(true);
  });

  it("toggle plays then pauses", () => {
    const { clock } = setup();
    act(() => clock().toggle());
    expect(clock().playing).toBe(true);
    act(() => clock().toggle());
    expect(clock().playing).toBe(false);
  });

  it("cancels its pending frame when it unmounts", () => {
    const { clock, hook, scheduler } = setup();
    act(() => clock().play());
    expect(scheduler.pending()).toBe(1);
    hook.unmount();
    expect(scheduler.pending()).toBe(0);
  });
});
