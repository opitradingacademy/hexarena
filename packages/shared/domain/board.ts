/**
 * Pure hex-Othello domain engine. NO I/O — no Socket.IO, no timers, no DB.
 * See design.md "Domain / application boundary" (D3) and the Game Engine spec.
 */

export type PlayerId = "P1" | "P2";

export type Axial = { q: number; r: number };

export type GameStatus = "active" | "finished";

export type GameState = {
  board: Map<string, PlayerId | null>;
  turn: PlayerId;
  /** Single shared match clock, ms remaining. Ticks in real time regardless of whose turn it is — see shared-match-timer design D1/D2. */
  matchClockMs: number;
  /** `Date.now()` at match creation — the application layer recomputes `matchClockMs` from this to avoid `setInterval` drift (design D2). */
  matchStartedAt: number;
  status: GameStatus;
  /** Consecutive forced passes with no capturing move for the player to act. */
  consecutivePasses: number;
};

export type ApplyMoveError =
  | "wrong-turn"
  | "occupied"
  | "out-of-bounds"
  | "no-capture"
  | "game-over";

export type ApplyMoveResult =
  | { state: GameState; captures: Axial[] }
  | { error: ApplyMoveError };

export type EndResult = {
  over: boolean;
  winner?: PlayerId | null;
  reason?: "majority" | "draw" | "timeout";
};

export const BOARD_RADIUS = 4;
/** Floor for the shared match clock — spec game-engine "Minimum clock floor". */
export const MIN_MATCH_CLOCK_MS = 3 * 60 * 1000;

const DIRECTIONS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function cellKey(a: Axial): string {
  return `${a.q},${a.r}`;
}

function inBounds(a: Axial, radius = BOARD_RADIUS): boolean {
  return Math.max(Math.abs(a.q), Math.abs(a.r), Math.abs(a.q + a.r)) <= radius;
}

function buildAllCells(radius = BOARD_RADIUS): Axial[] {
  const cells: Axial[] = [];
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) {
      cells.push({ q, r });
    }
  }
  return cells;
}

export const ALL_CELLS: Axial[] = buildAllCells();

export function otherPlayer(p: PlayerId): PlayerId {
  return p === "P1" ? "P2" : "P1";
}

/** JSON-safe wire form of `GameState` — `Map` does not survive `JSON.stringify` (serializes to `{}`). */
export type SerializedGameState = Omit<GameState, "board"> & {
  board: [string, PlayerId | null][];
};

/** Use before emitting `GameState` over Socket.IO. */
export function serializeGameState(state: GameState): SerializedGameState {
  return { ...state, board: [...state.board.entries()] };
}

/** Use after receiving a wire-form `GameState` from Socket.IO. */
export function deserializeGameState(wire: SerializedGameState): GameState {
  return { ...wire, board: new Map(wire.board) };
}

export function createGame(_seed?: string, matchClockMs: number = MIN_MATCH_CLOCK_MS): GameState {
  const board = new Map<string, PlayerId | null>();
  for (const cell of ALL_CELLS) {
    board.set(cellKey(cell), null);
  }

  // Starting layout: 3 stones per player, symmetric around the empty center,
  // arranged so the opening position already has legal capturing moves
  // (mirrors classic Reversi's "capture available on move one" property).
  const p1Start: Axial[] = [
    { q: -2, r: 0 },
    { q: 2, r: -1 },
    { q: 0, r: 2 },
  ];
  const p2Start: Axial[] = [
    { q: -1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: 1 },
  ];
  for (const c of p1Start) board.set(cellKey(c), "P1");
  for (const c of p2Start) board.set(cellKey(c), "P2");

  return {
    board,
    turn: "P1",
    matchClockMs: Math.max(matchClockMs, MIN_MATCH_CLOCK_MS),
    matchStartedAt: Date.now(),
    status: "active",
    consecutivePasses: 0,
  };
}

/**
 * Computes the union of all captured cells if `player` were to place at `at`.
 * Returns an empty array if the placement captures nothing (illegal placement).
 */
function computeCaptures(board: Map<string, PlayerId | null>, player: PlayerId, at: Axial): Axial[] {
  const opponent = otherPlayer(player);
  const captured: Axial[] = [];

  for (const dir of DIRECTIONS) {
    const run: Axial[] = [];
    let cur: Axial = { q: at.q + dir.q, r: at.r + dir.r };

    while (inBounds(cur)) {
      const occupant = board.get(cellKey(cur));
      if (occupant === opponent) {
        run.push(cur);
        cur = { q: cur.q + dir.q, r: cur.r + dir.r };
        continue;
      }
      if (occupant === player && run.length > 0) {
        captured.push(...run);
      }
      break;
    }
  }

  return captured;
}

export function legalMoves(state: GameState, player: PlayerId = state.turn): Axial[] {
  const moves: Axial[] = [];
  for (const cell of ALL_CELLS) {
    if (state.board.get(cellKey(cell)) !== null) continue;
    if (computeCaptures(state.board, player, cell).length > 0) {
      moves.push(cell);
    }
  }
  return moves;
}

export function applyMove(state: GameState, player: PlayerId, at: Axial): ApplyMoveResult {
  if (state.status === "finished") {
    return { error: "game-over" };
  }
  if (player !== state.turn) {
    return { error: "wrong-turn" };
  }
  if (!inBounds(at)) {
    return { error: "out-of-bounds" };
  }
  if (state.board.get(cellKey(at)) !== null) {
    return { error: "occupied" };
  }

  const captures = computeCaptures(state.board, player, at);
  if (captures.length === 0) {
    return { error: "no-capture" };
  }

  const board = new Map(state.board);
  board.set(cellKey(at), player);
  for (const c of captures) {
    board.set(cellKey(c), player);
  }

  const opponent = otherPlayer(player);
  const intermediate: GameState = {
    board,
    turn: opponent,
    matchClockMs: state.matchClockMs,
    matchStartedAt: state.matchStartedAt,
    status: "active",
    consecutivePasses: 0,
  };

  const boardFull = [...board.values()].every((v) => v !== null);
  const opponentMoves = legalMoves(intermediate, opponent);
  const selfMoves = legalMoves(intermediate, player);

  let turn: PlayerId = opponent;
  let consecutivePasses = state.consecutivePasses;
  let status: GameStatus = "active";

  if (boardFull) {
    status = "finished";
  } else if (opponentMoves.length > 0) {
    turn = opponent;
    consecutivePasses = 0;
  } else if (selfMoves.length > 0) {
    // Forced pass: opponent has no legal moves, turn stays with the mover.
    turn = player;
    consecutivePasses = state.consecutivePasses + 1;
  } else {
    // Both players stuck.
    status = "finished";
    consecutivePasses = state.consecutivePasses + 1;
  }

  return {
    state: {
      board,
      turn,
      matchClockMs: state.matchClockMs,
      matchStartedAt: state.matchStartedAt,
      status,
      consecutivePasses,
    },
    captures,
  };
}

function majorityResult(state: GameState): EndResult {
  let p1 = 0;
  let p2 = 0;
  for (const v of state.board.values()) {
    if (v === "P1") p1++;
    if (v === "P2") p2++;
  }

  if (p1 === p2) {
    return { over: true, winner: null, reason: "draw" };
  }
  return { over: true, winner: p1 > p2 ? "P1" : "P2", reason: "majority" };
}

export function checkEnd(state: GameState): EndResult {
  // Shared-clock expiry no longer means an automatic loss for whoever had the
  // turn (the old per-player sudden-death rule). It is now just a TRIGGER that
  // forces the same majority-of-cells evaluation used for board-full/both-stuck
  // — see shared-match-timer spec "Clock Expiry" and design D3.
  if (state.matchClockMs <= 0) {
    const result = majorityResult(state);
    return { ...result, reason: "timeout" };
  }

  const boardFull = [...state.board.values()].every((v) => v !== null);
  const bothStuck = state.status === "finished";

  if (!boardFull && !bothStuck) {
    return { over: false };
  }

  return majorityResult(state);
}
