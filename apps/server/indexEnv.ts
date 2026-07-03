/**
 * Boot-time environment validation. Extracted from index.ts so the
 * validation rule can be unit-tested without spinning up the full
 * HTTP server.
 *
 * Why this exists: a malformed ARENA_TREASURY_ADDRESS (e.g. 32 bytes
 * instead of 20) used to silently pass through, leaving the user to
 * discover the bug downstream as an on-chain 'execution reverted'
 * with no clue what the actual problem was. Fail loud at boot now.
 */

const HEX_RE = /^0x[0-9a-fA-F]{40}$/;

export function validateTreasuryAddress(value: string): `0x${string}` {
  if (!value) {
    throw new Error(
      "ARENA_TREASURY_ADDRESS is empty. Set the env to your 20-byte " +
        "operator address (e.g. 0x followed by 40 hex chars).",
    );
  }
  if (!value.startsWith("0x")) {
    throw new Error(
      `ARENA_TREASURY_ADDRESS is missing 0x prefix: '${value}'. ` +
        "Expected format: 0x + 40 hex chars.",
    );
  }
  if (value.length !== 42) {
    throw new Error(
      `ARENA_TREASURY_ADDRESS has wrong length (${value.length} chars, ` +
        "expected 42 — 20 bytes / 40 hex chars after the 0x prefix). " +
        "Check that the address isn't missing chars or has extra characters " +
        "(e.g. a private key's hex leaked in, or a 32-byte public key).",
    );
  }
  if (!HEX_RE.test(value)) {
    throw new Error(
      `ARENA_TREASURY_ADDRESS contains non-hex characters: '${value}'. ` +
        "Addresses are 0x + 40 hex chars exactly.",
    );
  }
  return value.toLowerCase() as `0x${string}`;
}
