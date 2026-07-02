import { ALL_CELLS, cellKey, type Axial, type GameState, type PlayerId } from "@hexarena/shared/domain/board";

export type DisplayCell = Axial & { key: string; occupant: PlayerId | null };

/**
 * Flattens the domain `GameState.board` Map into a renderable array of
 * cells, one per axial coordinate — used by the in-game board screen
 * (design.md wireframe "3. In-Game Board").
 */
export function toDisplayCells(state: GameState): DisplayCell[] {
  return ALL_CELLS.map((cell) => ({
    ...cell,
    key: cellKey(cell),
    occupant: state.board.get(cellKey(cell)) ?? null,
  }));
}
