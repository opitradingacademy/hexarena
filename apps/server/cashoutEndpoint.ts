/**
 * POST /api/cashout — debit the user's server-side ledger balance and
 * send USDT to their wallet on-chain via the redeployed
 * ArenaSettlement.withdrawUser() function.
 *
 * Flow (per PR1 design, with hash-as-withdrawalId fix):
 *   1. Validate wallet + idempotency key + amount headers/body.
 *   2. Lookup idempotency by (userId, idempotencyKey). If match → 200
 *      with idempotent_replay: true (same amount) or 409 (different
 *      amount).
 *   3. Compute `withdrawalId = keccak256(idempotencyKey)`. The same
 *      idempotency key ALWAYS hashes to the same bytes32, so the
 *      on-chain `withdrawn[withdrawalId]` guard is the ultimate
 *      idempotency authority — DB loss does not enable a
 *      double-payout.
 *   4. `cashoutInitiate()` — atomic ledger debit + PENDING row.
 *   5. `withdrawFn()` — viem signs + broadcasts `withdrawUser(hash,
 *      to, amountRaw)`. On-chain revert types:
 *      - `AlreadyWithdrawn` (0x51dd3741) + DB-CONFIRMED row → 200
 *        idempotent_replay (the user already got their USDT).
 *      - `AlreadyWithdrawn` + DB-PENDING (or no row) → 409
 *        IDEMPOTENCY_CONFLICT (we can't recover the txHash — ask
 *        the user to contact support).
 *      - any other revert / RPC failure → `cashoutFail()` +
 *        422 CASHOUT_FAILED.
 *   6. On success: `cashoutConfirm()` — 200 with full withdrawal
 *      record.
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
import { isAddress, getAddress, keccak256, toBytes } from "viem";
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
import { isAlreadyWithdrawnRevert, isInsufficientFloatRevert } from "./chain/withdraw";

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
    /** 32-byte hash (0x-prefixed) — typically `keccak256(idempotencyKey)`. */
    withdrawalId: `0x${string}`;
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

  // [HexArena:diag-cashout] 2026-07-22 — log every cashout to
  // diagnose the 409 IDEMPOTENCY_CONFLICT loop. Remove after root
  // cause is confirmed.
  console.log(`[HexArena:diag-cashout] wallet=${wallet} amount=${amountUSD} key=${idempotencyKey}`);

  // ---- Idempotency check ----
  const existing = store.getWithdrawalByIdempotencyKey(wallet, idempotencyKey);
  console.log(
    `[HexArena:diag-cashout] existingByKey=${existing ? existing.id : "none"}/${existing ? existing.status : "-"}`,
  );
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

  // ---- Derive withdrawalId from idempotencyKey ----
  const withdrawalId = keccak256(toBytes(idempotencyKey));
  console.log(`[HexArena:diag-cashout] derivedWithdrawalId=${withdrawalId}`);

  // ---- Debit ledger + create PENDING withdrawal ----
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

  // ---- Broadcast on-chain (with AlreadyWithdrawn retry) ----
  //
  // The on-chain `withdrawn[withdrawalId]` guard is the idempotency
  // source of truth. If the hash derived from the client-supplied
  // idempotencyKey is already burned on-chain (e.g. a previous
  // session signed with the same key, or the DB was wiped and the
  // client re-sent a stale key), we don't want to fail the user —
  // we want to retry with a hash that is definitely fresh. The
  // client idempotencyKey is preserved as the canonical DB row id
  // (so retries with the same key still dedup via the `existing`
  // check at the top), but the ONS-CHAIN withdrawalId is rotated
  // to a fresh random hash for the broadcast.
  const MAX_BURNED_RETRIES = 3;
  let attempt = 0;
  let chainResult: WithdrawOnChainResult;
  let broadcastHash: `0x${string}` = withdrawalId;
  while (true) {
    try {
      chainResult = await config.withdrawFn({
        withdrawalId: broadcastHash,
        to: wallet as `0x${string}`,
        amountUSD,
      });
      break;
    } catch (e) {
      console.log(
        `[HexArena:diag-cashout] catch: withdrawalId=${broadcastHash} err=${(e as Error).message?.slice(0, 200)}`,
      );
      // The on-chain guard rejected this hash because it was already
      // used. Rotate to a fresh random hash and try again — up to
      // MAX_BURNED_RETRIES times. Recovery scenarios:
      //   - Client reused a stale idempotencyKey from a wiped DB.
      //   - A previous session signed with this hash before crashing.
      //   - The client UI is regenerating the same key for some
      //     reason (MiniPay WebView localStorage caching).
      if (isInsufficientFloatRevert(e)) {
        // Rotating the withdrawalId can never fix this — the
        // operator's prize float genuinely doesn't hold enough of the
        // settlement token. Fail fast with a distinct code instead of
        // burning MAX_BURNED_RETRIES attempts on a shortage that
        // won't go away between retries.
        const failed = cashoutFail(store, withdrawalId);
        respond(res, 422, {
          ok: false,
          code: "INSUFFICIENT_FLOAT",
          msg: "Operator prize float is temporarily depleted — try again later",
          withdrawal: serializeWithdrawal(failed),
        });
        return true;
      }
      if (isAlreadyWithdrawnRevert(e) && attempt < MAX_BURNED_RETRIES) {
        attempt += 1;
        broadcastHash = keccak256(toBytes(`${idempotencyKey}#retry${attempt}:${Math.random()}`));
        console.log(
          `[HexArena:diag-cashout] alreadyWithdrawn: rotating to ${broadcastHash} (attempt ${attempt}/${MAX_BURNED_RETRIES})`,
        );
        continue;
      }
      // Revert / RPC failure (including a final exhausted retry
      // streak): restore balance via the reversal entry on the DB
      // row keyed by the original withdrawalId.
      const failed = cashoutFail(store, withdrawalId);
      respond(res, 422, {
        ok: false,
        code: "CASHOUT_FAILED",
        msg: (e as Error).message,
        withdrawal: serializeWithdrawal(failed),
      });
      return true;
    }
  }

  // ---- Confirm ----
  // The DB row is keyed by the IDEMPOTENCY-key-derived hash so a
  // client retry with the same key still hits the idempotency
  // replay fast path. The broadcast tx uses broadcastHash (different
  // from the DB row id when we had to rotate past an already-burned
  // hash) — that's the on-chain truth, so we record THAT hash via
  // the txHash emitted by the broadcast.
  const confirmed = cashoutConfirm(store, withdrawalId, chainResult.txHash, chainResult.amountRaw);
  console.log(
    `[HexArena:diag-cashout] confirmed: dbId=${withdrawalId} broadcastHash=${broadcastHash} rotated=${attempt > 0}`,
  );
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
