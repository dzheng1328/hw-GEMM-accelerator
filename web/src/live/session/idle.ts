/** Runs `callback` when the browser is idle after first paint; the returned function cancels it. */
export type IdleScheduler = (callback: () => void) => () => void;

export const browserIdle: IdleScheduler = (callback) => {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout: 1500 });
    return () => window.cancelIdleCallback(handle);
  }
  // Safari has no requestIdleCallback
  const handle = window.setTimeout(callback, 200);
  return () => window.clearTimeout(handle);
};

/** True when the visitor asked their browser to save data; the page then waits for a click before loading the chip. */
export function saveDataOn(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}
