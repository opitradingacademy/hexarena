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

/**
 * Boot-time check for OPERATOR_PRIVATE_KEY. The cash-out feature (PR1)
 * needs a real signer; the previous settle() flow also used this key
 * but failed open at boot. We now fail loud at boot if it's missing,
 * mirroring the treasury-address validation above. The cashout
 * endpoint additionally reads `process.env.OPERATOR_PRIVATE_KEY` at
 * request time and returns CONFIG_ERROR if it disappears between
 * boot and runtime — defense in depth.
 *
 * Format: 0x + 64 hex chars (32-byte secp256k1 private key).
 */
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

export function validateOperatorPrivateKey(value: string | undefined): `0x${string}` {
  if (!value) {
    throw new Error(
      "OPERATOR_PRIVATE_KEY is empty. Set the env to the 32-byte " +
        "operator signing key (0x + 64 hex chars). Without it, /api/cashout " +
        "and the on-chain settle() path cannot sign transactions.",
    );
  }
  if (!PRIVATE_KEY_RE.test(value)) {
    throw new Error(
      `OPERATOR_PRIVATE_KEY has wrong shape (length=${value.length}). ` +
        "Expected 0x + 64 hex chars (32-byte secp256k1 key).",
    );
  }
  return value as `0x${string}`;
}
