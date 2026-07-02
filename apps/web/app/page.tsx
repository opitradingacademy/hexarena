"use client";

import Link from "next/link";
import { useState } from "react";
import { WalletWidget } from "../components/WalletWidget";
import { ModeCard } from "../components/ModeCard";
import { HistoryList, type HistoryEntry } from "../components/HistoryList";
import { useIsMiniPay } from "../lib/useIsMiniPay";

/**
 * Dashboard screen (design.md wireframe "1. Dashboard").
 * Structural implementation for PR4 — real balance/history fetching from
 * apps/server wires up in PR5 e2e integration; state here is local/mocked.
 */
export default function DashboardPage() {
  const isMiniPay = useIsMiniPay();
  const [balanceUSD] = useState(0);
  const [recentMatches] = useState<HistoryEntry[]>([]);

  return (
    <main>
      <nav>
        <span>HexArena</span>
        <WalletWidget balanceUSD={balanceUSD} />
      </nav>

      {!isMiniPay && <p role="note">Open this app inside MiniPay for the best experience.</p>}

      <section>
        <ModeCard mode="CASUAL" balanceUSD={balanceUSD} />
        <ModeCard mode="ARENA" balanceUSD={balanceUSD} />
      </section>

      <section>
        <h3>Recent matches</h3>
        <HistoryList entries={recentMatches} />
      </section>

      <nav>
        <Link href="/">Home</Link>
        <Link href="/matchmaking">Play</Link>
        <Link href="/history">History</Link>
      </nav>
    </main>
  );
}
