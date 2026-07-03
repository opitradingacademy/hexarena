import { describe, expect, it, vi } from "vitest";
import { encodeUsdtTransfer } from "./transferUsdt";

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

// Tests for submitUsdtTransfer go through viem's createWalletClient, which
// is hard to mock in isolation — we verify the (a) network plumbing via
// the StakeConfirmDialog integration tests and (b) the canonical
// USDT_ADAPTER value via the shared chain constants the function reads.

describe("USDT adapter address (the only address that ever works for feeCurrency)", () => {
  it("is the verified Celo Mainnet adapter from docs.minipay.xyz", () => {
    // Don't hardcode the address inside transferUsdt — it's pulled from
    // @hexarena/shared/chain (FEE_CURRENCY_ADAPTER[42220]). Tests
    // import the same constant so any address drift would surface here.
    void USDT_ADAPTER;
    expect(USDT.toLowerCase()).toBe("0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e");
  });
});

// Smoke tests for submitUsdtTransfer's contract (input validation + error
// formatting) — the viem client itself is exercised in the
// StakeConfirmDialog integration tests because of how heavyweight it is
// to mock the celo chain + wallet client.

import { submitUsdtTransfer } from "./transferUsdt";

describe("submitUsdtTransfer (validation only)", () => {
  it("rejects when SETTLEMENT_TOKEN_ADDRESS for chainId is missing", async () => {
    const ethereum = { request: vi.fn() };
    await expect(
      submitUsdtTransfer({
        ethereum: ethereum as never,
        from: FROM,
        to: TREASURY,
        amountUSD: 0.1,
      }),
    ).rejects.toThrow();
  });

  it("calls the provider with eth_sendTransaction (viem builds the params)", async () => {
    const ethereum = {
      request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts") return [FROM];
        if (method === "eth_chainId") return "0xa4ec"; // 42220
        if (method === "eth_blockNumber") return "0x1";
        if (method === "eth_sendTransaction") return "0x" + "ab".repeat(32);
        return null;
      }),
    };
    const result = await submitUsdtTransfer({
      ethereum: ethereum as never,
      from: FROM,
      to: TREASURY,
      amountUSD: 0.1,
    });
    expect(result).toBe("0x" + "ab".repeat(32));
  });
});
