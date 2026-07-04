import { describe, it, expect } from "vitest";
import { createGame, legalMoves, type GameState } from "./board";
import { chooseBotMove } from "./bot";

function emptyState(): GameState {
  const state = createGame();
  for (const key of state.board.keys()) {
    state.board.set(key, null);
  }
  return state;
}

describe("chooseBotMove", () => {
  it("returns null when the player has no legal move", () => {
    const state = emptyState();
    expect(chooseBotMove(state, "P1")).toBeNull();
  });

  it("always returns one of the moves with the maximum capture count", () => {
    const state = emptyState();
    // Single-capture setup: P1(-1,0) P2(0,0), P1 plays (1,0) capturing 1.
    state.board.set("-1,0", "P1");
    state.board.set("0,0", "P2");
    // Two-capture setup: same placement cell also encloses a second run.
    state.board.set("1,-1", "P2");
    state.board.set("1,-2", "P1");
    // A second, unrelated single-capture opportunity elsewhere on the board.
    state.board.set("-2,2", "P1");
    state.board.set("-1,2", "P2");

    const moves = legalMoves(state, "P1");
    expect(moves.length).toBeGreaterThan(1);

    const chosen = chooseBotMove(state, "P1");
    expect(chosen).toEqual({ q: 1, r: 0 });
  });

  it("picks a legal move for the requested player from the real starting position", () => {
    const state = createGame();
    const move = chooseBotMove(state, "P1");
    expect(move).not.toBeNull();
    const moves = legalMoves(state, "P1");
    expect(moves).toContainEqual(move);
  });
});
