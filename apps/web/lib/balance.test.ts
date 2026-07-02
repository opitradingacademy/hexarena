import { describe, expect, it, vi } from "vitest";
import { getUsdtBalance } from "./balance";

const USDT_ADDRESS = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";

describe("getUsdtBalance", () => {
  it("returns null when there is no wallet address", async () => {
    const readContract = vi.fn();
    await expect(
      getUsdtBalance(null, { readContract } as never),
    ).resolves.toBeNull();
    expect(readContract).not.toHaveBeenCalled();
  });

  it("reads balanceOf and converts from 6-decimal USDT units to USD", async () => {
    const readContract = vi.fn().mockResolvedValue(1_500_000n);
    const balance = await getUsdtBalance("0xabc", { readContract } as never);
    expect(balance).toBe(1.5);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: USDT_ADDRESS,
        functionName: "balanceOf",
        args: ["0xabc"],
      }),
    );
  });
});
