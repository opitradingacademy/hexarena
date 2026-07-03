/**
 * POST /api/deposit — credit server ledger with a USDT transfer the user
 * just made on-chain to the operator treasury. See arena-deposit decision
 * (Approach B).
 *
 * Body: { txHash: "0x...", receipt?: MinimalReceipt }.
 *   - txHash is always required (idempotency key).
 *   - receipt is OPTIONAL but recommended. If the client POSTs the
 *     receipt (which its MiniPay provider-stub fetched via the same
 *     nodo that just signed the tx), the server validates the
 *     receipt structurally and skips its own RPC poll — which is
 *     critical because public RPCs (forno.celo.org,
 *     celo-rpc.publicnode.com) have 2-30s propagation latency for
 *     newly broadcast tx hashes, while the user's own provider-stub
 *     sees them in milliseconds.
 *   - If receipt is missing, the server falls back to polling the
 *     configured public RPC (slower path, used as a safety net).
 *
 * GET /api/balance?wallet=<address> — return { ok, balanceUSD } so a
 *   stumped user (or a debug session) can see what the server's ledger
 *   thinks the wallet holds. Critical for diagnosing the "modal-loop"
 *   case where the chain tx mined but the server polled too soon and
 *   hasn't credited it yet — running this query after Retry in the
 *   modal confirms whether the deposit eventually landed.
 *
 * Auth: caller declares their wallet via the X-Wallet-Address header.
 *       For MVP this is declarative, not a signed challenge — the chain tx
 *       itself already proves control of `from`. Production should also
 *       verify `from === X-Wallet-Address`.
 *
 * Response 200: { ok: true, balanceUSD: number }
 * Response 400: { ok: false, code: "BAD_REQUEST", msg }
 * Response 405: { ok: false, code: "METHOD_NOT_ALLOWED" }
 * Response 409: { ok: false, code: "DUPLICATE_TX" }
 * Response 422: { ok: false, code: "INVALID_TX", msg }
 * Response 500: { ok: false, code: "RPC_ERROR", msg }
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAddress, getAddress } from "viem";
import { creditDeposit } from "./ledger/ledger";
import {
  verifyDeposit,
  isSuccessStatus,
  InvalidTransactionError,
  WrongRecipientError,
  InsufficientAmountError,
  DuplicateTransactionError,
  type VerifyDepositProvider,
  type MinimalReceipt,
} from "./chain/verifyDeposit";
import type { LedgerStore } from "./ledger/types";
import { applyCorsHeaders } from "./cors";

export type DepositEndpointConfig = {
  treasury: `0x${string}`;
  /** Settlement token contract address (e.g. USDT on Celo Mainnet). */
  tokenAddress: `0x${string}`;
  provider: VerifyDepositProvider;
  /** Default 6 (USDT). Used to convert raw on-chain units to USD. */
  settleTokenDecimals?: number;
  /** Override the default 1500ms poll interval between receipt retries. */
  pollIntervalMs?: number;
  /** Override the default 10 retry attempts. */
  maxAttempts?: number;
};

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function pad32(hex: string): string {
  const stripped = hex.toLowerCase().replace(/^0x/, "");
  return "0x" + stripped.padStart(64, "0");
}

function eqAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Validate a client-provided receipt in isolation. This is the fast path:
 * the user signed the tx via their MiniPay provider-stub and that same
 * stub can fetch the receipt in milliseconds. The server only needs to
 * check that the receipt's `to` and Transfer event match the expected
 * treasury + amount — no RPC fetch.
 */
function validateClientReceipt(
  receipt: MinimalReceipt,
  treasury: `0x${string}`,
  tokenAddress: `0x${string}`,
): { ok: true; amount: bigint; from: `0x${string}` } {
  if (!isSuccessStatus(receipt.status)) {
    throw new InvalidTransactionError("receipt status is not success");
  }
  // A `transfer()` receipt's `to` is always the token CONTRACT you
  // called (e.g. the USDT address), never the recipient — the recipient
  // only shows up inside the Transfer event log below. Comparing `to`
  // against the treasury here was a bug: it can never match a real
  // ERC-20 transfer receipt.
  if (!receipt.to || !eqAddr(receipt.to, tokenAddress)) {
    throw new InvalidTransactionError("transaction was not sent to the settlement token contract");
  }
  const paddedTreasury = pad32(treasury);
  const matchingLog = receipt.logs.find(
    (log) =>
      eqAddr(log.address, tokenAddress) &&
      log.topics[0] === TRANSFER_TOPIC &&
      log.topics[2] === paddedTreasury,
  );
  if (!matchingLog) {
    throw new WrongRecipientError();
  }
  return {
    ok: true,
    amount: BigInt(matchingLog.data),
    from: receipt.from as `0x${string}`,
  };
}

export async function handleDepositRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: LedgerStore,
  config: DepositEndpointConfig,
): Promise<boolean> {
  if (!req.url) return false;
  const url = new URL(req.url, "http://localhost");

  // GET /api/balance?wallet=<address> — read-only ledger query, useful
  // for diagnosing the modal-loop case where the chain tx mined but the
  // polling in /api/deposit timed out before the public RPC caught up.
  // The user can hit this endpoint (or the client polls it after Retry)
  // to confirm whether the deposit eventually credited.
  if (url.pathname === "/api/balance") {
    const walletParam = url.searchParams.get("wallet");
    if (!walletParam || !isAddress(walletParam)) {
      respond(res, 400, {
        ok: false,
        code: "BAD_REQUEST",
        msg: "wallet must be a valid 0x-prefixed 20-byte address",
      });
      return true;
    }
    const normalized = getAddress(walletParam);
    // upsertUser makes balanceOf safe — a zero-balance query still
    // returns 0 instead of NaN.
    store.upsertUser(normalized, normalized);
    respond(res, 200, {
      ok: true,
      balanceUSD: store.balanceOf(normalized),
    });
    return true;
  }

  if (url.pathname !== "/api/deposit") return false;

  const settleTokenDecimals = config.settleTokenDecimals ?? 6;

  if (req.method !== "POST") {
    respond(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
    return true;
  }

  const walletHeader = req.headers["x-wallet-address"];
  const wallet =
    typeof walletHeader === "string" && isAddress(walletHeader) ? getAddress(walletHeader) : null;
  if (!wallet) {
    respond(res, 400, {
      ok: false,
      code: "BAD_REQUEST",
      msg: "missing or invalid X-Wallet-Address header",
    });
    return true;
  }

  let body: {
    txHash?: string;
    receipt?: MinimalReceipt;
  } = {};
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    respond(res, 400, { ok: false, code: "BAD_REQUEST", msg: "body must be JSON" });
    return true;
  }

  if (!body.txHash || !TX_HASH_RE.test(body.txHash)) {
    respond(res, 400, {
      ok: false,
      code: "BAD_REQUEST",
      msg: "txHash must be 0x-prefixed 32-byte hex",
    });
    return true;
  }
  const txHash = body.txHash as `0x${string}`;

  store.upsertUser(wallet, wallet);

  if (store.findDeposit(txHash)) {
    respond(res, 409, { ok: false, code: "DUPLICATE_TX" });
    return true;
  }

  try {
    let amount: bigint;
    if (body.receipt) {
      // Fast path: the client already fetched the receipt via its own
      // MiniPay provider-stub. Validate structurally without RPC fetch.
      const verified = validateClientReceipt(body.receipt, config.treasury, config.tokenAddress);
      amount = verified.amount;
    } else {
      // Slow path: poll the configured public RPC. Used as a safety net
      // when the client can't fetch its own receipt.
      const verified = await verifyDeposit({
        txHash,
        treasury: config.treasury,
        tokenAddress: config.tokenAddress,
        seenTxHashes: new Set<string>(),
        provider: config.provider,
        pollIntervalMs: config.pollIntervalMs,
        maxAttempts: config.maxAttempts,
      });
      amount = verified.amount;
    }
    const amountUSD = Number(amount) / 10 ** settleTokenDecimals;
    creditDeposit(store, wallet, txHash, amountUSD);
    respond(res, 200, {
      ok: true,
      balanceUSD: store.balanceOf(wallet),
    });
  } catch (e) {
    if (e instanceof DuplicateTransactionError) {
      respond(res, 409, { ok: false, code: "DUPLICATE_TX", msg: e.message });
      return true;
    }
    if (
      e instanceof WrongRecipientError ||
      e instanceof InsufficientAmountError ||
      e instanceof InvalidTransactionError
    ) {
      respond(res, 422, { ok: false, code: "INVALID_TX", msg: e.message });
      return true;
    }
    respond(res, 500, { ok: false, code: "RPC_ERROR", msg: (e as Error).message });
  }
  return true;
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  const headers: Record<string, string | string[] | undefined> = {
    "Content-Type": "application/json",
  };
  applyCorsHeaders(headers, "*");
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
