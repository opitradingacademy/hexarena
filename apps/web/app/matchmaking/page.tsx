"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { GameMode } from "@hexarena/shared/protocol";
import { StakeSelector } from "../../components/StakeSelector";
import { StakeConfirmDialog } from "../../components/StakeConfirmDialog";
import { getSocket } from "../../lib/socketSingleton";
import { useServerLedger } from "../../lib/useServerLedger";
import { getWalletAddress } from "../../lib/wallet";
import { waitForEthereum } from "../../lib/waitForEthereum";
import { getArenaTreasuryAddress, getDepositUrl } from "../../lib/serverUrl";

/**
 * Matchmaking screen (design.md wireframe "2. Matchmaking Queue").
 * Arena flow auto-opens the stake modal when the user taps Find Match
 * but the server ledger doesn't yet cover the chosen stake — so the
 * user never sees an "INSUFFICIENT_BALANCE" error in the happy
 * path. The /api/deposit receipt step credits the ledger, the
 * join_queue then goes through, and the user is matched.
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
  const { balance: balanceUSD, refresh: refreshBalance } = useServerLedger(
    process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001",
  );
  const [mode, setMode] = useState<GameMode>(
    searchParams.get("mode") === "arena" ? "ARENA" : "CASUAL",
  );
  const [stake, setStake] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "searching" | "cancelled" | "invite-pending">(
    "idle",
  );
  const [depositOpen, setDepositOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");

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
    async function onError(payload: { code: string; msg?: string }) {
      if (payload.code === "INSUFFICIENT_BALANCE") {
        // Production 2026-07-03 fix: before forcing the user back
        // into the deposit modal, refresh the SERVER ledger view.
        // The server's `join_queue` rejects on its own ledger
        // (balanceOf(store, userId)), not the on-chain wallet — and
        // this client's previous view of that number lagged the
        // server (the previous useUsdtBalance hook read via
        // eth_call, which can be ahead of the server's polling
        // result). After the refresh:
        //   - if the server ledger DOES cover the stake (the modal-
        //     loop case where the deposit tx already landed in the
        //     ledger but the client's cached balance was 0), retry
        //     join_queue without opening the modal. No fresh tx
        //     needed.
        //   - only if the server ledger still doesn't cover the
        //     stake do we open the deposit modal.
        const fresh = await refreshBalance();
        if (mode === "ARENA" && stake != null && fresh >= stake) {
          setServerError(null);
          setStatus("searching");
          socket.emit("join_queue", { mode: "ARENA", stake });
          return;
        }
        setDepositOpen(true);
        setServerError(payload.msg ?? "Insufficient balance — deposit stake first");
        setStatus("idle");
        return;
      }
      if (payload.code === "NOT_FOUND" || payload.code === "INVALID_STATE") {
        setServerError("That code isn't valid. Double-check it and try again.");
      }
    }
    function onInviteCreated(payload: { code: string }) {
      setInviteCode(payload.code);
      setInviteLink(`${window.location.origin}/invite/${payload.code}`);
      setInviteCopied(false);
      setStatus("invite-pending");
    }
    socket.on("match_found", onMatchFound);
    socket.on("error", onError as never);
    socket.on("invite_created", onInviteCreated);
    return () => {
      socket.off("match_found", onMatchFound);
      socket.off("error", onError as never);
      socket.off("invite_created", onInviteCreated);
    };
  }, [router, refreshBalance]);

  async function handleSearch() {
    if (mode === "ARENA" && stake == null) return;
    setServerError(null);
    // Production 2026-07-03 UX fix (v4 — NEVER-REOPEN): always
    // require the server's fresh ledger view before deciding
    // whether to open the stake modal. The cached React state can
    // lag the server ledger by tens of seconds (the user has
    // already deposited but the hook state hasn't re-rendered),
    // and that lag drives the "modal reopened, sign again" loop.
    // Trade a ~100ms HTTP round-trip for a deterministic flow.
    if (mode === "ARENA" && stake != null) {
      let fresh: number;
      try {
        fresh = await refreshBalance();
      } catch {
        // Couldn't reach the server at all. Surface this and ask
        // the user to tap Find Match again — don't open the modal,
        // since we genuinely don't know if a deposit is queued.
        setServerError("Couldn't reach the server. Tap Find Match again in a few seconds.");
        setStatus("idle");
        return;
      }
      if (fresh < stake) {
        setDepositOpen(true);
        return;
      }
    }
    setStatus("searching");
    getSocket().emit(
      "join_queue",
      mode === "CASUAL" ? { mode: "CASUAL" } : { mode: "ARENA", stake: stake ?? undefined },
    );
  }

  function handleCancel() {
    setStatus("cancelled");
    setInviteCode(null);
    setInviteLink(null);
    getSocket().emit("cancel_queue", {});
  }

  function handlePlayVsBot() {
    setServerError(null);
    setStatus("searching");
    getSocket().emit("play_vs_bot");
  }

  function handleInviteFriend() {
    if (mode === "ARENA" && stake == null) return;
    setServerError(null);
    getSocket().emit(
      "create_invite",
      mode === "CASUAL" ? { mode: "CASUAL" } : { mode: "ARENA", stake: stake ?? undefined },
    );
  }

  async function handleCopyInviteLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setInviteCopied(true);
  }

  function handleJoinByCode() {
    const code = joinCodeInput.trim();
    if (!code) return;
    setServerError(null);
    getSocket().emit("join_invite", { code });
  }

  async function handleStakeConfirmed() {
    // Production 2026-07-03 UX fix: after a successful deposit tx,
    // do NOT auto-resume the matchmaking flow on the client. Wait
    // for the user to confirm again — but make the second click a
    // no-op if the ledger already covers the stake (don't emit a
    // fresh join_queue when the previous one is still pending).
    setDepositOpen(false);
    setServerError(null);
    try {
      const fresh = await refreshBalance();
      if (mode === "ARENA" && stake != null && fresh >= stake) {
        setStatus("searching");
        getSocket().emit("join_queue", { mode: "ARENA", stake });
        return;
      }
    } catch {
      // The /api/balance read failed (offline, CORS, etc.). Don't
      // open the deposit modal again — the user just deposited and
      // the server has it. Surface a message that tells them to tap
      // Find Match again so we can re-read.
      setServerError("Deposit queued — Retry will reuse the signed tx once the server catches up.");
      return;
    }
    // The server polling hasn't credited the deposit yet — show a
    // friendly "still waiting" hint so the user understands why
    // they need to tap Find Match again.
    setServerError("Deposit queued — Retry will reuse the signed tx once the server catches up.");
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-4 pt-6 pb-24">
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

      {serverError && !depositOpen && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-arena-magenta/60 bg-arena-magenta/10 p-3 text-sm text-arena-magenta"
        >
          {serverError}
        </p>
      )}

      {status === "invite-pending" ? (
        <div className="mt-16 flex flex-col items-center gap-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-arena-cyan">
            Waiting for your friend to join…
          </p>
          <p className="text-center text-xs text-slate-400">
            Share this code with your friend — they enter it in MiniPay under &ldquo;Join with a
            code&rdquo;.
          </p>
          <div
            data-testid="invite-code"
            className="w-full rounded-xl border border-arena-gold/60 bg-arena-surface p-4 text-center text-3xl font-black tracking-[0.3em] text-arena-gold"
          >
            {inviteCode}
          </div>
          <p className="text-center text-xs text-slate-500">This code expires in 5 minutes.</p>
          <details className="w-full text-center text-xs text-slate-500">
            <summary className="cursor-pointer uppercase tracking-wide">
              Playing on web instead?
            </summary>
            <div
              data-testid="invite-link"
              className="mt-2 break-all rounded-xl border border-arena-border bg-arena-surface p-3 text-slate-400"
            >
              {inviteLink}
            </div>
            <button
              type="button"
              onClick={handleCopyInviteLink}
              className="mt-2 w-full rounded-xl border border-arena-border py-2 text-xs font-bold uppercase text-slate-300 transition"
            >
              {inviteCopied ? "Copied!" : "Copy link"}
            </button>
          </details>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-xl border border-arena-border px-6 py-2 text-sm font-bold uppercase text-slate-300"
          >
            Cancel
          </button>
        </div>
      ) : status === "searching" ? (
        <div className="mt-16 flex flex-col items-center gap-4">
          <div className="h-20 w-20 animate-spin rounded-full border-4 border-arena-cyan/20 border-t-arena-cyan" />
          <p className="text-sm font-semibold uppercase tracking-wide text-arena-cyan">
            Searching for opponent…
          </p>
          {mode === "CASUAL" && (
            <p className="text-center text-xs text-slate-400">
              No opponent yet? You&rsquo;ll be matched with the computer in a few seconds.
            </p>
          )}
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-xl border border-arena-border px-6 py-2 text-sm font-bold uppercase text-slate-300"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div data-testid="matchmaking-idle" className="flex flex-1 flex-col justify-center">
          <button
            type="button"
            onClick={handleSearch}
            disabled={mode === "ARENA" && stake == null}
            className="w-full rounded-xl bg-arena-magenta py-3 text-sm font-bold uppercase text-white shadow-neonMagenta transition disabled:cursor-not-allowed disabled:opacity-30"
          >
            Find match
          </button>
          {mode === "CASUAL" && (
            <button
              type="button"
              onClick={handlePlayVsBot}
              className="mt-3 w-full rounded-xl border border-arena-cyan/60 py-3 text-sm font-bold uppercase text-arena-cyan transition"
            >
              Play vs Computer
            </button>
          )}
          <button
            type="button"
            onClick={handleInviteFriend}
            disabled={mode === "ARENA" && stake == null}
            className="mt-3 w-full rounded-xl border border-arena-gold/60 py-3 text-sm font-bold uppercase text-arena-gold transition disabled:cursor-not-allowed disabled:opacity-30"
          >
            Invite a friend
          </button>

          <div className="mt-6 flex gap-2">
            <input
              type="text"
              inputMode="text"
              placeholder="Enter a code"
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-arena-border bg-arena-surface px-3 py-3 text-sm uppercase text-slate-200 placeholder:text-slate-500 placeholder:normal-case"
            />
            <button
              type="button"
              onClick={handleJoinByCode}
              disabled={!joinCodeInput.trim()}
              className="rounded-xl border border-arena-cyan/60 px-5 text-sm font-bold uppercase text-arena-cyan transition disabled:cursor-not-allowed disabled:opacity-30"
            >
              Join
            </button>
          </div>
        </div>
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
