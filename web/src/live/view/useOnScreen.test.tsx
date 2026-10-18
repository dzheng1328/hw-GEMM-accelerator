// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOnScreen } from "./useOnScreen";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

class FakeObserver {
  static last: FakeObserver;
  disconnected = false;
  constructor(readonly callback: (entries: { isIntersecting: boolean }[]) => void) {
    FakeObserver.last = this;
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
}

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const on = useOnScreen(ref);
  return <div ref={ref} data-testid="probe">{String(on)}</div>;
}

describe("useOnScreen", () => {
  it("follows the element into and out of view", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("false");
    act(() => FakeObserver.last.callback([{ isIntersecting: true }]));
    expect(screen.getByTestId("probe").textContent).toBe("true");
    act(() => FakeObserver.last.callback([{ isIntersecting: false }]));
    expect(screen.getByTestId("probe").textContent).toBe("false");
  });

  it("is on when the browser has no IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("true");
  });

  it("stops observing when it unmounts", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { unmount } = render(<Probe />);
    unmount();
    expect(FakeObserver.last.disconnected).toBe(true);
  });
});
