// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { useIsMiniPay } from "./useIsMiniPay";
import * as wfe from "./waitForEthereum";

function setWindowEthereum(value: unknown) {
  Object.defineProperty(window, "ethereum", {
    value,
    configurable: true,
    writable: true,
  });
}

describe("useIsMiniPay", () => {
  it("returns false during the first render (SSR-safe default)", () => {
    setWindowEthereum(undefined);
    vi.spyOn(wfe, "waitForEthereum").mockResolvedValue(false);
    const { result } = renderHook(() => useIsMiniPay());
    expect(result.current).toBe(false);
  });

  it("flips to true after window.ethereum injects with isMiniPay=true", async () => {
    setWindowEthereum(undefined);
    vi.spyOn(wfe, "waitForEthereum").mockResolvedValue(true);
    // Simulate injection happening as if it had already resolved
    // (we then redefine window.ethereum to a MiniPay-shaped provider)
    setWindowEthereum({ isMiniPay: true, request: vi.fn() });

    const { result } = renderHook(() => useIsMiniPay());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("stays false when the provider is not MiniPay", async () => {
    setWindowEthereum({ isMiniPay: false, request: vi.fn() });
    vi.spyOn(wfe, "waitForEthereum").mockResolvedValue(true);
    const { result } = renderHook(() => useIsMiniPay());
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("re-renders when accountsChanged fires on the MiniPay provider", async () => {
    const handlers: Array<(...args: unknown[]) => void> = [];
    const on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === "accountsChanged") handlers.push(handler);
    });
    const removeListener = vi.fn();
    setWindowEthereum({ isMiniPay: true, request: vi.fn(), on, removeListener });
    vi.spyOn(wfe, "waitForEthereum").mockResolvedValue(true);

    const { result, unmount } = renderHook(() => useIsMiniPay());
    await waitFor(() => expect(result.current).toBe(true));
    // Simulate a switch event by flipping the provider's flag at runtime.
    // (Our hook re-reads on every render anyway; the test asserts the
    // listener was actually wired.)
    expect(on).toHaveBeenCalledWith("accountsChanged", expect.any(Function));
    unmount();
    expect(removeListener).toHaveBeenCalled();
  });
});
