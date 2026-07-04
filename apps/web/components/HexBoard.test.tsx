// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createGame } from "@hexarena/shared/domain/board";
import { HexBoard } from "./HexBoard";

describe("HexBoard", () => {
  it("renders all 61 radius-4 cells as grid cells", () => {
    render(<HexBoard state={createGame()} />);
    expect(screen.getAllByRole("gridcell")).toHaveLength(61);
  });

  it("marks the starting P1/P2 occupants on their respective cells", () => {
    render(<HexBoard state={createGame()} />);
    expect(screen.getByTestId("cell--2,0")).toHaveAttribute("data-occupant", "P1");
    expect(screen.getByTestId("cell--1,0")).toHaveAttribute("data-occupant", "P2");
  });

  it("invokes onCellClick with the clicked cell's axial coordinates", () => {
    const onCellClick = vi.fn();
    render(<HexBoard state={createGame()} onCellClick={onCellClick} />);
    fireEvent.click(screen.getByTestId("cell-0,0"));
    expect(onCellClick).toHaveBeenCalledWith({ q: 0, r: 0 });
  });

  it("uses the gold hex fill and dark piece outline for high contrast against bg-arena-bg", () => {
    render(<HexBoard state={createGame()} />);
    const emptyCell = screen.getByTestId("cell-0,0");
    expect(emptyCell.className).toContain("bg-arena-gold");
    const p1Cell = screen.getByTestId("cell--2,0");
    const p1Piece = p1Cell.querySelector("span");
    expect(p1Piece?.className).toContain("outline-arena-bg");
  });
});
