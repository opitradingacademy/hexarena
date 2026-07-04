export type PlayerStatusRowProps = {
  label: string;
  captureCount: number;
  isTurn: boolean;
  isSelf: boolean;
  pieceColorClassName?: string;
};

/**
 * Replaces the old `PlayerClock` (which owned a per-player countdown).
 * Now shows only turn state + live captured-piece count — the countdown
 * itself lives once in `MatchClock`. `isSelf` disambiguates the turn label
 * from `isTurn` so the opponent's row never claims "Your turn".
 */
export function PlayerStatusRow({
  label,
  captureCount,
  isTurn,
  isSelf,
  pieceColorClassName,
}: PlayerStatusRowProps) {
  const turnText = isTurn ? (isSelf ? "Your turn" : "Opponent's turn") : "Waiting…";
  return (
    <div
      data-testid="player-status-row"
      data-is-turn={isTurn}
      className={`flex items-center justify-between rounded-xl border px-4 py-2 transition ${
        isTurn ? "border-arena-cyan bg-arena-surface shadow-neonCyan" : "border-arena-border bg-arena-surface/50 opacity-60"
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
        {pieceColorClassName && (
          <span
            data-testid="player-status-piece-color"
            className={`h-2.5 w-2.5 rounded-full ${pieceColorClassName}`}
            aria-hidden
          />
        )}
        {label}
      </span>
      <span data-testid="capture-count" className="font-mono text-lg font-bold text-white">
        {captureCount}
      </span>
      <span className={`text-xs font-bold uppercase ${isTurn ? "text-arena-cyan" : "text-slate-500"}`}>
        {turnText}
      </span>
    </div>
  );
}
