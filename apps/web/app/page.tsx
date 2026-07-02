"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WalletWidget } from "../components/WalletWidget";
import { ModeCard } from "../components/ModeCard";
import { HistoryList, type HistoryEntry } from "../components/HistoryList";
import { DiagPanel } from "../components/DiagPanel";
import { useIsMiniPay } from "../lib/useIsMiniPay";
import { getWalletAddress } from "../lib/wallet";
import { getUsdtBalance } from "../lib/balance";
import { waitForEthereum } from "../lib/waitForEthereum";
import { createDiagLog, type DiagEntry } from "../lib/diag";

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
  const [diagEntries, setDiagEntries] = useState<DiagEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    let accountsChangedHandler: ((accounts: unknown) => void) | null = null;
    const { entries, log } = createDiagLog();
    const publish = () => {
      if (!cancelled) setDiagEntries([...entries]);
    };

    async function loadBalance(reason: string) {
      log(`A.start reason=${reason}`, { isMiniPay });

      // MiniPay injects window.ethereum asynchronously — wait for it (or the
      // 3s timeout) before reading it, otherwise this can race the
      // injection and see no provider / no accounts.
      const waited = await waitForEthereum();
      const ethereum = window.ethereum;
      log("B.windowEthereum", {
        waited,
        present: !!ethereum,
        isMiniPayFlag: ethereum?.isMiniPay,
        hasRequest: typeof ethereum?.request === "function",
      });
      publish();

      let walletAddress: string | null = null;
      try {
        walletAddress =
          ethereum && typeof ethereum.request === "function"
            ? await getWalletAddress(
                {
                  request: ethereum.request,
                  enable: ethereum.enable,
                  selectedAddress: (ethereum as { selectedAddress?: string }).selectedAddress,
                },
                {
                  retries: 6,
                  delayMs: 500,
                  // Per-attempt trace so a device retest can show what
                  // the provider actually does between retries (without
                  // needing DevTools). Captures: timing, response shape,
                  // selectedAddress, enable() existence.
                  onTrace: (t) => {
                    log(
                      `B.trace a=${t.attempt} ${t.elapsedMs}ms ${t.resultKind}${t.resultLen !== undefined ? `(${t.resultLen})` : ""}`,
                      {
                        selectedAddress: t.selectedAddress,
                        enableExists: t.enableExists,
                        errMessage: t.errMessage,
                      },
                    );
                    publish();
                  },
                },
              )
            : null;
      } catch (e) {
        log("B.walletError", { message: (e as Error).message });
      }
      log("B.walletAddress", { walletAddress });
      publish();

      let balance: number | null = null;
      try {
        // Route the read through the injected provider (same as the
        // proven-working reference Mini App): forno.celo.org is blocked
        // by the MiniPay WebView's CORS policy, only the WebView's own
        // RPC over the injected provider reaches the chain reliably.
        if (ethereum?.request) {
          const requestFn: (args: { method: string; params?: unknown[] }) => Promise<unknown> =
            ethereum.request.bind(ethereum);
          balance = await getUsdtBalance(walletAddress, { request: requestFn });
        }
      } catch (e) {
        log("C.balanceError", { message: (e as Error).message });
      }
      log("C.balance", { balance });
      publish();

      if (!cancelled) {
        setBalanceUSD(balance ?? 0);
        setBalanceLoading(false);
      }
    }

    loadBalance("mount").catch((e) => {
      log("loadBalance.catch", { message: (e as Error).message });
      publish();
      if (!cancelled) setBalanceLoading(false);
    });

    // Subscribe to MiniPay's accountsChanged so a wallet switch in the
    // provider triggers a fresh balance read on the same screen.
    void waitForEthereum().then(() => {
      if (cancelled) return;
      const ethereum = window.ethereum as
        | (typeof window.ethereum & {
            on?: (event: string, handler: (...args: unknown[]) => void) => void;
          })
        | undefined;
      if (!ethereum?.on) return;
      accountsChangedHandler = () => {
        if (!cancelled) {
          setDiagEntries([]);
          loadBalance("accountsChanged").catch(() => {
            if (!cancelled) setBalanceLoading(false);
          });
        }
      };
      try {
        ethereum.on("accountsChanged", accountsChangedHandler as never);
      } catch {
        // provider doesn't support accountsChanged — fine.
      }
    });

    return () => {
      cancelled = true;
      if (accountsChangedHandler) {
        try {
          window.ethereum?.removeListener?.("accountsChanged", accountsChangedHandler as never);
        } catch {
          // ignore
        }
      }
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

      <DiagPanel entries={diagEntries} />
    </main>
  );
}
