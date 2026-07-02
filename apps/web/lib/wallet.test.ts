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
});
