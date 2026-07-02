/**
 * Orchestrates one match: domain engine + clock + disconnect grace +
 * ledger settlement + chain settlement stub. Framework-agnostic — the
 * Socket.IO layer (server.ts) wires `emit` to actual socket rooms.
 *
 * Specs: realtime-protocol (Move Validation, Disconnection Grace Window,
 * Game Over Delivery), arena-settlement (all settlement requirements).
 */
import {
  applyMove,
  checkEnd,
  createGame,
  otherPlayer,
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

    // Blitz clock: decrement the player-to-move's clock every tick,
    // broadcast clock_tick, and finalize as a timeout loss when it expires
    // — realtime-protocol / arena-settlement "Clock Expiry".
    this.clockInterval = this.setIntervalFn(() => {
      if (this.finished) return;
      const toMove = this.state.turn;
      this.state = {
        ...this.state,
        clocks: { ...this.state.clocks, [toMove]: Math.max(0, this.state.clocks[toMove] - TICK_MS) },
      };
      this.emit("*", "clock_tick", { clocks: this.state.clocks });

      const end = checkEnd(this.state);
      if (end.over) {
        this.finalize("timeout", end.winner ?? null);
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
      nextState: this.state,
      clocks: this.state.clocks,
    };
    this.emit("*", "move_result", payload);

    const end = checkEnd(this.state);
    if (end.over) {
      this.finalize(end.reason === "timeout" ? "timeout" : (end.reason ?? "majority"), end.winner ?? null);
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
        // (spec "Arena game over pending settlement"). Real signer in PR3.
        void settleOnChain(this.matchId, winnerId, payout);
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
