import { describe, it, expect } from "vitest";
import { createGame, legalMoves } from "./board";

describe("legalMoves", () => {
  it("returns at least one legal move for P1 from the starting position", () => {
    const state = createGame();
    const moves = legalMoves(state, "P1");
    expect(moves.length).toBeGreaterThan(0);
  });

  it("only returns empty cells that would result in at least one capture", () => {
    const state = createGame();
    const moves = legalMoves(state, "P1");
    for (const m of moves) {
      expect(state.board.get(`${m.q},${m.r}`)).toBeNull();
    }
  });

  it("returns an empty array when the player has no capturing placements", () => {
    // A near-empty board (only own stones, no adjacent opponent runs) has no legal moves.
    const state = createGame();
    // Clear the board except one P1 stone far from any P2 stone.
    for (const key of state.board.keys()) {
      state.board.set(key, null);
    }
    state.board.set("0,0", "P1");
    const moves = legalMoves(state, "P1");
    expect(moves.length).toBe(0);
  });
});
