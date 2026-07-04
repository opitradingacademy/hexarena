/**
 * E2E: local bot opponent for CASUAL matches — both trigger paths.
 * Spec: plan "Modo vs Máquina en Casual" (explicit play_vs_bot event +
 * automatic fallback for a lone CASUAL queue entry).
 */
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { deserializeGameState, legalMoves } from "@hexarena/shared/domain/board";
import { BOT_USER_ID } from "@hexarena/shared/domain/bot";
import type {
  ClientToServerEvents,
  MatchFoundPayload,
  MoveResultPayload,
  ServerToClientEvents,
} from "@hexarena/shared/protocol";
import { createServer, type CreateServerOpts } from "./server";
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

describe("E2E — local bot opponent", () => {
  let httpServer: HttpServer;
  let url: string;
  let clientA: TestSocket;
  let clientB: TestSocket;

  beforeEach(async () => {
    httpServer = createHttpServer();
    createServer(httpServer, new MemoryLedgerStore(), { botFallbackMs: 50 } as CreateServerOpts);
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

  it("play_vs_bot starts an immediate solo match against the bot", async () => {
    clientA.connect();

    const matchFound = waitFor<MatchFoundPayload>(clientA, "match_found");
    clientA.emit("play_vs_bot");
    const found = await matchFound;

    expect(found.color).toBe("P1");
    expect(found.opponent).toBe(BOT_USER_ID);

    const state = deserializeGameState(found.initialState);
    const move = legalMoves(state, "P1")[0];
    expect(move).toBeDefined();

    const botMoveResult = waitFor<MoveResultPayload>(clientA, "move_result");
    clientA.emit("make_move", { matchId: found.matchId, at: move });
    // First move_result is the human's own move; wait for a second one
    // from the bot (P2), which fires automatically after its delay.
    await botMoveResult;
    const botReply = await waitFor<MoveResultPayload>(clientA, "move_result");
    expect(botReply.by).toBe("P2");
  });

  it("falls back to the bot when nobody else joins the CASUAL queue in time", async () => {
    clientA.connect();

    const matchFound = waitFor<MatchFoundPayload>(clientA, "match_found");
    clientA.emit("join_queue", { mode: "CASUAL" });
    const found = await matchFound;

    expect(found.opponent).toBe(BOT_USER_ID);
  });

  it("does not fall back to the bot if a real opponent joins before the timeout", async () => {
    clientA.connect();
    clientB.connect();

    const matchFoundA = waitFor<MatchFoundPayload>(clientA, "match_found");
    const matchFoundB = waitFor<MatchFoundPayload>(clientB, "match_found");
    clientA.emit("join_queue", { mode: "CASUAL" });
    clientB.emit("join_queue", { mode: "CASUAL" });

    const [foundA, foundB] = await Promise.all([matchFoundA, matchFoundB]);
    expect(foundA.matchId).toBe(foundB.matchId);
    expect(foundA.opponent).not.toBe(BOT_USER_ID);
    expect(foundB.opponent).not.toBe(BOT_USER_ID);
  });

  it("does not fall back to the bot after cancel_queue", async () => {
    clientA.connect();
    clientA.emit("join_queue", { mode: "CASUAL" });
    clientA.emit("cancel_queue", {});

    let matchFound: MatchFoundPayload | null = null;
    clientA.once("match_found", (payload: MatchFoundPayload) => {
      matchFound = payload;
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(matchFound).toBeNull();
  });
});
