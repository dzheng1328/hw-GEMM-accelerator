// Test-only: a LiveSessionProvider that never auto-runs and never touches a worker, a GPU or the network.
import type { ReactNode } from "react";
import { manifest } from "../sim/manifest";
import type { MeshKey } from "../sim/types";
import { makeRun } from "../view/testRun.testlib";
import { LiveSessionProvider, type LiveSessionProviderProps } from "./LiveSessionProvider";

export function TestSession({ children, ...props }: Partial<LiveSessionProviderProps> & { children: ReactNode }) {
  return (
    <LiveSessionProvider
      autoRun={false}
      createClient={() => ({ run: (async (mesh: MeshKey) => makeRun(mesh)) as never, close() {} })}
      loadExamples={async () => []}
      loadScene={async () => () => null}
      webgl={() => false}
      supported={() => true}
      saveData={() => false}
      {...props}
    >
      {children}
    </LiveSessionProvider>
  );
}

/** Ten loaded example images for tests that need a run to be startable. */
export const testExamples = () =>
  manifest.classNames.map((name, i) => ({ name, pixels: new Uint8Array(3072).fill(i), logits: Array.from(makeRun().logits) }));
