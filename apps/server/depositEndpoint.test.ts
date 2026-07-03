import { describe, expect, it, vi } from "vitest";
import { createServer as createHttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { MemoryLedgerStore } from "./ledger/memoryStore";
import { creditDeposit } from "./ledger/ledger";
import { handleDepositRequest } from "./depositEndpoint";
import type { VerifyDepositProvider } from "./chain/verifyDeposit";

const TREASURY = "0x1111111111111111111111111111111111111111" as const;
const SENDER = "0x2222222222222222222222222222222222222222" as const;
const TX_HASH = ("0x" + "ab".repeat(32)) as `0x${string}`;

function encodedTransferLog(to: string, amount: bigint) {
  return {
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x000000000000000000000000" + SENDER.slice(2).toLowerCase(),
      "0x000000000000000000000000" + to.slice(2).toLowerCase(),
    ],
    data: "0x" + amount.toString(16).padStart(64, "0"),
  };
}

function makeProvider(amount: bigint, recipient: string = TREASURY): VerifyDepositProvider {
  return {
    getTransactionReceipt: vi.fn().mockResolvedValue({
      status: "success",
      to: recipient,
      from: SENDER,
      logs: [encodedTransferLog(recipient, amount)],
    }),
  };
}

function mountHttp() {
  const http = createHttpServer();
  const io = new SocketIOServer(http, { cors: { origin: "*" } });
  return { http, io };
}

async function fetchJson(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, body };
}

async function withServer<T>(
  setup: (store: MemoryLedgerStore, provider: VerifyDepositProvider) => void,
  cb: (port: number, io: SocketIOServer, http: ReturnType<typeof createHttpServer>) => Promise<T>,
): Promise<T> {
  const { http, io } = mountHttp();
  const store = new MemoryLedgerStore();
  const provider = makeProvider(100_000n);
  setup(store, provider);
  http.on("request", (req, res) => {
    handleDepositRequest(req, res, store, {
      treasury: TREASURY,
      provider,
      settleTokenDecimals: 6,
    }).catch((e) => {
      console.error("deposit handler threw:", e);
      res.end();
    });
  });
  await new Promise<void>((r) => http.listen(0, r));
  const port = (http.address() as { port: number }).port;
  try {
    return await cb(port, io, http);
  } finally {
    io.close();
    http.close();
  }
}

/** Variant that installs a custom provider but keeps the rest of the wiring. */
async function withCustomProvider<T>(
  provider: VerifyDepositProvider,
  setup: (store: MemoryLedgerStore) => void,
  cb: (port: number, http: ReturnType<typeof createHttpServer>, io: SocketIOServer) => Promise<T>,
): Promise<T> {
  const { http, io } = mountHttp();
  const store = new MemoryLedgerStore();
  setup(store);
  http.on("request", (req, res) => {
    handleDepositRequest(req, res, store, {
      treasury: TREASURY,
      provider,
      pollIntervalMs: 0,
      maxAttempts: 1,
    }).catch(() => res.end());
  });
  await new Promise<void>((r) => http.listen(0, r));
  const port = (http.address() as { port: number }).port;
  try {
    return await cb(port, http, io);
  } finally {
    io.close();
    http.close();
  }
}

describe("POST /api/deposit", () => {
  it("credits the ledger when the tx is valid", async () => {
    await withServer(
      () => {},
      async (port, _io, _http) => {
        const { status, body } = await fetchJson(`http://127.0.0.1:${port}/api/deposit`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-wallet-address": SENDER,
          },
          body: JSON.stringify({ txHash: TX_HASH }),
        });
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.balanceUSD).toBeCloseTo(0.1, 5);
      },
    );
  });

  it("rejects missing or malformed X-Wallet-Address header with 400", async () => {
    await withServer(
      () => {},
      async (port) => {
        const r1 = await fetchJson(`http://127.0.0.1:${port}/api/deposit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ txHash: TX_HASH }),
        });
        expect(r1.status).toBe(400);
        const r2 = await fetchJson(`http://127.0.0.1:${port}/api/deposit`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-wallet-address": "not-an-address",
          },
          body: JSON.stringify({ txHash: TX_HASH }),
        });
        expect(r2.status).toBe(400);
      },
    );
  });

  it("returns 409 for an already-credited txHash", async () => {
    await withServer(
      (store) => {
        store.upsertUser(SENDER, SENDER);
        creditDeposit(store, SENDER, TX_HASH, 0.05);
      },
      async (port) => {
        const { status, body } = await fetchJson(`http://127.0.0.1:${port}/api/deposit`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-wallet-address": SENDER,
          },
          body: JSON.stringify({ txHash: TX_HASH }),
        });
        expect(status).toBe(409);
        expect(body.code).toBe("DUPLICATE_TX");
      },
    );
  });

  it("returns 422 for an invalid receipt", async () => {
    const provider: VerifyDepositProvider = {
      getTransactionReceipt: vi.fn().mockResolvedValue(null),
    };
    await withCustomProvider(
      provider,
      () => {},
      async (port) => {
        const { status, body } = await fetchJson(`http://127.0.0.1:${port}/api/deposit`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-wallet-address": SENDER,
          },
          body: JSON.stringify({ txHash: TX_HASH }),
        });
        expect(status).toBe(422);
        expect(body.code).toBe("INVALID_TX");
      },
    );
  });

  it("returns 405 for non-POST methods", async () => {
    await withServer(
      () => {},
      async (port) => {
        const { status, body } = await fetchJson(`http://127.0.0.1:${port}/api/deposit`);
        expect(status).toBe(405);
        expect(body.code).toBe("METHOD_NOT_ALLOWED");
      },
    );
  });
});
