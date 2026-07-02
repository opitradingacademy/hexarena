"use client";

import { useState } from "react";
import type { GameMode } from "@hexarena/shared/protocol";
import { StakeSelector } from "../../components/StakeSelector";

/**
 * Matchmaking screen (design.md wireframe "2. Matchmaking Queue").
 * Socket.IO wiring (join_queue/cancel_queue) is stubbed with local state
 * here — real connection to a running apps/server instance is PR5 e2e work.
 */
export default function MatchmakingPage() {
  const [mode, setMode] = useState<GameMode>("CASUAL");
  const [stake, setStake] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "searching" | "cancelled">("idle");
  const balanceUSD = 0;

  function handleSearch() {
    setStatus("searching");
    // join_queue({ mode, stake: mode === "ARENA" ? stake ?? undefined : undefined })
    // wired against a live server connection in PR5.
  }

  function handleCancel() {
    setStatus("cancelled");
  }

  return (
    <main>
      <header>
        <button type="button" aria-pressed={mode === "CASUAL"} onClick={() => setMode("CASUAL")}>
          Casual
        </button>
        <button type="button" aria-pressed={mode === "ARENA"} onClick={() => setMode("ARENA")}>
          Arena
        </button>
      </header>

      {mode === "ARENA" && (
        <StakeSelector balanceUSD={balanceUSD} selectedStake={stake} onSelect={setStake} />
      )}

      {status === "searching" ? (
        <div>
          <p>Searching for opponent…</p>
          <button type="button" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={handleSearch} disabled={mode === "ARENA" && stake == null}>
          Find match
        </button>
      )}
    </main>
  );
}
