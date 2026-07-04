import type { PlayerId } from "@hexarena/shared/domain/board";

/** Derives each player's live captured-piece count straight from the board state — no server field needed. */
export function countPieces(board: Map<string, PlayerId | null>): Record<PlayerId, number> {
  const counts: Record<PlayerId, number> = { P1: 0, P2: 0 };
  for (const v of board.values()) {
    if (v === "P1") counts.P1++;
    if (v === "P2") counts.P2++;
  }
  return counts;
}
