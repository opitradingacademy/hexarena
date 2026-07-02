"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { GameMode } from "@hexarena/shared/protocol";
import { StakeSelector } from "../../components/StakeSelector";
import { StakeConfirmDialog } from "../../components/StakeConfirmDialog";
import { getSocket } from "../../lib/socketSingleton";
import { useUsdtBalance } from "../../lib/useUsdtBalance";
import { getWalletAddress } from "../../lib/wallet";
import { waitForEthereum } from "../../lib/waitForEthereum";
import { getArenaTreasuryAddress, getDepositUrl } from "../../lib/serverUrl";

/**
 * Matchmaking screen (design.md wireframe "2. Matchmaking Queue").
 * Arena flow requires the user to deposit their stake to the operator
 * treasury before join_queue — see arena-deposit Approach B in CLAUDE.md.
 * The StakeConfirmDialog handles the on-chain transfer + /api/deposit
 * credit step; only after the ledger credit does this screen emit
 * join_queue with the chosen stake.
 */
export default function MatchmakingPage() {
  return (
    <Suspense fallback={null}>
      <MatchmakingScreen />
    </Suspense>
  );
}

function MatchmakingScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { balance: balanceUSD, reload: reloadBalance } = useUsdtBalance();
  const [mode, setMode] = useState<GameMode>(
    searchParams.get("mode") === "arena" ? "ARENA" : "CASUAL",
  );
  const [stake, setStake] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "searching" | "cancelled">("idle");
  const [depositOpen, setDepositOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    function onMatchFound(payload: { matchId: string; color: "P1" | "P2"; opponent: string }) {
      router.push(
        `/game/${payload.matchId}?color=${payload.color}&opponent=${encodeURIComponent(
          payload.opponent,
        )}`,
      );
    }
    function onError(payload: { code: string; msg?: string }) {
      if (payload.code === "INSUFFICIENT_BALANCE") {
        setDepositOpen(true);
        setServerError(payload.msg ?? "Insufficient balance — deposit stake first");
        setStatus("idle");
      }
    }
    socket.on("match_found", onMatchFound);
    socket.on("error", onError as never);
    return () => {
      socket.off("match_found", onMatchFound);
      socket.off("error", onError as never);
    };
  }, [router]);

  function handleSearch() {
    // Casual joins the queue directly; Arena requires a stake deposit.
    if (mode === "CASUAL") {
      setStatus("searching");
      getSocket().emit("join_queue", { mode: "CASUAL" });
      return;
    }
    if (stake == null) return;
    setDepositOpen(true);
    setServerError(null);
  }

  function handleCancel() {
    setStatus("cancelled");
    getSocket().emit("cancel_queue", {});
  }

  async function handleStakeConfirmed() {
    setDepositOpen(false);
    setStatus("searching");
    // Refresh the local ledger view so the server's balanceOf check sees
    // the freshly-credited deposit on the next join_queue.
    reloadBalance();
    getSocket().emit("join_queue", { mode: "ARENA", stake: stake ?? 0 });
  }

  return (
    <main className="mx-auto flex max-w-md flex-col px-4 pt-6">
      <header className="flex rounded-full border border-arena-border bg-arena-surface p-1">
        <button
          type="button"
          aria-pressed={mode === "CASUAL"}
          onClick={() => setMode("CASUAL")}
          className={`flex-1 rounded-full py-2 text-sm font-bold uppercase transition ${
            mode === "CASUAL" ? "bg-arena-cyan text-arena-bg" : "text-slate-400"
          }`}
        >
          Casual
        </button>
        <button
          type="button"
          aria-pressed={mode === "ARENA"}
          onClick={() => setMode("ARENA")}
          className={`flex-1 rounded-full py-2 text-sm font-bold uppercase transition ${
            mode === "ARENA" ? "bg-arena-gold text-arena-bg" : "text-slate-400"
          }`}
        >
          Arena
        </button>
      </header>

      {mode === "ARENA" && (
        <div className="mt-4">
          <StakeSelector balanceUSD={balanceUSD} selectedStake={stake} onSelect={setStake} />
        </div>
      )}

      {serverError && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-arena-magenta/60 bg-arena-magenta/10 p-3 text-sm text-arena-magenta"
        >
          {serverError}
        </p>
      )}

      {status === "searching" ? (
        <div className="mt-16 flex flex-col items-center gap-4">
          <div className="h-20 w-20 animate-spin rounded-full border-4 border-arena-cyan/20 border-t-arena-cyan" />
          <p className="text-sm font-semibold uppercase tracking-wide text-arena-cyan">
            Searching for opponent…
          </p>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-xl border border-arena-border px-6 py-2 text-sm font-bold uppercase text-slate-300"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleSearch}
          disabled={mode === "ARENA" && stake == null}
          className="mt-8 w-full rounded-xl bg-arena-magenta py-3 text-sm font-bold uppercase text-white shadow-neonMagenta transition disabled:cursor-not-allowed disabled:opacity-30"
        >
          Find match
        </button>
      )}

      <MatchmakingDepositDialog
        open={depositOpen}
        mode={mode}
        stake={stake}
        onClose={() => setDepositOpen(false)}
        onConfirmed={handleStakeConfirmed}
      />
    </main>
  );
}

/**
 * Thin wrapper that resolves the user's wallet address, treasury,
 * and server URL once when the dialog opens, then forwards them to
 * <StakeConfirmDialog>. Doing the resolution here avoids passing
 * raw window-touching dependencies through the dialog's prop surface.
 */
function MatchmakingDepositDialog({
  open,
  mode,
  stake,
  onClose,
  onConfirmed,
}: {
  open: boolean;
  mode: GameMode;
  stake: number | null;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [senderAddress, setSenderAddress] = useState<`0x${string}` | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      await waitForEthereum();
      if (cancelled) return;
      const ethereum = window.ethereum as Parameters<typeof getWalletAddress>[0] | undefined;
      const addr = await getWalletAddress(ethereum, { retries: 6, delayMs: 500 });
      if (!cancelled && addr) setSenderAddress(addr as `0x${string}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open || mode !== "ARENA" || stake == null) return null;

  if (open && !senderAddress) {
    return (
      <div
        role="dialog"
        aria-modal
        data-testid="stake-confirm-dialog"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      >
        <div className="w-full max-w-sm rounded-2xl border border-arena-border bg-arena-bg p-6 text-slate-200">
          <h2 className="text-lg font-black uppercase tracking-wider text-arena-gold">
            Loading wallet…
          </h2>
          <p className="mt-2 text-sm">
            Resolving your wallet from MiniPay. If this doesn&rsquo;t clear in a few seconds, open
            this app inside MiniPay.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-6 w-full rounded-xl border border-arena-border px-4 py-2 text-sm font-bold uppercase"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <StakeConfirmDialog
      open={open}
      stakeUSD={stake}
      treasury={getArenaTreasuryAddress()}
      senderAddress={senderAddress as `0x${string}`}
      depositServerUrl={getDepositUrl()}
      onClose={onClose}
      onSuccess={onConfirmed}
    />
  );
}
