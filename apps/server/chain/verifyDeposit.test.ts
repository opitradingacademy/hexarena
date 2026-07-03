import { describe, expect, it, vi } from "vitest";
import {
  verifyDeposit,
  type VerifyDepositProvider,
  InvalidTransactionError,
  InsufficientAmountError,
  WrongRecipientError,
} from "./verifyDeposit";

const HEX = "0x" + "ab".repeat(32);

const TREASURY = "0x1111111111111111111111111111111111111111" as const;
const SENDER = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as const;
const TX_HASH = ("0x" + "ab".repeat(32)) as `0x${string}`;

// Real ERC-20 `transfer()` receipts always have `to` set to the TOKEN
// CONTRACT address (the thing you called), never the transfer's
// recipient — that only shows up inside the Transfer event log. A
// production deposit against the real USDT contract surfaced this: the
// old fixture defaulted `to` to TREASURY, which no real receipt ever has.
function makeReceipt(opts: {
  to?: string;
  from?: string;
  logs?: Array<{
    address: string;
    topics: string[];
    data: string;
  }>;
}) {
  return {
    blockHash: "0x" + "00".repeat(32),
    blockNumber: 1n,
    contractAddress: null,
    cumulativeGasUsed: 0n,
    effectiveGasPrice: 0n,
    from: opts.from ?? SENDER,
    gasUsed: 0n,
    logs: opts.logs ?? [],
    logsBloom: "0x",
    status: "success",
    to: opts.to ?? TOKEN,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    type: "legacy",
  };
}

function encodeTransfer(to: string, amount: bigint, tokenAddress: string = TOKEN) {
  const data = "0x" + amount.toString(16).padStart(64, "0");
  return {
    address: tokenAddress,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x000000000000000000000000" + SENDER.slice(2).toLowerCase(),
      "0x000000000000000000000000" + to.slice(2).toLowerCase(),
    ],
    data,
  };
}

function makeProvider(receipt: ReturnType<typeof makeReceipt> | null): VerifyDepositProvider {
  return {
    getTransactionReceipt: vi.fn().mockResolvedValue(receipt),
  };
}

describe("verifyDeposit", () => {
  it("returns the parsed USDT amount on a successful transfer", async () => {
    const amount = 100_000n;
    const provider = makeProvider(makeReceipt({ logs: [encodeTransfer(TREASURY, amount)] }));
    const result = await verifyDeposit({
      txHash: TX_HASH,
      treasury: TREASURY,
      tokenAddress: TOKEN,
      seenTxHashes: new Set<string>(),
      provider,
    });
    expect(result).toEqual({ ok: true, amount, from: SENDER });
  });

  it("rejects a tx that wasn't a call to the settlement token contract", async () => {
    const provider = makeProvider(
      makeReceipt({ to: "0xdead", logs: [encodeTransfer(TREASURY, 100_000n)] }),
    );
    await expect(
      verifyDeposit({
        txHash: TX_HASH,
        treasury: TREASURY,
        tokenAddress: TOKEN,
        seenTxHashes: new Set<string>(),
        provider,
      }),
    ).rejects.toBeInstanceOf(InvalidTransactionError);
  });

  it("rejects a tx whose receipt status is not 'success'", async () => {
    const provider = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        ...makeReceipt({ logs: [encodeTransfer(TREASURY, 100_000n)] }),
        status: "reverted",
      }),
    };
    await expect(
      verifyDeposit({
        txHash: TX_HASH,
        treasury: TREASURY,
        tokenAddress: TOKEN,
        seenTxHashes: new Set<string>(),
        provider,
      }),
    ).rejects.toBeInstanceOf(InvalidTransactionError);
  });

  it("rejects a tx with no matching Transfer event to the treasury", async () => {
    const provider = makeProvider(
      makeReceipt({
        logs: [encodeTransfer("0xdead", 100_000n)],
      }),
    );
    await expect(
      verifyDeposit({
        txHash: TX_HASH,
        treasury: TREASURY,
        tokenAddress: TOKEN,
        seenTxHashes: new Set<string>(),
        provider,
      }),
    ).rejects.toBeInstanceOf(WrongRecipientError);
  });

  it("rejects a spoofed Transfer event emitted by a contract other than the real token", async () => {
    // The token-agnostic version of this check only looked at topics, so
    // any contract could emit a fake Transfer(sender, treasury, amount)
    // log and pass verification. The real token address must match too.
    const provider = makeProvider(
      makeReceipt({
        logs: [encodeTransfer(TREASURY, 100_000n, "0xfakefakefakefakefakefakefakefakefakefake")],
      }),
    );
    await expect(
      verifyDeposit({
        txHash: TX_HASH,
        treasury: TREASURY,
        tokenAddress: TOKEN,
        seenTxHashes: new Set<string>(),
        provider,
      }),
    ).rejects.toBeInstanceOf(WrongRecipientError);
  });

  it("rejects an amount below the requested minimum", async () => {
    const provider = makeProvider(makeReceipt({ logs: [encodeTransfer(TREASURY, 1n)] }));
    await expect(
      verifyDeposit({
        txHash: TX_HASH,
        treasury: TREASURY,
        tokenAddress: TOKEN,
        seenTxHashes: new Set<string>(),
        provider,
        minAmountRaw: 100_000n,
      }),
    ).rejects.toBeInstanceOf(InsufficientAmountError);
  });

  it("fails when the RPC returns null (tx not mined or unknown)", async () => {
    const provider = makeProvider(null);
    await expect(
      verifyDeposit({
        txHash: TX_HASH as `0x${string}`,
        treasury: TREASURY as `0x${string}`,
        tokenAddress: TOKEN,
        seenTxHashes: new Set<string>(),
        provider,
        pollIntervalMs: 0,
        maxAttempts: 1,
      }),
    ).rejects.toBeInstanceOf(InvalidTransactionError);
  });

  describe("waitForReceipt polling", () => {
    it("retries getTransactionReceipt until the tx is mined", async () => {
      const receipt = makeReceipt({ logs: [encodeTransfer(TREASURY, 100_000n)] });
      const request = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(receipt);
      const result = await verifyDeposit({
        txHash: TX_HASH,
        treasury: TREASURY,
        tokenAddress: TOKEN,
        seenTxHashes: new Set<string>(),
        provider: { getTransactionReceipt: request },
        pollIntervalMs: 0,
        maxAttempts: 3,
      });
      expect(result.amount).toBe(100_000n);
      expect(request).toHaveBeenCalledTimes(3);
    });

    it("throws after maxAttempts when the receipt never appears", async () => {
      const request = vi.fn().mockResolvedValue(null);
      await expect(
        verifyDeposit({
          txHash: TX_HASH,
          treasury: TREASURY,
          tokenAddress: TOKEN,
          seenTxHashes: new Set<string>(),
          provider: { getTransactionReceipt: request },
          pollIntervalMs: 0,
          maxAttempts: 2,
        }),
      ).rejects.toBeInstanceOf(InvalidTransactionError);
      expect(request).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });
  });
});
