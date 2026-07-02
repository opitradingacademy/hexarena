import { createServer as createHttpServer } from "node:http";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { createServer } from "./server";
import { MemoryLedgerStore } from "./ledger/memoryStore";

const httpServer = createHttpServer();
const store = new MemoryLedgerStore();

const rpcUrl = process.env.CELO_MAINNET_RPC_URL ?? "https://forno.celo.org";
const publicClient = createPublicClient({ chain: celo, transport: http(rpcUrl) });

/**
 * Treasury address that receives user Arena stakes. If
 * ARENA_TREASURY_ADDRESS is not configured we derive it from
 * OPERATOR_PRIVATE_KEY (the same wallet that signs settle()) so a fresh
 * deploy needs only OPERATOR_PRIVATE_KEY. Set ARENA_TREASURY_ADDRESS
 * explicitly to use a separate wallet for stakes.
 */
const treasuryAddress = (process.env.ARENA_TREASURY_ADDRESS ??
  (() => {
    const pk = process.env.OPERATOR_PRIVATE_KEY as `0x${string}` | undefined;
    if (!pk) return "0x0000000000000000000000000000000000000000";
    return privateKeyToAccount(pk).address;
  })()) as `0x${string}`;

createServer(httpServer, store, {
  treasuryAddress,
  publicClient,
});

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => {
  console.log(`hexarena server listening on :${port}`);
  console.log(`arena treasury: ${treasuryAddress}`);
});
