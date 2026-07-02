/**
 * E2E: full Casual match over a real Socket.IO connection (task 5.1).
 * Spins up createServer() on a real HTTP server + connects two real
 * socket.io-client sockets — no mocking of the transport layer.
 * Spec: realtime-protocol "Queue Join", "Match Found", "Move Validation",
 * "Game Over Delivery".
 */
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { deserializeGameState, legalMoves, otherPlayer } from "@hexarena/shared/domain/board";
import type {
  ClientToServerEvents,
  GameOverPayload,
  MatchFoundPayload,
  MoveResultPayload,
  ServerToClientEvents,
} from "@hexarena/shared/protocol";
import { createServer } from "./server";
import { MemoryLedgerStore } from "./ledger/memoryStore";

type TestSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

function connectClient(url: string): TestSocket {
  return ioClient(url, { transports: ["websocket"], autoConnect: false }) as TestSocket;
}

function waitFor<T>(socket: TestSocket, event: keyof ServerToClientEvents): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, ((payload: T) => resolve(payload)) as never);
  });
}

describe("E2E — full Casual match", () => {
  let httpServer: HttpServer;
  let url: string;
  let clientA: TestSocket;
  let clientB: TestSocket;

  beforeEach(async () => {
    httpServer = createHttpServer();
    createServer(httpServer, new MemoryLedgerStore());
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

  it("queue -> match_found -> make_move -> resign -> game_over", async () => {
    clientA.connect();
    clientB.connect();

    const matchFoundA = waitFor<MatchFoundPayload>(clientA, "match_found");
    const matchFoundB = waitFor<MatchFoundPayload>(clientB, "match_found");

    clientA.emit("join_queue", { mode: "CASUAL" });
    clientB.emit("join_queue", { mode: "CASUAL" });

    const [foundA, foundB] = await Promise.all([matchFoundA, matchFoundB]);
    expect(foundA.matchId).toBe(foundB.matchId);
    expect(foundA.color).not.toBe(foundB.color);

    const state = deserializeGameState(foundA.initialState);
    const mover = foundA.color === state.turn ? clientA : clientB;
    const move = legalMoves(state)[0];
    expect(move).toBeDefined();

    const moveResult = waitFor<MoveResultPayload>(clientA, "move_result");
    mover.emit("make_move", { matchId: foundA.matchId, at: move });
    const result = await moveResult;
    expect(result.at).toEqual(move);
    expect(result.captures.length).toBeGreaterThan(0);

    const gameOverA = waitFor<GameOverPayload>(clientA, "game_over");
    const gameOverB = waitFor<GameOverPayload>(clientB, "game_over");
    clientA.emit("resign", { matchId: foundA.matchId });
    const [overA, overB] = await Promise.all([gameOverA, gameOverB]);

    const expected = { winner: otherPlayer(foundA.color), reason: "resign" };
    expect(overA).toEqual(expected);
    expect(overB).toEqual(expected);
  });
});
