/**
 * WebSocket (Socket.IO) wire contract. See realtime-protocol spec.
 * Server is sole authority: client sends intent, server validates and broadcasts state.
 */

import type { Axial, PlayerId, SerializedGameState } from "../domain/board";

export type GameMode = "CASUAL" | "ARENA";

export type MatchId = string;

// ---------------------------------------------------------------------------
// Client -> Server events
// ---------------------------------------------------------------------------

export type JoinQueuePayload = {
  mode: GameMode;
  /** Required when mode === "ARENA"; USD stake amount. */
  stake?: number;
};

export type CancelQueuePayload = Record<string, never>;

export type MakeMovePayload = {
  matchId: MatchId;
  at: Axial;
};

export type ResignPayload = {
  matchId: MatchId;
};

export type ResumePayload = {
  matchId: MatchId;
};

export type CreateInvitePayload = {
  mode: GameMode;
  /** Required when mode === "ARENA"; USD stake amount. */
  stake?: number;
};

export type JoinInvitePayload = {
  code: string;
};

export type ClientToServerEvents = {
  join_queue: (payload: JoinQueuePayload) => void;
  cancel_queue: (payload: CancelQueuePayload) => void;
  /** Skips the queue entirely — starts an immediate solo CASUAL match against the local bot. */
  play_vs_bot: () => void;
  /** Generates a single-use invite code that pairs the creator with whoever calls join_invite. */
  create_invite: (payload: CreateInvitePayload) => void;
  /** Skips the queue entirely — pairs directly with the invite's creator. */
  join_invite: (payload: JoinInvitePayload) => void;
  make_move: (payload: MakeMovePayload) => void;
  resign: (payload: ResignPayload) => void;
  resume: (payload: ResumePayload) => void;
};

// ---------------------------------------------------------------------------
// Server -> Client events
// ---------------------------------------------------------------------------

export type QueueJoinedPayload = Record<string, never>;

export type MatchFoundPayload = {
  matchId: MatchId;
  opponent: string;
  color: PlayerId;
  /** JSON-safe wire form — reconstruct with `deserializeGameState` from `@hexarena/shared/domain/board`. */
  initialState: SerializedGameState;
  /** Single shared match clock (ms remaining) — see shared-match-timer spec. Identical for both clients; there is only one clock. */
  matchClockMs: number;
};

export type MoveResultPayload = {
  matchId: MatchId;
  by: PlayerId;
  at: Axial;
  captures: Axial[];
  /** JSON-safe wire form — reconstruct with `deserializeGameState` from `@hexarena/shared/domain/board`. */
  nextState: SerializedGameState;
  /** Single shared match clock (ms remaining) — see shared-match-timer spec. */
  matchClockMs: number;
};

export type MoveRejectedReason =
  "wrong-turn" | "occupied" | "out-of-bounds" | "no-capture" | "game-over";

export type MoveRejectedPayload = {
  reason: MoveRejectedReason;
};

export type ClockTickPayload = {
  /** Single shared match clock (ms remaining) — see shared-match-timer spec "Shared Clock Tick Broadcast". */
  matchClockMs: number;
};

export type OpponentDisconnectedPayload = {
  /** Fixed at 30000ms for MVP — see realtime-protocol spec "Disconnection Grace Window". */
  graceMs: number;
};

export type OpponentReconnectedPayload = Record<string, never>;

export type InviteCreatedPayload = {
  code: string;
  /** Epoch ms — the invite stops working after this (single-use, short TTL). */
  expiresAt: number;
};

export type ArenaSettlementInfo = {
  prizeUSD: number;
  settleTxPending: boolean;
};

export type GameOverReason =
  "majority" | "draw" | "timeout" | "resign" | "abandon" | "turn-timeout";

export type GameOverPayload = {
  winner: PlayerId | null;
  reason: GameOverReason;
  /** Present only for Arena matches; absent for Casual — see "Game Over Delivery". */
  arena?: ArenaSettlementInfo;
};

export type ErrorCode = "INSUFFICIENT_BALANCE" | "INVALID_STATE" | "NOT_FOUND" | "UNKNOWN";

export type ErrorPayload = {
  code: ErrorCode;
  msg: string;
};

/**
 * Server-to-client reconnection snapshot — sent in response to `resume`
 * (also fired for late subscribers once on join). Reconstruct with
 * `deserializeGameState` from `@hexarena/shared/domain/board`.
 *
 * The bug this fixes: when a player briefly disconnects mid-match
 * (MiniPay background, screen lock, WebView suspend) and reconnects,
 * the client's `useState(createGame())` initial state diverges from
 * the server's. The client then sends moves the server has already
 * rejected, and the user has no idea why clicks "don't work".
 */
export type MatchSnapshotPayload = {
  matchId: MatchId;
  /** JSON-safe wire form — reconstruct with `deserializeGameState` from `@hexarena/shared/domain/board`. */
  state: SerializedGameState;
  /** Present only if the match ended while the client was disconnected. */
  gameOver?: GameOverPayload;
  /** Single shared match clock (ms remaining). */
  matchClockMs: number;
};

export type ServerToClientEvents = {
  queue_joined: (payload: QueueJoinedPayload) => void;
  match_found: (payload: MatchFoundPayload) => void;
  move_result: (payload: MoveResultPayload) => void;
  move_rejected: (payload: MoveRejectedPayload) => void;
  clock_tick: (payload: ClockTickPayload) => void;
  opponent_disconnected: (payload: OpponentDisconnectedPayload) => void;
  opponent_reconnected: (payload: OpponentReconnectedPayload) => void;
  invite_created: (payload: InviteCreatedPayload) => void;
  game_over: (payload: GameOverPayload) => void;
  match_state_snapshot: (payload: MatchSnapshotPayload) => void;
  error: (payload: ErrorPayload) => void;
};

export const DISCONNECT_GRACE_MS = 30_000;
