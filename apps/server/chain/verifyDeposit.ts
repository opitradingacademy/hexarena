/**
 * Server-side confirmation of an Arena stake deposit.
 *
 * For MVP (Approach B in arena-deposit decision), users send a USDT
 * `transfer(operator, amount)` directly to the operator's treasury
 * wallet from their MiniPay, then POST the `txHash` to /api/deposit.
 * This module:
 *   - pulls the tx receipt via the injected viem provider,
 *   - confirms it is a successful USDT (or whatever token) transfer
 *     whose `to` matches the configured treasury,
 *   - parses the Transfer event for the amount,
 *   - checks against `seenTxHashes` for idempotency,
 *   - enforces a minimum amount when supplied.
 *
 * Errors are explicit types so the REST handler can map them to the
 * right HTTP status without leaking RPC details to the client.
 */

export type MinimalReceipt = {
  status: string;
  to: string | null;
  from: string;
  logs: ReadonlyArray<{
    address: string;
    topics: readonly string[];
    data: string;
  }>;
};

export type VerifyDepositProvider = {
  getTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<MinimalReceipt | null>;
};

export type VerifyDepositArgs = {
  txHash: `0x${string}`;
  /** 0x-prefixed lower/upper-case treasury address (case-insensitive). */
  treasury: `0x${string}`;
  /** Pre-populated set of tx hashes already credited (for idempotency). */
  seenTxHashes: ReadonlySet<string>;
  provider: VerifyDepositProvider;
  /** Required minimum amount, in raw token units (e.g. 100_000n = 0.1 USDT). */
  minAmountRaw?: bigint;
};

// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export class InvalidTransactionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "InvalidTransactionError";
  }
}
export class WrongRecipientError extends InvalidTransactionError {
  constructor() {
    super("transaction recipient is not the treasury");
    this.name = "WrongRecipientError";
  }
}
export class InsufficientAmountError extends InvalidTransactionError {
  constructor(
    public readonly amount: bigint,
    public readonly minimum: bigint,
  ) {
    super(`amount ${amount} is below minimum ${minimum}`);
    this.name = "InsufficientAmountError";
  }
}
export class DuplicateTransactionError extends InvalidTransactionError {
  constructor(txHash: string) {
    super(`txHash ${txHash} already credited`);
    this.name = "DuplicateTransactionError";
  }
}

function eqAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function pad32(addr: string): string {
  const stripped = addr.toLowerCase().replace(/^0x/, "");
  return "0x" + stripped.padStart(64, "0");
}

export async function verifyDeposit(args: VerifyDepositArgs): Promise<{
  ok: true;
  amount: bigint;
  from: `0x${string}`;
}> {
  // Idempotency (`seenTxHashes`) is the caller's responsibility. The
  // HTTP handler uses store.findDeposit(txHash) before calling us so a
  // re-POST returns 409 without fetching the receipt.
  const receipt = await args.provider.getTransactionReceipt({ hash: args.txHash });
  if (!receipt || receipt.status !== "success") {
    throw new InvalidTransactionError("receipt not found or not successful");
  }
  if (!receipt.to || !eqAddr(receipt.to, args.treasury)) {
    throw new WrongRecipientError();
  }

  const paddedTreasury = pad32(args.treasury);
  const matchingLog = receipt.logs.find(
    (log) => log.topics[0] === TRANSFER_TOPIC && log.topics[2] === paddedTreasury,
  );
  if (!matchingLog) {
    throw new InvalidTransactionError("no matching Transfer event to treasury");
  }
  const amount = BigInt(matchingLog.data);
  if (args.minAmountRaw !== undefined && amount < args.minAmountRaw) {
    throw new InsufficientAmountError(amount, args.minAmountRaw);
  }
  return { ok: true, amount, from: receipt.from as `0x${string}` };
}
