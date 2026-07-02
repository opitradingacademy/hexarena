import { formatUSD } from "../lib/formatUSD";

export type WalletWidgetProps = {
  balanceUSD: number;
  loading?: boolean;
};

/**
 * Dashboard top-nav wallet widget (design.md wireframe "1. Dashboard").
 * Copy rule: balance MUST be shown in USD only — never CELO/token/0x.
 */
export function WalletWidget({ balanceUSD, loading = false }: WalletWidgetProps) {
  if (loading) {
    return (
      <div
        data-testid="wallet-widget-skeleton"
        className="h-9 w-32 animate-pulse rounded-full bg-arena-surface"
      >
        <span className="sr-only">Loading balance…</span>
      </div>
    );
  }

  return (
    <div
      data-testid="wallet-widget"
      className="flex items-center gap-2 rounded-full border border-arena-border bg-arena-surface px-3 py-1.5"
    >
      <span data-testid="wallet-balance" className="text-sm font-bold text-arena-green">
        {formatUSD(balanceUSD)}
      </span>
      <button
        type="button"
        className="rounded-full bg-arena-cyan/10 px-2 py-0.5 text-xs font-semibold text-arena-cyan"
      >
        Add funds
      </button>
    </div>
  );
}
