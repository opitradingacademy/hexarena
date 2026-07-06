"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { CashoutDialog } from "../components/CashoutDialog";

/**
 * Dashboard screen (design.md wireframe "1. Dashboard").
 * Balance is read live from USDT on Celo Mainnet via the injected
 * MiniPay provider (see lib/useUsdtBalance for the resolver path)
 * and the HexArena game balance is read from the server ledger.
 */
export default function DashboardPage() {
  const router = useRouter();
  const { loading, balance, reload: refreshWalletBalance } = useUsdtBalance();
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

  // Cash-out step machine mirrors deposit: a "select" chip step and a
  // "confirm" dialog step that calls CashoutDialog (PR2). The amount
  // chips are intentionally identical to deposit so the user has a
  // familiar mental model — same chips, opposite direction.
  const [cashoutOpen, setCashoutOpen] = useState(false);
  const [cashoutStep, setCashoutStep] = useState<"select" | "confirm">("select");
  const [cashoutAmount, setCashoutAmount] = useState<number | null>(null);

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

  // Resolve the user's wallet address when the cash-out flow opens —
  // required by the X-Wallet-Address header on POST /api/cashout.
  // (Reuses the same resolver path as deposit; the wallet is the
  // same in either direction.)
  const [cashoutWallet, setCashoutWallet] = useState<`0x${string}` | null>(null);
  useEffect(() => {
    if (!cashoutOpen) return;
    let cancelled = false;
    (async () => {
      await waitForEthereum();
      if (cancelled) return;
      const ethereum = window.ethereum as Parameters<typeof getWalletAddress>[0] | undefined;
      const addr = await getWalletAddress(ethereum, { retries: 6, delayMs: 500 });
      if (!cancelled && addr) setCashoutWallet(addr as `0x${string}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [cashoutOpen]);

  async function handleDepositSuccess() {
    setDepositOpen(false);
    setSelectedAmount(null);
    setStep("select");
    // Trigger refreshing both server ledger and on-chain wallet balance
    await Promise.all([refreshGameBalance(), refreshWalletBalance()]);
  }

  async function handleCashoutSuccess() {
    setCashoutOpen(false);
    setCashoutStep("select");
    setCashoutAmount(null);
    // After a successful cash-out, the server ledger is debited and
    // the user's wallet is credited — both balances changed, refresh
    // both. Matches the deposit flow's pattern.
    await Promise.all([refreshGameBalance(), refreshWalletBalance()]);
  }

  // Compute the chip list for the cash-out step-1 modal. Mirrors the
  // deposit chips ($0.10, $0.25, $0.50, $1, $2) but only shows chips
  // the user can actually afford. Adds an "All" chip when there's at
  // least the minimum available — saves the user from typing
  // custom amounts (the deposit flow doesn't have one either, by
  // symmetry).
  const cashoutChips: Array<{ label: string; amount: number; testId: string }> = [];
  const presetAmounts = [0.1, 0.25, 0.5, 1.0, 2.0];
  for (const amount of presetAmounts) {
    if (amount <= gameBalance + 0.0001) {
      cashoutChips.push({
        label: formatUSD(amount),
        amount,
        testId: "cashout-chip",
      });
    }
  }
  if (gameBalance >= 0.1 && gameBalance > 2.0) {
    cashoutChips.push({
      label: `All (${formatUSD(gameBalance)})`,
      amount: gameBalance,
      testId: "cashout-chip-all",
    });
  }

  return (
    <main className="mx-auto max-w-md px-4 pt-6">
      <nav className="flex items-center justify-between">
        <span className="text-lg font-black uppercase tracking-widest text-arena-cyan">
          HexArena
        </span>
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
              data-testid="cashout-open"
              onClick={() => {
                setCashoutOpen(true);
                setCashoutStep("select");
              }}
              disabled={gameBalance <= 0}
              className="rounded-xl border border-arena-border px-4 py-2 text-xs font-bold uppercase text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
            >
              Cash out
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

      {/* Cash out Modal - Step 1: Select Amount */}
      {cashoutOpen && cashoutStep === "select" && (
        <div
          role="dialog"
          aria-modal
          data-testid="cashout-step1"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-sm rounded-2xl border border-arena-border bg-arena-bg p-6 text-slate-200 shadow-neonGold">
            <h2 className="text-lg font-black uppercase tracking-wider text-arena-gold">
              Cash out
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              Select how much of your Game Balance you want to move to your MiniPay wallet:
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {cashoutChips.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  data-testid={chip.testId}
                  onClick={() => {
                    setCashoutAmount(chip.amount);
                    setCashoutStep("confirm");
                  }}
                  className="rounded-xl border border-arena-border bg-arena-surface py-3 text-sm font-bold transition hover:border-arena-gold text-white hover:bg-slate-800"
                >
                  {chip.label}
                </button>
              ))}
            </div>
            {gameBalance > 0 && gameBalance < 0.1 && (
              <p data-testid="cashout-below-min" className="mt-3 text-xs text-arena-gold">
                Minimum cash out is $0.10. You currently have {formatUSD(gameBalance)}.
              </p>
            )}
            {gameBalance === 0 && (
              <p data-testid="cashout-empty" className="mt-3 text-xs text-slate-400">
                No Game Balance to cash out.
              </p>
            )}
            <button
              type="button"
              data-testid="cashout-step1-cancel"
              onClick={() => {
                setCashoutOpen(false);
                setCashoutStep("select");
                setCashoutAmount(null);
              }}
              className="mt-6 w-full rounded-xl border border-arena-border py-2.5 text-xs font-bold uppercase text-slate-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Cash out Modal - Step 2: Confirm (server signs the on-chain tx) */}
      {cashoutOpen && cashoutStep === "confirm" && cashoutAmount !== null && cashoutWallet && (
        <CashoutDialog
          open={cashoutOpen && cashoutStep === "confirm"}
          amountUSD={cashoutAmount}
          wallet={cashoutWallet}
          gameBalanceUSD={gameBalance}
          onClose={() => {
            setCashoutOpen(false);
            setCashoutStep("select");
            setCashoutAmount(null);
          }}
          onSuccess={handleCashoutSuccess}
        />
      )}
    </main>
  );
}
