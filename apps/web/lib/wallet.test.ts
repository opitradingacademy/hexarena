import { describe, expect, it, vi } from "vitest";
import { getWalletAddress } from "./wallet";

const ADDRESS = "0x000000000000000000000000000000000000dEaD";

describe("getWalletAddress", () => {
  it("returns null when there is no injected provider", async () => {
    await expect(getWalletAddress(undefined)).resolves.toBeNull();
  });

  it("returns the address from provider.selectedAddress without an RPC call", async () => {
    const request = vi.fn();
    const result = await getWalletAddress({ request, selectedAddress: ADDRESS });
    expect(result).toBe(ADDRESS);
    expect(request).not.toHaveBeenCalled();
  });

  it("uses eth_accounts as the first RPC step when selectedAddress is empty", async () => {
    const request = vi.fn().mockResolvedValue([ADDRESS]);
    const result = await getWalletAddress({ request, selectedAddress: "" });
    expect(result).toBe(ADDRESS);
    expect(request).toHaveBeenCalledWith({ method: "eth_accounts" });
    // eth_requestAccounts not reached
    expect(request).not.toHaveBeenCalledWith({ method: "eth_requestAccounts" });
  });

  it("falls back to eth_requestAccounts when eth_accounts is empty", async () => {
    const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
      if (method === "eth_accounts") return Promise.resolve([]);
      if (method === "eth_requestAccounts") return Promise.resolve([ADDRESS]);
      throw new Error("unreachable");
    });
    const result = await getWalletAddress({ request, selectedAddress: "" });
    expect(result).toBe(ADDRESS);
    expect(request).toHaveBeenCalledWith({ method: "eth_accounts" });
    expect(request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
  });

  it("returns null when every fallback is exhausted", async () => {
    const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
      if (method === "eth_accounts") return Promise.resolve([]);
      if (method === "eth_requestAccounts") return Promise.resolve([]);
      throw new Error("unreachable");
    });
    const result = await getWalletAddress({ request, selectedAddress: "" });
    expect(result).toBeNull();
  });

  it("returns null when the provider rejects the connection", async () => {
    const request = vi.fn().mockRejectedValue(new Error("User rejected"));
    await expect(getWalletAddress({ request })).resolves.toBeNull();
  });

  it("works with a MiniPay-shaped provider (isMiniPay flag present)", async () => {
    const request = vi.fn().mockResolvedValue([ADDRESS]);
    await expect(getWalletAddress({ request, isMiniPay: true } as never)).resolves.toBe(ADDRESS);
  });

  describe("hierarchical fallback when eth_requestAccounts throws (MiniPay stub bug)", () => {
    it("uses selectedAddress when present and eth_requestAccounts throws", async () => {
      const request = vi.fn().mockRejectedValue(new Error("this._request is not a function"));
      const result = await getWalletAddress(
        { request, selectedAddress: ADDRESS },
        { retries: 0, delayMs: 0 },
      );
      expect(result).toBe(ADDRESS);
      expect(request).not.toHaveBeenCalled();
    });

    it("falls back to selectedAddress even when retries=0 (zero RPC)", async () => {
      const result = await getWalletAddress(
        { request: vi.fn(), selectedAddress: ADDRESS },
        { retries: 0, delayMs: 0 },
      );
      expect(result).toBe(ADDRESS);
    });

    it("ignores selectedAddress when it is not a valid address", async () => {
      const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_accounts") return Promise.resolve([]);
        if (method === "eth_requestAccounts") return Promise.resolve([ADDRESS]);
        throw new Error("unreachable");
      });
      const result = await getWalletAddress(
        { request, selectedAddress: "not-an-address" },
        { retries: 0, delayMs: 0 },
      );
      expect(result).toBe(ADDRESS);
      expect(request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    });

    it("survives eth_accounts throwing — keeps trying eth_requestAccounts", async () => {
      const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_accounts") throw new Error("eth_accounts unsupported");
        if (method === "eth_requestAccounts") return Promise.resolve([ADDRESS]);
        throw new Error("unreachable");
      });
      const result = await getWalletAddress(
        { request, selectedAddress: "" },
        { retries: 0, delayMs: 0 },
      );
      expect(result).toBe(ADDRESS);
    });

    it("retries eth_requestAccounts when first call returns []", async () => {
      let n = 0;
      const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_accounts") return Promise.resolve([]);
        if (method === "eth_requestAccounts") {
          n += 1;
          return n >= 3 ? Promise.resolve([ADDRESS]) : Promise.resolve([]);
        }
        throw new Error("unreachable");
      });
      const result = await getWalletAddress(
        { request, selectedAddress: "" },
        { retries: 3, delayMs: 0 },
      );
      expect(result).toBe(ADDRESS);
    });

    it("returns null after retry exhaustion", async () => {
      const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_accounts") return Promise.resolve([]);
        if (method === "eth_requestAccounts") return Promise.resolve([]);
        throw new Error("unreachable");
      });
      const result = await getWalletAddress(
        { request, selectedAddress: "" },
        { retries: 2, delayMs: 0 },
      );
      expect(result).toBeNull();
    });
  });

  describe("onTrace breadcrumbs", () => {
    it("records each step the resolver attempts", async () => {
      const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_accounts") return Promise.resolve([]);
        if (method === "eth_requestAccounts") return Promise.resolve([ADDRESS]);
        throw new Error("unreachable");
      });
      const traces: Array<{ step: string; resultKind: string; elapsedMs: number }> = [];
      await getWalletAddress(
        { request },
        {
          onTrace: (t) =>
            traces.push({ step: t.step, resultKind: t.resultKind, elapsedMs: t.elapsedMs }),
        },
      );
      expect(traces.map((t) => t.step)).toEqual(["eth_accounts", "eth_requestAccounts"]);
    });

    it("records the selectedAddress step when it wins", async () => {
      const request = vi.fn();
      const traces: Array<{ step: string }> = [];
      await getWalletAddress(
        { request, selectedAddress: ADDRESS },
        { onTrace: (t) => traces.push({ step: t.step }) },
      );
      expect(traces).toEqual([{ step: "selectedAddress" }]);
    });

    it("records errors with their messages", async () => {
      const request = vi.fn().mockRejectedValue(new Error("Boom"));
      const traces: Array<{ step: string; resultKind: string; errMessage?: string }> = [];
      await getWalletAddress(
        { request },
        {
          onTrace: (t) =>
            traces.push({ step: t.step, resultKind: t.resultKind, errMessage: t.errMessage }),
        },
      );
      expect(traces.some((t) => t.errMessage === "Boom")).toBe(true);
    });
  });
});
