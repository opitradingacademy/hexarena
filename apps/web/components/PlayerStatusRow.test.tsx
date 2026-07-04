// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerStatusRow } from "./PlayerStatusRow";

describe("PlayerStatusRow", () => {
  it("renders the live captured-piece count, starting at 3 at match start", () => {
    render(<PlayerStatusRow label="You" captureCount={3} isTurn isSelf />);
    expect(screen.getByTestId("capture-count")).toHaveTextContent("3");
  });

  it("updates the displayed count on rerender after a capture", () => {
    const { rerender } = render(<PlayerStatusRow label="You" captureCount={3} isTurn isSelf />);
    expect(screen.getByTestId("capture-count")).toHaveTextContent("3");

    rerender(<PlayerStatusRow label="You" captureCount={7} isTurn isSelf />);
    expect(screen.getByTestId("capture-count")).toHaveTextContent("7");
  });

  it("labels the turn from this row's own perspective, never claiming the other player's turn", () => {
    const { rerender } = render(<PlayerStatusRow label="You" captureCount={3} isTurn isSelf />);
    expect(screen.getByText("Your turn")).toBeInTheDocument();

    rerender(<PlayerStatusRow label="You" captureCount={3} isTurn={false} isSelf />);
    expect(screen.getByText("Waiting…")).toBeInTheDocument();

    rerender(<PlayerStatusRow label="Opponent" captureCount={3} isTurn isSelf={false} />);
    expect(screen.getByText("Opponent's turn")).toBeInTheDocument();

    rerender(<PlayerStatusRow label="Opponent" captureCount={3} isTurn={false} isSelf={false} />);
    expect(screen.getByText("Waiting…")).toBeInTheDocument();
  });
});
