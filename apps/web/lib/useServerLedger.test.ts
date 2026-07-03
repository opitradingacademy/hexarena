// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useServerLedger } from "./useServerLedger";
import * as wfe from "./waitForEthereum";
import * as wallet from "./wallet";

function setWindowEthereum(value: unknown) {
  Object.defineProperty(window, "ethereum", {
    value,
    configurable: true,
    writable: true,
  });
}

describe("useServerLedger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns {loading: true, balance: 0} on first render", () => {
    setWindowEthereum(undefined);
    vi.spyOn(wfe, "waitForEthereum").mockResolvedValue(false);
    vi.spyOn(wallet, "getWalletAddress").mockResolvedValue("0xabc");
    const { result } = renderHook(() => useServerLedger("https://api.test"));
    expect(result.current.loading).toBe(true);
    expect(result.current.balance).toBe(0);
  });

  it("fetches the server's ledger balance, not the on-chain balance", async () => {
    setWindowEthereum({ request: vi.fn() });
    vi.spyOn(wfe, "waitForEthereum").mockResolvedValue(true);
    vi.spyOn(wallet, "getWalletAddress").mockResolvedValue("0xabc");
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balanceUSD: 0.1 }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useServerLedger("https://api.test"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balance).toBeCloseTo(0.1, 5);
    expect(fetchSpy.mock.calls[0][0]).toMatch(/^https:\/\/api\.test\/api\/balance\?wallet=0xabc$/);
  });

  it("stays at 0 when the wallet address cannot be read", async () => {
    setWindowEthereum({ request: vi.fn() });
    vi.spyOn(wfe, "waitForEthereum").mockResolvedValue(true);
    vi.spyOn(wallet, "getWalletAddress").mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn());

    const { result } = renderHook(() => useServerLedger("https://api.test"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balance).toBe(0);
  });

  it("surfaces the error and stays at 0 when /api/balance returns non-200", async () => {
    setWindowEthereum({ request: vi.fn() });
    vi.spyOn(wfe, "waitForEthereum").mockResolvedValue(true);
    vi.spyOn(wallet, "getWalletAddress").mockResolvedValue("0xabc");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    const { result } = renderHook(() => useServerLedger("https://api.test"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balance).toBe(0);
    expect(result.current.error?.message).toMatch(/BAD_REQUEST/);
  });

  it("refresh() resolves with the freshly-read balance and updates the hook state", async () => {
    setWindowEthereum({ request: vi.fn() });
    vi.spyOn(wfe, "waitForEthereum").mockResolvedValue(true);
    vi.spyOn(wallet, "getWalletAddress").mockResolvedValue("0xabc");
    let count = 0;
    const fetchSpy = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ balanceUSD: count++ > 0 ? 0.4 : 0.1 }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useServerLedger("https://api.test"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balance).toBeCloseTo(0.1, 5);

    let resolved: number = -1;
    await act(async () => {
      resolved = await result.current.refresh();
    });
    expect(resolved).toBeCloseTo(0.4, 5);
    expect(result.current.balance).toBeCloseTo(0.4, 5);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
