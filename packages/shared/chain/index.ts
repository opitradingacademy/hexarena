/**
 * Chain types/ABI for ArenaSettlement (Celo). `ArenaSettlement` is deployed
 * to Celo Mainnet as of PR5 — see design.md D1 (funding & access control)
 * and Folder Structure.
 */

// Celo Mainnet | Celo Sepolia testnet (chainId corrected from the
// deprecated Alfajores testnet id — Celo migrated its default public
// testnet to Sepolia; see packages/contracts/foundry.toml rpc_endpoints).
export type ChainId = 42220 | 11142220;

export type VerifiedAsset = "USDm" | "USDC" | "USDT";

export const ARENA_SETTLEMENT_ADDRESS: Partial<Record<ChainId, `0x${string}`>> = {
  42220: "0x108E012C3B12421f216cA5C2C59770c34653e1d0",
};

/** Settlement token (USDT) on Celo Mainnet — matches ArenaSettlement's constructor arg. */
export const SETTLEMENT_TOKEN_ADDRESS: Partial<Record<ChainId, `0x${string}`>> = {
  42220: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
};

/**
 * Fee-currency adapter addresses on Celo Mainnet (CIP-64). These are the
 * addresses MiniPay's provider uses when a Mini App passes `feeCurrency` in
 * its transaction params. Each token has its own adapter; passing the
 * token address directly as `feeCurrency` makes `eth_estimateGas`
 * unconditionally revert with "execution reverted" because the token
 * contract is not a recognised Celo gas-token adapter.
 *
 * Addresses verified against docs.minipay.xyz/technical-references/send-transaction
 * (token addresses table, "Uses Adapter?" column).
 */
export const FEE_CURRENCY_ADAPTER: Partial<Record<ChainId, `0x${string}`>> = {
  42220: "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72", // USDT adapter on Celo Mainnet
};

/** `settle(bytes32 matchId, address winner, uint256 amount)` — the only ABI fragment apps/server calls. */
export const ARENA_SETTLEMENT_ABI = [
  {
    type: "function",
    name: "settle",
    inputs: [
      { name: "matchId", type: "bytes32", internalType: "bytes32" },
      { name: "winner", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const SUPPORTED_ASSETS: readonly VerifiedAsset[] = ["USDm", "USDC", "USDT"];
