/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * The Emscripten glue in src/live/sim/artifacts imports node:module on its Node-only branch, which the tests use and a
 * browser never reaches. Bundling it would warn that the module is externalized, so the build gets an empty stand-in.
 */
const nodeModuleStub: Plugin = {
  name: "stub-node-module",
  apply: "build",
  enforce: "pre",
  resolveId: (id) => (id === "node:module" ? "\0stub-node-module" : null),
  load: (id) => (id === "\0stub-node-module" ? "export const createRequire = () => { throw new Error('node:module is not available in a browser'); };" : null),
};

export default defineConfig({
  plugins: [react(), nodeModuleStub],
  worker: { format: "es", plugins: () => [nodeModuleStub] },
  // the lazily loaded 3D chunk (three.js) is about 900 kB; the entry chunk stays far below this
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
  },
});
