// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinSection } from "./pinSection";
import { useInitialSection } from "./useInitialSection";

vi.mock("./pinSection", () => ({ pinSection: vi.fn() }));

function Harness() {
  useInitialSection();
  return (
    <main id="main">
      <section id="performance" />
      <div id="proof-cifar" tabIndex={-1} data-proof="" />
    </main>
  );
}

let scrollIntoView: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as never;
  vi.mocked(pinSection).mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("useInitialSection", () => {
  it("lands on a shared section link at once", () => {
    window.history.replaceState(null, "", "/#performance");
    render(<Harness />);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
    expect(pinSection).toHaveBeenCalledOnce();
  });

  it("lands on a shared proof link on the next task, so a drawer can open first", () => {
    window.history.replaceState(null, "", "/#proof-cifar");
    render(<Harness />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
    expect(document.activeElement).toBe(document.getElementById("proof-cifar"));
  });

  it("does nothing for any other hash, or none", () => {
    window.history.replaceState(null, "", "/#something-else");
    render(<Harness />);
    vi.advanceTimersByTime(10);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
