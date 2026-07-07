"use client";

import { useEffect, useState } from "react";
import { getAddress } from "viem";
import { HistoryList, type HistoryEntry } from "../../components/HistoryList";
import { getServerUrl } from "../../lib/serverUrl";
import { waitForEthereum } from "../../lib/waitForEthereum";
import { getWalletAddress } from "../../lib/wallet";

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
 *
 * Resolves the user's wallet address (EIP-55 checksummed via viem's
 * getAddress, matching the casing the server stores in the ledger and
 * uses as `userId`) and fetches their match history via
 * GET /matches/:userId.
 *
 * Why we don't use socket.id: the server stores matches keyed by the
 * authenticated wallet, not by the socket id. Reading socket.id would
 * always return an empty list — the original implementation bug.
 */
export default function HistoryPage() {
  const [filter, setFilter] = useState<"ALL" | "CASUAL" | "ARENA">("ALL");
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selfAddress, setSelfAddress] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolveWallet() {
      await waitForEthereum();
      if (cancelled) return;
      const ethereum = window.ethereum as Parameters<typeof getWalletAddress>[0] | undefined;
      const raw = await getWalletAddress(ethereum, { retries: 6, delayMs: 500 });
      if (cancelled) return;
      if (raw) {
        try {
          setSelfAddress(getAddress(raw));
        } catch {
          setSelfAddress(raw);
        }
      }
    }

    void resolveWallet();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selfAddress) return;
    let cancelled = false;

    async function loadHistory() {
      try {
        const res = await fetch(`${getServerUrl()}/matches/${selfAddress}`);
        if (!res.ok) return;
        const matches = (await res.json()) as ServerMatch[];
        if (!cancelled) {
          setEntries(matches.map((m) => toHistoryEntry(m, selfAddress!)));
        }
      } catch {
        // network blip — leave previous entries in place
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [selfAddress]);

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
