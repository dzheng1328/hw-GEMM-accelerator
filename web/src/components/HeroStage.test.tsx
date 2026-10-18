// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveSessionProvider, type LiveSessionProviderProps } from "../live/session/LiveSessionProvider";
import type { IdleScheduler } from "../live/session/idle";
import { manifest } from "../live/sim/manifest";
import type { MeshKey } from "../live/sim/types";
import { makeRun } from "../live/view/testRun.testlib";
import { fakeScheduler } from "../replay/fakeScheduler";
import { HeroStage } from "./HeroStage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const examples = () => manifest.classNames.map((name, i) => ({ name, pixels: new Uint8Array(3072).fill(i), logits: Array.from(makeRun().logits) }));

function setup(props: Partial<LiveSessionProviderProps> = {}, run: (mesh: MeshKey) => Promise<ReturnType<typeof makeRun>> = async (mesh) => makeRun(mesh)) {
  const queue: (() => void)[] = [];
  const idle: IdleScheduler = (cb) => {
    queue.push(cb);
    return () => {};
  };
  const scheduler = fakeScheduler();
  const runSpy = vi.fn(run);
  const ui = render(
    <LiveSessionProvider
      createClient={() => ({ run: runSpy as never, close() {} })}
      loadExamples={async () => examples()}
      loadScene={async () => () => null}
      webgl={() => true}
      supported={() => true}
      saveData={() => false}
      scheduler={scheduler}
      idle={idle}
      {...props}
    >
      <HeroStage />
    </LiveSessionProvider>,
  );
  return { ...ui, runSpy, scheduler, flushIdle: () => act(async () => queue.splice(0).forEach((cb) => cb())) };
}
const status = () => document.querySelector(".hero-status")!.textContent;
/** waits for the result to start playing, then lets the fake clock carry it to its end */
async function finish(scheduler: ReturnType<typeof fakeScheduler>) {
  await waitFor(() => expect(status()).toMatch(/cycle \d/));
  act(() => scheduler.advance(30_000));
}

describe("HeroStage", () => {
  it("shows the stage, the mesh pills with 2x2 pressed, a Run button and the first status", () => {
    const { container } = setup();
    expect(container.querySelector(".hero-stage-view")).not.toBeNull();
    const group = screen.getByRole("group", { name: "Mesh size for the live chip" });
    expect([...group.querySelectorAll("button")].map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["1x1", "false"],
      ["2x2", "true"],
      ["4x4", "false"],
    ]);
    expect(screen.getByRole("button", { name: "Run the chip" })).toBeTruthy();
    expect(status()).toBe("Loading the chip...");
  });

  it("runs by itself, then ends on the prediction with a Replay button", async () => {
    const { flushIdle, scheduler } = setup();
    await flushIdle();
    await finish(scheduler);
    expect(status()).toBe("Predicted: cat - checked against the reference");
    expect(screen.getByRole("button", { name: "Replay" })).toBeTruthy();
  });

  it("in a data-saver browser waits for the visitor, then runs on Run", async () => {
    const { runSpy, flushIdle, scheduler } = setup({ saveData: () => true });
    await flushIdle();
    expect(runSpy).not.toHaveBeenCalled();
    expect(status()).toBe("Press Run to watch the chip classify an image.");
    fireEvent.click(screen.getByRole("button", { name: "Run the chip" }));
    await finish(scheduler);
    expect(status()).toContain("Predicted: cat");
    expect(runSpy).toHaveBeenCalledOnce();
  });

  it("a mesh pill re-runs on that mesh once a run has happened", async () => {
    const { runSpy, flushIdle, scheduler } = setup();
    await flushIdle();
    await finish(scheduler);
    expect(status()).toContain("Predicted");
    fireEvent.click(screen.getByRole("button", { name: "4x4" }));
    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(2));
    expect(runSpy.mock.calls[1]![0]).toBe("4x4");
    expect(screen.getByRole("button", { name: "4x4" }).getAttribute("aria-pressed")).toBe("true");
    await finish(scheduler);
    expect(status()).toContain("Predicted");
  });

  it("a mesh pill only selects before any run", async () => {
    const { runSpy } = setup({ saveData: () => true });
    fireEvent.click(screen.getByRole("button", { name: "4x4" }));
    expect(screen.getByRole("button", { name: "4x4" }).getAttribute("aria-pressed")).toBe("true");
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("shows Running... while a run is in progress and ignores a press", async () => {
    const { runSpy, flushIdle } = setup({}, () => new Promise(() => {}));
    await flushIdle();
    const button = await screen.findByRole("button", { name: "Running..." });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(runSpy).toHaveBeenCalledOnce();
  });

  it("Replay plays the same result again without simulating again", async () => {
    const { runSpy, flushIdle, scheduler } = setup();
    await flushIdle();
    await finish(scheduler);
    expect(status()).toContain("Predicted");
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    await waitFor(() => expect(status()).toMatch(/cycle \d/));
    expect(runSpy).toHaveBeenCalledOnce();
  });

  it("keeps working when the example images cannot be loaded", async () => {
    const { flushIdle } = setup({ loadExamples: async () => Promise.reject(new Error("offline")) });
    await flushIdle();
    await waitFor(() => expect(status()).toBe("The example images could not be loaded. You can still upload one below."));
  });

  it("is disabled in a browser that cannot run the chip", () => {
    setup({ supported: () => false });
    expect((screen.getByRole("button", { name: "Run the chip" }) as HTMLButtonElement).disabled).toBe(true);
    expect(status()).toContain("cannot run Web Workers or WebAssembly");
  });

  it("without WebGL the board stays and the status line still reports the run", async () => {
    const { container, scheduler } = setup({ webgl: () => false, autoRun: false });
    fireEvent.click(screen.getByRole("button", { name: "Run the chip" }));
    await finish(scheduler);
    expect(status()).toContain("Predicted: cat");
    expect(container.querySelectorAll(".board-tile")).toHaveLength(4);
  });
});
