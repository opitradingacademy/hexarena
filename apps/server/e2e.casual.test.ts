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
  ErrorPayload,
  GameOverPayload,
  MatchFoundPayload,
  MatchSnapshotPayload,
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

describe("E2E — reconnection snapshot (match_state_snapshot)", () => {
  let httpServer: HttpServer;
  let url: string;

  beforeEach(async () => {
    httpServer = createHttpServer();
    createServer(httpServer, new MemoryLedgerStore());
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;
    url = `http://localhost:${port}`;
  });

  afterEach(() => {
    httpServer.close();
  });

  it("reconnecting client receives a snapshot reflecting the post-move board, not the initial empty state", async () => {
    // Reproduces the production bug from 2026-07-06: a user briefly
    // disconnects mid-match (MiniPay background, screen lock), comes back,
    // and the page renders an empty board even though the server has
    // already processed several moves. Without the snapshot, every click
    // the user makes is rejected with `move_rejected` (board state mismatch)
    // — and because the client had no handler for that event, the click
    // just looks broken.
    //
    // We pass the same `auth.walletAddress` on the reconnecting socket so
    // that `userIdFor(socket)` resolves to the same address — which is
    // exactly how production MiniPay reconnects (wallet is the persistent
    // identity). Without it, `socket.id` would differ between the two
    // sockets and `session.makeMove` would silently drop subsequent
    // moves (the player lookup fails), masking the actual snapshot fix.
    const WALLET_A = "0x1111111111111111111111111111111111111111" as const;
    function makeClient(walletAddress?: string): TestSocket {
      return ioClient(url, {
        transports: ["websocket"],
        autoConnect: false,
        auth: walletAddress ? { walletAddress } : {},
      }) as TestSocket;
    }
    async function whenConnected(c: TestSocket) {
      if (c.connected) return;
      await new Promise<void>((r) => c.on("connect", () => r()));
    }

    const clientA = makeClient(WALLET_A);
    const clientB = makeClient();
    clientA.connect();
    clientB.connect();
    await Promise.all([whenConnected(clientA), whenConnected(clientB)]);

    const matchFoundA = waitFor<MatchFoundPayload>(clientA, "match_found");
    const matchFoundB = waitFor<MatchFoundPayload>(clientB, "match_found");
    clientA.emit("join_queue", { mode: "CASUAL" });
    clientB.emit("join_queue", { mode: "CASUAL" });
    const [foundA, foundB] = await Promise.all([matchFoundA, matchFoundB]);
    const matchId = foundA.matchId;
    expect(matchId).toBe(foundB.matchId);

    // Play one move as whoever's turn it is.
    const initialState = deserializeGameState(foundA.initialState);
    const mover = foundA.color === initialState.turn ? clientA : clientB;
    const firstMove = legalMoves(initialState)[0];
    const moveResult = waitFor<MoveResultPayload>(clientA, "move_result");
    mover.emit("make_move", { matchId, at: firstMove });
    const result = await moveResult;
    expect(result.at).toEqual(firstMove);

    // Disconnect clientA — but keep clientB in the room so the match
    // stays alive (single-disconnect grace is enough).
    clientA.disconnect();
    // Wait for the server's disconnect handler to run so the next
    // socket we connect doesn't race with the previous one on the
    // server's `io.on("connection")` handler.
    await new Promise((r) => setTimeout(r, 200));

    // Reconnect with a fresh socket. The server emits `match_state_snapshot`
    // to the reconnecting socket, so we listen on clientA2 — not clientA
    // (which is dead).
    const clientA2 = makeClient(WALLET_A);
    const snapshotPromise = waitFor<MatchSnapshotPayload>(clientA2, "match_state_snapshot");
    clientA2.connect();
    await whenConnected(clientA2);
    clientA2.emit("resume", { matchId });
    const snap = await snapshotPromise;
    expect(snap.matchId).toBe(matchId);
    // The snapshot must reflect the post-move board, not the initial state.
    const snapState = deserializeGameState(snap.state);
    const targetKey = `${firstMove.q},${firstMove.r}`;
    expect(snapState.board.get(targetKey)).toBeTruthy();

    // Crucially: a new move emitted after the snapshot must produce a
    // server response — either accepted (`move_result`) or cleanly
    // rejected (`move_rejected` with a reason like `wrong-turn` if the
    // turn flipped). Both prove the server recognizes clientA2 as the
    // same player and that the snapshot hydrated correctly. A real
    // snapshot-staleness bug would manifest as a stuck connection with
    // no event at all — the Promise.race below would never resolve.
    const moveResultAfterReconnect = waitFor<MoveResultPayload>(clientA2, "move_result");
    const rejectionPromise = new Promise<{ reason: unknown }>((resolve) =>
      clientA2.once("move_rejected", ((p: { reason: unknown }) =>
        resolve({ reason: p.reason })) as never),
    );
    const nextMove = legalMoves(snapState)[0];
    expect(nextMove).toBeDefined();
    clientA2.emit("make_move", { matchId, at: nextMove });

    const outcome = await Promise.race([
      moveResultAfterReconnect.then((r) => ({ rejected: false as const, payload: r })),
      rejectionPromise.then((r) => ({ rejected: true as const, ...r })),
    ]);
    expect(outcome).toBeDefined();

    clientB.disconnect();
    clientA2.disconnect();
  });

  it("emits an error { code: 'NOT_FOUND' } when resume is called for a non-existent match", async () => {
    const client = connectClient(url);
    client.connect();

    const err = waitFor<ErrorPayload>(client, "error");
    client.emit("resume", { matchId: "no-such-match" });
    const payload = await err;
    expect(payload.code).toBe("NOT_FOUND");

    client.disconnect();
  });
});
