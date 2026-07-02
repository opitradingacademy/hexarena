export type ModeCardProps = {
  mode: "CASUAL" | "ARENA";
  balanceUSD: number;
};

/**
 * Dashboard hero-row mode card (design.md "1. Dashboard").
 * Arena card requires positive balance; otherwise nudges "Add funds" instead
 * of allowing "Play for real" — copy rule: no gas/crypto/CELO language.
 */
export function ModeCard({ mode, balanceUSD }: ModeCardProps) {
  if (mode === "CASUAL") {
    return (
      <div
        data-testid="mode-card-casual"
        className="rounded-2xl border border-arena-border bg-arena-surface p-5 shadow-neonCyan"
      >
        <h3 className="text-lg font-black uppercase tracking-wide text-arena-cyan">Casual</h3>
        <p className="mt-1 text-sm text-slate-400">Free · practice matches</p>
        <button
          type="button"
          className="mt-4 w-full rounded-xl bg-arena-cyan py-2 text-sm font-bold uppercase text-arena-bg transition hover:brightness-110"
        >
          Play now
        </button>
      </div>
    );
  }

  const canPlay = balanceUSD > 0;
  return (
    <div
      data-testid="mode-card-arena"
      className="rounded-2xl border border-arena-gold/50 bg-arena-surface p-5 shadow-neonGold"
    >
      <h3 className="text-lg font-black uppercase tracking-wide text-arena-gold">Arena</h3>
      <p className="mt-1 text-sm text-slate-400">$0.10–$1</p>
      {canPlay ? (
        <button
          type="button"
          className="mt-4 w-full rounded-xl bg-arena-gold py-2 text-sm font-bold uppercase text-arena-bg transition hover:brightness-110"
        >
          Play for real
        </button>
      ) : (
        <button
          type="button"
          disabled
          className="mt-4 w-full cursor-not-allowed rounded-xl border border-arena-border py-2 text-sm font-bold uppercase text-slate-500"
        >
          Add funds to play
        </button>
      )}
    </div>
  );
}
