// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSyncedReducer } from "./useSyncedReducer";

afterEach(cleanup);

const add = (n: number, by: number) => n + by;

describe("useSyncedReducer", () => {
  it("reads the state after every dispatch at once, before React re-renders", () => {
    const { result } = renderHook(() => useSyncedReducer(add, 0));
    act(() => {
      result.current[1](2);
      expect(result.current[2].current).toBe(2);
      result.current[1](3);
      expect(result.current[2].current).toBe(5);
    });
    expect(result.current[0]).toBe(5);
  });

  it("keeps a stable dispatch", () => {
    const { result, rerender } = renderHook(() => useSyncedReducer(add, 0));
    const first = result.current[1];
    rerender();
    expect(result.current[1]).toBe(first);
  });
});
