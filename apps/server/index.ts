import { createServer as createHttpServer } from "node:http";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { createServer } from "./server";
import { MemoryLedgerStore } from "./ledger/memoryStore";
import { validateTreasuryAddress } from "./indexEnv";

const httpServer = createHttpServer();
const store = new MemoryLedgerStore();

const rpcUrl = process.env.CELO_MAINNET_RPC_URL ?? "https://forno.celo.org";
const publicClient = createPublicClient({ chain: celo, transport: http(rpcUrl) });

// Fail loud at boot if the treasury env is missing or malformed. We
// previously started with a 0x0…0 fallback and only surfaced the
// misconfiguration at request time as 'INVALID_TX / WrongRecipientError'.
// That delayed the obvious fix (paste the right address into Railway)
// for hours.
const treasuryAddress = validateTreasuryAddress(process.env.ARENA_TREASURY_ADDRESS ?? "");

createServer(httpServer, store, {
  treasuryAddress,
  publicClient,
  corsOrigin: process.env.ARENA_CORS_ORIGIN ?? "https://web-taupe-alpha-23.vercel.app",
});

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => {
  console.log(`hexarena server listening on :${port}`);
  console.log(`arena treasury: ${treasuryAddress}`);
});
