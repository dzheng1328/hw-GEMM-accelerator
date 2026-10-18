// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeshSceneProps } from "./MeshScene";
import { manifest } from "../sim/manifest";
import { LiveSessionProvider, type LiveSessionProviderProps } from "../session/LiveSessionProvider";
import { useLiveSession } from "../session/context";
import type { LiveSession } from "../session/context";
import { makeRun } from "./testRun.testlib";
import { MeshStage, type StageVariant } from "./MeshStage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const seen: MeshSceneProps[] = [];
function Scene(props: MeshSceneProps) {
  seen.push(props);
  return <div data-testid="scene" data-active={String(props.active)} />;
}
const examples = () => manifest.classNames.map((name, i) => ({ name, pixels: new Uint8Array(3072).fill(i), logits: Array.from(makeRun().logits) }));

function Grab({ onSession }: { onSession(s: LiveSession): void }) {
  onSession(useLiveSession());
  return null;
}

function setup(variant: StageVariant, props: Partial<LiveSessionProviderProps> = {}) {
  seen.length = 0;
  let session!: LiveSession;
  const ui = render(
    <LiveSessionProvider
      autoRun={false}
      createClient={() => ({ run: (async (mesh: "1x1" | "2x2" | "4x4") => makeRun(mesh)) as never, close() {} })}
      loadExamples={async () => examples()}
      loadScene={async () => Scene}
      webgl={() => true}
      supported={() => true}
      saveData={() => false}
      {...props}
    >
      <Grab onSession={(s) => (session = s)} />
      <MeshStage variant={variant} />
    </LiveSessionProvider>,
  );
  return { ...ui, session: () => session };
}

describe("MeshStage", () => {
  it("shows the SVG board of the selected mesh at first, described for assistive technology", () => {
    const { container } = setup("inline");
    expect(container.querySelectorAll(".board-tile")).toHaveLength(4);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "3D view of the 2 by 2 mesh: 4 tiles, the links between them, and the command processor",
    );
    expect(screen.queryByTestId("scene")).toBeNull();
  });

  it("uses the class the Live section and the hero style", () => {
    expect(setup("inline").container.querySelector(".live-scene")).not.toBeNull();
    cleanup();
    expect(setup("hero").container.querySelector(".hero-stage-view")).not.toBeNull();
  });

  it("mounts the idle 3D scene once the chunk has loaded: no trace, not playing, active", async () => {
    const { session } = setup("inline");
    act(() => session().wantAssets());
    expect(await screen.findByTestId("scene")).toBeTruthy();
    const last = seen[seen.length - 1]!;
    expect(last.trace).toBeUndefined();
    expect(last.playing).toBe(false);
    expect(last.w).toBe(2);
    expect(last.h).toBe(2);
    expect(screen.getByTestId("scene").getAttribute("data-active")).toBe("true");
  });

  it("only the hero eases the camera in, and not under reduced motion", async () => {
    const hero = setup("hero");
    act(() => hero.session().wantAssets());
    await screen.findByTestId("scene");
    expect(seen[seen.length - 1]!.settle).toBe(true);
    cleanup();
    const inline = setup("inline");
    act(() => inline.session().wantAssets());
    await screen.findByTestId("scene");
    expect(seen[seen.length - 1]!.settle).toBe(false);
    cleanup();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    const reduced = setup("hero");
    act(() => reduced.session().wantAssets());
    await screen.findByTestId("scene");
    expect(seen[seen.length - 1]!.settle).toBe(false);
  });

  it("gives the scene the shared trace and clock once a run finishes, on the same canvas", async () => {
    const { session } = setup("inline");
    act(() => session().wantAssets());
    const scene = await screen.findByTestId("scene");
    act(() => session().run());
    await waitFor(() => expect(seen[seen.length - 1]!.trace).toBeDefined());
    expect(screen.getByTestId("scene")).toBe(scene);
    expect(seen[seen.length - 1]!.windowRef).toBeDefined();
  });

  it("follows the mesh: a mesh change redraws the board and the scene's size", async () => {
    const { session, container } = setup("inline");
    act(() => session().wantAssets());
    await screen.findByTestId("scene");
    act(() => session().setMesh("4x4"));
    expect(container.querySelectorAll(".board-tile")).toHaveLength(16);
    expect(seen[seen.length - 1]!.w).toBe(4);
  });

  it("hides the board once the scene reports its first frame, and not before", async () => {
    const { session, container } = setup("inline");
    act(() => session().wantAssets());
    await screen.findByTestId("scene");
    expect(container.querySelector(".live-scene")!.getAttribute("data-ready")).toBeNull();
    act(() => seen[seen.length - 1]!.onReady!());
    expect(container.querySelector(".live-scene")!.getAttribute("data-ready")).toBe("true");
  });

  it("without WebGL keeps the board and, in the Live section only, says why", () => {
    const inline = setup("inline", { webgl: () => false });
    expect(inline.container.querySelector(".live-fallback")!.textContent).toContain("WebGL");
    expect(inline.container.querySelectorAll(".board-tile")).toHaveLength(4);
    cleanup();
    const hero = setup("hero", { webgl: () => false });
    expect(hero.container.querySelector(".live-fallback")).toBeNull();
    expect(hero.container.querySelectorAll(".board-tile")).toHaveLength(4);
  });

  it("keeps the board when the 3D chunk cannot be loaded", async () => {
    const { session, container } = setup("inline", { loadScene: async () => Promise.reject(new Error("offline")) });
    act(() => session().wantAssets());
    await waitFor(() => expect(container.querySelector(".live-fallback")?.textContent).toContain("could not be loaded"));
    expect(container.querySelectorAll(".board-tile")).toHaveLength(4);
  });

  it("keeps the board and says so when the scene crashes", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = () => {
      throw new Error("context lost");
    };
    const { session, container } = setup("inline", { loadScene: async () => Broken });
    act(() => session().wantAssets());
    await waitFor(() => expect(container.querySelector(".live-fallback")?.textContent).toContain("could not be shown"));
    expect(container.querySelectorAll(".board-tile")).toHaveLength(4);
    expect(container.querySelector(".live-scene")!.getAttribute("data-ready")).toBeNull();
    quiet.mockRestore();
  });
});
