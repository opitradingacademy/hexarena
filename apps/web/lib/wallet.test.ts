import { describe, expect, it, vi } from "vitest";
import { getWalletAddress } from "./wallet";

describe("getWalletAddress", () => {
  it("returns null when there is no injected provider", async () => {
    await expect(getWalletAddress(undefined)).resolves.toBeNull();
  });

  it("returns the first account via viem's getAddresses (eth_accounts, not eth_requestAccounts)", async () => {
    // MiniPay auto-connects Mini Apps — no permission prompt. viem's
    // getAddresses() resolves to eth_accounts, matching that auto-connect
    // model instead of the manual eth_requestAccounts prompt flow.
    const address = "0x000000000000000000000000000000000000dEaD";
    const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
      if (method === "eth_accounts") return Promise.resolve([address]);
      return Promise.resolve([]);
    });
    await expect(getWalletAddress({ request })).resolves.toBe(address);
    expect(request.mock.calls[0][0]).toEqual(expect.objectContaining({ method: "eth_accounts" }));
  });

  it("returns null when the provider returns no accounts", async () => {
    const request = vi.fn().mockResolvedValue([]);
    await expect(getWalletAddress({ request })).resolves.toBeNull();
  });

  it("returns null when the provider rejects (no access / not connected)", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Provider error"));
    await expect(getWalletAddress({ request })).resolves.toBeNull();
  });
});
