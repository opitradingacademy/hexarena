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
    <div
      data-testid="player-clock"
      data-low-time={low}
      data-is-turn={isTurn}
      className={`flex items-center justify-between rounded-xl border px-4 py-2 transition ${
        isTurn ? "border-arena-cyan bg-arena-surface shadow-neonCyan" : "border-arena-border bg-arena-surface/50 opacity-60"
      }`}
    >
      <span className="text-sm font-semibold uppercase tracking-wide text-slate-300">{label}</span>
      <span
        data-testid="clock-value"
        className={`font-mono text-lg font-bold ${low ? "text-red-500" : "text-white"}`}
      >
        {formatClock(remainingMs)}
      </span>
      <span className={`text-xs font-bold uppercase ${isTurn ? "text-arena-cyan" : "text-slate-500"}`}>
        {isTurn ? "Your turn" : "Opponent's turn"}
      </span>
    </div>
  );
}
