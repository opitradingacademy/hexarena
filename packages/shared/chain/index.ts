/**
 * Chain types/ABI placeholder for ArenaSettlement (Celo). Full ABI + verified
 * Mainnet address are published here once a REAL on-chain deploy runs
 * (Phase 5 — PR3 only wrote the contract, tests, and deploy script; no
 * transaction was broadcast). See design.md D1 (funding & access control)
 * and Folder Structure.
 */

// Celo Mainnet | Celo Sepolia testnet (chainId corrected from the
// deprecated Alfajores testnet id — Celo migrated its default public
// testnet to Sepolia; see packages/contracts/foundry.toml rpc_endpoints).
export type ChainId = 42220 | 11142220;

export type VerifiedAsset = "USDm" | "USDC" | "USDT";

/** Populated post-deploy (PR3/PR5). Empty placeholder for PR1. */
export const ARENA_SETTLEMENT_ADDRESS: Partial<Record<ChainId, `0x${string}`>> = {};

/** Populated post-deploy with the compiled contract ABI. Empty placeholder for PR1. */
export const ARENA_SETTLEMENT_ABI: readonly unknown[] = [];

export const SUPPORTED_ASSETS: readonly VerifiedAsset[] = ["USDm", "USDC", "USDT"];
