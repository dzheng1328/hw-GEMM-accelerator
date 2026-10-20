/** True when this browser can create a WebGL context. The probe's own context is given back at once: browsers allow only about sixteen. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
