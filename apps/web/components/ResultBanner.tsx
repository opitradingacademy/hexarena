import type { GameOverPayload } from "@hexarena/shared/protocol";
import { formatUSD } from "../lib/formatUSD";

export type ResultBannerProps = {
  result: GameOverPayload;
  selfPlayer: "P1" | "P2";
};

const REASON_LABEL: Record<GameOverPayload["reason"], string> = {
  majority: "Enclosed majority",
  draw: "Draw",
  timeout: "Time out",
  resign: "Opponent resigned",
  abandon: "Opponent left",
};

/**
 * Result modal for the end-of-match screen (design.md "4. Result / History").
 * Never shows a tx hash or "gas" language — only a prize line + payout status.
 */
export function ResultBanner({ result, selfPlayer }: ResultBannerProps) {
  const won = result.winner === selfPlayer;
  const isDraw = result.winner === null;
  const banner = isDraw ? "DRAW" : won ? "WIN" : "LOSE";

  return (
    <div data-testid="result-banner" data-banner={banner}>
      <h2>{banner}</h2>
      <p>{REASON_LABEL[result.reason]}</p>
      {result.arena && (
        <div data-testid="arena-prize">
          {won ? (
            <p>You won {formatUSD(result.arena.prizeUSD)}</p>
          ) : (
            <p>Prize: {formatUSD(result.arena.prizeUSD)}</p>
          )}
          <p>{result.arena.settleTxPending ? "Payout processing…" : "Payout sent"}</p>
        </div>
      )}
      <button type="button">Rematch</button>
      <button type="button">Back to Dashboard</button>
    </div>
  );
}
