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
    <div data-testid="stake-selector">
      {STAKE_OPTIONS.map((stake) => {
        const disabled = balanceUSD < stake;
        return (
          <button
            key={stake}
            type="button"
            disabled={disabled}
            aria-pressed={selectedStake === stake}
            title={disabled ? "Add funds" : undefined}
            onClick={() => onSelect(stake)}
          >
            {formatUSD(stake)}
          </button>
        );
      })}
    </div>
  );
}
