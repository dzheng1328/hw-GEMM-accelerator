// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeScheduler } from "../replay/fakeScheduler";
import { TestSession, testExamples } from "../live/session/testSession.testlib";
import { RunStrip } from "./RunStrip";

afterEach(cleanup);

describe("RunStrip", () => {
  it("invites a run with a Run button when none has happened", () => {
    render(
      <TestSession>
        <RunStrip />
      </TestSession>,
    );
    expect(screen.getByText("Run the chip to see this light up.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run the chip" })).toBeTruthy();
  });

  it("says so, with no button, when the browser cannot run the chip", () => {
    render(
      <TestSession supported={() => false}>
        <RunStrip />
      </TestSession>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/cannot run Web Workers or WebAssembly/)).toBeTruthy();
  });

  it("runs the chip from here, then shows the run's place and a Replay button that restarts the clock", async () => {
    const scheduler = fakeScheduler();
    render(
      <TestSession loadExamples={async () => testExamples()} scheduler={scheduler}>
        <RunStrip />
      </TestSession>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run the chip" }));
    const replay = await screen.findByRole("button", { name: "Replay" });
    expect(screen.getByText(/^2x2 mesh - cycle 0 of \d+ - layer 1 of 6$/)).toBeTruthy();
    act(() => scheduler.advance(30_000));
    await waitFor(() => expect(screen.getByText(/^2x2 mesh - cycle (\d+) of \1 - layer 6 of 6$/)).toBeTruthy());
    fireEvent.click(replay);
    expect(screen.getByText(/^2x2 mesh - cycle 0 of \d+/)).toBeTruthy();
  });
});
