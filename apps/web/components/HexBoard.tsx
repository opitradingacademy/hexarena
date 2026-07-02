import type { Axial, GameState } from "@hexarena/shared/domain/board";
import { toDisplayCells } from "../lib/boardCells";

export type HexBoardProps = {
  state: GameState;
  onCellClick?: (at: Axial) => void;
};

/**
 * Hex board renderer for the in-game screen (design.md "3. In-Game Board").
 * Renders all 61 radius-4 axial cells; visual hex layout is a follow-up
 * (this session ships functional structure, not the neon pixel-perfect
 * grid geometry).
 */
export function HexBoard({ state, onCellClick }: HexBoardProps) {
  const cells = toDisplayCells(state);

  return (
    <div data-testid="hex-board" role="grid">
      {cells.map((cell) => (
        <button
          key={cell.key}
          type="button"
          role="gridcell"
          data-testid={`cell-${cell.key}`}
          data-occupant={cell.occupant ?? "empty"}
          onClick={() => onCellClick?.({ q: cell.q, r: cell.r })}
        >
          {cell.occupant ?? ""}
        </button>
      ))}
    </div>
  );
}
