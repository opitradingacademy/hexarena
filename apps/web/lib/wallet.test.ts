import { describe, expect, it, vi } from "vitest";
import { getWalletAddress } from "./wallet";

const ADDRESS = "0x000000000000000000000000000000000000dEaD";

describe("getWalletAddress", () => {
  it("returns null when there is no injected provider", async () => {
    await expect(getWalletAddress(undefined)).resolves.toBeNull();
  });

  it("returns the account from the silent eth_accounts path when already authorized", async () => {
    const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
      if (method === "eth_accounts") return Promise.resolve([ADDRESS]);
      return Promise.resolve([]);
    });
    await expect(getWalletAddress({ request })).resolves.toBe(ADDRESS);
    expect(request.mock.calls[0][0]).toEqual(expect.objectContaining({ method: "eth_accounts" }));
    expect(request.mock.calls.some((c) => c[0]?.method === "eth_requestAccounts")).toBe(false);
  });

  it("falls back to eth_requestAccounts when eth_accounts returns nothing", async () => {
    const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
      if (method === "eth_accounts") return Promise.resolve([]);
      if (method === "eth_requestAccounts") return Promise.resolve([ADDRESS]);
      return Promise.resolve([]);
    });
    await expect(getWalletAddress({ request })).resolves.toBe(ADDRESS);
    expect(request.mock.calls.some((c) => c[0]?.method === "eth_requestAccounts")).toBe(true);
  });

  it("falls back to the legacy enable() when both .request() paths return nothing (MiniPay Developer Mode test-page load)", async () => {
    // Confirmed by device testing: MiniPay's injected provider inside its
    // "Load Test Page" preview answers enable() while silently returning no
    // accounts for both eth_accounts and eth_requestAccounts via .request().
    const request = vi.fn().mockResolvedValue([]);
    const enable = vi.fn().mockResolvedValue([ADDRESS]);
    await expect(getWalletAddress({ request, enable })).resolves.toBe(ADDRESS);
    expect(enable).toHaveBeenCalled();
  });

  it("returns null when every path returns no accounts", async () => {
    const request = vi.fn().mockResolvedValue([]);
    const enable = vi.fn().mockResolvedValue([]);
    await expect(getWalletAddress({ request, enable })).resolves.toBeNull();
  });

  it("returns null when every path rejects", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Provider error"));
    const enable = vi.fn().mockRejectedValue(new Error("Provider error"));
    await expect(getWalletAddress({ request, enable })).resolves.toBeNull();
  });

  it("returns null when request() fails and there is no enable() to fall back to", async () => {
    const request = vi.fn().mockResolvedValue([]);
    await expect(getWalletAddress({ request })).resolves.toBeNull();
  });
});
