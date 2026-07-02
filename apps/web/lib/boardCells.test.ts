import { describe, expect, it } from "vitest";
import { createGame } from "@hexarena/shared/domain/board";
import { toDisplayCells } from "./boardCells";

describe("toDisplayCells", () => {
  it("returns exactly 61 cells for the radius-4 board", () => {
    const state = createGame();
    expect(toDisplayCells(state)).toHaveLength(61);
  });

  it("reflects the initial 3-vs-3 starting layout occupants", () => {
    const state = createGame();
    const cells = toDisplayCells(state);
    const occupied = cells.filter((c) => c.occupant !== null);
    expect(occupied).toHaveLength(6);
    const p1 = occupied.filter((c) => c.occupant === "P1");
    const p2 = occupied.filter((c) => c.occupant === "P2");
    expect(p1).toHaveLength(3);
    expect(p2).toHaveLength(3);
  });
});
