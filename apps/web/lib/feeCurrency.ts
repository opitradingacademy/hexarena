/**
 * CIP-64 fee abstraction (Celo) — maps a supported stablecoin to its
 * fee-currency adapter address, used as the `feeCurrency` field on a viem
 * transaction so the user pays the "network fee" (never the copy word "gas")
 * in a stablecoin instead of CELO. USDm is MiniPay's default fee currency.
 *
 * These are FEE-CURRENCY ADAPTER addresses (Celo's CIP-64 mechanism), which
 * are distinct from the plain ERC20 token addresses used elsewhere (e.g. the
 * ArenaSettlement custody token in packages/shared/chain) — do not conflate
 * the two address spaces.
 *
 * NOTE: MiniPay only supports legacy transactions — callers building the
 * transaction MUST NOT set maxFeePerGas/maxPriorityFeePerGas alongside
 * feeCurrency.
 */
export type SupportedFeeAsset = "USDm" | "USDC" | "USDT";

const FEE_CURRENCY_ADDRESSES: Record<SupportedFeeAsset, `0x${string}`> = {
  USDm: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
  USDC: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
  USDT: "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72",
};

export function getFeeCurrencyAddress(asset: SupportedFeeAsset): `0x${string}` {
  const address = FEE_CURRENCY_ADDRESSES[asset];
  if (!address) {
    throw new Error(`Unsupported fee currency asset: ${String(asset)}`);
  }
  return address;
}

/**
 * Builds the partial transaction config carrying the `feeCurrency` field
 * viem uses for CIP-64 fee abstraction. Never sets EIP-1559 fee fields —
 * MiniPay only supports legacy transactions.
 */
export function buildFeeAbstractionConfig(asset: SupportedFeeAsset = "USDm") {
  return {
    feeCurrency: getFeeCurrencyAddress(asset),
  } as const;
}
