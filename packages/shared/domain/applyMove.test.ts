import { describe, it, expect } from "vitest";
import { createGame, applyMove, legalMoves } from "./board";

describe("applyMove", () => {
  it("flips a single enclosed run in one direction", () => {
    const state = createGame();
    const moves = legalMoves(state, "P1");
    expect(moves.length).toBeGreaterThan(0);
    const move = moves[0];
    const result = applyMove(state, "P1", move);
    if ("error" in result) throw new Error("expected success, got " + result.error);
    expect(result.captures.length).toBeGreaterThan(0);
    expect(result.state.board.get(`${move.q},${move.r}`)).toBe("P1");
    for (const c of result.captures) {
      expect(result.state.board.get(`${c.q},${c.r}`)).toBe("P1");
    }
  });

  it("rejects a move on an occupied cell", () => {
    const state = createGame();
    const result = applyMove(state, "P1", { q: -1, r: 0 });
    // (-1,0) is occupied by a starting stone
    if (!("error" in result)) throw new Error("expected error for occupied cell");
    expect(result.error).toBeDefined();
  });

  it("rejects a move that captures nothing", () => {
    const state = createGame();
    // (4,-4) is a corner cell far from any opponent piece — cannot capture.
    const result = applyMove(state, "P1", { q: 4, r: -4 });
    if (!("error" in result)) throw new Error("expected error for non-capturing move");
    expect(result.error).toBeDefined();
  });

  it("resolves simultaneous multi-direction captures", () => {
    const state = createGame();
    // Build a controlled scenario: P1 at (-1,0) and (1,0); P2 stones sandwiched at (0,0) needing capture
    // in two directions by placing at a junction cell.
    for (const key of state.board.keys()) {
      state.board.set(key, null);
    }
    // Horizontal axis capture: P1(-1,0) P2(0,0) place P1 at (1,0)
    state.board.set("-1,0", "P1");
    state.board.set("0,0", "P2");
    // Vertical-ish axis capture: P1(0,-2) P2(0,-1) then place P1 at (0,0)... instead use the SAME placement cell (1,0)
    // to enclose two different opponent runs from two directions.
    state.board.set("1,-1", "P2");
    state.board.set("1,-2", "P1");
    const result = applyMove(state, "P1", { q: 1, r: 0 });
    if ("error" in result) throw new Error("expected success, got " + result.error);
    expect(result.captures).toEqual(
      expect.arrayContaining([
        { q: 0, r: 0 },
        { q: 1, r: -1 },
      ]),
    );
    expect(result.captures.length).toBe(2);
  });
});
