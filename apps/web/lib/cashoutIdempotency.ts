/**
 * Idempotency key storage for /api/cashout.
 *
 * Why a key per (wallet, amount, attempt) instead of a single rolling
 * key? Because a "Try again" click after a server-side failure
 * (e.g., CASHOUT_FAILED) means the user is starting a NEW attempt
 * with the same parameters. The server-side idempotency store treats
 * the same key + same amount as a replay, and would refuse to
 * re-execute — exactly what we DON'T want on a manual retry.
 *
 * Lifecycle:
 *   - getOrCreateIdempotencyKey() returns a uuid v4, persisting in
 *     localStorage so a page reload during a "pending" cashout
 *     doesn't accidentally re-broadcast.
 *   - clearIdempotencyKey() removes it on terminal states
 *     (CONFIRMED, CASHOUT_FAILED). On CONFIRMED the user already got
 *     their USDT — the next attempt must be a fresh key.
 *
 * Storage keys are namespaced under "hexarena.cashout.idempotency."
 * so they're easy to audit and don't collide with other features.
 *
 * Browser support: prefers `crypto.randomUUID()` (native in modern
 * Chrome/Safari/Firefox and inside MiniPay's WebView). Falls back to
 * a Math.random-based v4 generator for older runtimes — exported as
 * `generateUuidV4()` so the fallback itself is unit-tested.
 */

const STORAGE_PREFIX = "hexarena.cashout.idempotency.";

/**
 * Standard uuid v4 layout: 8-4-4-4-12 lowercase hex with version
 * nibble `4` and variant nibble in `[89ab]`. Mirrors the regex the
 * server enforces in apps/server/cashoutEndpoint.ts so a client
 * generating a key here can be confident the server will accept it.
 */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Returns a RFC 4122 v4 uuid using the browser's CSPRNG when
 * available. Falls back to Math.random — NOT cryptographically
 * strong but sufficient for a client-side cache key, where the only
 * requirement is uniqueness within the user's own session.
 */
export function generateUuidV4(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  // Fallback — RFC 4122 v4 layout, Math.random entropy.
  const hex = (n: number) =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(n, "0");
  const variantNibble = (8 + Math.floor(Math.random() * 4)).toString(16);
  return (
    hex(4) +
    hex(4) +
    "-" +
    hex(4) +
    "-" +
    "4" +
    hex(3) +
    "-" +
    variantNibble +
    hex(3) +
    "-" +
    hex(4) +
    hex(4) +
    hex(4)
  );
}

function storageKey(wallet: string, amountUSD: number, attempt: number): string {
  return `${STORAGE_PREFIX}${wallet}.${amountUSD}.${attempt}`;
}

/**
 * Returns the stored uuid for this (wallet, amount, attempt) tuple,
 * or generates and persists a fresh one if none is stored. Pass a
 * numeric `attempt` so retries are isolated from each other.
 *
 * Returns null if `localStorage` is unavailable (e.g., a test that
 * disabled it). In that case the dialog still has a fresh key to
 * submit — but a page reload mid-cashout would not survive.
 */
export function getOrCreateIdempotencyKey(args: {
  wallet: `0x${string}`;
  amountUSD: number;
  attempt: number;
}): string | null {
  const key = storageKey(args.wallet, args.amountUSD, args.attempt);
  try {
    if (typeof localStorage === "undefined") return null;
    const existing = localStorage.getItem(key);
    if (existing && UUID_V4_RE.test(existing)) {
      return existing;
    }
    const fresh = generateUuidV4();
    localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    // Quota errors, blocked storage, etc — non-fatal; we still have
    // a key in memory to submit, just not durable across reloads.
    return generateUuidV4();
  }
}

/**
 * Removes the stored key after a terminal state (CONFIRMED,
 * CASHOUT_FAILED) so the next attempt for the same parameters
 * gets a fresh key. Safe to call when nothing is stored.
 */
export function clearIdempotencyKey(args: {
  wallet: `0x${string}`;
  amountUSD: number;
  attempt: number;
}): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(storageKey(args.wallet, args.amountUSD, args.attempt));
  } catch {
    // ignore — best-effort cleanup
  }
}
