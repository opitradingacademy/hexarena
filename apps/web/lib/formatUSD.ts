/**
 * Balance/amount formatting. Copy rule (minipay-client spec, "Crypto/Gas-Free
 * Copy"): balances MUST be denominated in USD, never CELO/token ticker/0x
 * address. This is the ONLY formatter screens should use for money values.
 */
export function formatUSD(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  return `${sign}$${abs.toFixed(2)}`;
}
