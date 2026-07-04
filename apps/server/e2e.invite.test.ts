/**
 * E2E: single-use invite links — a player generates a code, sharing it
 * pairs whoever opens it directly with the inviter, skipping the queue.
 */
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ErrorPayload,
  InviteCreatedPayload,
  MatchFoundPayload,
  ServerToClientEvents,
} from "@hexarena/shared/protocol";
import { createServer } from "./server";
import { MemoryLedgerStore } from "./ledger/memoryStore";
import { creditDeposit } from "./ledger/ledger";

// All-digit addresses checksum to themselves (case only matters for hex
// letters a-f), so these are valid without needing viem's getAddress.
const WALLET_A = "0x1111111111111111111111111111111111111111" as const;
const WALLET_B = "0x2222222222222222222222222222222222222222" as const;
const WALLET_C = "0x3333333333333333333333333333333333333333" as const;

type TestSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

function connectClient(url: string, walletAddress?: string): TestSocket {
  return ioClient(url, {
    transports: ["websocket"],
    autoConnect: false,
    auth: walletAddress ? { walletAddress } : {},
  }) as TestSocket;
}

function waitFor<T>(socket: TestSocket, event: keyof ServerToClientEvents): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, ((payload: T) => resolve(payload)) as never);
  });
}

describe("E2E — invite links", () => {
  let httpServer: HttpServer;
  let store: MemoryLedgerStore;
  let url: string;
  let clientA: TestSocket;
  let clientB: TestSocket;

  beforeEach(async () => {
    httpServer = createHttpServer();
    store = new MemoryLedgerStore();
    createServer(httpServer, store);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;
    url = `http://localhost:${port}`;
    clientA = connectClient(url, WALLET_A);
    clientB = connectClient(url, WALLET_B);
  });

  afterEach(() => {
    clientA.disconnect();
    clientB.disconnect();
    httpServer.close();
  });

  it("pairs the inviter with whoever joins via the invite code (CASUAL)", async () => {
    clientA.connect();
    clientB.connect();

    const created = waitFor<InviteCreatedPayload>(clientA, "invite_created");
    clientA.emit("create_invite", { mode: "CASUAL" });
    const { code } = await created;

    const matchFoundA = waitFor<MatchFoundPayload>(clientA, "match_found");
    const matchFoundB = waitFor<MatchFoundPayload>(clientB, "match_found");
    clientB.emit("join_invite", { code });

    const [foundA, foundB] = await Promise.all([matchFoundA, matchFoundB]);
    expect(foundA.matchId).toBe(foundB.matchId);
    expect(foundA.color).not.toBe(foundB.color);
  });

  it("rejects an unknown or already-used invite code", async () => {
    clientB.connect();
    const err = waitFor<ErrorPayload>(clientB, "error");
    clientB.emit("join_invite", { code: "nonexistent" });
    expect((await err).code).toBe("NOT_FOUND");
  });

  it("an invite can only be used once", async () => {
    clientA.connect();
    clientB.connect();

    const created = waitFor<InviteCreatedPayload>(clientA, "invite_created");
    clientA.emit("create_invite", { mode: "CASUAL" });
    const { code } = await created;

    await Promise.all([
      waitFor(clientA, "match_found"),
      waitFor(clientB, "match_found"),
      new Promise((resolve) => {
        clientB.emit("join_invite", { code });
        resolve(undefined);
      }),
    ]);

    const clientC = connectClient(url, WALLET_C);
    clientC.connect();
    const err = waitFor<ErrorPayload>(clientC, "error");
    clientC.emit("join_invite", { code });
    expect((await err).code).toBe("NOT_FOUND");
    clientC.disconnect();
  });

  it("rejects joining your own invite", async () => {
    clientA.connect();
    const created = waitFor<InviteCreatedPayload>(clientA, "invite_created");
    clientA.emit("create_invite", { mode: "CASUAL" });
    const { code } = await created;

    const err = waitFor<ErrorPayload>(clientA, "error");
    clientA.emit("join_invite", { code });
    expect((await err).code).toBe("INVALID_STATE");
  });

  it("ARENA invite rejects a joiner with insufficient balance", async () => {
    clientA.connect();
    clientB.connect();
    creditDeposit(store, WALLET_A, "0xtxA", 0.1);

    const created = waitFor<InviteCreatedPayload>(clientA, "invite_created");
    clientA.emit("create_invite", { mode: "ARENA", stake: 0.1 });
    const { code } = await created;

    const err = waitFor<ErrorPayload>(clientB, "error");
    clientB.emit("join_invite", { code });
    expect((await err).code).toBe("INSUFFICIENT_BALANCE");
  });

  it("ARENA invite pairs both players once the joiner has enough balance", async () => {
    clientA.connect();
    clientB.connect();
    creditDeposit(store, WALLET_A, "0xtxA", 0.1);
    creditDeposit(store, WALLET_B, "0xtxB", 0.1);

    const created = waitFor<InviteCreatedPayload>(clientA, "invite_created");
    clientA.emit("create_invite", { mode: "ARENA", stake: 0.1 });
    const { code } = await created;

    const matchFoundB = waitFor<MatchFoundPayload>(clientB, "match_found");
    clientB.emit("join_invite", { code });
    expect((await matchFoundB).matchId).toBeDefined();
  });

  it("create_invite rejects an ARENA invite from a creator with insufficient balance", async () => {
    clientA.connect();
    const err = waitFor<ErrorPayload>(clientA, "error");
    clientA.emit("create_invite", { mode: "ARENA", stake: 0.5 });
    expect((await err).code).toBe("INSUFFICIENT_BALANCE");
  });
});
