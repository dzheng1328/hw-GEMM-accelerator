// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionsFile } from "./decisionTypes";
import { useDecisions } from "./useDecisions";

const FILE: DecisionsFile = {
  _generated: { sources: [], regenerate: "", note: "" },
  records: { a: { heading: "h", sections: [] } },
};

type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;
let callback: Callback | null = null;

function stubObserver() {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: Callback) {
        callback = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
}

function Probe({ load }: { load: () => Promise<DecisionsFile> }) {
  const ref = useRef<HTMLDivElement>(null);
  const { status, records } = useDecisions(ref, load);
  return (
    <div ref={ref} data-testid="probe">
      {`${status}|${records ? Object.keys(records).join(",") : "-"}`}
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  callback = null;
});

describe("useDecisions", () => {
  it("does not fetch while the section is far from the screen", () => {
    stubObserver();
    const load = vi.fn(async () => FILE);
    render(<Probe load={load} />);
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByTestId("probe").textContent).toBe("idle|-");
  });

  it("fetches once when the section comes near, then has the records", async () => {
    stubObserver();
    const load = vi.fn(async () => FILE);
    render(<Probe load={load} />);
    await act(async () => {
      callback!([{ isIntersecting: true }]);
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("ready|a")).toBeTruthy();
  });

  it("reports an error and no records when the fetch fails", async () => {
    stubObserver();
    const load = vi.fn(async () => {
      throw new Error("blocked");
    });
    render(<Probe load={load} />);
    await act(async () => {
      callback!([{ isIntersecting: true }]);
    });
    expect(await screen.findByText("error|-")).toBeTruthy();
  });

  it("fetches at once where there is no IntersectionObserver", async () => {
    const load = vi.fn(async () => FILE);
    render(<Probe load={load} />);
    expect(await screen.findByText("ready|a")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
