/**
 * POST /api/cashout — debit the user's server-side ledger balance and
 * send USDT to their wallet on-chain via the redeployed
 * ArenaSettlement.withdrawUser() function.
 *
 * Flow (per PR1 design):
 *   1. Validate wallet + idempotency key + amount headers/body.
 *   2. Check idempotency: if (wallet, idempotencyKey) already exists
 *      → return current state with 200 + idempotent_replay: true.
 *      (Same amount → ok. Different amount → 409 IDEMPOTENCY_CONFLICT.)
 *   3. Call `cashoutInitiate()` — atomic ledger debit + PENDING row.
 *   4. Call `withdrawFn()` — viem chain broadcast. Idempotent on
 *      the withdrawalId so a re-broadcast is safe.
 *   5. On success: `cashoutConfirm()` — 200 with full withdrawal
 *      record.
 *   6. On revert: `cashoutFail()` — writes WITHDRAW_REVERSAL,
 *      restores balance, returns 422 CASHOUT_FAILED.
 *
 * Auth: caller declares their wallet via the X-Wallet-Address header.
 * MVP-trust, no signed challenge. The chain tx itself proves the
 * recipient — production should also verify the recipient.
 *
 * Response 200: { ok: true, balanceUSD, withdrawal: { id, status,
 *                  txHash, amountUSD, netReceivedUSD } }
 * Response 200: { ok: true, balanceUSD, idempotent_replay: true,
 *                  withdrawal: ... }   ← replay of a prior call
 * Response 400: { ok: false, code: "BAD_REQUEST" }
 * Response 405: { ok: false, code: "METHOD_NOT_ALLOWED" }
 * Response 409: { ok: false, code: "IDEMPOTENCY_CONFLICT" }
 * Response 422: { ok: false, code: "INSUFFICIENT_BALANCE" | "BELOW_MINIMUM" | "CASHOUT_FAILED" }
 * Response 500: { ok: false, code: "CONFIG_ERROR" }
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAddress, getAddress } from "viem";
import { randomUUID } from "node:crypto";
import {
  cashoutInitiate,
  cashoutConfirm,
  cashoutFail,
  balanceOf,
  MIN_CASHOUT_USD,
} from "./ledger/ledger";
import { InsufficientBalanceError } from "./ledger/errors";
import type { LedgerStore } from "./ledger/types";
import { applyCorsHeaders } from "./cors";
import type { WithdrawOnChainResult } from "./chain/withdraw";

export type WithdrawOnChainConfig = {
  /**
   * Function that signs and broadcasts the on-chain withdrawUser
   * call. Production wires this to `withdrawUsdtOnChain` from
   * `apps/server/chain/withdraw.ts`; tests pass a mock. Accepting
   * it as a dependency (rather than reading from a module-level
   * constant) is what lets us inject viem mocks without polluting
   * the real signer with `vi.mock()`.
   */
  withdrawFn: (args: {
    withdrawalId: string;
    to: `0x${string}`;
    amountUSD: number;
  }) => Promise<WithdrawOnChainResult>;
};

/** UUID v4 (RFC 4122) — strict enough to reject empty / malformed keys. */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleCashoutRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: LedgerStore,
  config: WithdrawOnChainConfig,
): Promise<boolean> {
  if (!req.url) return false;
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/api/cashout") return false;

  // CORS preflight — the MiniPay WebView sends OPTIONS before the
  // POST /api/cashout when the origin (Vercel) differs from the API
  // (Railway). Without this, the browser blocks the actual request.
  // Mirror the deposit handler pattern: respond 204 with CORS
  // headers and short-circuit. Also covers the case where this
  // handler is mounted standalone in tests.
  if (req.method === "OPTIONS") {
    const headers: Record<string, string | string[] | undefined> = {};
    applyCorsHeaders(headers, "*");
    res.writeHead(204, headers);
    res.end();
    return true;
  }

  if (req.method !== "POST") {
    respond(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
    return true;
  }

  if (!process.env.OPERATOR_PRIVATE_KEY) {
    respond(res, 500, {
      ok: false,
      code: "CONFIG_ERROR",
      msg: "OPERATOR_PRIVATE_KEY not configured",
    });
    return true;
  }

  // ---- Header validation ----
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

  const idempotencyHeader = req.headers["idempotency-key"];
  const idempotencyKey = typeof idempotencyHeader === "string" ? idempotencyHeader.trim() : "";
  if (!idempotencyKey || !UUID_V4_RE.test(idempotencyKey)) {
    respond(res, 400, {
      ok: false,
      code: "BAD_REQUEST",
      msg: "Idempotency-Key header must be a uuid v4",
    });
    return true;
  }

  // ---- Body validation ----
  let body: { amountUSD?: unknown } = {};
  try {
    const raw = (await readBody(req)) || "{}";
    body = JSON.parse(raw);
  } catch {
    respond(res, 400, { ok: false, code: "BAD_REQUEST", msg: "body must be JSON" });
    return true;
  }

  const amountUSD = body.amountUSD;
  if (typeof amountUSD !== "number" || !Number.isFinite(amountUSD)) {
    respond(res, 400, {
      ok: false,
      code: "BAD_REQUEST",
      msg: "amountUSD must be a finite number",
    });
    return true;
  }

  if (amountUSD < MIN_CASHOUT_USD) {
    respond(res, 422, {
      ok: false,
      code: "BELOW_MINIMUM",
      msg: `amountUSD must be >= ${MIN_CASHOUT_USD}`,
    });
    return true;
  }

  store.upsertUser(wallet, wallet);

  // ---- Idempotency check ----
  const existing = store.getWithdrawalByIdempotencyKey(wallet, idempotencyKey);
  if (existing) {
    if (existing.amountUSD !== amountUSD) {
      respond(res, 409, {
        ok: false,
        code: "IDEMPOTENCY_CONFLICT",
        msg: "Idempotency-Key already used with a different amount",
      });
      return true;
    }
    // Same wallet + same key + same amount → return the existing
    // withdrawal. If it was CONFIRMED, the user already got their
    // USDT — just report the current state.
    respond(res, 200, {
      ok: true,
      idempotent_replay: true,
      balanceUSD: balanceOf(store, wallet),
      withdrawal: serializeWithdrawal(existing),
    });
    return true;
  }

  // ---- Balance check (cheap pre-flight; cashoutInitiate re-checks
  // atomically inside the transaction) ----
  if (balanceOf(store, wallet) < amountUSD) {
    respond(res, 422, {
      ok: false,
      code: "INSUFFICIENT_BALANCE",
      msg: "amountUSD exceeds available balance",
    });
    return true;
  }

  // ---- Debit ledger + create PENDING withdrawal ----
  const withdrawalId = randomUUID();
  try {
    cashoutInitiate(store, wallet, withdrawalId, amountUSD, idempotencyKey);
  } catch (e) {
    if (e instanceof InsufficientBalanceError) {
      respond(res, 422, {
        ok: false,
        code: "INSUFFICIENT_BALANCE",
        msg: e.message,
      });
      return true;
    }
    throw e;
  }

  // ---- Broadcast on-chain ----
  let chainResult: WithdrawOnChainResult;
  try {
    chainResult = await config.withdrawFn({
      withdrawalId,
      to: wallet as `0x${string}`,
      amountUSD,
    });
  } catch (e) {
    // Revert / RPC failure: restore balance via the reversal entry.
    const failed = cashoutFail(store, withdrawalId);
    respond(res, 422, {
      ok: false,
      code: "CASHOUT_FAILED",
      msg: (e as Error).message,
      withdrawal: serializeWithdrawal(failed),
    });
    return true;
  }

  // ---- Confirm ----
  const confirmed = cashoutConfirm(store, withdrawalId, chainResult.txHash, chainResult.amountRaw);
  respond(res, 200, {
    ok: true,
    balanceUSD: balanceOf(store, wallet),
    withdrawal: {
      ...serializeWithdrawal(confirmed),
      // User-facing number — what they net after the on-chain fee.
      // Equal to amountUSD (operator absorbs the ~1.5%).
      netReceivedUSD: amountUSD,
    },
  });
  return true;
}

/**
 * Pick the fields the handler exposes. `amountRaw` is the gross
 * value signed to the contract (operator-facing only).
 */
function serializeWithdrawal(w: ReturnType<typeof Object> & Record<string, any>) {
  return {
    id: w.id,
    status: w.status,
    txHash: w.txHash,
    amountUSD: w.amountUSD,
    amountRaw: w.amountRaw,
    createdAt: w.createdAt,
    confirmedAt: w.confirmedAt,
    failedAt: w.failedAt,
  };
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
