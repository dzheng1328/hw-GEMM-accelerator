import type { Scheduler } from "./useClock";

/** A manual scheduler for tests: time moves only when `advance` is called. */
export function fakeScheduler(): Scheduler & { advance(ms: number): void; pending(): number } {
  let time = 0;
  let next = 1;
  const queue = new Map<number, () => void>();
  return {
    now: () => time,
    request(cb) {
      const handle = next++;
      queue.set(handle, cb);
      return handle;
    },
    cancel(handle) {
      queue.delete(handle);
    },
    advance(ms) {
      time += ms;
      const callbacks = [...queue.values()];
      queue.clear();
      for (const cb of callbacks) cb();
    },
    pending: () => queue.size,
  };
}
