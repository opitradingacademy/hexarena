/**
 * Socket.IO application layer — wires transport events to Matchmaker +
 * MatchSession + ledger, per realtime-protocol spec. This module builds
 * the Socket.IO server; index.ts starts it listening.
 */
import { Server, type Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { isAddress } from "viem";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@hexarena/shared/protocol";
import { serializeGameState, type PlayerId } from "@hexarena/shared/domain/board";
import type { LedgerStore, UserId } from "./ledger/types";
import { balanceOf } from "./ledger/ledger";
import { Matchmaker, type QueueEntry } from "./matchmaking";
import { MatchSession } from "./matchSession";

export function createServer(httpServer: HttpServer, store: LedgerStore) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: "*" },
  });

  // Read endpoint for the History screen (task 2.14, design.md Wireframe #4).
  // GET /matches/:userId -> reverse-chronological match history.
  httpServer.on("request", (req, res) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const match = url.pathname.match(/^\/matches\/([^/]+)$/);
    if (req.method === "GET" && match) {
      const userId = decodeURIComponent(match[1]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(store.matchHistoryFor(userId)));
    }
  });

  const matchmaker = new Matchmaker();
  const sessions = new Map<string, MatchSession>();
  /** userId -> socket, so MatchSession.emit can target either the room or one player. */
  const socketsByUser = new Map<UserId, Socket>();
  /** userId -> matchId, so disconnect/resume/make_move/resign know which session to use. */
  const activeMatchByUser = new Map<UserId, string>();

  function userIdFor(socket: Socket): UserId {
    // Wallet-auth (MVP): the client declares its address via
    // socket.handshake.auth.walletAddress (see apps/web lib/wallet.ts +
    // lib/socketSingleton.ts). This is NOT cryptographic verification — a
    // malicious client could claim any address without proving control of
    // it. Production would need a signed challenge. Falls back to socket.id
    // when absent/invalid so dev/test clients without a wallet still work.
    // Ledger users are upserted lazily on first use.
    const walletAddress = socket.handshake.auth?.walletAddress;
    if (typeof walletAddress === "string" && isAddress(walletAddress)) {
      return walletAddress;
    }
    return socket.id;
  }

  io.on("connection", (socket: Socket) => {
    const userId = userIdFor(socket);
    socket.data.userId = userId;
    socketsByUser.set(userId, socket);
    store.upsertUser(userId, `wallet:${userId}`);

    socket.on("join_queue", (payload) => {
      if (payload.mode === "ARENA") {
        const stake = payload.stake ?? 0;
        if (balanceOf(store, userId) < stake) {
          socket.emit("error", { code: "INSUFFICIENT_BALANCE", msg: "Insufficient balance for stake" });
          return;
        }
      }

      const entry: QueueEntry = { userId, mode: payload.mode, stake: payload.stake };
      const pair = matchmaker.join(entry);
      socket.emit("queue_joined", {});

      if (!pair) return;

      const [a, b] = pair;
      const matchId = randomUUID();
      const players: Record<PlayerId, UserId> = { P1: a.userId, P2: b.userId };

      const session = new MatchSession({
        matchId,
        mode: a.mode,
        stake: a.stake ?? 0,
        players,
        store,
        emit: (targetUser, event, evtPayload) => {
          // Bridging a generic (event, payload) emit into socket.io's
          // per-event typed overloads.
          const emitAny = (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            target: { emit: (...args: any[]) => unknown },
          ) => target.emit(event, evtPayload);
          if (targetUser === "*") {
            emitAny(io.to(matchId));
          } else {
            const target = socketsByUser.get(targetUser);
            if (target) emitAny(target);
          }
        },
      });
      sessions.set(matchId, session);

      for (const p of [a, b]) {
        activeMatchByUser.set(p.userId, matchId);
        socketsByUser.get(p.userId)?.join(matchId);
      }

      for (const [p, color] of [[a, "P1"] as const, [b, "P2"] as const]) {
        socketsByUser.get(p.userId)?.emit("match_found", {
          matchId,
          opponent: p === a ? b.userId : a.userId,
          color,
          initialState: serializeGameState(session.state),
          clocks: session.state.clocks,
        });
      }
    });

    socket.on("cancel_queue", () => {
      matchmaker.cancel(userId);
    });

    socket.on("make_move", ({ matchId, at }) => {
      sessions.get(matchId)?.makeMove(userId, at);
    });

    socket.on("resign", ({ matchId }) => {
      sessions.get(matchId)?.resign(userId);
    });

    socket.on("resume", ({ matchId }) => {
      socket.join(matchId);
      sessions.get(matchId)?.resume(userId);
    });

    socket.on("disconnect", () => {
      socketsByUser.delete(userId);
      const matchId = activeMatchByUser.get(userId);
      if (matchId) sessions.get(matchId)?.disconnect(userId);
    });
  });

  return io;
}
