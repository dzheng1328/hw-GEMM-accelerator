import { describe, expect, it } from "vitest";
import { SimClient, SimError, SupersededError, type Transport } from "./client";
import type { EngineEvent, LiveRun, RunRequest, Stage } from "./engine";

class FakeTransport implements Transport {
  posted: RunRequest[] = [];
  closed = false;
  private listener: (event: EngineEvent) => void = () => {};
  private errorListener: (message: string) => void = () => {};
  post(request: RunRequest) {
    this.posted.push(request);
  }
  onEvent(listener: (event: EngineEvent) => void) {
    this.listener = listener;
  }
  onError(listener: (message: string) => void) {
    this.errorListener = listener;
  }
  close() {
    this.closed = true;
  }
  emit(event: EngineEvent) {
    this.listener(event);
  }
  fail(message: string) {
    this.errorListener(message);
  }
}
const run = (cycles: number) => ({ cycles }) as unknown as LiveRun;
const pixels = new Uint8Array(3072);

describe("SimClient", () => {
  it("posts a request with a fresh id and resolves with the run", async () => {
    const t = new FakeTransport();
    const client = new SimClient(t);
    const promise = client.run("2x2", pixels);
    expect(t.posted).toHaveLength(1);
    expect(t.posted[0]).toMatchObject({ mesh: "2x2" });
    t.emit({ id: t.posted[0]!.id, kind: "done", run: run(7) });
    await expect(promise).resolves.toMatchObject({ cycles: 7 });
  });

  it("reports stages to the caller", async () => {
    const t = new FakeTransport();
    const client = new SimClient(t);
    const stages: Stage[] = [];
    const promise = client.run("2x2", pixels, (s) => stages.push(s));
    const id = t.posted[0]!.id;
    t.emit({ id, kind: "stage", stage: "loading" });
    t.emit({ id, kind: "stage", stage: "simulating" });
    t.emit({ id, kind: "done", run: run(1) });
    await promise;
    expect(stages).toEqual(["loading", "simulating"]);
  });

  it("supersedes an earlier request when a new one is made, and ignores the old request's events", async () => {
    const t = new FakeTransport();
    const client = new SimClient(t);
    const first = client.run("2x2", pixels);
    const firstId = t.posted[0]!.id;
    const second = client.run("4x4", pixels);
    const secondId = t.posted[1]!.id;
    expect(secondId).not.toBe(firstId);
    await expect(first).rejects.toBeInstanceOf(SupersededError);
    t.emit({ id: firstId, kind: "done", run: run(111) });
    t.emit({ id: secondId, kind: "done", run: run(222) });
    await expect(second).resolves.toMatchObject({ cycles: 222 });
  });

  it("turns an error event into a SimError that says whether it was a chip fault", async () => {
    const t = new FakeTransport();
    const client = new SimClient(t);
    const promise = client.run("2x2", pixels);
    t.emit({ id: t.posted[0]!.id, kind: "error", message: "the chip raised error", fault: true });
    await expect(promise).rejects.toMatchObject({ message: "the chip raised error", fault: true });
    await expect(promise).rejects.toBeInstanceOf(SimError);
  });

  it("rejects every pending request when the worker itself fails", async () => {
    const t = new FakeTransport();
    const client = new SimClient(t);
    const promise = client.run("2x2", pixels);
    t.fail("worker script failed to load");
    await expect(promise).rejects.toMatchObject({ message: expect.stringContaining("worker script failed to load"), fault: false });
  });

  it("ignores events for ids it does not know, and closes the transport", () => {
    const t = new FakeTransport();
    const client = new SimClient(t);
    expect(() => t.emit({ id: 999, kind: "done", run: run(1) })).not.toThrow();
    client.close();
    expect(t.closed).toBe(true);
  });
});
