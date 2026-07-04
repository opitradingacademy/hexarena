import { describe, it, expect } from "vitest";
import { createGame, cellKey, ALL_CELLS, serializeGameState, deserializeGameState, MIN_MATCH_CLOCK_MS } from "./board";

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

  it("initializes a single shared match clock, not one per player", () => {
    const state = createGame();
    expect(state.matchClockMs).toBeGreaterThan(0);
    expect(state.matchStartedAt).toBeGreaterThan(0);
  });

  it("clamps the initial match clock to a minimum of 3 minutes", () => {
    const state = createGame(undefined, 1000);
    expect(state.matchClockMs).toBe(MIN_MATCH_CLOCK_MS);
  });

  it("accepts a match clock above the minimum as-is", () => {
    const state = createGame(undefined, MIN_MATCH_CLOCK_MS + 60_000);
    expect(state.matchClockMs).toBe(MIN_MATCH_CLOCK_MS + 60_000);
  });
});

describe("GameState wire (de)serialization — Socket.IO JSON boundary", () => {
  it("round-trips board through JSON without losing entries (Map is not JSON-serializable)", () => {
    const state = createGame();
    const wire = serializeGameState(state);
    const json = JSON.parse(JSON.stringify(wire));
    const restored = deserializeGameState(json);

    expect(restored.board.size).toBe(state.board.size);
    for (const [key, value] of state.board) {
      expect(restored.board.get(key)).toBe(value);
    }
    expect(restored.turn).toBe(state.turn);
    expect(restored.matchClockMs).toEqual(state.matchClockMs);
    expect(restored.matchStartedAt).toEqual(state.matchStartedAt);
    expect(restored.status).toBe(state.status);
    expect(restored.consecutivePasses).toBe(state.consecutivePasses);
  });
});
