export interface MotionEnv {
  reduced: boolean;
  saveData: boolean;
  search: string;
}

/** Off for reduced motion, for Save-Data and for ?motion=0. Off means the final state is shown, never hidden content. */
export function motionEnabled(env: MotionEnv): boolean {
  if (env.reduced || env.saveData) return false;
  return new URLSearchParams(env.search).get("motion") !== "0";
}

export function readMotionEnv(win: Window = window): MotionEnv {
  const reduced = typeof win.matchMedia === "function" ? win.matchMedia("(prefers-reduced-motion: reduce)").matches : true;
  const connection = (win.navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return { reduced, saveData: connection?.saveData === true, search: win.location.search };
}
