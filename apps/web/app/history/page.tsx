"use client";

import { useEffect, useState } from "react";
import { HistoryList, type HistoryEntry } from "../../components/HistoryList";
import { getSocket } from "../../lib/socketSingleton";
import { getServerUrl } from "../../lib/serverUrl";

type ServerMatch = {
  id: string;
  mode: "CASUAL" | "ARENA";
  p1: string;
  p2: string;
  winner: string | null;
  stake: number;
  createdAt: number;
};

function toHistoryEntry(match: ServerMatch, selfUserId: string): HistoryEntry {
  const opponentAlias = match.p1 === selfUserId ? match.p2 : match.p1;
  const result: HistoryEntry["result"] =
    match.winner === null ? "DRAW" : match.winner === selfUserId ? "WIN" : "LOSE";
  const amountUSD =
    match.mode === "CASUAL"
      ? 0
      : result === "WIN"
        ? match.stake * 0.8
        : result === "DRAW"
          ? -match.stake * 0.2
          : -match.stake;

  return {
    matchId: match.id,
    date: new Date(match.createdAt).toISOString().slice(0, 10),
    mode: match.mode,
    opponentAlias,
    result,
    amountUSD,
  };
}

/**
 * History screen (design.md wireframe "4. Result / History").
 * Fetches real match history from apps/server's GET /matches/:userId
 * endpoint (task 2.14) once the socket is connected and its id is known.
 */
export default function HistoryPage() {
  const [filter, setFilter] = useState<"ALL" | "CASUAL" | "ARENA">("ALL");
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    async function loadHistory() {
      const selfUserId = socket.id;
      if (!selfUserId) return;
      const res = await fetch(`${getServerUrl()}/matches/${selfUserId}`);
      const matches = (await res.json()) as ServerMatch[];
      setEntries(matches.map((m) => toHistoryEntry(m, selfUserId)));
    }

    if (socket.connected) void loadHistory();
    socket.on("connect", loadHistory);
    return () => {
      socket.off("connect", loadHistory);
    };
  }, []);

  const filtered = entries.filter((e) => filter === "ALL" || e.mode === filter);

  const FILTERS = [
    { key: "ALL", label: "All" },
    { key: "CASUAL", label: "Casual" },
    { key: "ARENA", label: "Arena" },
  ] as const;

  return (
    <main className="mx-auto max-w-md px-4 pt-6">
      <h2 className="text-lg font-black uppercase tracking-widest text-arena-cyan">History</h2>
      <div className="mt-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-4 py-1.5 text-sm font-bold transition ${
              filter === f.key
                ? "border-arena-cyan bg-arena-cyan text-arena-bg"
                : "border-arena-border text-slate-400"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        <HistoryList entries={filtered} />
      </div>
    </main>
  );
}
