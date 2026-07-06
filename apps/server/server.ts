/**
 * Socket.IO application layer — wires transport events to Matchmaker +
 * MatchSession + ledger, per realtime-protocol spec. This module builds
 * the Socket.IO server; index.ts starts it listening.
 */
import { Server, type Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createPublicClient, http, isAddress, getAddress, type PublicClient } from "viem";
import { celo } from "viem/chains";
import type {
  ClientToServerEvents,
  GameMode,
  ServerToClientEvents,
} from "@hexarena/shared/protocol";
import { serializeGameState, type PlayerId } from "@hexarena/shared/domain/board";
import { BOT_USER_ID } from "@hexarena/shared/domain/bot";
import type { LedgerStore, UserId } from "./ledger/types";
import { balanceOf } from "./ledger/ledger";
import { Matchmaker, type QueueEntry } from "./matchmaking";
import { MatchSession } from "./matchSession";
import { handleDepositRequest } from "./depositEndpoint";
import { handleCashoutRequest, type WithdrawOnChainConfig } from "./cashoutEndpoint";
import type { VerifyDepositProvider, MinimalReceipt } from "./chain/verifyDeposit";
import { applyCorsHeaders } from "./cors";

/**
 * Minimal shape of a viem PublicClient that verifyDeposit needs.
 * Splitting it this way keeps verifyDeposit's unit tests free of viem
 * chain plumbing and lets the server inject its real RPC client.
 */
type CeloPublicClient = Pick<PublicClient, "getTransactionReceipt">;

/** How long a CASUAL queue entry waits for a human before falling back to the bot. */
const BOT_FALLBACK_MS = 10_000;
/** Invite links are single-use and short-lived — no point keeping a stale one around. */
const INVITE_TTL_MS = 5 * 60 * 1000;

export type CreateServerOpts = {
  /** Treasury address that receives user Arena stakes. Required for /api/deposit. */
  treasuryAddress: `0x${string}`;
  /** Settlement token contract address (e.g. USDT on Celo Mainnet). Required for /api/deposit. */
  tokenAddress: `0x${string}`;
  /**
   * viem public client for reading tx receipts. Required for /api/deposit.
   * Kept for compatibility / fallback; the server prefers `extraPublicClients`
   * (parallel multi-RPC) over this single client when both are provided —
   * see the comment on `provider` below for the rationale.
   */
  publicClient: CeloPublicClient;
  /**
   * Additional public clients to fan out to in parallel each poll. Each
   * one returns its OWN getTransactionReceipt result; the first non-null
   * one wins. Required because viem's `fallback([...])` ONLY falls back
   * on transport errors (timeout, 5xx) — when an RPC returns null for a
   * tx it doesn't have yet (because propagation lag), `fallback` accepts
   * that null and never tries the next transport. Production 2026-07-03
   * showed publicNode taking >40s to surface a tx that forno and
   * CeloScan already had, so a single RPC could mean the modal never
   * progresses.
   */
  extraPublicClients?: readonly CeloPublicClient[];
  /**
   * Allowed origin for CORS. Defaults to '*' which is fine for an MVP
   * that only serves the hexarena Mini App. Pass the deployed Vercel
   * URL to lock down further.
   */
  corsOrigin?: string | "*";
  /** Injectable for tests; defaults to BOT_FALLBACK_MS (10s). */
  botFallbackMs?: number;
  /**
   * Injected cash-out chain adapter. Production wires this to the real
   * `withdrawUsdtOnChain` from `apps/server/chain/withdraw.ts`. Tests
   * pass a mock. When omitted, /api/cashout returns 503 NO_RPC (or
   * CONFIG_ERROR if OPERATOR_PRIVATE_KEY is missing) — same pattern
   * as the deposit endpoint.
   */
  withdrawFn?: WithdrawOnChainConfig["withdrawFn"];
};

export function createServer(
  httpServer: HttpServer,
  store: LedgerStore,
  opts: CreateServerOpts = {} as CreateServerOpts,
) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: "*" },
  });
  const botFallbackMs = opts.botFallbackMs ?? BOT_FALLBACK_MS;

  // Make /api/deposit a no-op (no provider-stub) when createServer is
  // called without deposit wiring — needed by unit tests that don't
  // care about REST endpoints. Production always wires both primary and
  // extra clients via index.ts.
  const primaryClient = opts.publicClient;
  const extraClients = opts.extraPublicClients ?? [];
  const provider: VerifyDepositProvider | null = primaryClient
    ? {
        getTransactionReceipt: async (args) => {
          // TEMP DIAG 2026-07-03: log every receipt query so we can
          // measure how often each RPC wins in production (the parallel
          // multi-RPC setup makes it non-obvious without instrumentation).
          const allClients = [primaryClient, ...extraClients];
          console.log(
            `[HexArena:server:rpc] getTransactionReceipt(${args.hash}) fanning to ${allClients.length} clients`,
          );
          const start = Date.now();
          const tries = await Promise.allSettled(
            allClients.map(async (c, idx) => {
              const clientStart = Date.now();
              try {
                const r = await c.getTransactionReceipt(args);
                const elapsed = Date.now() - clientStart;
                console.log(
                  `[HexArena:server:rpc] client[${idx}] returned ${r ? "receipt" : "null"} in ${elapsed}ms`,
                );
                return r;
              } catch (e) {
                const elapsed = Date.now() - clientStart;
                console.log(
                  `[HexArena:server:rpc] client[${idx}] THREW after ${elapsed}ms: ${(e as Error).message}`,
                );
                throw e;
              }
            }),
          );
          const totalElapsed = Date.now() - start;
          for (const result of tries) {
            if (result.status === "fulfilled") {
              const r = result.value as MinimalReceipt | null;
              if (r) {
                console.log(`[HexArena:server:rpc] served from cache, total ${totalElapsed}ms`);
                return r;
              }
            }
          }
          console.log(`[HexArena:server:rpc] all clients returned null after ${totalElapsed}ms`);
          return null;
        },
      }
    : null;

  // HTTP request dispatcher — single hand-off point for all REST endpoints.
  httpServer.on("request", async (req, res) => {
    // TEMP DIAG 2026-07-03: log every request so we can confirm the
    // dispatch is firing and identify where traffic gets stuck when
    // Railway reports the container as Online but HTTP responses hang.
    console.log(
      `[HexArena:server:req] ${req.method} ${req.url} from ${req.headers["x-forwarded-for"] ?? "unknown"}`,
    );
    const url = new URL(req.url ?? "", "http://localhost");
    const corsOrigin: string | "*" = opts.corsOrigin ?? "*";
    const corsHeaders: Record<string, string | string[] | undefined> = {};
    applyCorsHeaders(corsHeaders, corsOrigin);

    // CORS preflight — the MiniPay WebView sends OPTIONS before the
    // POST /api/deposit when the origin (Vercel) differs from the API
    // (Railway). Without handling OPTIONS explicitly the browser blocks
    // the actual request.
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    // POST /api/deposit — credit ledger with on-chain USDT transfer (see
    // depositEndpoint.ts NatSpec for the full contract).
    // GET  /api/balance?wallet=<addr> — read ledger balance.
    // Both routes are owned by handleDepositRequest, which decides
    // itself which path/verb it services. The router MUST call it for
    // every recognized path that handleDepositRequest can handle — the
    // inline /api/deposit-only call here is what made /api/balance a
    // silent 502 in production 2026-07-03.
    if (url.pathname === "/api/deposit" || url.pathname === "/api/balance") {
      // Without a provider the server can still serve /api/balance
      // (it's a pure read off the in-memory ledger). /api/deposit
      // without a provider is a no-go — return 503 NO_RPC so the
      // operator sees a clear signal that creation is misconfigured.
      if (!provider && url.pathname === "/api/deposit") {
        res.writeHead(503, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({ ok: false, code: "NO_RPC" }));
        return;
      }
      await handleDepositRequest(req, res, store, {
        treasury: opts.treasuryAddress,
        tokenAddress: opts.tokenAddress,
        // Without a provider, /api/balance still works (no RPC needed).
        // Pass an inert stub that returns null so /api/deposit fails
        // fast inside the handler rather than crashing on provider
        // access.
        provider: provider ?? {
          getTransactionReceipt: async () => null as never,
        },
        settleTokenDecimals: 6,
      });
      return;
    }

    // POST /api/cashout — debit ledger and broadcast withdrawUser on
    // ArenaSettlement. Mirrors the deposit wiring: when createServer
    // is called without a withdrawFn, /api/cashout fails fast with a
    // clear code (NO_WITHDRAW_FN for missing adapter, CONFIG_ERROR
    // for missing OPERATOR_PRIVATE_KEY).
    if (url.pathname === "/api/cashout") {
      if (!opts.withdrawFn) {
        res.writeHead(503, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({ ok: false, code: "NO_WITHDRAW_FN" }));
        return;
      }
      await handleCashoutRequest(req, res, store, { withdrawFn: opts.withdrawFn });
      return;
    }

    // GET /matches/:userId — read endpoint for the History screen.
    const match = url.pathname.match(/^\/matches\/([^/]+)$/);
    if (req.method === "GET" && match) {
      const userId = decodeURIComponent(match[1]);
      res.writeHead(200, {
        "Content-Type": "application/json",
        ...corsHeaders,
      });
      res.end(JSON.stringify(store.matchHistoryFor(userId)));
    }
  });

  const matchmaker = new Matchmaker();
  const sessions = new Map<string, MatchSession>();
  /** userId -> socket, so MatchSession.emit can target either the room or one player. */
  const socketsByUser = new Map<UserId, Socket>();
  /** userId -> matchId, so disconnect/resume/make_move/resign know which session to use. */
  const activeMatchByUser = new Map<UserId, string>();
  /** userId -> pending "no human showed up" bot-fallback timer for CASUAL queue entries. */
  const botFallbackTimers = new Map<UserId, ReturnType<typeof setTimeout>>();
  /** code -> pending invite, single-use and short-lived. */
  const invites = new Map<
    string,
    { inviterUserId: UserId; mode: GameMode; stake: number; expiresAt: number }
  >();

  function clearBotFallback(userId: UserId): void {
    const timer = botFallbackTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      botFallbackTimers.delete(userId);
    }
  }

  /** Creates and wires a MatchSession for `players`, then notifies each player's own socket. */
  function createMatchSession(
    players: Record<PlayerId, UserId>,
    mode: "CASUAL" | "ARENA",
    stake: number,
    botPlayer?: PlayerId,
  ): void {
    const matchId = randomUUID();

    const session = new MatchSession({
      matchId,
      mode,
      stake,
      players,
      store,
      botPlayer,
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

    for (const [color, playerUserId] of Object.entries(players) as [PlayerId, UserId][]) {
      if (playerUserId === BOT_USER_ID) continue;
      activeMatchByUser.set(playerUserId, matchId);
      const socket = socketsByUser.get(playerUserId);
      if (!socket) continue;
      socket.join(matchId);
      const opponentColor: PlayerId = color === "P1" ? "P2" : "P1";
      socket.emit("match_found", {
        matchId,
        opponent: players[opponentColor],
        color,
        initialState: serializeGameState(session.state),
        matchClockMs: session.state.matchClockMs,
      });
    }
  }

  /** Starts a solo CASUAL match against the local bot (P2), skipping the queue entirely. */
  function startBotMatch(humanUserId: UserId): void {
    createMatchSession({ P1: humanUserId, P2: BOT_USER_ID }, "CASUAL", 0, "P2");
  }

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
      return getAddress(walletAddress);
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
          socket.emit("error", {
            code: "INSUFFICIENT_BALANCE",
            msg: "Insufficient balance for stake",
          });
          return;
        }
      }

      const entry: QueueEntry = { userId, mode: payload.mode, stake: payload.stake };
      const pair = matchmaker.join(entry);
      socket.emit("queue_joined", {});

      if (!pair) {
        // No human opponent waiting — CASUAL entries fall back to the local
        // bot after a short wait so a new/lone user isn't stuck staring at
        // a spinner. ARENA never falls back (it involves real stakes).
        if (payload.mode === "CASUAL") {
          clearBotFallback(userId);
          botFallbackTimers.set(
            userId,
            setTimeout(() => {
              botFallbackTimers.delete(userId);
              // Only start the bot match if this user is still queued
              // (matchmaker.cancel returns true iff it found+removed them).
              if (matchmaker.cancel(userId)) startBotMatch(userId);
            }, botFallbackMs),
          );
        }
        return;
      }

      const [a, b] = pair;
      clearBotFallback(a.userId);
      clearBotFallback(b.userId);
      const players: Record<PlayerId, UserId> = { P1: a.userId, P2: b.userId };
      createMatchSession(players, a.mode, a.stake ?? 0);
    });

    socket.on("play_vs_bot", () => {
      startBotMatch(userId);
    });

    socket.on("create_invite", (payload) => {
      if (payload.mode === "ARENA" && balanceOf(store, userId) < (payload.stake ?? 0)) {
        socket.emit("error", {
          code: "INSUFFICIENT_BALANCE",
          msg: "Insufficient balance for stake",
        });
        return;
      }
      const code = randomUUID().slice(0, 8);
      const expiresAt = Date.now() + INVITE_TTL_MS;
      invites.set(code, {
        inviterUserId: userId,
        mode: payload.mode,
        stake: payload.stake ?? 0,
        expiresAt,
      });
      socket.emit("invite_created", { code, expiresAt });
    });

    socket.on("join_invite", ({ code }) => {
      const invite = invites.get(code);
      if (!invite || Date.now() > invite.expiresAt) {
        invites.delete(code);
        socket.emit("error", { code: "NOT_FOUND", msg: "Invite is invalid or has expired" });
        return;
      }
      if (invite.inviterUserId === userId) {
        socket.emit("error", { code: "INVALID_STATE", msg: "You can't join your own invite" });
        return;
      }
      if (!socketsByUser.get(invite.inviterUserId)) {
        invites.delete(code);
        socket.emit("error", { code: "NOT_FOUND", msg: "Invite is invalid or has expired" });
        return;
      }
      if (invite.mode === "ARENA" && balanceOf(store, userId) < invite.stake) {
        socket.emit("error", {
          code: "INSUFFICIENT_BALANCE",
          msg: "Insufficient balance for stake",
        });
        return;
      }
      invites.delete(code);
      createMatchSession({ P1: invite.inviterUserId, P2: userId }, invite.mode, invite.stake);
    });

    socket.on("cancel_queue", () => {
      matchmaker.cancel(userId);
      clearBotFallback(userId);
    });

    socket.on("make_move", ({ matchId, at }) => {
      sessions.get(matchId)?.makeMove(userId, at);
    });

    socket.on("resign", ({ matchId }) => {
      sessions.get(matchId)?.resign(userId);
    });

    socket.on("resume", ({ matchId }) => {
      socket.join(matchId);
      const session = sessions.get(matchId);
      if (!session) {
        // The session is gone — match was cleaned up, abandoned past
        // grace, or never existed. Without an explicit signal the client
        // would just sit on `useState(createGame())` and conclude the
        // page is broken. Emit a NOT_FOUND error so it can navigate away.
        socket.emit("error", { code: "NOT_FOUND", msg: "Match no longer exists" });
        return;
      }
      session.resume(userId);
      // Send the live state so the client hydrates from the same view
      // the server has — without this, a player who briefly disconnected
      // (MiniPay background, screen lock) returns to an empty board,
      // clicks a cell, and gets rejected with no visible feedback.
      socket.emit("match_state_snapshot", session.snapshot());
    });

    socket.on("disconnect", () => {
      socketsByUser.delete(userId);
      clearBotFallback(userId);
      for (const [code, invite] of invites) {
        if (invite.inviterUserId === userId) invites.delete(code);
      }
      const matchId = activeMatchByUser.get(userId);
      if (matchId) sessions.get(matchId)?.disconnect(userId);
    });
  });

  return io;
}
