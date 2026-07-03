"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { WalletWidget } from "../components/WalletWidget";
import { ModeCard } from "../components/ModeCard";
import { HistoryList, type HistoryEntry } from "../components/HistoryList";
import { useIsMiniPay } from "../lib/useIsMiniPay";
import { useUsdtBalance } from "../lib/useUsdtBalance";
import { useServerLedger } from "../lib/useServerLedger";
import { formatUSD } from "../lib/formatUSD";
import { getArenaTreasuryAddress, getDepositUrl } from "../lib/serverUrl";
import { getWalletAddress } from "../lib/wallet";
import { waitForEthereum } from "../lib/waitForEthereum";
import { StakeConfirmDialog } from "../components/StakeConfirmDialog";

/**
 * Dashboard screen (design.md wireframe "1. Dashboard").
 * Balance is read live from USDT on Celo Mainnet via the injected
 * MiniPay provider (see lib/useUsdtBalance for the resolver path)
 * and the HexArena game balance is read from the server ledger.
 */
export default function DashboardPage() {
  const router = useRouter();
  const { loading, balance, refresh: refreshWalletBalance } = useUsdtBalance();
  const {
    balance: gameBalance,
    loading: gameLoading,
    refresh: refreshGameBalance,
  } = useServerLedger(process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001");
  const isMiniPay = useIsMiniPay();
  const recentMatches: HistoryEntry[] = [];

  const [depositOpen, setDepositOpen] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [step, setStep] = useState<"select" | "confirm">("select");
  const [senderAddress, setSenderAddress] = useState<`0x${string}` | null>(null);

  // Resolve sender wallet address dynamically when the deposit flow starts
  useEffect(() => {
    if (!depositOpen) return;
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
  }, [depositOpen]);

  async function handleDepositSuccess() {
    setDepositOpen(false);
    setSelectedAmount(null);
    setStep("select");
    // Trigger refreshing both server ledger and on-chain wallet balance
    await Promise.all([refreshGameBalance(), refreshWalletBalance()]);
  }

  return (
    <main className="mx-auto max-w-md px-4 pt-6">
      <nav className="flex items-center justify-between">
        <span className="text-lg font-black uppercase tracking-widest text-arena-cyan">
          HexArena
        </span>
        <WalletWidget
          balanceUSD={balance}
          loading={loading}
          onAddFunds={() => {
            setDepositOpen(true);
            setStep("select");
          }}
        />
      </nav>

      {!isMiniPay && (
        <p
          role="note"
          className="mt-4 rounded-xl border border-arena-gold/40 bg-arena-gold/10 px-4 py-2 text-sm text-arena-gold"
        >
          Open this app inside MiniPay for the best experience.
        </p>
      )}

      {/* Balance Card Container */}
      <section className="mt-6 rounded-2xl border border-arena-border bg-arena-surface p-5 shadow-neonGold/5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-400">
              Game Balance
            </h2>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-3xl font-black tracking-tight text-arena-gold">
                {gameLoading ? "..." : formatUSD(gameBalance)}
              </span>
              <span className="text-xs font-bold text-slate-500 uppercase">USD</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Deposited & ready to play Arena instantly.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setDepositOpen(true);
                setStep("select");
              }}
              className="rounded-xl bg-arena-magenta px-4 py-2 text-xs font-bold uppercase text-white shadow-neonMagenta transition hover:opacity-90"
            >
              Deposit
            </button>
            <button
              type="button"
              onClick={() => {
                alert(
                  "Withdrawals will be settled to your MiniPay wallet. Contact support for manual withdrawal of test funds.",
                );
              }}
              className="rounded-xl border border-arena-border px-4 py-2 text-xs font-bold uppercase text-slate-300 transition hover:bg-slate-800"
            >
              Withdraw
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-arena-border/50 pt-3 text-xs text-slate-400">
          <span>Wallet Balance (MiniPay)</span>
          <span className="font-bold text-arena-green">
            {loading ? "Loading..." : formatUSD(balance)}
          </span>
        </div>
      </section>

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

      {/* Deposit Modal - Step 1: Select Amount */}
      {depositOpen && step === "select" && (
        <div
          role="dialog"
          aria-modal
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-sm rounded-2xl border border-arena-border bg-arena-bg p-6 text-slate-200 shadow-neonMagenta">
            <h2 className="text-lg font-black uppercase tracking-wider text-arena-cyan">
              Deposit Funds
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              Select how much USD you want to load from your wallet into the game:
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[0.1, 0.25, 0.5, 1.0, 2.0].map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => {
                    setSelectedAmount(amount);
                    setStep("confirm");
                  }}
                  className="rounded-xl border border-arena-border bg-arena-surface py-3 text-sm font-bold transition hover:border-arena-cyan text-white hover:bg-slate-800"
                >
                  {formatUSD(amount)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setDepositOpen(false)}
              className="mt-6 w-full rounded-xl border border-arena-border py-2.5 text-xs font-bold uppercase text-slate-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Deposit Modal - Step 2: Confirm Transaction */}
      {depositOpen && step === "confirm" && selectedAmount !== null && senderAddress && (
        <StakeConfirmDialog
          open={depositOpen && step === "confirm"}
          stakeUSD={selectedAmount}
          treasury={getArenaTreasuryAddress()}
          senderAddress={senderAddress}
          depositServerUrl={getDepositUrl()}
          onClose={() => {
            setDepositOpen(false);
            setSelectedAmount(null);
            setStep("select");
          }}
          onSuccess={handleDepositSuccess}
        />
      )}
    </main>
  );
}
