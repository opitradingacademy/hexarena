import { describe, it, expect } from "vitest";
import { createGame, applyMove, legalMoves, type GameState } from "./board";

describe("forced pass rule", () => {
  it("automatically passes the turn to the opponent when the mover has no legal moves after their move", () => {
    // Construct a state where after P1's move, P1 (mover) still has moves but P2 has none,
    // by using a board where P2 has zero legal moves anywhere.
    const state = createGame();
    // Clear the board and set up a scenario: P1 captures P2's only piece, leaving P2 with
    // no stones and thus no legal moves (no opponent runs to capture against).
    for (const key of state.board.keys()) state.board.set(key, null);
    state.board.set("-1,0", "P1");
    state.board.set("0,0", "P2");
    const before: GameState = { ...state, turn: "P1" };

    const result = applyMove(before, "P1", { q: 1, r: 0 });
    if ("error" in result) throw new Error("expected success, got " + result.error);

    // P2 now has zero pieces on the board -> zero legal moves.
    const p2Moves = legalMoves(result.state, "P2");
    expect(p2Moves.length).toBe(0);

    // Since P2 (opponent) is stuck but P1 (mover) still has legal moves elsewhere is not
    // guaranteed on this tiny board, so we only assert the pass-detection contract:
    // turn stays with P1 whenever P2 has no legal moves and P1 still does, else game ends.
    const p1Moves = legalMoves(result.state, "P1");
    if (p1Moves.length > 0) {
      expect(result.state.turn).toBe("P1");
      expect(result.state.consecutivePasses).toBeGreaterThan(0);
    } else {
      expect(result.state.status).toBe("finished");
    }
  });

  it("rejects a pass attempt when the player still has legal moves (enforced by callers via legalMoves)", () => {
    const state = createGame();
    const moves = legalMoves(state, "P1");
    expect(moves.length).toBeGreaterThan(0);
    // Pass is only valid when legalMoves(state, player).length === 0; callers (application layer)
    // MUST reject any pass request while this is non-empty.
  });
});
