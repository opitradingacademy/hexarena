import { describe, expect, it, vi } from "vitest";
import {
  verifyDeposit,
  type VerifyDepositProvider,
  InvalidTransactionError,
  InsufficientAmountError,
  WrongRecipientError,
} from "./verifyDeposit";

const TREASURY = "0x1111111111111111111111111111111111111111" as const;
const SENDER = "0x2222222222222222222222222222222222222222" as const;
const TX_HASH = ("0x" + "ab".repeat(32)) as `0x${string}`;

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
    to: opts.to ?? TREASURY,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    type: "legacy",
  };
}

function encodeTransfer(to: string, amount: bigint) {
  const data = "0x" + amount.toString(16).padStart(64, "0");
  return {
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
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
      seenTxHashes: new Set<string>(),
      provider,
    });
    expect(result).toEqual({ ok: true, amount, from: SENDER });
  });

  it("rejects a tx that is not paid to the treasury address", async () => {
    const provider = makeProvider(
      makeReceipt({ to: "0xdead", logs: [encodeTransfer("0xdead", 100_000n)] }),
    );
    await expect(
      verifyDeposit({
        txHash: TX_HASH,
        treasury: TREASURY,
        seenTxHashes: new Set<string>(),
        provider,
      }),
    ).rejects.toBeInstanceOf(WrongRecipientError);
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
        seenTxHashes: new Set<string>(),
        provider,
      }),
    ).rejects.toBeInstanceOf(InvalidTransactionError);
  });

  it("rejects a tx with no matching Transfer event to the treasury", async () => {
    const provider = makeProvider(
      makeReceipt({
        to: TREASURY,
        logs: [encodeTransfer("0xdead", 100_000n)],
      }),
    );
    await expect(
      verifyDeposit({
        txHash: TX_HASH,
        treasury: TREASURY,
        seenTxHashes: new Set<string>(),
        provider,
      }),
    ).rejects.toBeInstanceOf(InvalidTransactionError);
  });

  it("rejects an amount below the requested minimum", async () => {
    const provider = makeProvider(makeReceipt({ logs: [encodeTransfer(TREASURY, 1n)] }));
    await expect(
      verifyDeposit({
        txHash: TX_HASH,
        treasury: TREASURY,
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
        txHash: TX_HASH,
        treasury: TREASURY,
        seenTxHashes: new Set<string>(),
        provider,
      }),
    ).rejects.toBeInstanceOf(InvalidTransactionError);
  });
});
