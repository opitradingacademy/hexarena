/**
 * E2E: full Arena match — simulated deposit -> match -> house rake payout
 * -> settleOnChain() invoked with correct params (task 5.2).
 *
 * settleOnChain is mocked at the module boundary: this test validates the
 * ledger rake/payout math and that settle() is called correctly, WITHOUT
 * broadcasting a real Celo Mainnet transaction (would cost real gas).
 */
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type {
  ClientToServerEvents,
  GameOverPayload,
  MatchFoundPayload,
  ServerToClientEvents,
} from "@hexarena/shared/protocol";
import { MemoryLedgerStore } from "./ledger/memoryStore";
import { creditDeposit, balanceOf } from "./ledger/ledger";

const settleOnChainMock = vi.fn().mockResolvedValue({ txHash: "0xmocked" });
vi.mock("./chain/settlement", () => ({
  settleOnChain: (...args: unknown[]) => settleOnChainMock(...args),
}));

type TestSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

function connectClient(url: string): TestSocket {
  return ioClient(url, { transports: ["websocket"], autoConnect: false }) as TestSocket;
}

function waitFor<T>(socket: TestSocket, event: keyof ServerToClientEvents): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, ((payload: T) => resolve(payload)) as never);
  });
}

function waitForConnect(socket: TestSocket): Promise<void> {
  return new Promise((resolve) => socket.once("connect", () => resolve()));
}

describe("E2E — full Arena match", () => {
  let httpServer: HttpServer;
  let store: MemoryLedgerStore;
  let url: string;
  let clientA: TestSocket;
  let clientB: TestSocket;

  beforeEach(async () => {
    settleOnChainMock.mockClear();
    store = new MemoryLedgerStore();
    httpServer = createHttpServer();
    const { createServer } = await import("./server");
    createServer(httpServer, store);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;
    url = `http://localhost:${port}`;
    clientA = connectClient(url);
    clientB = connectClient(url);
  });

  afterEach(() => {
    clientA.disconnect();
    clientB.disconnect();
    httpServer.close();
  });

  it("stake -> match -> decisive win pays 80% of pool, settleOnChain called with matchId/winner/amount", async () => {
    const STAKE = 0.1;

    clientA.connect();
    clientB.connect();
    await Promise.all([waitForConnect(clientA), waitForConnect(clientB)]);

    // Simulated pre-funded deposits (task 5.2 "simulated deposit").
    creditDeposit(store, clientA.id!, "0xtxA", STAKE);
    creditDeposit(store, clientB.id!, "0xtxB", STAKE);

    const matchFoundA = waitFor<MatchFoundPayload>(clientA, "match_found");
    const matchFoundB = waitFor<MatchFoundPayload>(clientB, "match_found");
    clientA.emit("join_queue", { mode: "ARENA", stake: STAKE });
    clientB.emit("join_queue", { mode: "ARENA", stake: STAKE });
    const [foundA] = await Promise.all([matchFoundA, matchFoundB]);

    const gameOverA = waitFor<GameOverPayload>(clientA, "game_over");
    const gameOverB = waitFor<GameOverPayload>(clientB, "game_over");
    // clientB resigns -> clientA (winner) receives the pool minus 20% house rake.
    clientB.emit("resign", { matchId: foundA.matchId });
    const [overA, overB] = await Promise.all([gameOverA, gameOverB]);

    expect(overA.arena?.prizeUSD).toBeCloseTo(0.16, 6); // (0.1+0.1) * 0.8
    expect(overA.arena?.settleTxPending).toBe(true);
    expect(overB).toEqual(overA);
    expect(balanceOf(store, clientA.id!)).toBeCloseTo(0.16, 6);

    expect(settleOnChainMock).toHaveBeenCalledTimes(1);
    expect(settleOnChainMock).toHaveBeenCalledWith(
      foundA.matchId,
      expect.stringContaining(clientA.id!), // ledger walletAddress placeholder is `wallet:${userId}`
      expect.closeTo(0.16, 6),
    );
  });
});
