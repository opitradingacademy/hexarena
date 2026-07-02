/**
 * Resolves the apps/server base URL for both Socket.IO and the
 * /api/deposit REST endpoint. Next.js only exposes env vars prefixed
 * `NEXT_PUBLIC_` to client bundles — see `.env.example`.
 */
export function getServerUrl(): string {
  return process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";
}

export function getDepositUrl(): string {
  return `${getServerUrl()}/api/deposit`;
}

/**
 * Operator/treasury address that receives user Arena stakes. Same
 * address as ARENA_TREASURY_ADDRESS on the server side. The contract
 * itself is funded separately via ArenaSettlement.fund() — this is
 * just the wallet that collects user stake txs at match-search time.
 */
export function getArenaTreasuryAddress(): `0x${string}` {
  return (process.env.NEXT_PUBLIC_ARENA_TREASURY_ADDRESS ??
    "0x0000000000000000000000000000000000000000") as `0x${string}`;
}
