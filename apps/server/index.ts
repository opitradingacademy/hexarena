import { createServer as createHttpServer } from "node:http";
import { createServer } from "./server";
import { MemoryLedgerStore } from "./ledger/memoryStore";

const httpServer = createHttpServer();
const store = new MemoryLedgerStore();
createServer(httpServer, store);

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => {
  console.log(`hexarena server listening on :${port}`);
});
