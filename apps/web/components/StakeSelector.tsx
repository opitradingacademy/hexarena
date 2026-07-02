import { formatUSD } from "../lib/formatUSD";

export type StakeSelectorProps = {
  balanceUSD: number;
  selectedStake: number | null;
  onSelect: (stake: number) => void;
};

const STAKE_OPTIONS = [0.1, 0.25, 0.5, 1];

/**
 * Matchmaking screen stake chip selector (design.md "2. Matchmaking Queue").
 * Chips are disabled when balance is below the stake amount.
 */
export function StakeSelector({ balanceUSD, selectedStake, onSelect }: StakeSelectorProps) {
  return (
    <div data-testid="stake-selector" className="flex flex-wrap gap-2">
      {STAKE_OPTIONS.map((stake) => {
        const disabled = balanceUSD < stake;
        const selected = selectedStake === stake;
        return (
          <button
            key={stake}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            title={disabled ? "Add funds" : undefined}
            onClick={() => onSelect(stake)}
            className={`rounded-full border px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-30 ${
              selected
                ? "border-arena-gold bg-arena-gold text-arena-bg"
                : "border-arena-border bg-arena-surface text-slate-200"
            }`}
          >
            {formatUSD(stake)}
          </button>
        );
      })}
    </div>
  );
}
