import { describe, it, expect } from "vitest";
import { createGame, checkEnd, type GameState } from "./board";

function emptyState(overrides: Partial<GameState> = {}): GameState {
  const state = createGame();
  for (const key of state.board.keys()) {
    state.board.set(key, null);
  }
  return { ...state, ...overrides };
}

describe("checkEnd", () => {
  it("declares majority winner by cell count", () => {
    const state = emptyState({ status: "finished" });
    let i = 0;
    for (const key of state.board.keys()) {
      state.board.set(key, i < 33 ? "P1" : "P2");
      i++;
    }
    const result = checkEnd(state);
    expect(result.over).toBe(true);
    expect(result.winner).toBe("P1");
    expect(result.reason).toBe("majority");
  });

  it("declares a draw when cell counts are equal", () => {
    const cells = [...createGame().board.keys()];
    const state = emptyState({ status: "finished" });
    // 61 cells is odd; leave one empty to make 30/30 split for equal counts.
    for (let i = 0; i < cells.length; i++) {
      if (i < 30) state.board.set(cells[i], "P1");
      else if (i < 60) state.board.set(cells[i], "P2");
      // cell 60 stays null
    }
    const result = checkEnd(state);
    expect(result.over).toBe(true);
    expect(result.winner).toBeNull();
    expect(result.reason).toBe("draw");
  });

  it("ends when board is full", () => {
    const state = emptyState();
    let i = 0;
    for (const key of state.board.keys()) {
      state.board.set(key, i % 2 === 0 ? "P1" : "P2");
      i++;
    }
    const result = checkEnd(state);
    expect(result.over).toBe(true);
  });

  it("ends when both players are stuck (no legal moves) even if board is not full", () => {
    const state = emptyState({ status: "finished", consecutivePasses: 2 });
    state.board.set("0,0", "P1");
    const result = checkEnd(state);
    expect(result.over).toBe(true);
  });

  it("is not over while the board has space and status is active", () => {
    const state = createGame();
    const result = checkEnd(state);
    expect(result.over).toBe(false);
  });

  it("ends the match by piece-count majority when the shared clock expires, NOT an automatic loss for whoever had the turn", () => {
    const state = emptyState({ status: "active", turn: "P1" });
    let i = 0;
    for (const key of state.board.keys()) {
      // P1 controls a clear majority of the occupied cells, board not full.
      state.board.set(key, i < 40 ? "P1" : i < 55 ? "P2" : null);
      i++;
    }
    state.matchClockMs = 0;

    const result = checkEnd(state);
    expect(result.over).toBe(true);
    expect(result.winner).toBe("P1");
    expect(result.reason).toBe("timeout");
  });

  it("ends in a draw when the shared clock expires with equal cell counts", () => {
    const state = emptyState({ status: "active", turn: "P1" });
    let i = 0;
    for (const key of state.board.keys()) {
      state.board.set(key, i < 30 ? "P1" : i < 60 ? "P2" : null);
      i++;
    }
    state.matchClockMs = 0;

    const result = checkEnd(state);
    expect(result.over).toBe(true);
    expect(result.winner).toBeNull();
    expect(result.reason).toBe("timeout");
  });

  it("does not treat clock expiry as game-over while matchClockMs is still positive", () => {
    const state = createGame();
    state.matchClockMs = 1;
    const result = checkEnd(state);
    expect(result.over).toBe(false);
  });
});
