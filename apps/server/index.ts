import { createServer as createHttpServer } from "node:http";
import { createPublicClient, fallback, http } from "viem";
import { celo } from "viem/chains";
import { SETTLEMENT_TOKEN_ADDRESS } from "@hexarena/shared/chain";
import { createServer } from "./server";
import { MemoryLedgerStore } from "./ledger/memoryStore";
import { validateTreasuryAddress } from "./indexEnv";

const httpServer = createHttpServer();
const store = new MemoryLedgerStore();

// PublicNode's Celo RPC has consistently lower propagation latency than
// forno.celo.org for new transactions, which is what /api/deposit depends
// on to confirm the receipt in time. Fall back to forno.celo.org if the
// operator doesn't override CELO_MAINNET_RPC_URL.
const rpcUrl = process.env.CELO_MAINNET_RPC_URL ?? "https://celo-rpc.publicnode.com";
const publicClient = createPublicClient({
  chain: celo,
  transport: fallback([
    http("https://celo-rpc.publicnode.com"),
    http("https://forno.celo.org"),
    http(rpcUrl),
  ]),
});

// Fail loud at boot if the treasury env is missing or malformed. We
// previously started with a 0x0…0 fallback and only surfaced the
// misconfiguration at request time as 'INVALID_TX / WrongRecipientError'.
// That delayed the obvious fix (paste the right address into Railway)
// for hours.
const treasuryAddress = validateTreasuryAddress(process.env.ARENA_TREASURY_ADDRESS ?? "");

const tokenAddress = SETTLEMENT_TOKEN_ADDRESS[42220];
if (!tokenAddress) {
  throw new Error("No settlement token configured for chain 42220 (Celo Mainnet)");
}

createServer(httpServer, store, {
  treasuryAddress,
  tokenAddress,
  publicClient,
  corsOrigin: process.env.ARENA_CORS_ORIGIN ?? "https://web-taupe-alpha-23.vercel.app",
});

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => {
  console.log(`hexarena server listening on :${port}`);
  console.log(`arena treasury: ${treasuryAddress}`);
  console.log(`primary RPC: celo-rpc.publicnode.com (fallback forno.celo.org)`);
});
