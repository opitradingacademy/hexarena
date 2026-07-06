/**
 * Client for `POST /api/cashout` — server signs the on-chain
 * `ArenaSettlement.withdrawUser` call; the user never signs a tx for
 * cash-out (unlike deposit, where the user sends USDT.transfer from
 * their wallet). See PR1 commit `ae23816`.
 *
 * Idempotency contract (server-side, see apps/server/cashoutEndpoint.ts):
 *   - Same `Idempotency-Key` + same amount → returns the original
 *     withdrawal with `idempotent_replay: true`. Used for retry on
 *     transient network failure.
 *   - Same key + different amount → 409 IDEMPOTENCY_CONFLICT.
 *   - The key lives in localStorage keyed by (wallet, amount, attempt)
 *     so a fresh attempt (user clicks "Try again") gets a NEW key.
 *
 * Error semantics — every non-2xx response throws a `CashoutError`
 * with the server's `code` + `msg` attached, so the dialog can render
 * `INSUFFICIENT_BALANCE` differently from `CASHOUT_FAILED`, etc.
 */

export type CashoutSuccessResponse = {
  ok: true;
  balanceUSD: number;
  idempotent_replay?: boolean;
  withdrawal: {
    id: string;
    status: "CONFIRMED" | "PENDING" | "FAILED";
    txHash: `0x${string}` | null;
    amountUSD: number;
    amountRaw: number | null;
    netReceivedUSD: number;
    createdAt: number;
    confirmedAt: number | null;
    failedAt: number | null;
  };
};

export type CashoutErrorResponse = {
  ok: false;
  code: string;
  msg?: string;
};

export class CashoutError extends Error {
  readonly code: string;
  readonly status: number;
  readonly msg: string;
  constructor(code: string, msg: string, status: number) {
    super(msg || code);
    this.name = "CashoutError";
    this.code = code;
    this.status = status;
    this.msg = msg || code;
  }
}

/**
 * Posts a cash-out request to the server. The server validates the
 * X-Wallet-Address header, runs the idempotency check, debits the
 * ledger, and broadcasts the on-chain withdrawUser tx.
 *
 * Throws `CashoutError` on any non-2xx response so callers can render
 * the structured `code` to the user (e.g., INSUFFICIENT_BALANCE vs
 * CASHOUT_FAILED). Network failures throw a CashoutError with code
 * "NETWORK" so the dialog can offer Retry without distinguishing
 * TypeError-from-fetch from a 5xx upstream.
 */
export async function requestCashout(args: {
  serverUrl: string;
  wallet: `0x${string}`;
  amountUSD: number;
  idempotencyKey: string;
}): Promise<CashoutSuccessResponse> {
  const url = `${args.serverUrl}/api/cashout`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-wallet-address": args.wallet,
        "idempotency-key": args.idempotencyKey,
      },
      body: JSON.stringify({ amountUSD: args.amountUSD }),
    });
  } catch (e) {
    throw new CashoutError("NETWORK", (e as Error)?.message || "Network error", 0);
  }

  // 200 may carry `idempotent_replay: true` on retry — that's still a
  // success path, just an indication the user is seeing cached state.
  if (res.ok) {
    const body = (await res.json().catch(() => ({}))) as CashoutSuccessResponse;
    if (!body || body.ok !== true || !body.withdrawal) {
      throw new CashoutError(
        "BAD_RESPONSE",
        "Malformed success response from /api/cashout",
        res.status,
      );
    }
    return body;
  }

  const body = (await res.json().catch(() => ({}))) as Partial<CashoutErrorResponse>;
  throw new CashoutError(
    body.code ?? `HTTP_${res.status}`,
    body.msg ?? `Cash out failed (${res.status})`,
    res.status,
  );
}
