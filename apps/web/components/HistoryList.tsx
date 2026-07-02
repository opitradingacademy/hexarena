import { formatUSD } from "../lib/formatUSD";

export type HistoryEntry = {
  matchId: string;
  date: string;
  mode: "CASUAL" | "ARENA";
  opponentAlias: string;
  result: "WIN" | "LOSE" | "DRAW";
  amountUSD: number;
};

export type HistoryListProps = {
  entries: HistoryEntry[];
};

/** History screen (design.md "4. Result / History") — reverse-chronological rows. */
const RESULT_STYLE: Record<HistoryEntry["result"], string> = {
  WIN: "text-arena-green",
  LOSE: "text-arena-magenta",
  DRAW: "text-slate-400",
};

export function HistoryList({ entries }: HistoryListProps) {
  if (entries.length === 0) {
    return (
      <p data-testid="history-empty" className="rounded-xl border border-arena-border bg-arena-surface p-6 text-center text-sm text-slate-400">
        No matches yet — play your first game.
      </p>
    );
  }

  return (
    <ul data-testid="history-list" className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li
          key={entry.matchId}
          data-testid={`history-row-${entry.matchId}`}
          className="flex items-center justify-between rounded-xl border border-arena-border bg-arena-surface px-4 py-3 text-sm"
        >
          <div className="flex flex-col">
            <span className="font-semibold text-white">{entry.opponentAlias}</span>
            <span className="text-xs text-slate-400">
              {entry.date} · {entry.mode}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className={`text-xs font-bold uppercase ${RESULT_STYLE[entry.result]}`}>{entry.result}</span>
            <span className={`font-mono text-sm ${entry.amountUSD >= 0 ? "text-arena-green" : "text-arena-magenta"}`}>
              {entry.amountUSD >= 0 ? "+" : ""}
              {formatUSD(entry.amountUSD)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
