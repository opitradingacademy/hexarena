import { describe, expect, it, vi } from "vitest";
import { encodeUsdtTransfer, submitUsdtTransfer } from "./transferUsdt";

const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as const;
const TREASURY = "0x1111111111111111111111111111111111111111" as const;
const FROM = "0x2222222222222222222222222222222222222222" as const;

describe("encodeUsdtTransfer", () => {
  it("encodes transfer(address,uint256) with the right selector + padded args", () => {
    const data = encodeUsdtTransfer({ to: TREASURY, amountRaw: 100_000n });
    const hex = data.slice(2); // drop 0x
    // selector = 8 hex chars
    expect(hex.slice(0, 8)).toBe("a9059cbb");
    // next 64 hex chars = treasury address, left-padded
    expect(hex.slice(8, 72)).toBe("0".repeat(24) + TREASURY.slice(2).toLowerCase());
    // last 64 hex chars = amount (big-endian)
    expect(BigInt("0x" + hex.slice(72))).toBe(100_000n);
  });

  it("converts USD amount (number) to 6-decimal raw units", () => {
    const data = encodeUsdtTransfer({ to: TREASURY, amountUSD: 0.1 });
    const hex = data.slice(2);
    expect(BigInt("0x" + hex.slice(-64))).toBe(100_000n);
  });
});

describe("submitUsdtTransfer", () => {
  it("sends an eth_sendTransaction via the injected provider with feeCurrency", async () => {
    const txHash = "0x" + "ab".repeat(32);
    const request = vi.fn().mockResolvedValue(txHash);
    const ethereum = { request };
    const result = await submitUsdtTransfer({
      ethereum,
      from: FROM,
      to: TREASURY,
      amountUSD: 0.1,
    });
    expect(result).toBe(txHash);
    const call = request.mock.calls[0]?.[0];
    expect(call.method).toBe("eth_sendTransaction");
    expect(call.params[0].from).toBe(FROM);
    expect(call.params[0].to.toLowerCase()).toBe(USDT.toLowerCase());
    expect(call.params[0].data.startsWith("0xa9059cbb")).toBe(true);
    // Critical: feeCurrency must be the USDT adapter, NOT the token address
    // (CIP-64). Otherwise eth_estimateGas in the MiniPay provider-stub
    // reverts silently with "execution reverted".
    expect(call.params[0].feeCurrency.toLowerCase()).toBe(
      "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72",
    );
  });

  it("does NOT include maxFeePerGas / maxPriorityFeePerGas (MiniPay is legacy only)", async () => {
    const request = vi.fn().mockResolvedValue("0x" + "ab".repeat(32));
    await submitUsdtTransfer({
      ethereum: { request },
      from: FROM,
      to: TREASURY,
      amountUSD: 0.1,
    });
    const txParams = request.mock.calls[0][0].params[0];
    expect(txParams.maxFeePerGas).toBeUndefined();
    expect(txParams.maxPriorityFeePerGas).toBeUndefined();
    expect(txParams.gas).toBeUndefined(); // let provider estimate
  });

  it("uses explicit raw amount when supplied (skipping USD conversion)", async () => {
    const request = vi.fn().mockResolvedValue("0x" + "00".repeat(32));
    await submitUsdtTransfer({
      ethereum: { request },
      from: FROM,
      to: TREASURY,
      amountRaw: 250_000n,
    });
    const data = request.mock.calls[0][0].params[0].data;
    expect(BigInt("0x" + data.slice(2).slice(-64))).toBe(250_000n);
  });

  it("propagates provider rejection with the original error", async () => {
    const request = vi.fn().mockRejectedValue(new Error("User rejected"));
    await expect(
      submitUsdtTransfer({
        ethereum: { request },
        from: FROM,
        to: TREASURY,
        amountUSD: 0.1,
      }),
    ).rejects.toThrow("User rejected");
  });
});
