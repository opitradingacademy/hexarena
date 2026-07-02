/**
 * Wallet-auth handshake (task: real wallet identity, MVP without signature
 * verification). Client declares its address via socket.handshake.auth;
 * a valid hex address becomes the ledger userId, otherwise the server
 * falls back to socket.id (spec: unauthenticated dev/testing clients still work).
 */
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@hexarena/shared/protocol";
import { createServer } from "./server";
import { MemoryLedgerStore } from "./ledger/memoryStore";

type TestSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

describe("wallet-auth handshake", () => {
  let httpServer: HttpServer;
  let store: MemoryLedgerStore;
  let url: string;
  let client: TestSocket;

  beforeEach(async () => {
    httpServer = createHttpServer();
    store = new MemoryLedgerStore();
    createServer(httpServer, store);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;
    url = `http://localhost:${port}`;
  });

  afterEach(() => {
    client.disconnect();
    httpServer.close();
  });

  it("uses the declared wallet address as userId when it is a valid hex address", async () => {
    const walletAddress = "0x1234567890123456789012345678901234567890";
    client = ioClient(url, {
      transports: ["websocket"],
      autoConnect: false,
      auth: { walletAddress },
    }) as TestSocket;

    const joined = new Promise<void>((resolve) => client.once("queue_joined", () => resolve()));
    client.connect();
    client.emit("join_queue", { mode: "CASUAL" });
    await joined;

    expect(store.getUser(walletAddress)).toBeDefined();
  });

  it("falls back to socket.id when no wallet address is declared", async () => {
    client = ioClient(url, { transports: ["websocket"], autoConnect: false }) as TestSocket;

    const joined = new Promise<void>((resolve) => client.once("queue_joined", () => resolve()));
    client.connect();
    client.emit("join_queue", { mode: "CASUAL" });
    await joined;

    expect(client.id).toBeDefined();
    expect(store.getUser(client.id as string)).toBeDefined();
  });

  it("falls back to socket.id when the declared wallet address is not a valid hex address", async () => {
    client = ioClient(url, {
      transports: ["websocket"],
      autoConnect: false,
      auth: { walletAddress: "not-an-address" },
    }) as TestSocket;

    const joined = new Promise<void>((resolve) => client.once("queue_joined", () => resolve()));
    client.connect();
    client.emit("join_queue", { mode: "CASUAL" });
    await joined;

    expect(store.getUser("not-an-address")).toBeUndefined();
    expect(store.getUser(client.id as string)).toBeDefined();
  });
});
