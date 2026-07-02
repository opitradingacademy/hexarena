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
export function HistoryList({ entries }: HistoryListProps) {
  if (entries.length === 0) {
    return <p data-testid="history-empty">No matches yet — play your first game.</p>;
  }

  return (
    <ul data-testid="history-list">
      {entries.map((entry) => (
        <li key={entry.matchId} data-testid={`history-row-${entry.matchId}`}>
          <span>{entry.date}</span>
          <span>{entry.mode}</span>
          <span>{entry.opponentAlias}</span>
          <span>{entry.result}</span>
          <span>
            {entry.amountUSD >= 0 ? "+" : ""}
            {formatUSD(entry.amountUSD)}
          </span>
        </li>
      ))}
    </ul>
  );
}
