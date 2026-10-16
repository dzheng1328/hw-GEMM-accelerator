import { describe, expect, it } from "vitest";
import { readDeep, withDeep } from "./useDeepMode";

describe("readDeep", () => {
  it("is on only for deep=1", () => {
    expect(readDeep("?deep=1")).toBe(true);
    expect(readDeep("?utm=x&deep=1")).toBe(true);
  });

  it("is off for anything else", () => {
    for (const search of ["", "?", "?deep=0", "?deep=true", "?deep=", "?deep=11", "?deeper=1", "?utm=x"]) {
      expect(readDeep(search), search).toBe(false);
    }
  });
});

describe("withDeep", () => {
  it("adds deep=1 and keeps other parameters", () => {
    expect(withDeep("", true)).toBe("?deep=1");
    expect(withDeep("?utm=x", true)).toBe("?utm=x&deep=1");
  });

  it("removes deep and keeps other parameters", () => {
    expect(withDeep("?utm=x&deep=1", false)).toBe("?utm=x");
    expect(withDeep("?deep=1", false)).toBe("");
  });

  it("does not duplicate deep", () => {
    expect(withDeep("?deep=1", true)).toBe("?deep=1");
  });
});
