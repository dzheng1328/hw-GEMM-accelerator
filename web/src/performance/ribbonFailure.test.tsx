// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestSession } from "../live/session/testSession.testlib";
import { manifest } from "../live/sim/manifest";
import { PerformanceSection } from "./PerformanceSection";

// the ribbon's chunk fails to load (a redeploy removed the old hashed file, or the network dropped)
vi.mock("./StrokeRibbon", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

afterEach(cleanup);

describe("the performance section when the ribbon's chunk fails to load", () => {
  it("keeps the rest of the section and says the chart could not load, instead of unmounting the page", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, getByRole, findByText } = render(
      <TestSession loadExamples={async () => manifest.classNames.map((name) => ({ name, pixels: new Uint8Array(3072), logits: [] }))}>
        <PerformanceSection />
      </TestSession>,
    );
    expect(await findByText(/chart could not load/i)).toBeTruthy();
    expect(getByRole("heading", { name: "Where the cycles go" })).toBeTruthy();
    await waitFor(() => expect(container.querySelectorAll(".mesh-tile").length).toBeGreaterThan(0));
    quiet.mockRestore();
  });
});
