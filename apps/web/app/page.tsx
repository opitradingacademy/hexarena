"use client";

import { useRouter } from "next/navigation";
import { WalletWidget } from "../components/WalletWidget";
import { ModeCard } from "../components/ModeCard";
import { HistoryList, type HistoryEntry } from "../components/HistoryList";
import { useIsMiniPay } from "../lib/useIsMiniPay";
import { useUsdtBalance } from "../lib/useUsdtBalance";

/**
 * Dashboard screen (design.md wireframe "1. Dashboard").
 * Balance is read live from USDT on Celo Mainnet via the injected
 * MiniPay provider (see lib/useUsdtBalance for the resolver path).
 */
export default function DashboardPage() {
  const router = useRouter();
  const { loading, balance } = useUsdtBalance();
  const isMiniPay = useIsMiniPay();
  const recentMatches: HistoryEntry[] = [];

  return (
    <main className="mx-auto max-w-md px-4 pt-6">
      <nav className="flex items-center justify-between">
        <span className="text-lg font-black uppercase tracking-widest text-arena-cyan">
          HexArena
        </span>
        <WalletWidget balanceUSD={balance} loading={loading} />
      </nav>

      {!isMiniPay && (
        <p
          role="note"
          className="mt-4 rounded-xl border border-arena-gold/40 bg-arena-gold/10 px-4 py-2 text-sm text-arena-gold"
        >
          Open this app inside MiniPay for the best experience.
        </p>
      )}

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ModeCard mode="CASUAL" balanceUSD={balance} onPlay={() => router.push("/matchmaking")} />
        <ModeCard
          mode="ARENA"
          balanceUSD={balance}
          onPlay={() => router.push("/matchmaking?mode=arena")}
        />
      </section>

      <section className="mt-8">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400">Recent matches</h3>
        <div className="mt-3">
          <HistoryList entries={recentMatches} />
        </div>
      </section>
    </main>
  );
}
