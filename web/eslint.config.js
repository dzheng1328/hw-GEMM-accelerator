import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["dist", "node_modules", "test-results", "playwright-report", "src/data/generated", "src/live/sim/artifacts"],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    // Node-run build tools written as plain ES modules.
    files: ["sim-build/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", Buffer: "readonly", console: "readonly" } },
  },
);
