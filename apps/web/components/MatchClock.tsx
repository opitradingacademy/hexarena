import { formatClock } from "../lib/formatClock";

export type MatchClockProps = {
  matchClockMs: number;
};

const LOW_TIME_THRESHOLD_MS = 15_000;

/**
 * Single shared match clock — replaces the old per-player countdown pair.
 * See shared-match-timer spec "In-Game Clock Display": exactly ONE countdown
 * for the whole match, not one per player.
 */
export function MatchClock({ matchClockMs }: MatchClockProps) {
  const low = matchClockMs < LOW_TIME_THRESHOLD_MS;
  return (
    <div
      data-testid="match-clock"
      data-low-time={low}
      className="flex items-center justify-center rounded-xl border border-arena-cyan bg-arena-surface px-4 py-2 shadow-neonCyan"
    >
      <span
        data-testid="clock-value"
        className={`font-mono text-2xl font-bold ${low ? "text-red-500" : "text-white"}`}
      >
        {formatClock(matchClockMs)}
      </span>
    </div>
  );
}
