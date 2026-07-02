import { formatClock } from "../lib/formatClock";

export type PlayerClockProps = {
  label: string;
  remainingMs: number;
  isTurn: boolean;
  isSelf: boolean;
  pieceColorClassName?: string;
};

const LOW_TIME_THRESHOLD_MS = 15_000;

/**
 * Clock display for the in-game board screen (design.md "3. In-Game Board")
 * — turns "red"/urgent below 15s, dims when it's not this player's turn.
 * `isSelf` disambiguates the turn label from `isTurn` (whose turn it is)
 * so the opponent's row never claims "Your turn" — each row states the
 * turn from its OWN owner's perspective.
 */
export function PlayerClock({
  label,
  remainingMs,
  isTurn,
  isSelf,
  pieceColorClassName,
}: PlayerClockProps) {
  const low = remainingMs < LOW_TIME_THRESHOLD_MS;
  const turnText = isTurn ? (isSelf ? "Your turn" : "Opponent's turn") : "Waiting…";
  return (
    <div
      data-testid="player-clock"
      data-low-time={low}
      data-is-turn={isTurn}
      className={`flex items-center justify-between rounded-xl border px-4 py-2 transition ${
        isTurn ? "border-arena-cyan bg-arena-surface shadow-neonCyan" : "border-arena-border bg-arena-surface/50 opacity-60"
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
        {pieceColorClassName && (
          <span
            data-testid="player-clock-piece-color"
            className={`h-2.5 w-2.5 rounded-full ${pieceColorClassName}`}
            aria-hidden
          />
        )}
        {label}
      </span>
      <span
        data-testid="clock-value"
        className={`font-mono text-lg font-bold ${low ? "text-red-500" : "text-white"}`}
      >
        {formatClock(remainingMs)}
      </span>
      <span className={`text-xs font-bold uppercase ${isTurn ? "text-arena-cyan" : "text-slate-500"}`}>
        {turnText}
      </span>
    </div>
  );
}
