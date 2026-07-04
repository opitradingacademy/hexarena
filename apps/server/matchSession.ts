/**
 * Orchestrates one match: domain engine + clock + disconnect grace +
 * ledger settlement + chain settlement stub. Framework-agnostic — the
 * Socket.IO layer (server.ts) wires `emit` to actual socket rooms.
 *
 * Specs: realtime-protocol (Move Validation, Disconnection Grace Window,
 * Game Over Delivery), arena-settlement (all settlement requirements),
 * shared-match-timer (Clock Expiry — single shared clock, D1/D2/D3).
 */
import {
  applyMove,
  checkEnd,
  createGame,
  otherPlayer,
  serializeGameState,
  type GameState,
  type PlayerId,
} from "@hexarena/shared/domain/board";
import {
  DISCONNECT_GRACE_MS,
  type GameMode,
  type GameOverPayload,
  type GameOverReason,
  type MoveResultPayload,
  type MoveRejectedReason,
} from "@hexarena/shared/protocol";
import type { LedgerStore, MatchId, UserId } from "./ledger/types";
import { holdStake, settleDecisive, settleDraw, voidMatch } from "./ledger/ledger";
import { settleOnChain } from "./chain/settlement";

export type MatchSessionDeps = {
  matchId: MatchId;
  mode: GameMode;
  stake: number;
  players: Record<PlayerId, UserId>;
  store: LedgerStore;
  /** Called for room-wide broadcasts and single-recipient emits alike. */
  emit: (userId: UserId | "*", event: string, payload: unknown) => void;
  /** Injectable for tests; defaults to real timers. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

const TICK_MS = 1000;

function reasonFor(end: { reason?: "majority" | "draw" | "timeout" }): GameOverReason {
  return end.reason === "timeout" ? "timeout" : (end.reason ?? "majority");
}

export class MatchSession {
  readonly matchId: MatchId;
  readonly mode: GameMode;
  readonly stake: number;
  readonly players: Record<PlayerId, UserId>;
  state: GameState;
  private store: LedgerStore;
  private emit: MatchSessionDeps["emit"];
  private setTimeoutFn: typeof setTimeout;
  private clearTimeoutFn: typeof clearTimeout;
  private setIntervalFn: typeof setInterval;
  private clearIntervalFn: typeof clearInterval;
  private graceTimers: Partial<Record<PlayerId, ReturnType<typeof setTimeout>>> = {};
  private clockInterval: ReturnType<typeof setInterval>;
  /** Total ms allotted for the shared match clock — fixed at match creation, used to recompute `matchClockMs` from `Date.now()` each tick (design D2, avoids `setInterval` drift). */
  private readonly totalMatchClockMs: number;
  private finished = false;

  constructor(deps: MatchSessionDeps) {
    this.matchId = deps.matchId;
    this.mode = deps.mode;
    this.stake = deps.stake;
    this.players = deps.players;
    this.store = deps.store;
    this.emit = deps.emit;
    this.setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
    this.setIntervalFn = deps.setIntervalFn ?? setInterval;
    this.clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
    this.state = createGame();
    this.totalMatchClockMs = this.state.matchClockMs;

    if (this.mode === "ARENA") {
      holdStake(this.store, this.players.P1, this.matchId, this.stake);
      holdStake(this.store, this.players.P2, this.matchId, this.stake);
    }

    // Persist match row for history — design.md Ledger Schema `matches`.
    this.store.insertMatch({
      id: this.matchId,
      mode: this.mode,
      p1: this.players.P1,
      p2: this.players.P2,
      stake: this.stake,
      winner: null,
      state: "ACTIVE",
    });

    // Shared match clock: ticks down in real time regardless of whose turn it
    // is (NOT paused/resumed per turn). Recomputed from Date.now() each tick
    // rather than decremented, to avoid setInterval drift over a 3+ minute
    // match (design D2). Expiry no longer means an automatic loss — checkEnd()
    // resolves the winner by the same majority-of-cells rule as any other
    // end-of-game condition (design D3, shared-match-timer spec).
    this.clockInterval = this.setIntervalFn(() => {
      if (this.finished) return;
      const elapsed = Date.now() - this.state.matchStartedAt;
      const matchClockMs = Math.max(0, this.totalMatchClockMs - elapsed);
      this.state = { ...this.state, matchClockMs };
      this.emit("*", "clock_tick", { matchClockMs });

      const end = checkEnd(this.state);
      if (end.over) {
        this.finalize(reasonFor(end), end.winner ?? null);
      }
    }, TICK_MS);
  }

  private playerIdFor(userId: UserId): PlayerId | undefined {
    if (this.players.P1 === userId) return "P1";
    if (this.players.P2 === userId) return "P2";
    return undefined;
  }

  makeMove(userId: UserId, at: { q: number; r: number }): void {
    if (this.finished) {
      this.emit(userId, "move_rejected", { reason: "game-over" satisfies MoveRejectedReason });
      return;
    }
    const player = this.playerIdFor(userId);
    if (!player) return;

    const result = applyMove(this.state, player, at);
    if ("error" in result) {
      this.emit(userId, "move_rejected", { reason: result.error });
      return;
    }

    this.state = result.state;
    const payload: MoveResultPayload = {
      matchId: this.matchId,
      by: player,
      at,
      captures: result.captures,
      nextState: serializeGameState(this.state),
      matchClockMs: this.state.matchClockMs,
    };
    this.emit("*", "move_result", payload);

    const end = checkEnd(this.state);
    if (end.over) {
      this.finalize(reasonFor(end), end.winner ?? null);
    }
  }

  resign(userId: UserId): void {
    if (this.finished) return;
    const player = this.playerIdFor(userId);
    if (!player) return;
    this.finalize("resign", otherPlayer(player));
  }

  disconnect(userId: UserId): void {
    if (this.finished) return;
    const player = this.playerIdFor(userId);
    if (!player) return;

    this.emit("*", "opponent_disconnected", { graceMs: DISCONNECT_GRACE_MS });
    this.graceTimers[player] = this.setTimeoutFn(() => {
      if (this.finished) return;
      this.finalize("abandon", otherPlayer(player));
    }, DISCONNECT_GRACE_MS);
  }

  resume(userId: UserId): boolean {
    const player = this.playerIdFor(userId);
    if (!player) return false;
    const timer = this.graceTimers[player];
    if (!timer) return false;
    this.clearTimeoutFn(timer);
    delete this.graceTimers[player];
    this.emit("*", "opponent_reconnected", {});
    return true;
  }

  private finalize(reason: GameOverReason, winner: PlayerId | null): void {
    if (this.finished) return;
    this.finished = true;
    this.clearIntervalFn(this.clockInterval);
    for (const timer of Object.values(this.graceTimers)) {
      if (timer) this.clearTimeoutFn(timer);
    }

    const payload: GameOverPayload = { winner, reason };

    if (this.mode === "ARENA") {
      if (winner) {
        const winnerId = this.players[winner];
        const loserId = this.players[otherPlayer(winner)];
        const { payout } = settleDecisive(this.store, this.matchId, winnerId, loserId, this.stake, this.stake);
        payload.arena = { prizeUSD: payout, settleTxPending: true };
        // Fire-and-forget: game_over must not block on chain confirmation
        // (spec "Arena game over pending settlement").
        // NOTE: `walletAddress` is a `wallet:${userId}` placeholder until
        // real wallet-auth middleware lands (see server.ts userIdFor) — the
        // on-chain settle() call is wired for real but will only resolve a
        // genuine winner address once auth is real. Out of scope for PR5.
        const winnerAddress = this.store.getUser(winnerId)?.walletAddress ?? winnerId;
        settleOnChain(this.matchId, winnerAddress, payout).catch((err) => {
          console.error(`[settleOnChain] matchId=${this.matchId} failed:`, err);
        });
      } else {
        settleDraw(this.store, this.matchId, this.players.P1, this.players.P2, this.stake, this.stake);
        payload.arena = { prizeUSD: this.stake * 0.8, settleTxPending: false };
      }
    }

    this.store.updateMatch(this.matchId, {
      winner: winner ? this.players[winner] : null,
      state: this.mode === "ARENA" ? "SETTLED" : "FINISHED",
      endedAt: Date.now(),
    });

    this.emit("*", "game_over", payload);
  }

  /** Server-error mid-match void — full refund, no rake, no settle() call. */
  voidForServerError(): void {
    if (this.finished) return;
    this.finished = true;
    this.clearIntervalFn(this.clockInterval);
    for (const timer of Object.values(this.graceTimers)) {
      if (timer) this.clearTimeoutFn(timer);
    }
    if (this.mode === "ARENA") {
      voidMatch(this.store, this.matchId, [
        { userId: this.players.P1, stake: this.stake },
        { userId: this.players.P2, stake: this.stake },
      ]);
    }
    this.emit("*", "game_over", { winner: null, reason: "abandon" } satisfies GameOverPayload);
  }
}
