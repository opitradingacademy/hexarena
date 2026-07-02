"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WalletWidget } from "../components/WalletWidget";
import { ModeCard } from "../components/ModeCard";
import { HistoryList, type HistoryEntry } from "../components/HistoryList";
import { useIsMiniPay } from "../lib/useIsMiniPay";
import { getWalletAddress } from "../lib/wallet";
import { getCeloPublicClient, getUsdtBalance } from "../lib/balance";
import { waitForEthereum } from "../lib/waitForEthereum";

/**
 * Dashboard screen (design.md wireframe "1. Dashboard").
 * Balance is read live from USDT on Celo Mainnet; history fetching from
 * apps/server still wires up in PR5 e2e integration.
 */
export default function DashboardPage() {
  const router = useRouter();
  const isMiniPay = useIsMiniPay();
  const [balanceUSD, setBalanceUSD] = useState(0);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [recentMatches] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadBalance() {
      const diag = (label: string, payload?: unknown) =>
        // Prefixed for easy grep in minipay-debug logs.
        console.log("[HexArena:diag]", label, payload ?? "");

      diag("A.isMiniPay", { isMiniPay });

      // MiniPay injects window.ethereum asynchronously — wait for it (or the
      // 3s timeout) before reading it, otherwise this can race the
      // injection and see no provider / no accounts.
      const waited = await waitForEthereum();
      const ethereum = window.ethereum;
      diag("B.windowEthereum", {
        waited,
        present: !!ethereum,
        isMiniPayFlag: ethereum?.isMiniPay,
        hasRequest: typeof ethereum?.request === "function",
      });

      let walletAddress: string | null = null;
      try {
        walletAddress =
          ethereum && typeof ethereum.request === "function"
            ? await getWalletAddress({
                request: ethereum.request,
                enable: ethereum.enable,
              })
            : null;
      } catch (e) {
        diag("B.walletError", { message: (e as Error).message });
      }
      diag("B.walletAddress", { walletAddress });

      let balance: number | null = null;
      try {
        balance = await getUsdtBalance(walletAddress, getCeloPublicClient());
      } catch (e) {
        diag("C.balanceError", { message: (e as Error).message });
      }
      diag("C.balance", { balance });

      if (!cancelled) {
        setBalanceUSD(balance ?? 0);
        setBalanceLoading(false);
      }
    }

    loadBalance().catch((e) => {
      console.log("[HexArena:diag] loadBalance.catch", (e as Error).message);
      if (!cancelled) setBalanceLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-md px-4 pt-6">
      <nav className="flex items-center justify-between">
        <span className="text-lg font-black uppercase tracking-widest text-arena-cyan">
          HexArena
        </span>
        <WalletWidget balanceUSD={balanceUSD} loading={balanceLoading} />
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
        <ModeCard
          mode="CASUAL"
          balanceUSD={balanceUSD}
          onPlay={() => router.push("/matchmaking")}
        />
        <ModeCard
          mode="ARENA"
          balanceUSD={balanceUSD}
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
