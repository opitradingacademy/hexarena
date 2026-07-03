import { describe, expect, it, vi } from "vitest";
import { createServer as createHttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { MemoryLedgerStore } from "./ledger/memoryStore";
import { creditDeposit } from "./ledger/ledger";
import { handleDepositRequest } from "./depositEndpoint";
import type { VerifyDepositProvider } from "./chain/verifyDeposit";

const TREASURY = "0x1111111111111111111111111111111111111111" as const;
const SENDER = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as const;
const TX_HASH = ("0x" + "ab".repeat(32)) as `0x${string}`;

function encodedTransferLog(to: string, amount: bigint) {
  return {
    address: TOKEN,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x000000000000000000000000" + SENDER.slice(2).toLowerCase(),
      "0x000000000000000000000000" + to.slice(2).toLowerCase(),
    ],
    data: "0x" + amount.toString(16).padStart(64, "0"),
  };
}

// Real ERC-20 `transfer()` receipts have `to` set to the TOKEN CONTRACT
// (what you called), never the recipient — the recipient only shows up
// inside the Transfer event log, which defaults to TREASURY below.
function makeProvider(amount: bigint, recipient: string = TREASURY): VerifyDepositProvider {
  return {
    getTransactionReceipt: vi.fn().mockResolvedValue({
      status: "success",
      to: TOKEN,
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
      tokenAddress: TOKEN,
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
      tokenAddress: TOKEN,
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

  it("credits the ledger when the client provides a fully-fetched receipt", async () => {
    // The new flow: client fetches the receipt via its own provider-stub
    // (which sees the tx immediately) and POSTs the full receipt
    // object. The server validates the receipt structurally — no
    // polling needed because the receipt already arrived.
    const receipt = {
      status: "success",
      to: TOKEN,
      from: SENDER,
      blockHash: "0x" + "11".repeat(32),
      blockNumber: "0x64", // hex strings — what viem actually returns in JSON
      contractAddress: null,
      cumulativeGasUsed: "0x0",
      effectiveGasPrice: "0x0",
      gasUsed: "0x0",
      logs: [
        {
          address: TOKEN,
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            "0x000000000000000000000000" + SENDER.slice(2).toLowerCase(),
            "0x000000000000000000000000" + TREASURY.slice(2).toLowerCase(),
          ],
          data: "0x" + 100_000n.toString(16).padStart(64, "0"),
        },
      ],
      logsBloom: "0x",
      transactionHash: TX_HASH,
      transactionIndex: "0x0",
      type: "0x2",
    };
    const provider: VerifyDepositProvider = {
      // Provider stub isn't even called in this flow — the receipt is
      // validated purely from the POST body.
      getTransactionReceipt: vi.fn().mockResolvedValue(receipt),
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
          body: JSON.stringify({ txHash: TX_HASH, receipt }),
        });
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.balanceUSD).toBeCloseTo(0.1, 5);
      },
    );
  });

  it("credits the ledger when the client-supplied receipt has a raw hex status (real MiniPay shape)", async () => {
    // The client fetches this receipt via raw `ethereum.request({method:
    // "eth_getTransactionReceipt"})`, NOT through viem — so per the
    // Ethereum JSON-RPC spec, `status` is the hex quantity "0x1"/"0x0",
    // never the string "success"/"reverted" viem normalizes to. A real
    // MiniPay deposit that was confirmed on CeloScan hit this exact gap.
    const receipt = {
      status: "0x1",
      to: TOKEN,
      from: SENDER,
      blockHash: "0x" + "11".repeat(32),
      blockNumber: "0x64",
      contractAddress: null,
      cumulativeGasUsed: "0x0",
      effectiveGasPrice: "0x0",
      gasUsed: "0x0",
      logs: [
        {
          address: TOKEN,
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            "0x000000000000000000000000" + SENDER.slice(2).toLowerCase(),
            "0x000000000000000000000000" + TREASURY.slice(2).toLowerCase(),
          ],
          data: "0x" + 100_000n.toString(16).padStart(64, "0"),
        },
      ],
      logsBloom: "0x",
      transactionHash: TX_HASH,
      transactionIndex: "0x0",
      type: "0x2",
    };
    const provider: VerifyDepositProvider = {
      getTransactionReceipt: vi.fn().mockResolvedValue(receipt),
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
          body: JSON.stringify({ txHash: TX_HASH, receipt }),
        });
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.balanceUSD).toBeCloseTo(0.1, 5);
      },
    );
  });

  it("returns 422 when the receipt has no matching Transfer event to the treasury", async () => {
    const receipt = {
      status: "success",
      to: TOKEN,
      from: SENDER,
      blockHash: "0x" + "11".repeat(32),
      blockNumber: "0x64",
      contractAddress: null,
      cumulativeGasUsed: "0x0",
      effectiveGasPrice: "0x0",
      gasUsed: "0x0",
      logs: [],
      logsBloom: "0x",
      transactionHash: TX_HASH,
      transactionIndex: "0x0",
      type: "0x2",
    };
    const provider: VerifyDepositProvider = {
      getTransactionReceipt: vi.fn().mockResolvedValue(receipt),
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
          body: JSON.stringify({ txHash: TX_HASH, receipt }),
        });
        expect(status).toBe(422);
        expect(body.code).toBe("INVALID_TX");
      },
    );
  });

  it("returns 422 when the tx wasn't sent to the settlement token contract", async () => {
    const receipt = {
      status: "success",
      to: "0xdead000000000000000000000000000000000000",
      from: SENDER,
      blockHash: "0x" + "11".repeat(32),
      blockNumber: "0x64",
      contractAddress: null,
      cumulativeGasUsed: "0x0",
      effectiveGasPrice: "0x0",
      gasUsed: "0x0",
      logs: [],
      logsBloom: "0x",
      transactionHash: TX_HASH,
      transactionIndex: "0x0",
      type: "0x2",
    };
    const provider: VerifyDepositProvider = {
      getTransactionReceipt: vi.fn().mockResolvedValue(receipt),
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
          body: JSON.stringify({ txHash: TX_HASH, receipt }),
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

describe("GET /api/balance", () => {
  it("returns the ledger balance for a given wallet", async () => {
    await withServer(
      (store) => {
        store.upsertUser(SENDER, SENDER);
        creditDeposit(store, SENDER, "0x" + "cd".repeat(32), 0.42);
      },
      async (port) => {
        const { status, body } = await fetchJson(
          `http://127.0.0.1:${port}/api/balance?wallet=${SENDER}`,
        );
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.balanceUSD).toBeCloseTo(0.42, 5);
      },
    );
  });

  it("returns 400 for missing or invalid wallet query param", async () => {
    await withServer(
      () => {},
      async (port) => {
        const r1 = await fetchJson(`http://127.0.0.1:${port}/api/balance`);
        expect(r1.status).toBe(400);
        const r2 = await fetchJson(`http://127.0.0.1:${port}/api/balance?wallet=not-an-address`);
        expect(r2.status).toBe(400);
      },
    );
  });

  it("returns balance 0 for an address that has never deposited (no NaN)", async () => {
    await withServer(
      () => {},
      async (port) => {
        const { status, body } = await fetchJson(
          `http://127.0.0.1:${port}/api/balance?wallet=${SENDER}`,
        );
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.balanceUSD).toBe(0);
      },
    );
  });
});
