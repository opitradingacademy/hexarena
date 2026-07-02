/**
 * WebSocket (Socket.IO) wire contract. See realtime-protocol spec.
 * Server is sole authority: client sends intent, server validates and broadcasts state.
 */

import type { Axial, GameState, PlayerId } from "../domain/board";

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

export type ClientToServerEvents = {
  join_queue: (payload: JoinQueuePayload) => void;
  cancel_queue: (payload: CancelQueuePayload) => void;
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
  initialState: GameState;
  clocks: Record<PlayerId, number>;
};

export type MoveResultPayload = {
  matchId: MatchId;
  by: PlayerId;
  at: Axial;
  captures: Axial[];
  nextState: GameState;
  clocks: Record<PlayerId, number>;
};

export type MoveRejectedReason =
  | "wrong-turn"
  | "occupied"
  | "out-of-bounds"
  | "no-capture"
  | "game-over";

export type MoveRejectedPayload = {
  reason: MoveRejectedReason;
};

export type ClockTickPayload = {
  clocks: Record<PlayerId, number>;
};

export type OpponentDisconnectedPayload = {
  /** Fixed at 30000ms for MVP — see realtime-protocol spec "Disconnection Grace Window". */
  graceMs: number;
};

export type OpponentReconnectedPayload = Record<string, never>;

export type ArenaSettlementInfo = {
  prizeUSD: number;
  settleTxPending: boolean;
};

export type GameOverReason = "majority" | "draw" | "timeout" | "resign" | "abandon";

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

export type ServerToClientEvents = {
  queue_joined: (payload: QueueJoinedPayload) => void;
  match_found: (payload: MatchFoundPayload) => void;
  move_result: (payload: MoveResultPayload) => void;
  move_rejected: (payload: MoveRejectedPayload) => void;
  clock_tick: (payload: ClockTickPayload) => void;
  opponent_disconnected: (payload: OpponentDisconnectedPayload) => void;
  opponent_reconnected: (payload: OpponentReconnectedPayload) => void;
  game_over: (payload: GameOverPayload) => void;
  error: (payload: ErrorPayload) => void;
};

export const DISCONNECT_GRACE_MS = 30_000;
