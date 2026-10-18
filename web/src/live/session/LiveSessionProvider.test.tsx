// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { manifest } from "../sim/manifest";
import { SimError, SupersededError } from "../sim/client";
import type { LiveRun } from "../sim/engine";
import type { MeshKey } from "../sim/types";
import { makeRun } from "../view/testRun.testlib";
import { useRunPlayback } from "./RunPlaybackProvider";
import { useLiveSession } from "./context";
import { LiveSessionProvider, type LiveSessionProviderProps } from "./LiveSessionProvider";
import type { IdleScheduler } from "./idle";
import type { LiveSession } from "./context";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const examples = () =>
  manifest.classNames.map((name, i) => ({ name, pixels: new Uint8Array(3072).fill(i), logits: Array.from(makeRun().logits) }));

function Probe({ onSession }: { onSession(session: LiveSession): void }) {
  const session = useLiveSession();
  const rp = useRunPlayback();
  onSession(session);
  return <p data-testid="probe">{`${session.state.phase.name}|${session.state.mesh}|${rp?.run.mesh ?? "-"}`}</p>;
}

type RunImpl = (mesh: MeshKey, pixels: Uint8Array) => Promise<LiveRun>;

function setup(opts: { run?: RunImpl; props?: Partial<LiveSessionProviderProps>; strict?: boolean } = {}) {
  const idleQueue: (() => void)[] = [];
  const idle: IdleScheduler = (callback) => {
    idleQueue.push(callback);
    return () => {
      const at = idleQueue.indexOf(callback);
      if (at >= 0) idleQueue.splice(at, 1);
    };
  };
  const run = vi.fn(opts.run ?? (async (mesh: MeshKey) => makeRun(mesh)));
  const close = vi.fn();
  const loadExamples = vi.fn(async () => examples());
  const loadScene = vi.fn(async () => () => null);
  let session!: LiveSession;
  const tree = (
    <LiveSessionProvider
      createClient={() => ({ run: run as never, close })}
      loadExamples={loadExamples}
      loadScene={loadScene}
      decodeImage={async () => ({ rgba: new Uint8ClampedArray(64 * 64 * 4).fill(200), width: 64, height: 64 })}
      webgl={() => true}
      supported={() => true}
      saveData={() => false}
      idle={idle}
      {...opts.props}
    >
      <Probe onSession={(s) => (session = s)} />
    </LiveSessionProvider>
  );
  const ui = render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree);
  return {
    ...ui,
    run,
    close,
    loadExamples,
    loadScene,
    session: () => session,
    flushIdle: () => act(async () => idleQueue.splice(0).forEach((callback) => callback())),
  };
}
const phase = () => screen.getByTestId("probe").textContent!.split("|")[0];

describe("useLiveSession", () => {
  it("throws outside a provider", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe onSession={() => {}} />)).toThrow(/LiveSessionProvider/);
    quiet.mockRestore();
  });
});

describe("the arrival auto-run", () => {
  it("starts one run by itself after first paint: the cat on 2x2", async () => {
    const { run, flushIdle } = setup();
    expect(run).not.toHaveBeenCalled();
    await flushIdle();
    await waitFor(() => expect(phase()).toBe("done"));
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]![0]).toBe("2x2");
    expect(run.mock.calls[0]![1]).toEqual(new Uint8Array(3072).fill(3));
  });

  it("says the first run is pending until the visitor has run something", async () => {
    const { session, flushIdle } = setup();
    expect(session().autoPending).toBe(true);
    await flushIdle();
    await waitFor(() => expect(phase()).toBe("done"));
    expect(session().autoPending).toBe(false);
  });

  it.each([
    ["reduced motion is on", () => vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} })), {}],
    ["Save-Data is on", () => {}, { saveData: () => true }],
    ["WebGL is missing", () => {}, { webgl: () => false }],
    ["Workers or WebAssembly are missing", () => {}, { supported: () => false }],
    ["autoRun is off", () => {}, { autoRun: false }],
  ])("does nothing when %s, and loads nothing", async (_name, arrange, props) => {
    arrange();
    const { run, loadExamples, loadScene, session, flushIdle } = setup({ props });
    await flushIdle();
    expect(run).not.toHaveBeenCalled();
    expect(loadExamples).not.toHaveBeenCalled();
    expect(loadScene).not.toHaveBeenCalled();
    expect(session().autoPending).toBe(false);
  });

  it("runs once even though React StrictMode mounts its effects twice", async () => {
    const { run, flushIdle } = setup({ strict: true });
    await flushIdle();
    await waitFor(() => expect(phase()).toBe("done"));
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not run again when the visitor pressed Run before the idle callback fired", async () => {
    const { run, session, flushIdle } = setup();
    act(() => session().run());
    await flushIdle();
    await waitFor(() => expect(phase()).toBe("done"));
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not run when the visitor already ran something", async () => {
    const { run, session, flushIdle } = setup({ props: { autoRun: false } });
    act(() => session().wantAssets());
    await waitFor(() => expect(session().examples.status).toBe("ready"));
    act(() => session().run());
    await waitFor(() => expect(phase()).toBe("done"));
    await flushIdle();
    expect(run).toHaveBeenCalledOnce();
  });

  it("stops saying 'pending' when the example images cannot be loaded", async () => {
    const { session, flushIdle } = setup({ props: { loadExamples: async () => Promise.reject(new Error("offline")) } });
    await flushIdle();
    await waitFor(() => expect(session().examples.status).toBe("error"));
    expect(session().autoPending).toBe(false);
  });
});

describe("run()", () => {
  it("waits for the example images when they have not loaded, then runs", async () => {
    const { run, session } = setup({ props: { autoRun: false } });
    act(() => session().run());
    await waitFor(() => expect(phase()).toBe("done"));
    expect(run).toHaveBeenCalledOnce();
  });

  it("ignores a second press while a run is in progress", async () => {
    const { run, session } = setup({ props: { autoRun: false }, run: () => new Promise<LiveRun>(() => {}) });
    act(() => session().run());
    await waitFor(() => expect(phase()).toBe("running"));
    act(() => session().run());
    expect(run).toHaveBeenCalledOnce();
  });

  it("does nothing in a browser that cannot run the chip", async () => {
    const { run, session } = setup({ props: { supported: () => false, autoRun: false } });
    act(() => session().run());
    await act(async () => {});
    expect(run).not.toHaveBeenCalled();
    expect(phase()).toBe("idle");
  });

  it("makes a new client after a failure that is not a chip fault", async () => {
    let created = 0;
    let calls = 0;
    const closes: number[] = [];
    const { session } = setup({
      props: {
        autoRun: false,
        createClient: () => {
          const id = ++created;
          return {
            run: (async (mesh: MeshKey) => {
              if (++calls === 1) throw new SimError("the simulator worker failed: boom", false);
              return makeRun(mesh);
            }) as never,
            close: () => closes.push(id),
          };
        },
      },
    });
    act(() => session().run());
    await waitFor(() => expect(phase()).toBe("error"));
    act(() => session().run());
    await waitFor(() => expect(phase()).toBe("done"));
    expect(created).toBe(2);
    expect(closes).toEqual([1]);
  });

  it("closes the client when the provider unmounts", async () => {
    const { close, session, unmount } = setup({ props: { autoRun: false } });
    act(() => session().run());
    await waitFor(() => expect(phase()).toBe("done"));
    unmount();
    expect(close).toHaveBeenCalled();
  });
});

describe("setMesh()", () => {
  it("only selects the mesh when nothing has run yet", async () => {
    const { run, session } = setup({ props: { autoRun: false } });
    act(() => session().setMesh("4x4"));
    await act(async () => {});
    expect(run).not.toHaveBeenCalled();
    expect(session().state.mesh).toBe("4x4");
    expect(phase()).toBe("idle");
  });

  it("re-runs the current image on the new mesh once a run has happened", async () => {
    const { run, session, flushIdle } = setup();
    await flushIdle();
    await waitFor(() => expect(phase()).toBe("done"));
    act(() => session().setMesh("4x4"));
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("done|4x4|4x4"));
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]![0]).toBe("4x4");
    expect(run.mock.calls[1]![1]).toEqual(run.mock.calls[0]![1]);
  });

  it("does nothing for the mesh that is already selected", async () => {
    const { run, session, flushIdle } = setup();
    await flushIdle();
    await waitFor(() => expect(phase()).toBe("done"));
    act(() => session().setMesh("2x2"));
    await act(async () => {});
    expect(run).toHaveBeenCalledOnce();
  });

  it("shows only the last mesh's result after rapid clicks", async () => {
    const resolvers: { mesh: MeshKey; resolve(run: LiveRun): void; reject(error: Error): void }[] = [];
    const { session, flushIdle } = setup({
      run: (mesh) => new Promise<LiveRun>((resolve, reject) => resolvers.push({ mesh, resolve, reject })),
    });
    await flushIdle();
    await waitFor(() => expect(resolvers).toHaveLength(1));
    await act(async () => resolvers[0]!.resolve(makeRun("2x2")));
    await waitFor(() => expect(phase()).toBe("done"));
    act(() => session().setMesh("1x1"));
    act(() => session().setMesh("4x4"));
    await waitFor(() => expect(resolvers).toHaveLength(3));
    await act(async () => resolvers[1]!.reject(new SupersededError("replaced")));
    expect(phase()).toBe("running");
    await act(async () => resolvers[2]!.resolve(makeRun("4x4")));
    expect(screen.getByTestId("probe").textContent).toBe("done|4x4|4x4");
  });

  it("drops a late result from a run the visitor moved on from", async () => {
    const resolvers: ((run: LiveRun) => void)[] = [];
    const { session, flushIdle } = setup({ run: () => new Promise<LiveRun>((resolve) => resolvers.push(resolve)) });
    await flushIdle();
    await waitFor(() => expect(resolvers).toHaveLength(1));
    act(() => session().setMesh("1x1"));
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => resolvers[0]!(makeRun("2x2")));
    expect(phase()).toBe("running");
    await act(async () => resolvers[1]!(makeRun("1x1")));
    expect(screen.getByTestId("probe").textContent).toBe("done|1x1|1x1");
  });
});

describe("images", () => {
  it("choosing another example clears the run and does not re-run it", async () => {
    const { run, session, flushIdle } = setup();
    await flushIdle();
    await waitFor(() => expect(phase()).toBe("done"));
    act(() => session().selectExample(0));
    await act(async () => {});
    expect(phase()).toBe("idle");
    expect(run).toHaveBeenCalledOnce();
    expect(session().imageLabel).toBe("the airplane");
    expect(session().autoPending).toBe(false);
  });

  it("an uploaded image is cropped to 3072 bytes, named 'your image', and a later mesh change re-runs it", async () => {
    const { run, session, flushIdle } = setup();
    await flushIdle();
    await waitFor(() => expect(phase()).toBe("done"));
    await act(async () => session().upload(new File(["x"], "me.png", { type: "image/png" })));
    expect(session().imageLabel).toBe("your image");
    expect(session().golden).toBeNull();
    act(() => session().setMesh("1x1"));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls[1]![1]).toHaveLength(3072);
  });

  it("explains an empty file without decoding it", async () => {
    const decodeImage = vi.fn();
    const { session } = setup({ props: { decodeImage, autoRun: false } });
    await act(async () => session().upload(new File([], "empty.png", { type: "image/png" })));
    expect(session().state.notice).toBe("That file is empty.");
    expect(decodeImage).not.toHaveBeenCalled();
  });
});
