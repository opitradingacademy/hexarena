import { useEffect, useRef, useState } from "react";
import type { Axial, GameState } from "@hexarena/shared/domain/board";
import { toDisplayCells } from "../lib/boardCells";

export type HexBoardProps = {
  state: GameState;
  onCellClick?: (at: Axial) => void;
  lastMove?: Axial | null;
  capturedKeys?: string[];
};

const HEX_SIZE_MOBILE = 20; // px, center-to-corner radius (mobile default)
const HEX_SIZE_DESKTOP_MIN = 22; // floor for desktop — keep parity with mobile
const HEX_SIZE_DESKTOP_MAX = 32; // ceiling — board never exceeds ~553px wide
const BOARD_RADIUS = 4;
const SQRT3 = Math.sqrt(3);
const ASPECT = (BOARD_RADIUS + 1) * SQRT3 * 2; // board width per unit hexSize

function computeBoardSize(hexSize: number) {
  const hexW = SQRT3 * hexSize;
  const hexH = 2 * hexSize;
  const center = (BOARD_RADIUS + 1) * hexW;
  const boardSize = center * 2;
  return { hexW, hexH, center, boardSize };
}

export const PIECE_COLOR: Record<"P1" | "P2", string> = {
  P1: "bg-arena-cyan shadow-neonCyan",
  P2: "bg-arena-magenta shadow-neonMagenta",
};

export const PIECE_COLOR_NAME: Record<"P1" | "P2", string> = {
  P1: "Cyan",
  P2: "Magenta",
};

export const HEX_BOARD_MOBILE_BOARD_SIZE = computeBoardSize(HEX_SIZE_MOBILE).boardSize;

/**
 * Hex board renderer for the in-game screen (design.md "3. In-Game Board").
 * Renders all 61 radius-4 axial cells in a real pointy-top hexagonal layout
 * (axial -> pixel projection), each cell clipped into a hexagon shape.
 *
 * Responsive sizing:
 *   - mobile (<640px viewport): fixed HEX_SIZE_MOBILE (~346px board). The
 *     mobile container max-w-md (448px) gives enough room and keeps hexes
 *     crisp.
 *   - desktop (≥640px viewport): hexSize scales with viewport width, capped
 *     between HEX_SIZE_DESKTOP_MIN and HEX_SIZE_DESKTOP_MAX. This stops the
 *     board from looking lost on wide viewports.
 *
 * Threshold is `window.innerWidth`, NOT the container width, because the
 * game page wraps HexBoard in `max-w-md` (~416px) — measuring the container
 * would always return a mobile-sized width and the board would never scale.
 */
export function HexBoard({ state, onCellClick, lastMove, capturedKeys = [] }: HexBoardProps) {
  const cells = toDisplayCells(state);
  const capturedSet = new Set(capturedKeys);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hexSize, setHexSize] = useState(HEX_SIZE_MOBILE);

  useEffect(() => {
    function recompute() {
      const el = wrapRef.current;
      if (!el) return;
      // Use the viewport width, NOT the container width: the game page
      // wraps HexBoard in a div with `max-w-md` (~416px), so container
      // width would always be under the desktop threshold and the board
      // would never scale up. Viewport width is the correct signal.
      const vw = window.innerWidth;
      if (vw < 640) {
        setHexSize(HEX_SIZE_MOBILE);
        return;
      }
      const desired = vw / ASPECT;
      const clamped = Math.max(HEX_SIZE_DESKTOP_MIN, Math.min(HEX_SIZE_DESKTOP_MAX, desired));
      setHexSize(clamped);
    }
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);

  const { hexH, center, boardSize } = computeBoardSize(hexSize);
  // Each cell button is SQUARE (`hexH × hexH`), not `hexW × hexH`. The
  // clip-path polygon uses percentages and only renders a regular hexagon
  // when the host element is square. A pointy-top hex has hexW < hexH,
  // so making the button hexW × hexH squashes the hexagon horizontally
  // and only the top/bottom triangles remain visible.
  const cellSide = hexH;
  const piecePx = Math.max(14, Math.min(20, hexSize * 0.7));

  function axialToPixel(q: number, r: number) {
    const x = hexSize * SQRT3 * (q + r / 2);
    const y = hexSize * 1.5 * r;
    return { x: x + center, y: y + center };
  }

  return (
    <div
      ref={wrapRef}
      data-testid="hex-board-wrap"
      className="flex w-full justify-center overflow-hidden"
    >
      <div
        data-testid="hex-board"
        role="grid"
        className="relative shrink-0"
        style={{ width: boardSize, height: boardSize }}
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
              className={`absolute flex items-center justify-center border border-arena-gold/30 bg-arena-gold transition ${
                isLastMove ? "ring-2 ring-arena-bg" : ""
              } ${isCaptured ? "animate-pulse bg-arena-magenta/40" : ""}`}
              style={{
                width: cellSide,
                height: cellSide,
                left: x - cellSide / 2,
                top: y - cellSide / 2,
                clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
              }}
            >
              {cell.occupant && (
                <span
                  className={`block rounded-full outline outline-2 outline-arena-bg outline-offset-[-2px] ${PIECE_COLOR[cell.occupant]}`}
                  aria-hidden
                  style={{ width: piecePx, height: piecePx }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
