import { describe, it, expect } from "vitest";
import { createGame, cellKey, ALL_CELLS } from "./board";

describe("createGame", () => {
  it("creates a radius-4 hex board with 61 cells", () => {
    const state = createGame();
    expect(state.board.size).toBe(61);
    expect(ALL_CELLS.length).toBe(61);
  });

  it("places 3 starting stones per player around the center, center empty", () => {
    const state = createGame();
    expect(state.board.get(cellKey({ q: 0, r: 0 }))).toBeNull();
    const counts = { P1: 0, P2: 0 };
    for (const v of state.board.values()) {
      if (v === "P1") counts.P1++;
      if (v === "P2") counts.P2++;
    }
    expect(counts.P1).toBe(3);
    expect(counts.P2).toBe(3);
  });

  it("starts with P1 to move and status active", () => {
    const state = createGame();
    expect(state.turn).toBe("P1");
    expect(state.status).toBe("active");
    expect(state.consecutivePasses).toBe(0);
  });

  it("initializes clocks for both players", () => {
    const state = createGame();
    expect(state.clocks.P1).toBeGreaterThan(0);
    expect(state.clocks.P2).toBeGreaterThan(0);
  });
});
