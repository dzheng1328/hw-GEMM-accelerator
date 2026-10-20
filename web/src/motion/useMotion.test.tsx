// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ enabled: true, load: (() => Promise.resolve({})) as (...args: never[]) => Promise<unknown> }));
vi.mock("./enabled", () => ({ readMotionEnv: () => ({}), motionEnabled: () => state.enabled }));
vi.mock("./schedule", () => ({ afterFirstPaint: (run: () => void) => (run(), () => {}) }));
vi.mock("./gsapLoader", () => ({ loadGsap: () => state.load() }));

import { useMotion } from "./useMotion";

function Probe({ make }: { make: (g: unknown, el: HTMLDivElement) => { kill(): void } | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(ref, make as never);
  return <div ref={ref} data-testid="probe" style={{}} />;
}

beforeEach(() => {
  state.enabled = true;
  state.load = vi.fn().mockResolvedValue({ fake: "gsap" });
});
afterEach(cleanup);

describe("useMotion", () => {
  it("does nothing, and never loads GSAP, when motion is off", () => {
    state.enabled = false;
    const make = vi.fn();
    render(<Probe make={make} />);
    expect(state.load).not.toHaveBeenCalled();
    expect(make).not.toHaveBeenCalled();
  });

  it("loads GSAP after first paint and hands the element to the factory", async () => {
    const make = vi.fn().mockReturnValue({ kill: vi.fn() });
    const { getByTestId } = render(<Probe make={make} />);
    await vi.waitFor(() => expect(make).toHaveBeenCalledTimes(1));
    expect(make.mock.calls[0]![0]).toEqual({ fake: "gsap" });
    expect(make.mock.calls[0]![1]).toBe(getByTestId("probe"));
  });

  it("kills the animation on unmount", async () => {
    const kill = vi.fn();
    const make = vi.fn().mockReturnValue({ kill });
    const { unmount } = render(<Probe make={make} />);
    await vi.waitFor(() => expect(make).toHaveBeenCalled());
    unmount();
    expect(kill).toHaveBeenCalled();
  });

  it("accepts a factory that returns null (nothing to animate) and unmounts cleanly", async () => {
    const make = vi.fn().mockReturnValue(null);
    const { unmount } = render(<Probe make={make as never} />);
    await vi.waitFor(() => expect(make).toHaveBeenCalled());
    expect(() => unmount()).not.toThrow();
  });

  it("does not start an animation if the component unmounted while GSAP was loading", async () => {
    let resolve!: (g: unknown) => void;
    state.load = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    const make = vi.fn();
    const { unmount } = render(<Probe make={make} />);
    unmount();
    resolve({ fake: "gsap" });
    await Promise.resolve();
    await Promise.resolve();
    expect(make).not.toHaveBeenCalled();
  });

  it("leaves the element untouched when GSAP fails to load (offline, blocked)", async () => {
    state.load = vi.fn().mockRejectedValue(new Error("chunk failed"));
    const make = vi.fn();
    const { getByTestId } = render(<Probe make={make} />);
    await Promise.resolve();
    await Promise.resolve();
    expect(make).not.toHaveBeenCalled();
    const el = getByTestId("probe");
    expect(el.style.opacity).toBe("");
    expect(el.style.transform).toBe("");
    expect(el.hasAttribute("data-motion")).toBe(false);
  });
});
