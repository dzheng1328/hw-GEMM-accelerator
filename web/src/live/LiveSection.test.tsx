// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepContext } from "../components/deepContext";
import { fakeScheduler } from "../replay/fakeScheduler";
import { LiveSection, type LiveSectionProps } from "./LiveSection";
import { manifest } from "./sim/manifest";
import { SimError, SupersededError } from "./sim/client";
import type { LiveRun } from "./sim/engine";
import { makeRun } from "./view/testRun.testlib";
import type { MeshKey } from "./sim/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const examples = () =>
  manifest.classNames.map((name, i) => ({ name, pixels: new Uint8Array(3072).fill(i), logits: Array.from(makeRun().logits) }));
const Scene = () => <div data-testid="scene" />;

type RunImpl = (mesh: MeshKey, pixels: Uint8Array) => Promise<LiveRun>;
function setup(opts: { run?: RunImpl; props?: Partial<LiveSectionProps>; reduced?: boolean; deep?: boolean } = {}) {
  if (opts.reduced) {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
  }
  const impl: RunImpl = opts.run ?? (async (mesh) => makeRun(mesh));
  const run = vi.fn(impl);
  const close = vi.fn();
  const scheduler = fakeScheduler();
  const props: LiveSectionProps = {
    createClient: () => ({ run: run as never, close }),
    loadScene: async () => Scene,
    loadExamples: async () => examples(),
    decodeImage: async () => ({ rgba: new Uint8ClampedArray(64 * 64 * 4).fill(200), width: 64, height: 64 }),
    webgl: () => true,
    scheduler,
    ...opts.props,
  };
  const ui = render(
    <DeepContext.Provider value={opts.deep ?? false}>
      <LiveSection {...props} />
    </DeepContext.Provider>,
  );
  return { run, close, scheduler, ...ui };
}
const ready = () => screen.findByRole("button", { name: "Example: cat" });
const runButton = () => screen.getByRole("button", { name: "Run on the chip" });
async function runAndWait(container: HTMLElement) {
  fireEvent.click(runButton());
  await waitFor(() => expect(container.querySelector(".live-verdict")).toBeTruthy());
}

describe("LiveSection", () => {
  it("renders the title, ten examples, three meshes, a Run button and a closed drawer", async () => {
    const { container } = setup();
    expect(screen.getByRole("heading", { name: "Run it live" })).toBeTruthy();
    await ready();
    expect(screen.getAllByRole("button", { name: /^Example: / })).toHaveLength(10);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(false);
  });

  it("starts with the cat and the 2x2 mesh selected", async () => {
    setup();
    await ready();
    expect(screen.getByRole("button", { name: "Example: cat" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("radio", { name: "2x2 (4 tiles)" }) as HTMLInputElement).checked).toBe(true);
  });

  it("runs the chip on the selected example and shows the verified result, the layer strip and the logits", async () => {
    const { run, container } = setup();
    await ready();
    await runAndWait(container);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]![0]).toBe("2x2");
    expect(run.mock.calls[0]![1]).toHaveLength(3072);
    expect(container.querySelector(".live-verdict")!.getAttribute("data-state")).toBe("match");
    expect(container.querySelectorAll(".live-layers li")).toHaveLength(6);
    expect(container.querySelectorAll(".live-logits li")).toHaveLength(10);
    expect(await screen.findByTestId("scene")).toBeTruthy();
  });

  it("starts playing by itself after a run", async () => {
    const { container } = setup();
    await ready();
    await runAndWait(container);
    // play() runs in an effect after the result renders, so the button flips a moment after the verdict appears
    expect(await screen.findByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("with reduced motion the run starts paused at its end, with the logits shown", async () => {
    const { container } = setup({ reduced: true });
    await ready();
    await runAndWait(container);
    expect(screen.getByRole("button", { name: "Replay" })).toBeTruthy();
    const total = makeRun().cycles;
    expect((screen.getByRole("slider", { name: "Cycle" }) as HTMLInputElement).value).toBe(String(total));
    expect(container.querySelector(".live-logits li[aria-current='true']")?.textContent).toContain("cat");
  });

  it("shows a mismatch as a mismatch", async () => {
    const { container } = setup({ run: async (mesh) => makeRun(mesh, { mismatch: true }) });
    await ready();
    await runAndWait(container);
    expect(container.querySelector(".live-verdict")!.getAttribute("data-state")).toBe("mismatch");
  });

  it("shows a failed run as an alert and lets the visitor run again", async () => {
    let calls = 0;
    const { container } = setup({
      run: async (mesh) => {
        if (++calls === 1) throw new SimError("the chip raised error at program word 12", true);
        return makeRun(mesh);
      },
    });
    await ready();
    fireEvent.click(runButton());
    expect((await screen.findByRole("alert")).textContent).toContain("the chip raised error");
    expect((runButton() as HTMLButtonElement).disabled).toBe(false);
    await runAndWait(container);
    expect(container.querySelector(".live-error")).toBeNull();
  });

  it("explains why 4x4 only slightly beats 2x2", async () => {
    const { container } = setup();
    await ready();
    fireEvent.click(screen.getByRole("radio", { name: "4x4 (16 tiles)" }));
    await runAndWait(container);
    expect(container.querySelector(".live-result")!.textContent).toContain("injection port");
    expect(container.querySelector(".live-result")!.textContent).toContain("only 2.1% fewer");
  });

  it("clears the result when the mesh or the image changes", async () => {
    const { container } = setup();
    await ready();
    await runAndWait(container);
    fireEvent.click(screen.getByRole("radio", { name: "4x4 (16 tiles)" }));
    expect(container.querySelector(".live-verdict")).toBeNull();
    fireEvent.click(runButton());
    await waitFor(() => expect(container.querySelector(".live-result")?.getAttribute("data-mesh")).toBe("4x4"));
    fireEvent.click(screen.getByRole("button", { name: "Example: dog" }));
    expect(container.querySelector(".live-verdict")).toBeNull();
  });

  it("never shows a result for a run the visitor has moved on from", async () => {
    let resolve!: (run: LiveRun) => void;
    const { container } = setup({ run: () => new Promise<LiveRun>((r) => (resolve = r)) });
    await ready();
    fireEvent.click(runButton());
    fireEvent.click(screen.getByRole("radio", { name: "1x1 (1 tile)" }));
    await act(async () => resolve(makeRun("2x2")));
    expect(container.querySelector(".live-verdict")).toBeNull();
    expect(container.querySelector(".live-result")).toBeNull();
  });

  it("ignores a superseded run's rejection, and shows the newer run's result", async () => {
    const resolvers: ((run: LiveRun) => void)[] = [];
    const rejectors: ((e: Error) => void)[] = [];
    const { container } = setup({
      run: () => new Promise<LiveRun>((res, rej) => (resolvers.push(res), rejectors.push(rej))),
    });
    await ready();
    fireEvent.click(runButton());
    fireEvent.click(screen.getByRole("radio", { name: "4x4 (16 tiles)" }));
    fireEvent.click(runButton());
    await act(async () => rejectors[0]!(new SupersededError("replaced")));
    expect(container.querySelector(".live-error")).toBeNull();
    await act(async () => resolvers[1]!(makeRun("4x4")));
    expect(container.querySelector(".live-result")?.getAttribute("data-mesh")).toBe("4x4");
  });

  it("explains an unreadable upload and keeps the previous selection", async () => {
    const { container } = setup({ props: { decodeImage: async () => Promise.reject(new Error("That file could not be read as an image.")) } });
    await ready();
    fireEvent.change(screen.getByLabelText("Upload your own image"), { target: { files: [new File(["nope"], "a.png", { type: "image/png" })] } });
    expect((await screen.findByText("That file could not be read as an image.")).closest(".live-notice")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Example: cat" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".live-verdict")).toBeNull();
  });

  it("rejects an empty file without decoding it", async () => {
    const decodeImage = vi.fn();
    setup({ props: { decodeImage } });
    await ready();
    fireEvent.change(screen.getByLabelText("Upload your own image"), { target: { files: [new File([], "empty.png", { type: "image/png" })] } });
    expect(await screen.findByText("That file is empty.")).toBeTruthy();
    expect(decodeImage).not.toHaveBeenCalled();
  });

  it("runs the chip on an uploaded image, cropped and shrunk to 3072 bytes, and verifies it against the reference only", async () => {
    const { run, container } = setup();
    await ready();
    fireEvent.change(screen.getByLabelText("Upload your own image"), { target: { files: [new File(["x"], "me.png", { type: "image/png" })] } });
    expect(await screen.findByText(/Using your image: me.png/)).toBeTruthy();
    await runAndWait(container);
    expect(run.mock.calls[0]![1]).toHaveLength(3072);
    expect(container.querySelector(".live-verdict")!.textContent).not.toContain("Python golden");
  });

  it("without WebGL it says so and still shows the strip, the logits and the check", async () => {
    const { container } = setup({ props: { webgl: () => false } });
    await ready();
    await runAndWait(container);
    expect(container.querySelector(".live-fallback")?.textContent).toContain("WebGL");
    expect(screen.queryByTestId("scene")).toBeNull();
    expect(container.querySelectorAll(".live-layers li")).toHaveLength(6);
    expect(container.querySelector(".live-verdict")).toBeTruthy();
  });

  it("explains a client that cannot be created", async () => {
    setup({
      props: {
        createClient: () => {
          throw new SimError("This browser cannot run Web Workers or WebAssembly, so the chip cannot run here.", false);
        },
      },
    });
    await ready();
    fireEvent.click(runButton());
    expect((await screen.findByRole("alert")).textContent).toContain("cannot run Web Workers");
  });

  it("says plainly what the classifier is and is not", async () => {
    const { container } = setup();
    await ready();
    const text = container.textContent ?? "";
    expect(text).toContain("ten CIFAR-10 classes");
    expect(text).toContain("still gets one of the ten answers");
    expect(text).toContain("never leaves");
  });

  it("opens its drawer in Deep mode and lists the cycles of each mesh", async () => {
    const { container } = setup({ deep: true });
    await ready();
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(true);
    expect(container.textContent).toContain("313,539");
    expect(container.textContent).toContain("139,981");
    expect(container.textContent).toContain("136,987");
  });

  it("closes the worker client when it unmounts", async () => {
    const { close, unmount, container } = setup();
    await ready();
    await runAndWait(container);
    unmount();
    expect(close).toHaveBeenCalled();
  });
});
