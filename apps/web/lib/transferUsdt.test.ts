import { describe, expect, it, vi } from "vitest";
import { encodeUsdtTransfer, submitUsdtTransfer } from "./transferUsdt";

const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as const;
const USDT_ADAPTER = "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72" as const;
const TREASURY = "0x1111111111111111111111111111111111111111" as const;
const FROM = "0x2222222222222222222222222222222222222222" as const;

describe("encodeUsdtTransfer", () => {
  it("encodes transfer(address,uint256) with the right selector + padded args", () => {
    const data = encodeUsdtTransfer({ to: TREASURY, amountRaw: 100_000n });
    const hex = data.slice(2);
    expect(hex.slice(0, 8)).toBe("a9059cbb");
    expect(hex.slice(8, 72)).toBe("0".repeat(24) + TREASURY.slice(2).toLowerCase());
    expect(BigInt("0x" + hex.slice(72))).toBe(100_000n);
  });

  it("converts USD amount (number) to 6-decimal raw units", () => {
    const data = encodeUsdtTransfer({ to: TREASURY, amountUSD: 0.1 });
    const hex = data.slice(2);
    expect(BigInt("0x" + hex.slice(-64))).toBe(100_000n);
  });
});

describe("submitUsdtTransfer (MiniPay + feeCurrency only, no type/gas)", () => {
  function mockProvider(
    requestImpl: (args: { method: string; params?: unknown[] }) => Promise<unknown>,
  ) {
    return { request: requestImpl };
  }

  it("sends eth_sendTransaction with from, to, data, feeCurrency — nothing else", async () => {
    const txHash = "0x" + "ab".repeat(32);
    const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
      if (method === "eth_sendTransaction") return Promise.resolve(txHash);
      throw new Error("unreachable: " + method);
    });
    const result = await submitUsdtTransfer({
      ethereum: mockProvider(request) as never,
      from: FROM,
      to: TREASURY,
      amountUSD: 0.1,
    });
    expect(result).toBe(txHash);

    const txCall = request.mock.calls[0]?.[0];
    expect(txCall.method).toBe("eth_sendTransaction");
    const params = txCall.params[0];

    // Must include feeCurrency with the adapter address.
    expect(params.feeCurrency.toLowerCase()).toBe(USDT_ADAPTER.toLowerCase());
    expect(params.from).toBe(FROM);
    expect(params.to.toLowerCase()).toBe(USDT.toLowerCase());
    expect(params.data.startsWith("0xa9059cbb")).toBe(true);

    // Critical: do NOT set any of these — the provider infers them.
    expect(params.type).toBeUndefined();
    expect(params.gasPrice).toBeUndefined();
    expect(params.gas).toBeUndefined();
    expect(params.maxFeePerGas).toBeUndefined();
    expect(params.maxPriorityFeePerGas).toBeUndefined();
  });

  it("uses explicit raw amount when supplied (skipping USD conversion)", async () => {
    const request = vi.fn().mockResolvedValue("0x" + "00".repeat(32));
    await submitUsdtTransfer({
      ethereum: mockProvider(request) as never,
      from: FROM,
      to: TREASURY,
      amountRaw: 250_000n,
    });
    const data = request.mock.calls[0][0].params[0].data;
    expect(BigInt("0x" + data.slice(2).slice(-64))).toBe(250_000n);
  });

  it("propagates provider rejection with a tagged error", async () => {
    const request = vi.fn().mockRejectedValue(new Error("User rejected"));
    await expect(
      submitUsdtTransfer({
        ethereum: mockProvider(request) as never,
        from: FROM,
        to: TREASURY,
        amountUSD: 0.1,
      }),
    ).rejects.toThrow(/submitUsdtTransfer reverted/);
  });
});
