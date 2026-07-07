import { formatUSD } from "../lib/formatUSD";

export type StakeSelectorProps = {
  balanceUSD: number;
  selectedStake: number | null;
  onSelect: (stake: number) => void;
};

const STAKE_OPTIONS = [0.1, 0.25, 0.5, 1];

/**
 * Matchmaking screen stake chip selector (design.md "2. Matchmaking
 * Queue"). Chips are clickable even when the user's ledger balance
 * doesn't cover them — the matchmaking screen (not the selector)
 * decides whether to pre-open the stake modal. The user shouldn't
 * have to think about "do I have funds?" before they pick a stake
 * amount.
 */
export function StakeSelector({ balanceUSD, selectedStake, onSelect }: StakeSelectorProps) {
  return (
    <div data-testid="stake-selector">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Your stake</p>
        <p data-testid="stake-selector-hint" className="text-[11px] text-slate-500">
          What you&rsquo;ll put in the match
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {STAKE_OPTIONS.map((stake) => {
          const selected = selectedStake === stake;
          return (
            <button
              key={stake}
              type="button"
              aria-pressed={selected}
              data-testid={`stake-chip-${stake}`}
              onClick={() => onSelect(stake)}
              className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
                selected
                  ? "border-arena-gold bg-arena-gold text-arena-bg"
                  : "border-arena-border bg-arena-surface text-slate-200 hover:border-arena-gold/50"
              }`}
            >
              <div className="flex flex-col items-center gap-0.5">
                <span>{formatUSD(stake)}</span>
                {balanceUSD < stake && (
                  <span className="text-[9px] uppercase tracking-wider opacity-70">Top up</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
