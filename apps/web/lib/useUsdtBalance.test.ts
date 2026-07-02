// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useUsdtBalance } from "./useUsdtBalance";
import * as wfe from "./waitForEthereum";
import * as wallet from "./wallet";

function setWindowEthereum(value: unknown) {
  Object.defineProperty(window, "ethereum", {
    value,
    configurable: true,
    writable: true,
  });
}

const USDT_RESPONSE = (raw: bigint) => "0x" + raw.toString(16).padStart(64, "0");

describe("useUsdtBalance", () => {
  it("returns {loading: true, balance: 0} on first render", () => {
    setWindowEthereum(undefined);
    vi.spyOn(wfe, "waitForEthereum").mockResolvedValue(false);
    vi.spyOn(wallet, "getWalletAddress").mockResolvedValue("0xabc");
    const { result } = renderHook(() => useUsdtBalance());
    expect(result.current.loading).toBe(true);
    expect(result.current.balance).toBe(0);
  });

  it("loads balance after mount and resolves to positive USD", async () => {
    setWindowEthereum({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_call") {
          return Promise.resolve(USDT_RESPONSE(3_914_020n)); // 3.91402 USDT (6 decimals)
        }
        throw new Error("unreachable");
      }),
    });
    vi.spyOn(wfe, "waitForEthereum").mockResolvedValue(true);
    vi.spyOn(wallet, "getWalletAddress").mockResolvedValue("0xabc");

    const { result } = renderHook(() => useUsdtBalance());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balance).toBeCloseTo(3.91402, 4);
  });

  it("stays at 0 when no wallet is connected (no error)", async () => {
    setWindowEthereum({ request: vi.fn() });
    vi.spyOn(wfe, "waitForEthereum").mockResolvedValue(true);
    vi.spyOn(wallet, "getWalletAddress").mockResolvedValue(null);

    const { result } = renderHook(() => useUsdtBalance());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balance).toBe(0);
  });

  it("stays at 0 and surfaces the error when the RPC call throws", async () => {
    setWindowEthereum({
      request: vi.fn().mockRejectedValue(new Error("RPC down")),
    });
    vi.spyOn(wfe, "waitForEthereum").mockResolvedValue(true);
    vi.spyOn(wallet, "getWalletAddress").mockResolvedValue("0xabc");

    const { result } = renderHook(() => useUsdtBalance());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balance).toBe(0);
    expect(result.current.error?.message).toBe("RPC down");
  });

  it("reloads the balance when reload() is called", async () => {
    let count = 0;
    setWindowEthereum({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_call") {
          count += 1;
          return Promise.resolve(USDT_RESPONSE(BigInt(count) * 1_000_000n));
        }
        throw new Error("unreachable");
      }),
    });
    vi.spyOn(wfe, "waitForEthereum").mockResolvedValue(true);
    vi.spyOn(wallet, "getWalletAddress").mockResolvedValue("0xabc");

    const { result } = renderHook(() => useUsdtBalance());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balance).toBe(1);
    result.current.reload();
    await waitFor(() => expect(result.current.balance).toBe(2));
  });
});
