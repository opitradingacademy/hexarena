import { describe, expect, it } from "vitest";
import { createGame } from "@hexarena/shared/domain/board";
import { countPieces } from "./captureCount";

describe("countPieces", () => {
  it("counts 3-3 at match start", () => {
    const state = createGame();
    expect(countPieces(state.board)).toEqual({ P1: 3, P2: 3 });
  });

  it("reflects captures after cells flip", () => {
    const board = new Map<string, "P1" | "P2" | null>([
      ["0,0", "P1"],
      ["1,0", "P1"],
      ["2,0", "P2"],
      ["3,0", null],
    ]);
    expect(countPieces(board)).toEqual({ P1: 2, P2: 1 });
  });
});
