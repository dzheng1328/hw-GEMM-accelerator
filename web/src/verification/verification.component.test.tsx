// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeepContext } from "../components/deepContext";
import { CLAIM, LADDERS, LAYERS, LIMITS, REPRODUCE, SUITES } from "../content/verification";
import { REPO_URL } from "../content/timeline";
import { ladderEvidence } from "./evidence";
import { LadderView } from "./LadderView";
import { LimitsList } from "./LimitsList";
import { SuiteTable } from "./SuiteTable";
import { VerificationSection } from "./VerificationSection";

afterEach(cleanup);

describe("LadderView", () => {
  it("draws a card per rung, in order, with what it proves, its files and its command", () => {
    for (const ladder of LADDERS) {
      const { container } = render(<LadderView ladder={ladder} />);
      const cards = container.querySelectorAll(".rung-card");
      expect(cards).toHaveLength(ladder.rungs.length);
      for (const [i, rung] of ladder.rungs.entries()) {
        const text = cards[i]!.textContent!;
        expect(text).toContain(rung.name);
        expect(text).toContain(rung.proves);
        for (const f of rung.files) expect(text).toContain(f);
        if (rung.command) expect(text).toContain(rung.command.text);
      }
      cleanup();
    }
  });

  it("puts a connector between rungs and says plainly where a step is not bit-exact", () => {
    const lm = LADDERS.find((l) => l.id === "lm")!;
    const { container } = render(<LadderView ladder={lm} />);
    const connectors = [...container.querySelectorAll(".rung-connector")].map((n) => n.textContent);
    expect(connectors).toHaveLength(3);
    // The step from the float model to the integer reference is by validation loss; the two steps below it are bit-exact.
    expect(connectors[0]).toContain("not bit-exact");
    for (const connector of connectors.slice(1)) {
      expect(connector).toContain("bit-exact against the rung above");
      expect(connector).not.toContain("not bit-exact");
    }
  });

  it("shows the evidence line from the generated data", () => {
    const cifar = LADDERS.find((l) => l.id === "cifar")!;
    const { container } = render(<LadderView ladder={cifar} />);
    expect(container.querySelector("figcaption")!.textContent).toBe(ladderEvidence("cifar"));
  });

  it("is an ordered list of rungs", () => {
    const { container } = render(<LadderView ladder={LADDERS[0]!} />);
    expect(container.querySelector("ol.rungs")).not.toBeNull();
  });
});

describe("LimitsList", () => {
  it("lists every limit with a link to its source", () => {
    const { container } = render(<LimitsList limits={LIMITS} />);
    const items = container.querySelectorAll(".limits li");
    expect(items).toHaveLength(LIMITS.length);
    for (const [i, limit] of LIMITS.entries()) {
      expect(items[i]!.textContent).toContain(limit.text);
      const href = items[i]!.querySelector("a")!.getAttribute("href")!;
      const expected = "decision" in limit.source ? `${REPO_URL}/blob/main/docs/decisions.md` : `${REPO_URL}/blob/main/${limit.source.file}`;
      expect(href, limit.id).toBe(expected);
    }
  });
});

describe("SuiteTable", () => {
  it("has a table per layer and a row per suite", () => {
    const { container } = render(<SuiteTable suites={SUITES} layers={LAYERS} />);
    const captions = [...container.querySelectorAll("caption")].map((c) => c.textContent);
    expect(captions).toEqual(LAYERS);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(SUITES.length);
  });

  it("shows each suite's directory, unit under test, claim and checks", () => {
    const { container } = render(<SuiteTable suites={SUITES} layers={LAYERS} />);
    const rows = [...container.querySelectorAll("tbody tr")];
    const writeback = rows.find((r) => r.textContent!.includes("tb/writeback"))!;
    expect(writeback.textContent).toContain("rtl/writeback.v");
    for (const target of ["orphan-check", "mode-check", "rows-check"]) expect(writeback.textContent).toContain(`make ${target}`);
  });

  it("keeps its table semantics explicit, so stacking the rows on a phone does not remove them for a screen reader", () => {
    const { container } = render(<SuiteTable suites={SUITES} layers={LAYERS} />);
    for (const table of container.querySelectorAll("table")) {
      expect(table.getAttribute("role")).toBe("table");
      expect(table.querySelector("thead")!.getAttribute("role")).toBe("rowgroup");
      expect(table.querySelector("tbody")!.getAttribute("role")).toBe("rowgroup");
    }
    expect([...container.querySelectorAll("th")].every((th) => th.getAttribute("role") === "columnheader")).toBe(true);
    expect([...container.querySelectorAll("tbody tr")].every((tr) => tr.getAttribute("role") === "row")).toBe(true);
    expect([...container.querySelectorAll("tbody td")].every((td) => td.getAttribute("role") === "cell")).toBe(true);
    expect([...container.querySelectorAll("thead tr")].every((tr) => tr.getAttribute("role") === "row")).toBe(true);
  });

  it("hides the header row on a phone visually, not with display: none, so the column headers stay in the accessibility tree", () => {
    const css = readFileSync(join(import.meta.dirname, "..", "theme", "architecture.css"), "utf8");
    expect(css).not.toMatch(/suite-table thead\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/suite-table thead\s*\{[^}]*clip/);
  });

  it("lists the negative checks as 'must fail, and does', one per must-fail check, and not the positive probes", () => {
    const { container } = render(<SuiteTable suites={SUITES} layers={LAYERS} />);
    const items = [...container.querySelectorAll(".must-fail li")];
    expect(items).toHaveLength(9);
    const text = items.map((i) => i.textContent).join("\n");
    expect(text).toContain("make error-check");
    expect(text).not.toContain("make reset-check");
    expect(text).not.toContain("make q16");
  });
});

describe("VerificationSection", () => {
  it("shows both ladders, the claim and the six limits without any click", () => {
    const { container } = render(<VerificationSection />);
    expect(container.querySelector("section#verification h2")!.textContent).toBe("Why you can believe it");
    expect(container.querySelectorAll(".ladder")).toHaveLength(2);
    expect(container.querySelector(".claim")!.textContent).toContain(CLAIM.text);
    expect(container.querySelectorAll(".limits li")).toHaveLength(6);
    expect(container.querySelector("details")!.hasAttribute("open")).toBe(false);
  });

  it("puts the suites, the must-fail list and the reproduce lines in the drawer", () => {
    const { container } = render(
      <DeepContext.Provider value={true}>
        <VerificationSection />
      </DeepContext.Provider>,
    );
    const drawer = container.querySelector("details")!;
    expect(drawer.open).toBe(true);
    expect(drawer.querySelectorAll("tbody tr")).toHaveLength(SUITES.length);
    expect(drawer.querySelectorAll(".must-fail li")).toHaveLength(9);
    const reproduce = [...drawer.querySelectorAll(".reproduce li")];
    expect(reproduce).toHaveLength(REPRODUCE.length);
    expect(reproduce[0]!.textContent).toContain("./test.sh");
  });
});
