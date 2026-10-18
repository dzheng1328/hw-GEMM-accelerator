// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

afterEach(cleanup);

describe("ErrorBoundary", () => {
  it("shows the fallback and tells its owner once when a child throws", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    const Broken = () => {
      throw new Error("boom");
    };
    render(
      <ErrorBoundary fallback={<p>fallback</p>} onError={onError}>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByText("fallback")).toBeTruthy();
    expect(onError).toHaveBeenCalledOnce();
    quiet.mockRestore();
  });
});
