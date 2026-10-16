import { describe, expect, it } from "vitest";
import { meshLinks } from "./links";

describe("meshLinks", () => {
  it("has no links on a 1x1 mesh", () => {
    expect(meshLinks(1, 1)).toEqual([]);
  });
  it("2x2: eight directed links, north is y + 1 and east is x + 1", () => {
    const links = meshLinks(2, 2);
    expect(links).toHaveLength(8);
    expect(links).toContainEqual({ id: 0 * 4 + 1, from: 0, to: 1, port: 1 }); // node 0 east -> node 1
    expect(links).toContainEqual({ id: 0 * 4 + 0, from: 0, to: 2, port: 0 }); // node 0 north -> node 2
    expect(links).toContainEqual({ id: 3 * 4 + 3, from: 3, to: 2, port: 3 }); // node 3 west -> node 2
    expect(links).toContainEqual({ id: 3 * 4 + 2, from: 3, to: 1, port: 2 }); // node 3 south -> node 1
  });
  it("4x4: 48 directed links, none leaving the mesh, ids unique", () => {
    const links = meshLinks(4, 4);
    expect(links).toHaveLength(48);
    expect(new Set(links.map((l) => l.id)).size).toBe(48);
    for (const l of links) expect(l.to).toBeGreaterThanOrEqual(0);
  });
});
