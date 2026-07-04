/**
 * Local bot opponent for CASUAL matches — greedy heuristic. Pure, no I/O,
 * same boundary rule as board.ts. See plan "Modo vs Máquina en Casual".
 */
import { applyMove, legalMoves, type Axial, type GameState, type PlayerId } from "./board";

/** Synthetic userId for the bot player — never has a socket. */
export const BOT_USER_ID = "BOT";

/**
 * Picks the legal move that captures the most pieces this turn, breaking
 * ties randomly. Returns null if the player has no legal move (shouldn't
 * happen mid-match — board.ts keeps the turn with whoever has moves).
 */
export function chooseBotMove(state: GameState, player: PlayerId): Axial | null {
  const moves = legalMoves(state, player);
  if (moves.length === 0) return null;

  let best: Axial[] = [];
  let bestCaptures = -1;
  for (const move of moves) {
    const result = applyMove(state, player, move);
    if ("error" in result) continue;
    const n = result.captures.length;
    if (n > bestCaptures) {
      bestCaptures = n;
      best = [move];
    } else if (n === bestCaptures) {
      best.push(move);
    }
  }

  return best[Math.floor(Math.random() * best.length)];
}
