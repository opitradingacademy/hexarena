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

  const bannerColor = isDraw ? "text-slate-300" : won ? "text-arena-green" : "text-arena-magenta";
  const bannerGlow = isDraw ? "" : won ? "shadow-neonCyan border-arena-green/50" : "border-arena-magenta/50";

  return (
    <div
      data-testid="result-banner"
      data-banner={banner}
      className={`rounded-2xl border bg-arena-surface p-6 text-center ${bannerGlow || "border-arena-border"}`}
    >
      <h2 className={`text-3xl font-black uppercase tracking-widest ${bannerColor}`}>{banner}</h2>
      <p className="mt-1 text-sm text-slate-400">{REASON_LABEL[result.reason]}</p>
      {result.arena && (
        <div data-testid="arena-prize" className="mt-4 rounded-xl border border-arena-gold/40 bg-arena-gold/10 p-3">
          {won ? (
            <p className="text-lg font-bold text-arena-gold">You won {formatUSD(result.arena.prizeUSD)}</p>
          ) : (
            <p className="text-sm text-slate-300">Prize: {formatUSD(result.arena.prizeUSD)}</p>
          )}
          <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">
            {result.arena.settleTxPending ? "Payout processing…" : "Payout sent"}
          </p>
        </div>
      )}
    </div>
  );
}
