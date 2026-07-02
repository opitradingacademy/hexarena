import { describe, expect, it, vi } from "vitest";
import { getWalletAddress } from "./wallet";

const ADDRESS = "0x000000000000000000000000000000000000dEaD";

describe("getWalletAddress", () => {
  it("returns null when there is no injected provider", async () => {
    await expect(getWalletAddress(undefined)).resolves.toBeNull();
  });

  it("returns the first account from eth_requestAccounts", async () => {
    const request = vi.fn().mockResolvedValue([ADDRESS]);
    await expect(getWalletAddress({ request })).resolves.toBe(ADDRESS);
    expect(request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
  });

  it("returns null when the provider returns no accounts", async () => {
    const request = vi.fn().mockResolvedValue([]);
    await expect(getWalletAddress({ request })).resolves.toBeNull();
  });

  it("returns null when the provider rejects (user denied access)", async () => {
    const request = vi.fn().mockRejectedValue(new Error("User rejected"));
    await expect(getWalletAddress({ request })).resolves.toBeNull();
  });

  it("works with a MiniPay-shaped provider (isMiniPay flag present)", async () => {
    const request = vi.fn().mockResolvedValue([ADDRESS]);
    await expect(getWalletAddress({ request, isMiniPay: true } as never)).resolves.toBe(ADDRESS);
    expect(request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
  });

  it("retries eth_requestAccounts when the first call returns [] (MiniPay WebView race)", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([ADDRESS]);
    const result = await getWalletAddress({ request }, { retries: 3, delayMs: 0 });
    expect(result).toBe(ADDRESS);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("respects the existing fast-path: retries=0 means no retry", async () => {
    const request = vi.fn().mockResolvedValue([]);
    const result = await getWalletAddress({ request }, { retries: 0, delayMs: 0 });
    expect(result).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("returns null when all retries are exhausted and provider never yields accounts", async () => {
    const request = vi.fn().mockResolvedValue([]);
    const result = await getWalletAddress({ request }, { retries: 2, delayMs: 0 });
    expect(result).toBeNull();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("emits a trace per attempt with elapsed timing and result shape", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([ADDRESS]);
    const traces: unknown[] = [];
    await getWalletAddress({ request }, { retries: 3, delayMs: 0, onTrace: (t) => traces.push(t) });
    expect(traces).toHaveLength(3);
    expect(traces[0]).toMatchObject({
      attempt: 0,
      resultKind: "array-empty",
      elapsedMs: expect.any(Number),
    });
    expect(traces[2]).toMatchObject({ attempt: 2, resultKind: "array-with", resultLen: 1 });
  });

  it("captures selectedAddress + enableExists from the provider", async () => {
    const request = vi.fn().mockResolvedValue([]);
    const traces: unknown[] = [];
    await getWalletAddress(
      { request, selectedAddress: "0xabc", enable: () => Promise.resolve([]) },
      { retries: 1, delayMs: 0, onTrace: (t) => traces.push(t) },
    );
    expect(traces[0]).toMatchObject({
      selectedAddress: "0xabc",
      enableExists: true,
    });
  });

  it("records thrown errors with their message", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Boom"));
    const traces: unknown[] = [];
    const result = await getWalletAddress(
      { request },
      { retries: 0, delayMs: 0, onTrace: (t) => traces.push(t) },
    );
    expect(result).toBeNull();
    expect(traces[0]).toMatchObject({ resultKind: "throw", errMessage: "Boom" });
  });
});
