import { createServer as createHttpServer } from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, fallback, http } from "viem";
import { celo } from "viem/chains";
import { SETTLEMENT_TOKEN_ADDRESS } from "@hexarena/shared/chain";
import { createServer } from "./server";
import { MemoryLedgerStore } from "./ledger/memoryStore";
import { SqliteLedgerStore } from "./ledger/sqliteStore";
import { validateTreasuryAddress, validateOperatorPrivateKey } from "./indexEnv";
import { withdrawUsdtOnChain } from "./chain/withdraw";

const httpServer = createHttpServer();

// Production 2026-07-03 fix: the in-memory store wiped every credited
// balance on each Railway redeploy, which drove the modal-loop (every
// new tx signed by the user was being treated as the FIRST deposit,
// because the server "forgot" the earlier ones). Switch to SQLite
// behind the same LedgerStore interface; only the boot path changes.
//
// To enable persistence across deploys, set SQLITE_PATH to a path on
// a persistent Railway volume (e.g. /data/hexarena.db if you mount a
// volume at /data). The default /tmp/hexarena.db IS writable but
// ephemeral — it survives the lifetime of a container but is wiped on
// every redeploy. Once a Railway Pro volume is configured, set the
// env var and the migration story is just "point at a path".
const sqlitePath = process.env.SQLITE_PATH ?? "/tmp/hexarena.db";
let store;
if (process.env.LEDGER_BACKEND === "memory") {
  store = new MemoryLedgerStore();
  console.log("using in-memory ledger (LEDGER_BACKEND=memory)");
} else if (existsSync(dirname(sqlitePath)) || canCreateDir(dirname(sqlitePath))) {
  store = new SqliteLedgerStore(sqlitePath);
  console.log(`using sqlite ledger at ${sqlitePath}`);
} else {
  console.log(
    `cannot write to ${dirname(sqlitePath)}, falling back to memory ` +
      `ledger. set LEDGER_BACKEND=memory to silence this.`,
  );
  store = new MemoryLedgerStore();
}

function canCreateDir(path: string): boolean {
  try {
    mkdirSync(path, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

// PublicNode's Celo RPC has consistently lower propagation latency than
// forno.celo.org for new transactions, which is what /api/deposit depends
// on to confirm the receipt in time. Fall back to forno.celo.org if the
// operator doesn't override CELO_MAINNET_RPC_URL.
//
// Production 2026-07-03: viem's default `http()` transport has no
// per-request timeout cap, and `fallback()` chains up to 3 retries
// per transport with exponential backoff. That means a single
// hung RPC could stall a /api/deposit request for >5 minutes —
// longer than the entire event loop can absorb without external
// requests piling up. Cap each transport at 4 seconds so the worst
// case per poll is bounded.
const rpcUrl = process.env.CELO_MAINNET_RPC_URL ?? "https://celo-rpc.publicnode.com";
const publicClient = createPublicClient({
  chain: celo,
  transport: fallback(
    [
      http("https://celo-rpc.publicnode.com", { timeout: 4_000 }),
      http("https://forno.celo.org", { timeout: 4_000 }),
      http(rpcUrl, { timeout: 4_000 }),
    ],
    { retryCount: 1 },
  ),
});

// Explicit second public client for forno so it runs IN PARALLEL with
// publicNode on every receipt poll, not just as a sequential fallback.
// viem's `fallback()` only falls over on transport errors — when an RPC
// returns null for a tx it hasn't seen yet (the production case),
// fallback accepts that null and never asks the next transport. Having
// forno as a separate client means every poll tries both and takes the
// first non-null receipt, so the modal never blocks on whichever RPC
// happens to be slowest on a given day.
const fornoClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org", { timeout: 4_000 }),
});

// Fail loud at boot if the treasury env is missing or malformed. We
// previously started with a 0x0…0 fallback and only surfaced the
// misconfiguration at request time as 'INVALID_TX / WrongRecipientError'.
// That delayed the obvious fix (paste the right address into Railway)
// for hours.
const treasuryAddress = validateTreasuryAddress(process.env.ARENA_TREASURY_ADDRESS ?? "");

// PR1: same fail-loud posture for the operator signing key (used by
// both settle() and withdrawUser()). Without this key the cash-out
// endpoint can't sign anything — fail at boot, not at request time.
validateOperatorPrivateKey(process.env.OPERATOR_PRIVATE_KEY);

const tokenAddress = SETTLEMENT_TOKEN_ADDRESS[42220];
if (!tokenAddress) {
  throw new Error("No settlement token configured for chain 42220 (Celo Mainnet)");
}

createServer(httpServer, store, {
  treasuryAddress,
  tokenAddress,
  publicClient,
  extraPublicClients: [fornoClient],
  corsOrigin: process.env.ARENA_CORS_ORIGIN ?? "https://web-taupe-alpha-23.vercel.app",
  withdrawFn: withdrawUsdtOnChain,
});

const port = Number(process.env.PORT ?? 3001);
// Pin to 0.0.0.0 so Railway's HTTP proxy can reach the listener.
// Production 2026-07-03 — multiple observations from Railway logs /
// tcp dump:
//   1. Default listen() on Node 22 defaults to IPv6 wildcard (::), not
//      IPv4. Railway's HTTP proxy speaks IPv4 to the container → silent
//      hang. Fixed by pinning to 0.0.0.0.
//   2. Even after the pin, Railway reports 'Online' + 'listening
//      log fires', but external requests still hang. Possible cause is
//      a bind to a single interface that's not reachable from the
//      proxy's pod-local subnet. Logging the listen address confirms.
httpServer.listen(port, "0.0.0.0", () => {
  const addr = httpServer.address();
  const info = typeof addr === "object" && addr !== null ? addr : { address: "?", port };
  console.log(`hexarena server listening on ${info.address}:${info.port}`);
  console.log(`arena treasury: ${treasuryAddress}`);
  console.log(`primary RPC: celo-rpc.publicnode.com (fallback forno.celo.org)`);
});
