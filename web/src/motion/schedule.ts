/** Runs `run` once the first paint is done and the browser is idle (or after 200 ms where there is no idle callback). Returns a cancel function. */
export function afterFirstPaint(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 1500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 200);
  return () => window.clearTimeout(id);
}
