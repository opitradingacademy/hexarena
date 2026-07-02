"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { GameMode } from "@hexarena/shared/protocol";
import { StakeSelector } from "../../components/StakeSelector";
import { getSocket } from "../../lib/socketSingleton";
import { useUsdtBalance } from "../../lib/useUsdtBalance";

/**
 * Matchmaking screen (design.md wireframe "2. Matchmaking Queue").
 * Wired to a real apps/server Socket.IO connection (PR5 e2e). The socket
 * is a module-level singleton (`getSocket`) so it survives navigation into
 * the game screen on `match_found`.
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
  const { balance: balanceUSD } = useUsdtBalance();
  const [mode, setMode] = useState<GameMode>(
    searchParams.get("mode") === "arena" ? "ARENA" : "CASUAL",
  );
  const [stake, setStake] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "searching" | "cancelled">("idle");

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    function onMatchFound(payload: { matchId: string; color: "P1" | "P2"; opponent: string }) {
      router.push(
        `/game/${payload.matchId}?color=${payload.color}&opponent=${encodeURIComponent(payload.opponent)}`,
      );
    }

    socket.on("match_found", onMatchFound);
    return () => {
      socket.off("match_found", onMatchFound);
    };
  }, [router]);

  function handleSearch() {
    setStatus("searching");
    getSocket().emit("join_queue", {
      mode,
      stake: mode === "ARENA" ? (stake ?? undefined) : undefined,
    });
  }

  function handleCancel() {
    setStatus("cancelled");
    getSocket().emit("cancel_queue", {});
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
    </main>
  );
}
