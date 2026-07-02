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
    return <div data-testid="wallet-widget-skeleton">Loading balance…</div>;
  }

  return (
    <div data-testid="wallet-widget">
      <span data-testid="wallet-balance">{formatUSD(balanceUSD)}</span>
      <button type="button">Add funds</button>
    </div>
  );
}
