/**
 * POST /api/deposit — credit server ledger with a USDT transfer the user
 * just made on-chain to the operator treasury. See arena-deposit decision
 * (Approach B).
 *
 * Body: { txHash: "0x..." }.
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
  InvalidTransactionError,
  WrongRecipientError,
  InsufficientAmountError,
  DuplicateTransactionError,
  type VerifyDepositProvider,
} from "./chain/verifyDeposit";
import type { LedgerStore } from "./ledger/types";
import { applyCorsHeaders } from "./cors";

export type DepositEndpointConfig = {
  treasury: `0x${string}`;
  provider: VerifyDepositProvider;
  /** Default 6 (USDT). Used to convert raw on-chain units to USD. */
  settleTokenDecimals?: number;
};

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Functional handler so the routing layer in server.ts can chain
 * specific endpoints instead of stacking listeners on 'request'.
 * Returns true when the request was handled (caller must NOT respond again).
 */
export async function handleDepositRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: LedgerStore,
  config: DepositEndpointConfig,
): Promise<boolean> {
  if (!req.url) return false;
  const url = new URL(req.url, "http://localhost");
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

  let body: { txHash?: string } = {};
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
    const verified = await verifyDeposit({
      txHash,
      treasury: config.treasury,
      seenTxHashes: new Set<string>(),
      provider: config.provider,
    });
    const amountUSD = Number(verified.amount) / 10 ** settleTokenDecimals;
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
