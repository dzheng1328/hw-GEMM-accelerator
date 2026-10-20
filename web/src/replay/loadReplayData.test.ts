import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import stepsUrl from "../data/generated/lm-steps.json?url&no-inline";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (url === stepsUrl ? { steps: [{ step: 0 }] } : { promptIds: [1], stories: [], probs: [], vocab: {} }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const stepFetches = () => fetchMock.mock.calls.filter(([url]) => url === stepsUrl).length;

describe("the per-step records", () => {
  it("are fetched once for the replay and the ribbon together", async () => {
    const { loadLmSteps, loadReplayData } = await import("./loadReplayData");
    const [steps, replay] = await Promise.all([loadLmSteps(), loadReplayData()]);
    expect(replay.steps).toBe(steps);
    expect(await loadLmSteps()).toBe(steps);
    expect(stepFetches()).toBe(1);
  });

  it("are fetched again after a failure", async () => {
    const { loadLmSteps } = await import("./loadReplayData");
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 503 }));
    await expect(loadLmSteps()).rejects.toThrow("HTTP 503");
    await expect(loadLmSteps()).resolves.toEqual([{ step: 0 }]);
    expect(stepFetches()).toBe(2);
  });
});
