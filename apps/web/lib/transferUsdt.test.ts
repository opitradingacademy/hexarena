import { describe, expect, it, vi } from "vitest";
import { encodeUsdtTransfer, submitUsdtTransfer } from "./transferUsdt";

const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as const;
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

describe("submitUsdtTransfer (MiniPay legacy tx, type 0)", () => {
  function providerWithGasPrice(
    requestImpl: (args: { method: string; params?: unknown[] }) => Promise<unknown>,
  ) {
    return { request: requestImpl };
  }

  it("sends a legacy eth_sendTransaction (type: 0) with explicit gasPrice", async () => {
    const txHash = "0x" + "ab".repeat(32);
    const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
      if (method === "eth_gasPrice") return Promise.resolve("0x4a817c800"); // 20 gwei
      if (method === "eth_sendTransaction") return Promise.resolve(txHash);
      throw new Error("unreachable: " + method);
    });
    const result = await submitUsdtTransfer({
      ethereum: providerWithGasPrice(request) as never,
      from: FROM,
      to: TREASURY,
      amountUSD: 0.1,
    });
    expect(result).toBe(txHash);

    // Find the eth_sendTransaction call (after eth_gasPrice)
    const txCall = request.mock.calls.find((c) => c[0].method === "eth_sendTransaction")?.[0];
    expect(txCall).toBeDefined();
    const params = txCall!.params[0];

    // Critical for MiniPay: type 0 (legacy) is what MiniPay accepts.
    // docs.minipay.xyz + the working reference app confirm:
    //   "Every contract write uses type: 0 with explicit gasPrice."
    // The Celo doc's 'type: 0x7b' CIP-64 advice applies to non-MiniPay
    // clients; MiniPay's WebView provider-stub rejects 0x7b txs
    // with bare 'execution reverted'.
    expect(params.type).toBe(0);
    expect(params.gasPrice).toBe("0x4a817c800");
    expect(params.from).toBe(FROM);
    expect(params.to.toLowerCase()).toBe(USDT.toLowerCase());
    expect(params.data.startsWith("0xa9059cbb")).toBe(true);

    // Critical: NO feeCurrency (MiniPay legacy pays gas in CELO).
    expect(params.feeCurrency).toBeUndefined();
  });

  it("uses explicit raw amount when supplied (skipping USD conversion)", async () => {
    const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
      if (method === "eth_gasPrice") return Promise.resolve("0x4a817c800");
      if (method === "eth_sendTransaction") return Promise.resolve("0x" + "00".repeat(32));
      throw new Error("unreachable");
    });
    await submitUsdtTransfer({
      ethereum: providerWithGasPrice(request) as never,
      from: FROM,
      to: TREASURY,
      amountRaw: 250_000n,
    });
    const txCall = request.mock.calls.find((c) => c[0].method === "eth_sendTransaction")?.[0];
    const data = txCall!.params[0].data;
    expect(BigInt("0x" + data.slice(2).slice(-64))).toBe(250_000n);
  });

  it("propagates provider rejection with a tagged error", async () => {
    const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
      if (method === "eth_gasPrice") return Promise.resolve("0x4a817c800");
      if (method === "eth_sendTransaction") return Promise.reject(new Error("User rejected"));
      throw new Error("unreachable");
    });
    await expect(
      submitUsdtTransfer({
        ethereum: providerWithGasPrice(request) as never,
        from: FROM,
        to: TREASURY,
        amountUSD: 0.1,
      }),
    ).rejects.toThrow(/submitUsdtTransfer reverted/);
  });
});
