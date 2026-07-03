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

    // Retrying from a server-error must resume from the already-signed
    // txHash instead of calling submitUsdtTransfer again — otherwise a
    // transient receipt-fetch failure (MiniPay's own RPC lagging behind
    // a tx that's already mined) would double-charge the user on retry.
    let txHash: `0x${string}`;
    if (status.kind === "server-error") {
      txHash = status.txHash;
    } else {
      setStatus({ kind: "sending-tx" });
      try {
        txHash = await submitUsdtTransfer({
          ethereum,
          from: senderAddress,
          to: treasury,
          amountUSD: stakeUSD,
        });
      } catch (e) {
        const msg = (e as Error).message || "Tx rejected";
        // MiniPay's own provider sometimes waits for the receipt
        // internally before resolving eth_sendTransaction, and throws
        // viem's TransactionReceiptNotFoundError instead of returning
        // the hash — even though the tx was genuinely broadcast (the
        // hash is embedded in the error message). Recover it and treat
        // this like a server-error so Retry resumes instead of signing
        // a brand-new tx (which would double-charge the user).
        const recoveredHash = msg.match(/0x[0-9a-fA-F]{64}/)?.[0] as `0x${string}` | undefined;
        if (recoveredHash) {
          setStatus({ kind: "server-error", txHash: recoveredHash, code: "NETWORK", msg });
          return;
        }
        setStatus({ kind: "client-error", msg });
        return;
      }
    }

    setStatus({ kind: "confirming", txHash });
    // TEMP DIAG 2026-07-03: surface the receipt-fetch fork so we can
    // confirm on-device whether the bug we're fixing hits this exact
    // path (and that the server-side slow path is reached). Safe to
    // remove once Arena deposit is verified end-to-end on physical
    // device.
    type ReceiptFetchResult =
      { kind: "ok"; receipt: Record<string, unknown> | null } | { kind: "throw"; error: unknown };
    let receiptFetch: ReceiptFetchResult = { kind: "ok", receipt: null };
    try {
      // Try to fetch the receipt from the same provider-stub that signed
      // the tx — that nodo has it immediately, no propagation latency.
      // Sending the receipt lets the server validate without polling.
      const receipt = (await ethereum.request({
        method: "eth_getTransactionReceipt",
        params: [txHash],
      })) as Record<string, unknown> | null;
      receiptFetch = { kind: "ok", receipt };
    } catch (e) {
      receiptFetch = { kind: "throw", error: e };
    }
    // TEMP DIAG 2026-07-03: log which fork we hit so device study can
    // confirm root cause. Strings grep-able as [HexArena:diag].
    if (receiptFetch.kind === "throw") {
      const msg = (receiptFetch.error as Error)?.message ?? String(receiptFetch.error);
      console.log(
        `[HexArena:diag] deposit receipt fetch THREW — delegating to server slow path. ` +
          `txHash=${txHash} err=${msg}`,
      );
    } else if (receiptFetch.receipt === null) {
      console.log(
        `[HexArena:diag] deposit receipt fetch RETURNED NULL — delegating to server slow path. ` +
          `txHash=${txHash}`,
      );
    } else {
      console.log(
        `[HexArena:diag] deposit receipt fetch OK — sending receipt to server. ` +
          `txHash=${txHash}`,
      );
    }
    // Build the POST body. Only attach the receipt when we actually got
    // one back — if the local fetch threw or returned null, omit the
    // field entirely. The server's slow path (verifyDeposit) will poll
    // the public Celo RPC up to 15s and credit the ledger on its own.
    // Re-querying the same stale local view on Retry was never going
    // to converge — the local provider-stub lags behind chain state.
    const body: { txHash: `0x${string}`; receipt?: Record<string, unknown> } = {
      txHash,
    };
    if (receiptFetch.kind === "ok" && receiptFetch.receipt !== null) {
      body.receipt = receiptFetch.receipt;
    }
    try {
      const res = await fetch(depositServerUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-wallet-address": senderAddress,
        },
        body: JSON.stringify(body),
      });
      console.log(
        `[HexArena:diag] POST /api/deposit responded status=${res.status} txHash=${txHash}`,
      );
      if (!res.ok) {
        const respBody = (await res.json().catch(() => ({}))) as {
          code?: string;
          msg?: string;
        };
        setStatus({
          kind: "server-error",
          txHash,
          code: respBody.code ?? `HTTP_${res.status}`,
          msg: respBody.msg ?? `Deposit failed (${res.status})`,
        });
        return;
      }
      onSuccess(txHash);
    } catch (e) {
      console.log(
        `[HexArena:diag] POST /api/deposit THREW — txHash=${txHash} err=${
          (e as Error)?.message ?? String(e)
        }`,
      );
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
            className="mt-4 rounded-xl border border-arena-magenta/60 bg-arena-magenta/10 p-3 text-xs text-arena-magenta"
          >
            {(status.kind === "server-error" || status.kind === "client-error") &&
              status.kind === "server-error" && (
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-arena-magenta/80">
                  code: {status.code}
                </div>
              )}
            {errorMessage}
            {/* For the RPC_ERROR case specifically — when the server polled
                the public Celo RPC for up to 40s and didn't see the tx
                yet — the tx IS already mined (the wallet shows the debit),
                we just need to wait for the public RPC to catch up. Tell
                the user that explicitly so they know Retry is safe and
                likely to succeed. The same txHash is reused on Retry, so
                no double-charge. */}
            {status.kind === "server-error" &&
              status.code === "RPC_ERROR" &&
              " The deposit is queued — Retry will reuse the signed tx."}
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
