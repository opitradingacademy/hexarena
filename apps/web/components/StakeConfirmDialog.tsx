"use client";

import { useEffect, useState } from "react";
import { formatUSD } from "../lib/formatUSD";
import { submitUsdtTransfer, type EthereumRequester } from "../lib/transferUsdt";

export type StakeConfirmDialogProps = {
  open: boolean;
  stakeUSD: number;
  treasury: `0x${string}`;
  senderAddress: `0x${string}`;
  depositServerUrl: string;
  onClose: () => void;
  onSuccess: (txHash: `0x${string}`) => void;
};

type Status =
  | { kind: "idle" }
  | { kind: "sending-tx" }
  | { kind: "confirming"; txHash: `0x${string}` }
  | { kind: "server-error"; txHash: `0x${string}`; code: string; msg: string }
  | { kind: "client-error"; msg: string };

/**
 * Modal that handles the full Arena-stake credit path:
 *   1. submitUsdtTransfer — sends a USDT.transfer(treasury, stake) via
 *      the injected MiniPay provider and waits for the user to sign.
 *   2. POST /api/deposit { txHash } — server fetches the on-chain
 *      receipt, confirms the Transfer event matches, and credits the
 *      internal ledger so join_queue can pass its balanceOf gate.
 *   3. onSuccess(txHash) — MatchmakingScreen closes the dialog and
 *      emits join_queue with the same stake.
 *
 * The dialog calls onSuccess ONLY after the ledger credit returns 200.
 * If the on-chain transfer is signed but the server ledger credit
 * fails, the dialog surfaces a structured error and refrains from
 * progressing — the user can retry the deposit step without signing a
 * second on-chain tx (idempotency is at the tx_hash level).
 *
 * No gas/crypto/CELO copy here — MiniPay rules.
 */
export function StakeConfirmDialog({
  open,
  stakeUSD,
  treasury,
  senderAddress,
  depositServerUrl,
  onClose,
  onSuccess,
}: StakeConfirmDialogProps) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Reset state when the dialog reopens so stale errors don't linger.
  useEffect(() => {
    if (open) setStatus({ kind: "idle" });
  }, [open]);

  if (!open) return null;

  const errorMessage =
    status.kind === "client-error" || status.kind === "server-error" ? status.msg : null;

  const submitting = status.kind === "sending-tx" || status.kind === "confirming";

  async function handleConfirm() {
    const ethereum = window.ethereum as unknown as EthereumRequester | undefined;
    if (!ethereum?.request) {
      setStatus({ kind: "client-error", msg: "No provider — open inside MiniPay." });
      return;
    }
    setStatus({ kind: "sending-tx" });
    let txHash: `0x${string}`;
    try {
      txHash = await submitUsdtTransfer({
        ethereum,
        from: senderAddress,
        to: treasury,
        amountUSD: stakeUSD,
      });
    } catch (e) {
      const msg = (e as Error).message || "Tx rejected";
      setStatus({ kind: "client-error", msg });
      return;
    }

    setStatus({ kind: "confirming", txHash });
    try {
      const res = await fetch(depositServerUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-wallet-address": senderAddress,
        },
        body: JSON.stringify({ txHash }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          msg?: string;
        };
        setStatus({
          kind: "server-error",
          txHash,
          code: body.code ?? `HTTP_${res.status}`,
          msg: body.msg ?? `Deposit failed (${res.status})`,
        });
        return;
      }
      onSuccess(txHash);
    } catch (e) {
      setStatus({
        kind: "server-error",
        txHash,
        code: "NETWORK",
        msg: (e as Error).message || "Network error",
      });
    }
  }

  const primaryLabel =
    status.kind === "idle"
      ? `Confirm ${formatUSD(stakeUSD)} stake`
      : status.kind === "sending-tx"
        ? "Sign in wallet…"
        : status.kind === "confirming"
          ? "Confirming…"
          : "Retry";

  return (
    <div
      role="dialog"
      aria-modal
      data-testid="stake-confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl border border-arena-border bg-arena-bg p-6 text-slate-200 shadow-neonGold">
        <h2 className="text-lg font-black uppercase tracking-wider text-arena-gold">
          Confirm stake
        </h2>
        <p className="mt-2 text-sm">
          You&rsquo;ll sign a network fee with stablecoins to deposit{" "}
          <strong className="text-arena-green">{formatUSD(stakeUSD)}</strong> for this match. The
          prize pool pays <strong>{(1 - 0.2) * 100}%</strong> to the winner.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          Destination wallet:{" "}
          <span className="font-mono">
            {treasury.slice(0, 6)}…{treasury.slice(-4)}
          </span>
        </p>

        {errorMessage && (
          <div
            data-testid="stake-error"
            role="alert"
            className="mt-4 rounded-xl border border-arena-magenta/60 bg-arena-magenta/10 p-3 text-sm text-arena-magenta"
          >
            {errorMessage}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => {
              if (!submitting) onClose();
            }}
            disabled={submitting}
            className="flex-1 rounded-xl border border-arena-border px-4 py-2 text-sm font-bold uppercase text-slate-300 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="stake-confirm-button"
            onClick={handleConfirm}
            disabled={submitting}
            className="flex-1 rounded-xl bg-arena-gold px-4 py-2 text-sm font-bold uppercase text-arena-bg shadow-neonGold disabled:opacity-40"
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
