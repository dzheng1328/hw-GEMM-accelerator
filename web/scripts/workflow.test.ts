import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(join(import.meta.dirname, "..", "..", ".github", "workflows", "web.yml"), "utf8");

/** The quoted entries of `paths:` under a trigger such as `pull_request`. */
function pathsUnder(trigger: string): string[] {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === `  ${trigger}:`);
  if (start === -1) throw new Error(`web.yml has no "${trigger}" trigger`);
  const paths: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,2}\S/.test(line)) break;
    const match = /^\s+- "(.+)"$/.exec(line);
    if (match) paths.push(match[1]!);
  }
  return paths;
}

// Everything a content test reads from outside web/: the page cites these files, so a change to them must run the web job.
const READ_BY_CONTENT_TESTS = [
  "web/**",
  "docs/perf/**",
  ".github/workflows/web.yml",
  "rtl/**",
  "tb/**",
  "compiler/**",
  "model/**",
  "docs/decisions.md",
  "docs/specs/**",
  "test.sh",
];

describe("the web workflow's path filter", () => {
  for (const trigger of ["pull_request", "push"]) {
    it(`${trigger} runs for every path the content tests read`, () => {
      const paths = pathsUnder(trigger);
      expect(paths.length, `${trigger} has no paths`).toBeGreaterThan(0);
      for (const wanted of READ_BY_CONTENT_TESTS) {
        expect(paths, `${trigger} does not list "${wanted}"`).toContain(wanted);
      }
    });
  }
});
