import { describe, expect, it, vi } from "vitest";
import { getUsdtBalance } from "./balance";

const USDT_ADDRESS = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const SOME_ADDRESS = "0x0000000000000000000000000000000000abcdef";

describe("getUsdtBalance (via injected provider, raw eth_call)", () => {
  it("returns null when there is no wallet address", async () => {
    const request = vi.fn();
    await expect(getUsdtBalance(null, { request } as never)).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("encodes balanceOf(addr) and decodes uint256 from eth_call result", async () => {
    // balanceOf(address) selector = 0x70a08231
    const request = vi
      .fn()
      .mockResolvedValue("0x000000000000000000000000000000000000000000000000000000000016e360");
    const balance = await getUsdtBalance(SOME_ADDRESS, { request } as never);
    expect(balance).toBe(1.5);
    const [callObj] = request.mock.calls[0]?.[0]?.params ?? [];
    expect(callObj.to.toLowerCase()).toBe(USDT_ADDRESS.toLowerCase());
    expect(callObj.data.startsWith("0x70a08231")).toBe(true);
  });

  it("converts a 0 raw reading to 0 USD (not null)", async () => {
    const request = vi
      .fn()
      .mockResolvedValue("0x0000000000000000000000000000000000000000000000000000000000000000");
    const balance = await getUsdtBalance(SOME_ADDRESS, { request } as never);
    expect(balance).toBe(0);
  });

  it("propagates provider errors (no silent $0.00)", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Internal error"));
    await expect(getUsdtBalance(SOME_ADDRESS, { request } as never)).rejects.toThrow(
      "Internal error",
    );
  });

  it("passes 'latest' as the block tag", async () => {
    const request = vi
      .fn()
      .mockResolvedValue("0x0000000000000000000000000000000000000000000000000000000000000000");
    await getUsdtBalance(SOME_ADDRESS, { request } as never);
    const [, blockTag] = request.mock.calls[0]?.[0]?.params ?? [];
    expect(blockTag).toBe("latest");
  });
});
