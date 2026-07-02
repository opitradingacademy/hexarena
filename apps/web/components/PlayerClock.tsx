import { formatClock } from "../lib/formatClock";

export type PlayerClockProps = {
  label: string;
  remainingMs: number;
  isTurn: boolean;
};

const LOW_TIME_THRESHOLD_MS = 15_000;

/**
 * Clock display for the in-game board screen (design.md "3. In-Game Board")
 * — turns "red"/urgent below 15s, dims when it's not this player's turn.
 */
export function PlayerClock({ label, remainingMs, isTurn }: PlayerClockProps) {
  const low = remainingMs < LOW_TIME_THRESHOLD_MS;
  return (
    <div data-testid="player-clock" data-low-time={low} data-is-turn={isTurn}>
      <span>{label}</span>
      <span data-testid="clock-value">{formatClock(remainingMs)}</span>
      <span>{isTurn ? "Your turn" : "Opponent's turn"}</span>
    </div>
  );
}
