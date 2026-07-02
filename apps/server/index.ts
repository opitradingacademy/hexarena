import { createServer as createHttpServer } from "node:http";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { createServer } from "./server";
import { MemoryLedgerStore } from "./ledger/memoryStore";

const httpServer = createHttpServer();
const store = new MemoryLedgerStore();

const rpcUrl = process.env.CELO_MAINNET_RPC_URL ?? "https://forno.celo.org";
const publicClient = createPublicClient({ chain: celo, transport: http(rpcUrl) });

/**
 * Treasury address that receives user Arena stakes. Configured via the
 * ARENA_TREASURY_ADDRESS env. When unset (e.g. fresh deploy, env drift)
 * the server still starts so health checks pass, but every /api/deposit
 * call will fail the receipt's `to` check — this surfaces the
 * misconfiguration loudly at request time instead of crashing boot.
 */
const treasuryAddress = (process.env.ARENA_TREASURY_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

createServer(httpServer, store, {
  treasuryAddress,
  publicClient,
});

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => {
  console.log(`hexarena server listening on :${port}`);
  console.log(`arena treasury: ${treasuryAddress}`);
});
