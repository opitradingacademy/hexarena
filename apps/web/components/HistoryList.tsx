import { formatUSD } from "../lib/formatUSD";
import { shortenAddress } from "../lib/shortenAddress";

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

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Display-side truncation for the opponent's identifier. Wallet
 * addresses (full 0x + 40 hex) are rendered in the project's canonical
 * 6+4 form so the row doesn't overflow the card on mobile. Anything
 * else (an alias) is shown as-is.
 */
function displayOpponent(alias: string): string {
  return ADDRESS_RE.test(alias) ? shortenAddress(alias) : alias;
}

/** History screen (design.md "4. Result / History") — reverse-chronological rows. */
const RESULT_STYLE: Record<HistoryEntry["result"], string> = {
  WIN: "text-arena-green",
  LOSE: "text-arena-magenta",
  DRAW: "text-slate-400",
};

export function HistoryList({ entries }: HistoryListProps) {
  if (entries.length === 0) {
    return (
      <p
        data-testid="history-empty"
        className="rounded-xl border border-arena-border bg-arena-surface p-6 text-center text-sm text-slate-400"
      >
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
          className="flex items-center justify-between gap-3 rounded-xl border border-arena-border bg-arena-surface px-4 py-3 text-sm"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold text-white">
              {displayOpponent(entry.opponentAlias)}
            </span>
            <span className="text-xs text-slate-400">
              {entry.date} · {entry.mode}
            </span>
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <span className={`text-xs font-bold uppercase ${RESULT_STYLE[entry.result]}`}>
              {entry.result}
            </span>
            <span
              className={`font-mono text-sm ${entry.amountUSD >= 0 ? "text-arena-green" : "text-arena-magenta"}`}
            >
              {entry.amountUSD >= 0 ? "+" : ""}
              {formatUSD(entry.amountUSD)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
