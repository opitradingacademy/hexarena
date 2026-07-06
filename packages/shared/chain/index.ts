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
  // NOTE: This address WILL CHANGE after the "Cash out" feature (PR1 of the
  // cash-out change) redeploys ArenaSettlement with the new `withdrawUser`
  // function. PR0 ships the contract code + ABI fragment only — the address
  // update is intentionally deferred to PR1 (post-deploy) to avoid a window
  // where the web app points at a contract that doesn't exist yet on Mainnet.
  42220: "0x108E012C3B12421f216cA5C2C59770c34653e1d0",
};

/** Settlement token (USDT) on Celo Mainnet — matches ArenaSettlement's constructor arg. */
export const SETTLEMENT_TOKEN_ADDRESS: Partial<Record<ChainId, `0x${string}`>> = {
  42220: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
};

/**
 * USDT fee-currency adapter on Celo Mainnet (CIP-64). The MiniPay
 * provider accepts USDT-as-fee only via this adapter address — passing
 * the USDT token address directly as `feeCurrency` makes
 * `eth_estimateGas` revert with bare "execution reverted".
 * Verified against docs.minipay.xyz/technical-references/send-transaction
 * (token addresses table, "Uses Adapter?" column).
 */
export const FEE_CURRENCY_ADAPTER: Partial<Record<ChainId, `0x${string}`>> = {
  42220: "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72",
};

/**
 * ABI fragments for the on-chain ArenaSettlement entry points used by
 * apps/server. Keep these in lockstep with `packages/contracts/src/ArenaSettlement.sol`.
 *
 *   - `settle`         — operator pays the Arena match winner.
 *   - `withdrawUser`   — operator releases user cash-outs (idempotent per
 *                        `withdrawalId`). Added in PR0 of the cash-out
 *                        change; the on-chain address is unchanged in this
 *                        PR but WILL be redeployed in PR1.
 */
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
  {
    type: "function",
    name: "withdrawUser",
    inputs: [
      { name: "withdrawalId", type: "bytes32", internalType: "bytes32" },
      { name: "to", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const SUPPORTED_ASSETS: readonly VerifiedAsset[] = ["USDm", "USDC", "USDT"];
