import type { Axial, GameState } from "@hexarena/shared/domain/board";
import { toDisplayCells } from "../lib/boardCells";

export type HexBoardProps = {
  state: GameState;
  onCellClick?: (at: Axial) => void;
  lastMove?: Axial | null;
  capturedKeys?: string[];
};

const HEX_SIZE = 20; // px, center-to-corner radius
const HEX_W = Math.sqrt(3) * HEX_SIZE; // pointy-top hex width
const HEX_H = 2 * HEX_SIZE;
const BOARD_RADIUS = 4;
const CENTER = (BOARD_RADIUS + 1) * HEX_W;
const BOARD_SIZE = CENTER * 2;

function axialToPixel(q: number, r: number) {
  const x = HEX_SIZE * Math.sqrt(3) * (q + r / 2);
  const y = HEX_SIZE * 1.5 * r;
  return { x: x + CENTER, y: y + CENTER };
}

const PIECE_COLOR: Record<"P1" | "P2", string> = {
  P1: "bg-arena-cyan shadow-neonCyan",
  P2: "bg-arena-magenta shadow-neonMagenta",
};

/**
 * Hex board renderer for the in-game screen (design.md "3. In-Game Board").
 * Renders all 61 radius-4 axial cells in a real pointy-top hexagonal layout
 * (axial -> pixel projection), each cell clipped into a hexagon shape.
 */
export function HexBoard({ state, onCellClick, lastMove, capturedKeys = [] }: HexBoardProps) {
  const cells = toDisplayCells(state);
  const capturedSet = new Set(capturedKeys);

  return (
    <div
      data-testid="hex-board"
      role="grid"
      className="relative mx-auto"
      style={{ width: BOARD_SIZE, height: BOARD_SIZE }}
    >
      {cells.map((cell) => {
        const { x, y } = axialToPixel(cell.q, cell.r);
        const isLastMove = lastMove && lastMove.q === cell.q && lastMove.r === cell.r;
        const isCaptured = capturedSet.has(cell.key);

        return (
          <button
            key={cell.key}
            type="button"
            role="gridcell"
            data-testid={`cell-${cell.key}`}
            data-occupant={cell.occupant ?? "empty"}
            onClick={() => onCellClick?.({ q: cell.q, r: cell.r })}
            className={`absolute flex items-center justify-center border border-arena-border/60 bg-arena-surface transition ${
              isLastMove ? "ring-2 ring-arena-gold" : ""
            } ${isCaptured ? "animate-pulse bg-arena-gold/30" : ""}`}
            style={{
              width: HEX_W,
              height: HEX_H,
              left: x - HEX_W / 2,
              top: y - HEX_H / 2,
              clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
            }}
          >
            {cell.occupant && (
              <span
                className={`h-3.5 w-3.5 rounded-full ${PIECE_COLOR[cell.occupant]}`}
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
