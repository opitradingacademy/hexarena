import { useEffect, useRef, useState } from "react";
import type { Axial, GameState } from "@hexarena/shared/domain/board";
import { toDisplayCells } from "../lib/boardCells";

export type HexBoardProps = {
  state: GameState;
  onCellClick?: (at: Axial) => void;
  lastMove?: Axial | null;
  capturedKeys?: string[];
};

const HEX_SIZE_MOBILE = 20;
const HEX_SIZE_DESKTOP_MIN = 22;
const HEX_SIZE_DESKTOP_MAX = 32;
const BOARD_RADIUS = 4;
const SQRT3 = Math.sqrt(3);
const ASPECT = (BOARD_RADIUS + 1) * SQRT3 * 2;

const FILL_GOLD = "#ffcf3f";
const FILL_MAGENTA_SOFT = "rgba(255, 47, 208, 0.4)";
const FILL_CYAN = "#00f0ff";
const FILL_MAGENTA = "#ff2fd0";
const STROKE_DARK = "#0b0d17";
const STROKE_PICKER = "#0b0d17";

function hexCornerPoints(cx: number, cy: number, size: number): string {
  // Pointy-top hex: corners at angles 30°, 90°, 150°, 210°, 270°, 330°
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i - 30;
    const angleRad = (Math.PI / 180) * angleDeg;
    const x = cx + size * Math.cos(angleRad);
    const y = cy + size * Math.sin(angleRad);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
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

function computeBoardSize(hexSize: number) {
  const hexW = SQRT3 * hexSize;
  const center = (BOARD_RADIUS + 1) * hexW;
  const boardSize = center * 2;
  return { hexW, center, boardSize };
}

/**
 * Hex board renderer for the in-game screen (design.md "3. In-Game Board").
 *
 * Each cell is rendered as an inline SVG `<polygon>` with the 6 corner
 * points computed analytically for pointy-top hexagons. This is a true
 * geometric hexagon (not a clip-path approximation) so the diagonals
 * render correctly at any size, and the dark stroke between adjacent
 * cells produces the visible hex grid the user asked for.
 */
export function HexBoard({ state, onCellClick, lastMove, capturedKeys = [] }: HexBoardProps) {
  const cells = toDisplayCells(state);
  const capturedSet = new Set(capturedKeys);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hexSize, setHexSize] = useState(HEX_SIZE_MOBILE);

  useEffect(() => {
    function recompute() {
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

  const { center, boardSize } = computeBoardSize(hexSize);
  // Inset between cells. Pixels per hex size, ~6% of hexSize feels right.
  const strokeWidth = Math.max(1.5, hexSize * 0.08);
  const pieceRadius = Math.max(7, Math.min(11, hexSize * 0.4));

  function axialToPixel(q: number, r: number) {
    const x = hexSize * SQRT3 * (q + r / 2);
    const y = hexSize * 1.5 * r;
    return { x: x + center, y: y + center };
  }

  function handleKeyDown(e: React.KeyboardEvent<SVGGElement>, at: Axial) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onCellClick?.(at);
    }
  }

  return (
    <div
      ref={wrapRef}
      data-testid="hex-board-wrap"
      className="flex w-full justify-center overflow-hidden"
    >
      <svg
        data-testid="hex-board"
        role="grid"
        width={boardSize}
        height={boardSize}
        viewBox={`0 0 ${boardSize} ${boardSize}`}
        className="shrink-0"
      >
        {cells.map((cell) => {
          const { x, y } = axialToPixel(cell.q, cell.r);
          const isLastMove = lastMove && lastMove.q === cell.q && lastMove.r === cell.r;
          const isCaptured = capturedSet.has(cell.key);
          const points = hexCornerPoints(x, y, hexSize);
          const fill = isCaptured ? FILL_MAGENTA_SOFT : FILL_GOLD;
          const stroke = isLastMove ? STROKE_PICKER : STROKE_DARK;
          const strokeW = isLastMove ? strokeWidth * 2 : strokeWidth;

          return (
            <g
              key={cell.key}
              data-testid={`cell-${cell.key}`}
              data-occupant={cell.occupant ?? "empty"}
              role="gridcell"
              tabIndex={onCellClick ? 0 : -1}
              onClick={() => onCellClick?.({ q: cell.q, r: cell.r })}
              onKeyDown={(e) => handleKeyDown(e, { q: cell.q, r: cell.r })}
              style={{ cursor: onCellClick ? "pointer" : "default" }}
            >
              <polygon
                points={points}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeW}
                strokeLinejoin="round"
              />
              {cell.occupant && (
                <circle
                  cx={x}
                  cy={y}
                  r={pieceRadius}
                  fill={cell.occupant === "P1" ? FILL_CYAN : FILL_MAGENTA}
                  stroke={STROKE_DARK}
                  strokeWidth={strokeWidth}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
