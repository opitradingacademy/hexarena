const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

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
 * address as ARENA_TREASURY_ADDRESS on the server side. Throws when the
 * env is missing or malformed so the UI surfaces a clear error rather
 * than encoding an invalid address into the on-chain transfer call
 * (which would silently revert on-chain and look like a MiniPay issue).
 */
export function getArenaTreasuryAddress(): `0x${string}` {
  const value = process.env.NEXT_PUBLIC_ARENA_TREASURY_ADDRESS ?? "";
  if (!HEX_ADDRESS_RE.test(value)) {
    throw new Error(
      `NEXT_PUBLIC_ARENA_TREASURY_ADDRESS is missing or malformed: '${value}'. ` +
        "Expected 0x + 40 hex chars. Set this in the Vercel project " +
        "environment to the operator address that will collect user stakes.",
    );
  }
  return value.toLowerCase() as `0x${string}`;
}
