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
      <div data-testid="mode-card-casual">
        <h3>Casual</h3>
        <button type="button">Play now</button>
      </div>
    );
  }

  const canPlay = balanceUSD > 0;
  return (
    <div data-testid="mode-card-arena">
      <h3>Arena</h3>
      <p>$0.10–$1</p>
      {canPlay ? (
        <button type="button">Play for real</button>
      ) : (
        <button type="button" disabled>
          Add funds to play
        </button>
      )}
    </div>
  );
}
